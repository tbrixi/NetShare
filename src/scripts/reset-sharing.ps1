# Resets Internet Connection Sharing to a clean slate. Use when ICS is stuck -
# typically when the gateway IP 192.168.137.1 is stranded on a disconnected
# Wi-Fi Direct virtual adapter left over from a past Mobile Hotspot session,
# which stops a fresh share from binding that IP to the real target adapter.
# Requires Administrator.
#
#   1. Disable sharing on every connection (COM - same as stop-sharing.ps1).
#   2. Strip any leftover 192.168.137.x address from every adapter.
#   3. Restart the SharedAccess service so the next share starts clean.

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[string]

# 1. Disable all ICS sharing.
try {
  $mgr = New-Object -ComObject HNetCfg.HNetShare
  $disabled = 0
  foreach ($conn in $mgr.EnumEveryConnection) {
    $cfg = $mgr.INetSharingConfigurationForINetConnection.Invoke($conn)
    if ($cfg.SharingEnabled) { $cfg.DisableSharing(); $disabled++ }
  }
  $report.Add("sharing-disabled=$disabled")
} catch {
  $report.Add('sharing-disable-failed')
}

# 2. Remove any stranded ICS gateway addresses (192.168.137.x). With sharing
#    already disabled, every remaining one is stale and safe to drop.
$stale = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like '192.168.137.*' })
foreach ($ip in $stale) {
  try {
    Remove-NetIPAddress -IPAddress $ip.IPAddress -InterfaceIndex $ip.InterfaceIndex `
      -Confirm:$false -ErrorAction Stop
    $report.Add("ip-removed=$($ip.IPAddress)")
  } catch {
    $report.Add("ip-remove-failed=$($ip.IPAddress)")
  }
}
if ($stale.Count -eq 0) { $report.Add('no-stale-ip') }

# 3. Restart the ICS service so a subsequent share starts from a clean state.
#    Stop+Start (rather than Restart-Service) and capture the real reason on
#    failure - a bare 'service-restart-failed' tells the user nothing.
try {
  $svc = Get-Service -Name SharedAccess -ErrorAction Stop
  if ($svc.StartType -eq 'Disabled') {
    Set-Service -Name SharedAccess -StartupType Manual -ErrorAction SilentlyContinue
  }
  Stop-Service -Name SharedAccess -Force -ErrorAction SilentlyContinue
  Start-Service -Name SharedAccess -ErrorAction Stop
  $report.Add('service-restarted')
} catch {
  $msg = ($_.Exception.Message -replace '[;\r\n]+', ' ').Trim()
  $report.Add("service-restart-failed=$msg")
}

Write-Output ("ICS_RESET:" + ($report -join '; '))
