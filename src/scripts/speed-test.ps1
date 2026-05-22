# Measures real internet throughput (download + upload) and latency for the
# machine's internet uplink, and emits the result as JSON.
#
# Optionally pins the test to a given local source IP so it reflects a specific
# adapter's uplink. This is best effort: Windows still routes by destination,
# but the connection's local endpoint is bound to the requested adapter's
# address, which is exactly what happens for the normal single-uplink case.
#
# Uses Cloudflare's public speed-test endpoints (no API key required):
#   https://speed.cloudflare.com/__down?bytes=N   - serves N bytes
#   https://speed.cloudflare.com/__up             - accepts a POST body
#
# Always exits 0 and emits a single JSON object so the caller can surface a
# clean error instead of a non-zero exit:
#   { Ok, DownMbps, UpMbps, PingMs, DownBytes, UpBytes, Error }

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

  # When a source IP is supplied, bind every connection's local endpoint to it
  # so the test runs over the chosen adapter. The delegate is attached to the
  # ServicePoint, which is shared per host - that is fine, all our requests go
  # to the same host. The BindIPEndPointDelegate type cannot be named directly
  # on Windows PowerShell 5.1, but assigning a scriptblock to the property
  # lets PowerShell coerce it to the delegate type automatically.
  $bindBlock = $null
  if ($SourceIP) {
    $ip = ($SourceIP -split ',')[0].Trim()
    $ipObj = [System.Net.IPAddress]::Parse($ip)
    $localEP = New-Object System.Net.IPEndPoint -ArgumentList $ipObj, 0
    $bindBlock = {
      param($servicePoint, $remoteEndPoint, $retryCount)
      return $localEP
    }.GetNewClosure()
  }

  function New-Req([string]$Url, [int]$TimeoutMs) {
    $r = [System.Net.HttpWebRequest]::Create($Url)
    $r.Timeout = $TimeoutMs
    $r.ReadWriteTimeout = $TimeoutMs
    $r.Proxy = $null
    if ($bindBlock) { $r.ServicePoint.BindIPEndPointDelegate = $bindBlock }
    return $r
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
    DownBytes = 0
    UpBytes   = 0
    Error     = $_.Exception.Message
  })
}
