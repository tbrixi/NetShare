# Lists devices currently connected to (or recently seen on) the given ICS
# target adapter. Pulls Get-NetNeighbor for the adapter's IPv4 neighbor cache,
# filters out broadcast / multicast / stale empty entries / the gateway
# itself, and best-effort resolves each IP to a hostname via reverse DNS.

param(
  [Parameter(Mandatory = $true)] [string] $TargetAdapter,
  [Parameter(Mandatory = $true)] [string] $GatewayIP
)

$ErrorActionPreference = 'Stop'

# Low-level ARP probe — the only reliable liveness check for ICS clients,
# because many devices (Roku, smart-home gear, etc.) don't respond to ICMP.
# Asks the network "who is X.X.X.X?" and waits for an ARP reply; returns
# true only when a device actually answers. Windows caps the timeout at
# roughly 1.5–3 s per call.
Add-Type -Namespace NetShare -Name Arp -MemberDefinition @'
[DllImport("iphlpapi.dll", ExactSpelling=true)]
public static extern int SendARP(int destIp, int srcIp, byte[] macAddr, ref int macLen);
'@

function Test-ArpReachable([string]$ip) {
  try {
    $bytes = ([System.Net.IPAddress]::Parse($ip)).GetAddressBytes()
    $destIp = [BitConverter]::ToInt32($bytes, 0)
    $mac = New-Object byte[] 6
    $len = 6
    return ([NetShare.Arp]::SendARP($destIp, 0, $mac, [ref]$len) -eq 0)
  } catch {
    return $false
  }
}

$adapter = Get-NetAdapter -Name $TargetAdapter -ErrorAction Stop
$ifIdx = $adapter.ifIndex

# Derive the ICS network base — anything sharing the first 3 octets of the
# gateway IP is "on the network" for our purposes (ICS always /24).
$network = $GatewayIP -replace '\.\d+$', '.'

$neighbors = @(Get-NetNeighbor -InterfaceIndex $ifIdx -AddressFamily IPv4 -ErrorAction SilentlyContinue) |
  Where-Object {
    $_.IPAddress -ne $GatewayIP -and
    $_.IPAddress -notmatch '\.255$' -and
    $_.IPAddress.StartsWith($network) -and
    $_.LinkLayerAddress -and
    $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and
    $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' -and
    $_.State -ne 'Unreachable'
  }

# Windows leaves stale DHCP-lease entries in the neighbor cache when a device
# renews its lease and gets a new IP — both old and new entries persist with
# the same MAC, both flagged Permanent. Deduplicate by MAC and pick the
# highest IP host-octet (DHCP issues incrementing addresses, so the larger
# octet is almost always the most recent lease).
$byMac = @{}
foreach ($n in $neighbors) {
  $existing = $byMac[$n.LinkLayerAddress]
  if (-not $existing) { $byMac[$n.LinkLayerAddress] = $n; continue }
  $existingOctet = [int]($existing.IPAddress -split '\.')[-1]
  $newOctet      = [int]($n.IPAddress -split '\.')[-1]
  if ($newOctet -gt $existingOctet) { $byMac[$n.LinkLayerAddress] = $n }
}

# Verify each survivor with an actual ARP probe — drops entries left behind in
# the neighbor cache after a device has powered off.
$neighbors = @($byMac.Values | Where-Object { Test-ArpReachable $_.IPAddress })

$out = foreach ($n in $neighbors) {
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

# Sort by last octet for stable display order.
$out = $out | Sort-Object { [int]($_.IPAddress -split '\.')[-1] }
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
