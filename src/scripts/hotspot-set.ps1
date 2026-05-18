# Configures the Mobile Hotspot's SSID, passphrase, and Wi-Fi band.
# Uses ConfigureAccessPointBindingAsync — that's the only setter that lets us
# control the band (the simpler ConfigureAccessPointAsync only takes SSID +
# passphrase). The async call is awaited via the standard WindowsRuntimeSystem-
# Extensions.AsTask -> Task.Wait() bridge that ships with .NET Framework.

param(
  [Parameter(Mandatory = $true)] [string] $Ssid,
  [Parameter(Mandatory = $true)] [string] $Passphrase,
  [Parameter(Mandatory = $true)]
  [ValidateSet('Auto', 'TwoPointFourGigahertz', 'FiveGigahertz')]
  [string] $Band
)

$ErrorActionPreference = 'Stop'

$null = [Windows.Networking.Connectivity.NetworkInformation,                           Windows.Networking.Connectivity,    ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,          Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $conn) { throw 'No internet connection profile is available to share.' }

$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)

$cfg = New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
$cfg.Ssid       = $Ssid
$cfg.Passphrase = $Passphrase
$cfg.Band       = switch ($Band) {
  'Auto'                  { 0 }
  'TwoPointFourGigahertz' { 1 }
  'FiveGigahertz'         { 2 }
}

$asyncAction = $mgr.ConfigureAccessPointBindingAsync($cfg)
[System.WindowsRuntimeSystemExtensions]::AsTask([Windows.Foundation.IAsyncAction]$asyncAction).Wait()

Write-Output "HOTSPOT_CONFIGURED:$Ssid:$Band"
