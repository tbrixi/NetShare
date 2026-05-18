# Disables ICS on every connection that currently has it enabled.
# Requires Administrator — the COM call EnableSharing/DisableSharing is privileged.

$ErrorActionPreference = 'Stop'
$mgr = New-Object -ComObject HNetCfg.HNetShare
$count = 0
foreach ($conn in $mgr.EnumEveryConnection) {
  $cfg = $mgr.INetSharingConfigurationForINetConnection.Invoke($conn)
  if ($cfg.SharingEnabled) {
    $cfg.DisableSharing()
    $count++
  }
}
Write-Output "ICS_DISABLED:$count"
