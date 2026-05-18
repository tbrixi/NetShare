# Configures ICS: enables the named public (source) and private (target) adapters,
# disabling any existing sharing first. Requires Administrator.

param(
  [Parameter(Mandatory = $true)] [string] $PublicName,
  [Parameter(Mandatory = $true)] [string] $PrivateName
)

$ErrorActionPreference = 'Stop'
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

$mgr.INetSharingConfigurationForINetConnection.Invoke($publicConn).EnableSharing(0)
$mgr.INetSharingConfigurationForINetConnection.Invoke($privateConn).EnableSharing(1)

Write-Output "ICS_ENABLED:$PublicName->$PrivateName"
