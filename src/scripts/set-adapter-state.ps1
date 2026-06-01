# Enables or disables a network adapter - the same operation as the
# Enable/Disable command in the Windows "Network Connections" control panel.
# Requires Administrator: Enable-NetAdapter / Disable-NetAdapter are privileged.

param(
  [Parameter(Mandatory = $true)] [string] $AdapterName,
  [Parameter(Mandatory = $true)]
  [ValidateSet('Enable', 'Disable')]
  [string] $Action
)

$ErrorActionPreference = 'Stop'

if ($Action -eq 'Enable') {
  Enable-NetAdapter -Name $AdapterName -Confirm:$false
  Write-Output "ADAPTER_ENABLED:$AdapterName"
} else {
  Disable-NetAdapter -Name $AdapterName -Confirm:$false
  Write-Output "ADAPTER_DISABLED:$AdapterName"
}
