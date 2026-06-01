# Detects Windows ICS state without admin elevation.
#  - ScopeAddress (the ICS gateway IP) is read from the registry - it defaults
#    to 192.168.137.1 but is user-configurable, so we never hardcode it.
#  - Target (private) = adapter currently holding that ScopeAddress IP.
#  - Source (public)  = up adapter with IPv4 Forwarding=Enabled, a default
#                       gateway, and not the target. Only considered when the
#                       SharedAccess service is Running.
# Emits a single JSON object:
#   { ServiceRunning, ScopeAddress, SourceName, TargetName, Adapters[] }

$ErrorActionPreference = 'Stop'

$adapters = @(Get-NetAdapter -IncludeHidden:$false)
$icsServiceRunning = ((Get-Service -Name SharedAccess -ErrorAction SilentlyContinue).Status -eq 'Running')

# Cumulative byte counters per adapter - the renderer diffs successive polls
# to derive UP/DOWN rates.
$stats = @{}
Get-NetAdapterStatistics -ErrorAction SilentlyContinue | ForEach-Object {
  $stats[$_.Name] = @{
    Received = [int64]$_.ReceivedBytes
    Sent     = [int64]$_.SentBytes
  }
}

# Windows' own per-adapter internet-reachability classification. Values include
# Internet / LocalNetwork / Subnet / NoTraffic / Disconnected. We only call an
# adapter "internet-connected" when Windows has actually verified Internet.
$connProfiles = @{}
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  $connProfiles[$_.InterfaceIndex] = @{
    IPv4Connectivity = $_.IPv4Connectivity
    IPv6Connectivity = $_.IPv6Connectivity
  }
}

# Configured ICS gateway IP. Windows uses 192.168.137.1 by default but a user
# may have changed this via the SharedAccess registry; respect what's there.
$scopeAddress = (Get-ItemProperty `
  -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters' `
  -Name 'ScopeAddress' -ErrorAction SilentlyContinue).ScopeAddress
if (-not $scopeAddress) { $scopeAddress = '192.168.137.1' }

$targetName = $null
$targetMatch = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -eq $scopeAddress } |
  Select-Object -First 1
if ($targetMatch) {
  $matchAdapter = $adapters | Where-Object { $_.ifIndex -eq $targetMatch.InterfaceIndex } | Select-Object -First 1
  if ($matchAdapter) { $targetName = $matchAdapter.Name }
}

$sourceName = $null
if ($targetName -and $icsServiceRunning) {
  foreach ($a in $adapters) {
    if ($a.Name -eq $targetName) { continue }
    if ($a.Status -ne 'Up') { continue }
    $fwd = (Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Forwarding
    $gw  = (Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
    if ($fwd -eq 'Enabled' -and $gw -and $gw -ne '0.0.0.0') {
      $sourceName = $a.Name
      break
    }
  }
}

$out = foreach ($a in $adapters) {
  # Capture IPv4 addresses (skipping APIPA 169.254.x.x). The bare IP is shown
  # in the UI for clarity; the prefix is exposed separately so the renderer can
  # surface the actual subnet range as a hover tooltip.
  $ipEntries = @(Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notmatch '^169\.254\.' } |
    ForEach-Object { [PSCustomObject]@{ IP = $_.IPAddress; Prefix = [int]$_.PrefixLength } })
  $ipv4         = ($ipEntries | ForEach-Object { $_.IP }) -join ', '
  $ipv4Prefixes = ($ipEntries | ForEach-Object { "$($_.IP)/$($_.Prefix)" }) -join ', '
  $gateway = (Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop

  $isSource = ($a.Name -eq $sourceName)
  $isTarget = ($a.Name -eq $targetName)
  $type = if ($isSource) { 0 } elseif ($isTarget) { 1 } else { -1 }

  $prof = $connProfiles[$a.ifIndex]
  $hasInternet = $false
  if ($prof) {
    $hasInternet = ($prof.IPv4Connectivity -eq 'Internet' -or $prof.IPv6Connectivity -eq 'Internet')
  }

  $aStats = $stats[$a.Name]
  $bytesIn  = if ($aStats) { $aStats.Received } else { 0 }
  $bytesOut = if ($aStats) { $aStats.Sent }     else { 0 }

  [PSCustomObject]@{
    Name                  = $a.Name
    InterfaceDescription  = $a.InterfaceDescription
    Status                = $a.Status
    MediaType             = $a.MediaType
    MacAddress            = $a.MacAddress
    LinkSpeed             = $a.LinkSpeed
    Virtual               = [bool]$a.Virtual
    IPv4Address           = $ipv4
    IPv4WithPrefix        = $ipv4Prefixes
    Gateway               = $gateway
    HasInternet           = $hasInternet
    BytesReceived         = $bytesIn
    BytesSent             = $bytesOut
    SharingEnabled        = ($isSource -or $isTarget)
    SharingConnectionType = $type
  }
}

$payload = [PSCustomObject]@{
  ServiceRunning = $icsServiceRunning
  ScopeAddress   = $scopeAddress
  SourceName     = $sourceName
  TargetName     = $targetName
  SampledAtMs    = [int64](([System.DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds())
  Adapters       = @($out)
}
ConvertTo-Json -InputObject $payload -Depth 4 -Compress
