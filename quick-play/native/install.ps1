param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$PythonPath = '',
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.px.quick_play'
$keys = @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName")
if ($Uninstall) {
    foreach ($key in $keys) { if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key } }
    Write-Host 'Native host registration removed. Configuration files retained.'
    return
}
if (!$PythonPath) { $PythonPath = (Get-Command python.exe -ErrorAction Stop).Source }
$PythonPath = (Resolve-Path -LiteralPath $PythonPath).Path
& $PythonPath -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or later is required.' }
$base = $PSScriptRoot
if (($base + $PythonPath) -match '[%\r\n]') { throw 'Paths containing percent signs or line breaks are unsupported.' }
$launcher = Join-Path $base 'launch.cmd'
$utf8 = New-Object System.Text.UTF8Encoding($false)
# cmd.exe uses the local Windows code page for batch source paths.
$batch = "@echo off`r`nsetlocal DisableDelayedExpansion`r`nchcp 65001 >nul`r`n`"$PythonPath`" -u `"$(Join-Path $base 'host.py')`"`r`n"
[IO.File]::WriteAllText($launcher, $batch, $utf8)
$manifestPath = Join-Path $base "$hostName.json"
$manifest = @{name=$hostName; description='Quick Play local media helper'; path=$launcher; type='stdio'; allowed_origins=@("chrome-extension://$ExtensionId/")}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
foreach ($key in $keys) {
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $manifestPath
}
Write-Host 'Installed for current-user Chrome and Edge. Open extension settings to configure media paths.'
