# Stops the Mobile Hotspot tethering. Mirrors hotspot-start.ps1.

$ErrorActionPreference = 'Stop'

$null = [Windows.Networking.Connectivity.NetworkInformation,                  Windows.Networking.Connectivity,    ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $conn) { throw 'No internet connection profile is available to share.' }

$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)
$asyncOp = $mgr.StopTetheringAsync()

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}
$resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]
$task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($asyncOp))
$task.Wait() | Out-Null
$result = $task.Result

$message = "HOTSPOT_STOP:$($result.Status)"
if ($result.AdditionalErrorMessage) { $message += " - $($result.AdditionalErrorMessage)" }
Write-Output $message
if ([int]$result.Status -ne 0) { throw $message }
