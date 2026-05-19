# Lists devices currently connected to the given ICS target adapter.
#
# Why the cache alone is not enough: ICS's built-in DHCP server inserts each
# lease into Windows' neighbor cache as State=Permanent. Permanent entries
# never age out — when a device renews and gets a new IP, BOTH the old
# (e.g. .253) and new (e.g. .42) entries persist with the same MAC and the
# same Permanent state. Get-NetNeighbor + state filtering cannot tell them
# apart, so we have to actively probe each candidate IP to decide what is
# really online right now.
#
# Liveness check per candidate:
#   1. ICMP echo (from the broad async sweep, plus up to 2 retries for
#      devices that ignored the first attempt because of Wi-Fi power-save).
#   2. If ICMP stays silent, TCP-connect to a list of common ports — a
#      successful connect OR a fast ConnectionRefused (RST) both prove the
#      host is up. Catches devices that block ICMP but still expose any
#      port at all (Windows SMB, macOS SSH, routers' web UI, etc.).
# An IP that fails both layers is treated as offline and dropped, even if
# Windows still holds a Permanent neighbor entry for it.

param(
  [Parameter(Mandatory = $true)] [string] $TargetAdapter,
  [Parameter(Mandatory = $true)] [string] $GatewayIP
)

$ErrorActionPreference = 'Stop'

$adapter = Get-NetAdapter -Name $TargetAdapter -ErrorAction Stop
$ifIdx = $adapter.ifIndex
$network = $GatewayIP -replace '\.\d+$', '.'

# Async ICMP sweep of the whole /24. Keep the task-per-IP mapping so we can
# read each result instead of just using the sweep to refresh the cache.
$sweepPing = New-Object System.Net.NetworkInformation.Ping
$sweepPairs = New-Object System.Collections.Generic.List[object]
for ($i = 1; $i -le 254; $i++) {
  $ip = $network + $i
  if ($ip -eq $GatewayIP) { continue }
  try {
    $task = $sweepPing.SendPingAsync($ip, 400)
    $sweepPairs.Add(@{ IP = $ip; Task = $task })
  } catch {}
}
try {
  $allTasks = @($sweepPairs | ForEach-Object { $_.Task })
  [System.Threading.Tasks.Task]::WaitAll($allTasks, 1800) | Out-Null
} catch {}

$icmpAlive = @{}
foreach ($pair in $sweepPairs) {
  $t = $pair.Task
  if ($t.Status -eq 'RanToCompletion' -and $t.Result.Status -eq 'Success') {
    $icmpAlive[$pair.IP] = $true
  }
}

# Brief settle so the cache reflects any ARP replies that arrived after the
# ICMP timeout (Windows still updates the neighbor entry).
Start-Sleep -Milliseconds 150

function Test-IpAliveTcp([string]$ip) {
  # Try ports common on LAN devices. SMB/NetBIOS for Windows, SSH for *nix
  # and Macs, HTTP/HTTPS for printers and routers, RDP for desktops, 8080
  # for IoT admin UIs. A connect or a refusal both prove the host is alive.
  foreach ($port in 445, 139, 22, 80, 443, 3389, 8080) {
    $client = $null
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $task = $client.ConnectAsync($ip, $port)
      if ($task.Wait(250) -and $task.Status -eq 'RanToCompletion') { return $true }
    } catch {
      $inner = if ($_.Exception.InnerException) { $_.Exception.InnerException } else { $_.Exception }
      if ($inner -is [System.Net.Sockets.SocketException] -and
          $inner.SocketErrorCode -eq [System.Net.Sockets.SocketError]::ConnectionRefused) {
        return $true
      }
    } finally {
      if ($client) { try { $client.Close() } catch {} }
    }
  }
  return $false
}

function Test-IpAliveIcmpRetry([string]$ip) {
  # Two extra ICMP attempts for devices in Wi-Fi power-save that snoozed
  # through the broad sweep. Cheaper than a 7-port TCP probe.
  $p = New-Object System.Net.NetworkInformation.Ping
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    try {
      $reply = $p.Send($ip, 500)
      if ($reply.Status -eq 'Success') { return $true }
    } catch {}
  }
  return $false
}

$candidates = @(Get-NetNeighbor -InterfaceIndex $ifIdx -AddressFamily IPv4 -ErrorAction SilentlyContinue) |
  Where-Object {
    $_.IPAddress -ne $GatewayIP -and
    $_.IPAddress -notmatch '\.255$' -and
    $_.IPAddress.StartsWith($network) -and
    $_.LinkLayerAddress -and
    $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and
    $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' -and
    $_.State -ne 'Unreachable'
  }

$alive = foreach ($n in $candidates) {
  if ($icmpAlive.ContainsKey($n.IPAddress))    { $n; continue }
  if (Test-IpAliveIcmpRetry $n.IPAddress)      { $n; continue }
  if (Test-IpAliveTcp $n.IPAddress)            { $n; continue }
}
$alive = @($alive)

# Dedup-by-MAC over only the survivors. Two live entries with the same MAC
# would mean an actual IP conflict, which is rare; fall back to highest
# octet as a tiebreaker.
$byMac = @{}
foreach ($n in $alive) {
  $existing = $byMac[$n.LinkLayerAddress]
  if (-not $existing) { $byMac[$n.LinkLayerAddress] = $n; continue }
  $eOct = [int]($existing.IPAddress -split '\.')[-1]
  $nOct = [int]($n.IPAddress -split '\.')[-1]
  if ($nOct -gt $eOct) { $byMac[$n.LinkLayerAddress] = $n }
}

$out = foreach ($n in $byMac.Values) {
  $hostname = $null
  try {
    $r = Resolve-DnsName -Name $n.IPAddress -Type PTR -ErrorAction Stop -DnsOnly -QuickTimeout
    $ptr = $r | Where-Object { $_.QueryType -eq 'PTR' } | Select-Object -First 1
    if ($ptr) { $hostname = $ptr.NameHost -replace '\.$', '' }
  } catch {}

  [PSCustomObject]@{
    IPAddress        = $n.IPAddress
    LinkLayerAddress = $n.LinkLayerAddress
    State            = $n.State.ToString()
    HostName         = $hostname
  }
}

$out = $out | Sort-Object { [int]($_.IPAddress -split '\.')[-1] }
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
