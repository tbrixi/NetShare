# Opens the Windows network adapter properties dialog for the given connection
# name. Uses the Shell.Application COM object to invoke the Properties verb on
# the Network Connections shell folder ({7007ACC7-3202-11D1-AAD2-00805FC1270E}).
# After invoking the verb, briefly polls visible top-level windows for the new
# "<AdapterName> Properties" dialog (hosted by dllhost.exe) and pulls it to
# the foreground so it doesn't get hidden behind the NetShare window.

param(
  [Parameter(Mandatory = $true)] [string] $AdapterName
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace NetShare -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr l);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder t, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr h);
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
'@

$shell  = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace('::{7007ACC7-3202-11D1-AAD2-00805FC1270E}')
if (-not $folder) { throw 'Could not open Network Connections shell folder' }

$item = $folder.Items() | Where-Object { $_.Name -eq $AdapterName } | Select-Object -First 1
if (-not $item) { throw "Adapter '$AdapterName' not found in Network Connections" }

$verb = $item.Verbs() | Where-Object { $_.Name.Replace('&', '') -ieq 'Properties' } | Select-Object -First 1
if ($verb) {
  $verb.DoIt()
} else {
  $item.InvokeVerb('Properties')
}

# Poll for the new properties dialog and bring it to the foreground.
# Title is "<AdapterName> Properties" on English Windows; we also accept any
# window whose title ends in " Properties" as a fallback.
$expectedTitle = "$AdapterName Properties"
$target = [System.IntPtr]::Zero
for ($i = 0; $i -lt 40 -and $target -eq [System.IntPtr]::Zero; $i++) {
  Start-Sleep -Milliseconds 100
  $script:found = [System.IntPtr]::Zero
  [NetShare.Win]::EnumWindows({
    param($h, $l)
    if ([NetShare.Win]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 256
      [NetShare.Win]::GetWindowText($h, $sb, 256) | Out-Null
      $t = $sb.ToString()
      if ($t -eq $expectedTitle -or $t -like "$AdapterName *Properties*") {
        $script:found = $h
        return $false
      }
    }
    return $true
  }, [System.IntPtr]::Zero) | Out-Null
  $target = $script:found
}

if ($target -ne [System.IntPtr]::Zero) {
  [NetShare.Win]::ShowWindow($target, 9) | Out-Null   # SW_RESTORE = 9
  [NetShare.Win]::BringWindowToTop($target) | Out-Null
  [NetShare.Win]::SetForegroundWindow($target) | Out-Null
}
