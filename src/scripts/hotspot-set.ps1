# Configures the Mobile Hotspot's SSID, passphrase, and Wi-Fi band.
# Uses ConfigureAccessPointAsync, which takes a
# NetworkOperatorTetheringAccessPointConfiguration carrying SSID, passphrase
# and Band. The async call is awaited via the standard WindowsRuntimeSystem-
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

$asyncAction = $mgr.ConfigureAccessPointAsync($cfg)

# Await the IAsyncAction. A direct [IAsyncAction] cast fails on PS 5.1 — the
# value comes back as a bare System.__ComObject — so locate the
# AsTask(IAsyncAction) overload by reflection and invoke it with the raw WinRT
# object; the CLR marshals it to the interface parameter. (hotspot-start.ps1
# uses the same trick for the generic IAsyncOperation overload.)
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
} | Select-Object -First 1
$asTask.Invoke($null, @($asyncAction)).Wait()

Write-Output "HOTSPOT_CONFIGURED:${Ssid}:$Band"
