# Measures real internet throughput (download + upload) and latency for the
# machine's internet uplink, and emits the result as JSON.
#
# Optionally pins the test to a given local source IP so it reflects a specific
# adapter's uplink. This is best effort: the bound connection is probed first,
# and if it cannot connect - common for VPN tunnel adapters (NordLynx,
# WireGuard, etc.) whose tunnel IP is not directly bindable - the test
# transparently falls back to the machine's default route. The `Bound` field
# in the output reports which path was actually used.
#
# Uses Cloudflare's public speed-test endpoints (no API key required):
#   https://speed.cloudflare.com/__down?bytes=N   - serves N bytes
#   https://speed.cloudflare.com/__up             - accepts a POST body
#
# Always exits 0 and emits a single JSON object so the caller can surface a
# clean error instead of a non-zero exit:
#   { Ok, DownMbps, UpMbps, PingMs, Bound, DownBytes, UpBytes, Error }

param(
  [string] $SourceIP  = '',
  [int]    $DownBytes = 20000000,
  [int]    $UpBytes   = 8000000
)

$ErrorActionPreference = 'Stop'

function Write-Result($obj) {
  ConvertTo-Json -InputObject $obj -Compress
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  [Net.ServicePointManager]::Expect100Continue = $false

  # $script:bindBlock is applied to every request's ServicePoint. It starts as
  # the source-IP binding (when requested) and is cleared to $null if that bind
  # turns out not to be routable, so the test falls back to the default route.
  $script:bindBlock = $null
  if ($SourceIP) {
    $ip = ($SourceIP -split ',')[0].Trim()
    if ($ip) {
      $ipObj = [System.Net.IPAddress]::Parse($ip)
      $localEP = New-Object System.Net.IPEndPoint -ArgumentList $ipObj, 0
      # BindIPEndPointDelegate cannot be named directly on Windows PowerShell
      # 5.1; assigning a scriptblock lets PowerShell coerce it to the delegate.
      $script:bindBlock = {
        param($servicePoint, $remoteEndPoint, $retryCount)
        return $localEP
      }.GetNewClosure()
    }
  }

  function New-Req([string]$Url, [int]$TimeoutMs) {
    $r = [System.Net.HttpWebRequest]::Create($Url)
    $r.Timeout = $TimeoutMs
    $r.ReadWriteTimeout = $TimeoutMs
    $r.Proxy = $null
    # Assigning $null also clears a binding left on a cached ServicePoint.
    $r.ServicePoint.BindIPEndPointDelegate = $script:bindBlock
    return $r
  }

  function Test-Reachable {
    try {
      $r = New-Req 'https://speed.cloudflare.com/__down?bytes=0' 8000
      $r.Method = 'GET'
      $r.KeepAlive = $false
      $resp = $r.GetResponse()
      $resp.Dispose()
      return $true
    } catch {
      return $false
    }
  }

  # Verify the endpoint is reachable. If a source-IP bind was requested but the
  # bound connection fails, drop the bind and retry over the default route.
  $bound = [bool]$script:bindBlock
  if (-not (Test-Reachable)) {
    if ($script:bindBlock) {
      $script:bindBlock = $null
      $bound = $false
    }
    if (-not (Test-Reachable)) {
      throw 'Cannot reach the speed-test server (speed.cloudflare.com).'
    }
  }

  # --- Latency: reuse one keep-alive connection, take the fastest of 4 ---
  $pingMs = $null
  try {
    $samples = @()
    for ($i = -1; $i -lt 4; $i++) {
      $r = New-Req 'https://speed.cloudflare.com/__down?bytes=0' 8000
      $r.Method = 'GET'
      $r.KeepAlive = $true
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $resp = $r.GetResponse()
      $s = $resp.GetResponseStream()
      $b = New-Object byte[] 64
      while ($s.Read($b, 0, $b.Length) -gt 0) {}
      $sw.Stop()
      $s.Dispose(); $resp.Dispose()
      # i = -1 is a warm-up request (TLS handshake) and is discarded.
      if ($i -ge 0) { $samples += $sw.Elapsed.TotalMilliseconds }
    }
    if ($samples.Count -gt 0) {
      $pingMs = [math]::Round(($samples | Measure-Object -Minimum).Minimum, 1)
    }
  } catch { $pingMs = $null }

  # --- Download ---
  $r = New-Req "https://speed.cloudflare.com/__down?bytes=$DownBytes" 60000
  $r.Method = 'GET'
  $r.KeepAlive = $false
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $resp = $r.GetResponse()
  $stream = $resp.GetResponseStream()
  $buf = New-Object byte[] 81920
  $downTotal = [int64]0
  while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) { $downTotal += $n }
  $sw.Stop()
  $stream.Dispose(); $resp.Dispose()
  $downSecs = [math]::Max($sw.Elapsed.TotalSeconds, 0.001)
  $downMbps = [math]::Round(($downTotal * 8) / $downSecs / 1000000, 1)

  # --- Upload ---
  $r = New-Req 'https://speed.cloudflare.com/__up' 60000
  $r.Method = 'POST'
  $r.ContentType = 'application/octet-stream'
  $r.KeepAlive = $false
  $r.ContentLength = $UpBytes
  $chunk = New-Object byte[] 81920
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $rs = $r.GetRequestStream()
  $upSent = 0
  while ($upSent -lt $UpBytes) {
    $n = [math]::Min($chunk.Length, $UpBytes - $upSent)
    $rs.Write($chunk, 0, $n)
    $upSent += $n
  }
  $rs.Dispose()
  $resp = $r.GetResponse()
  $resp.Dispose()
  $sw.Stop()
  $upSecs = [math]::Max($sw.Elapsed.TotalSeconds, 0.001)
  $upMbps = [math]::Round(($UpBytes * 8) / $upSecs / 1000000, 1)

  Write-Result ([PSCustomObject]@{
    Ok        = $true
    DownMbps  = $downMbps
    UpMbps    = $upMbps
    PingMs    = $pingMs
    Bound     = $bound
    DownBytes = $downTotal
    UpBytes   = $UpBytes
    Error     = $null
  })
} catch {
  Write-Result ([PSCustomObject]@{
    Ok        = $false
    DownMbps  = $null
    UpMbps    = $null
    PingMs    = $null
    Bound     = $false
    DownBytes = 0
    UpBytes   = 0
    Error     = $_.Exception.Message
  })
}
