# Configures ICS: enables the named public (source) and private (target) adapters,
# disabling any existing sharing first. Requires Administrator.

param(
  [Parameter(Mandatory = $true)] [string] $PublicName,
  [Parameter(Mandatory = $true)] [string] $PrivateName
)

$ErrorActionPreference = 'Stop'

# ICS rides on the SharedAccess service; if it is stopped or disabled,
# EnableSharing fails with a generic subscriber error. Make sure it can run.
try {
  $svc = Get-Service -Name SharedAccess -ErrorAction Stop
  if ($svc.StartType -eq 'Disabled') {
    Set-Service -Name SharedAccess -StartupType Manual -ErrorAction SilentlyContinue
  }
  if ($svc.Status -ne 'Running') { Start-Service -Name SharedAccess -ErrorAction Stop }
} catch {
  throw "The Internet Connection Sharing service (SharedAccess) could not be started: $($_.Exception.Message)"
}

$mgr = New-Object -ComObject HNetCfg.HNetShare

foreach ($conn in $mgr.EnumEveryConnection) {
  $cfg = $mgr.INetSharingConfigurationForINetConnection.Invoke($conn)
  if ($cfg.SharingEnabled) { $cfg.DisableSharing() }
}

$publicConn = $null
$privateConn = $null
foreach ($conn in $mgr.EnumEveryConnection) {
  $props = $mgr.NetConnectionProps.Invoke($conn)
  if ($props.Name -eq $PublicName)  { $publicConn  = $conn }
  if ($props.Name -eq $PrivateName) { $privateConn = $conn }
}

if (-not $publicConn)  { throw "Public adapter '$PublicName' not found"  }
if (-not $privateConn) { throw "Private adapter '$PrivateName' not found" }

try {
  $mgr.INetSharingConfigurationForINetConnection.Invoke($publicConn).EnableSharing(0)
  $mgr.INetSharingConfigurationForINetConnection.Invoke($privateConn).EnableSharing(1)
} catch {
  # 0x80040201 (EVENT_E_ALL_SUBSCRIBERS_FAILED): ICS accepted the call but every
  # internal NAT/firewall subscriber refused it. On a healthy service this means
  # the configuration itself is unshareable. The two real-world causes are
  # (a) the source is a tunnel adapter ICS cannot NAT (WireGuard/Wintun), and
  # (b) the single system-wide ICS NAT instance is already owned by another
  # component - almost always the Hyper-V 'Default Switch' or WSL2. Translate
  # the opaque HRESULT into something the user can act on.
  if ($_.Exception.Message -match '0x80040201|subscribers') {
    $reasons = New-Object System.Collections.Generic.List[string]

    $pubAdapter = Get-NetAdapter -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $PublicName }
    if ($pubAdapter -and ($pubAdapter.MediaType -eq 'IP' -or
        $pubAdapter.InterfaceDescription -match 'WireGuard|Wintun|Tunnel')) {
      $reasons.Add("the source '$PublicName' is a tunnel adapter ($($pubAdapter.InterfaceDescription)) - ICS cannot share WireGuard-style tunnels; switch the VPN to its OpenVPN/TAP protocol")
    }

    $defSwitch = Get-NetAdapter -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'Default Switch' -and $_.Status -eq 'Up' }
    if ($defSwitch) {
      $reasons.Add("the Hyper-V 'Default Switch' is active and already owns the single ICS NAT instance - remove that switch (or disable Hyper-V/WSL2 networking) to free ICS")
    }

    if ($reasons.Count -eq 0) {
      $reasons.Add('the ICS NAT engine refused the configuration - restart the SharedAccess service or reboot, then retry')
    }
    throw ("ICS could not enable sharing because " + ($reasons -join '; AND ') + ".")
  }
  throw
}

Write-Output "ICS_ENABLED:$PublicName->$PrivateName"
