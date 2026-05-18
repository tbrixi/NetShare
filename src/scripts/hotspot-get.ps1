# Returns the current Mobile Hotspot state + AP configuration via the WinRT
# NetworkOperatorTetheringManager API. Emits a single JSON object so the
# renderer can populate the hotspot modal in one round trip.
#
# Requires Windows PowerShell 5.1 (the WinRT projection used here, with
# ContentType=WindowsRuntime, only works in PS 5.1 — not pwsh 7).

$ErrorActionPreference = 'Stop'

$null = [Windows.Networking.Connectivity.NetworkInformation,                           Windows.Networking.Connectivity,    ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,          Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]

$conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $conn) {
  ConvertTo-Json -Compress -InputObject ([ordered]@{ Available = $false; Error = 'No internet connection profile is available to share.' })
  exit 0
}

$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)
$cfg = $mgr.GetCurrentAccessPointConfiguration()

$stateMap = @{ 0 = 'Unknown'; 1 = 'On'; 2 = 'Off'; 3 = 'InTransition' }
$bandMap  = @{ 0 = 'Auto';    1 = 'TwoPointFourGigahertz'; 2 = 'FiveGigahertz' }

$payload = [ordered]@{
  Available       = $true
  InternetProfile = $conn.ProfileName
  State           = $stateMap[[int]$mgr.TetheringOperationalState]
  Ssid            = $cfg.Ssid
  Passphrase      = $cfg.Passphrase
  Band            = $bandMap[[int]$cfg.Band]
  ClientCount     = [int]$mgr.ClientCount
  MaxClientCount  = [int]$mgr.MaxClientCount
}
ConvertTo-Json -Compress -InputObject $payload
