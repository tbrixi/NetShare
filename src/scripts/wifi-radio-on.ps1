# Turns the Wi-Fi radio software switch ON via the Windows.Devices.Radios API.
# The Mobile Hotspot broadcasts using the Wi-Fi adapter, so StartTetheringAsync
# fails with WiFiDeviceOff when the radio is software-off. Run this first.
#
# Requires Windows PowerShell 5.1 (the WinRT projection only works there).

$ErrorActionPreference = 'Stop'

$null = [Windows.Devices.Radios.Radio,             Windows.Devices.Radios, ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioAccessStatus, Windows.Devices.Radios, ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioState,        Windows.Devices.Radios, ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioKind,         Windows.Devices.Radios, ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# AsTask<T>(IAsyncOperation<T>) located by reflection, then awaited.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}

# Permission to manage radios (returns Allowed for a normal desktop process).
$null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])

$listType = [System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) $listType

$wifi = $radios | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::WiFi } | Select-Object -First 1
if (-not $wifi) { throw 'No Wi-Fi radio found on this system.' }

if ($wifi.State -ne [Windows.Devices.Radios.RadioState]::On) {
  $status = Await ($wifi.SetStateAsync([Windows.Devices.Radios.RadioState]::On)) ([Windows.Devices.Radios.RadioAccessStatus])
  if ("$status" -ne 'Allowed') { throw "Could not turn the Wi-Fi radio on: $status" }
}

Write-Output "WIFI_RADIO_ON:$($wifi.State)"
