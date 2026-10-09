param(
  [string]$Repository = 'GoStudios-Real/roblox-ubers',
  [string]$BackendUrl = 'http://127.0.0.1:3000',
  [string]$CloudflaredPath
)

$ErrorActionPreference = 'Stop'

$cloudflaredExe = $CloudflaredPath
if (-not $cloudflaredExe) {
  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cloudflared) { $cloudflaredExe = $cloudflared.Source }
}
if (-not $cloudflaredExe) {
  $installedPath = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'cloudflared\cloudflared.exe'
  if (Test-Path $installedPath) { $cloudflaredExe = $installedPath }
}
if (-not $cloudflaredExe -or -not (Test-Path $cloudflaredExe)) {
  throw 'cloudflared is not installed or was not found on PATH. Install it with: winget install --id Cloudflare.cloudflared'
}

try {
  $null = Invoke-RestMethod -Uri "$BackendUrl/api/health" -TimeoutSec 5
} catch {
  throw "ROBLOX UBERS is not responding at $BackendUrl. Start the app first, then run this script."
}

$logRoot = Join-Path $env:TEMP 'roblox-ubers-cloudflare'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logRoot "$stamp.stdout.log"
$stderrPath = Join-Path $logRoot "$stamp.stderr.log"
$tunnel = Start-Process -FilePath $cloudflaredExe `
  -ArgumentList @('tunnel', '--url', $BackendUrl, '--no-autoupdate') `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$deadline = [DateTime]::UtcNow.AddSeconds(90)
$tunnelUrl = $null
while ([DateTime]::UtcNow -lt $deadline) {
  if ($tunnel.HasExited) {
    throw "cloudflared exited before establishing a tunnel. Logs: $stderrPath"
  }

  $logs = @()
  if (Test-Path $stdoutPath) { $logs += Get-Content $stdoutPath }
  if (Test-Path $stderrPath) { $logs += Get-Content $stderrPath }
  $match = [regex]::Match(($logs -join "`n"), 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $tunnelUrl = $match.Value
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $tunnelUrl) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  throw "Timed out waiting for a Cloudflare Quick Tunnel URL. Logs: $stderrPath"
}

$health = $null
$lastError = $null
$hostName = ([Uri]$tunnelUrl).Host
$verifyUntil = [DateTime]::UtcNow.AddMinutes(6)
while ([DateTime]::UtcNow -lt $verifyUntil) {
  try {
    $dns = Invoke-RestMethod -Uri "https://cloudflare-dns.com/dns-query?name=$hostName&type=A" `
      -Headers @{ Accept = 'application/dns-json' } -TimeoutSec 10
    if ($dns.Status -ne 0 -or -not $dns.Answer) {
      $lastError = 'Waiting for the Quick Tunnel DNS record to propagate.'
      Start-Sleep -Seconds 5
      continue
    }
    $health = Invoke-RestMethod -Uri "$tunnelUrl/api/health" `
      -Headers @{ 'cf-skip-browser-warning' = '1'; Origin = 'https://gostudios-real.github.io' } `
      -TimeoutSec 10
    if ($health.ok) { break }
    $lastError = 'Backend health check did not report ok.'
  } catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Seconds 2
}
if (-not $health -or -not $health.ok) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  throw "Cloudflare tunnel did not reach the backend: $lastError"
}

& gh variable set UBERS_API_BASE_URL --repo $Repository --body $tunnelUrl
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  throw 'Could not save UBERS_API_BASE_URL. Check gh auth status and repository permissions.'
}

& gh workflow run 'Deploy GitHub Pages' --repo $Repository
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  throw 'The API URL was saved, but GitHub Pages deployment could not be started.'
}

Write-Host "Cloudflare Quick Tunnel is live: $tunnelUrl"
Write-Host "GitHub Pages deployment started for $Repository."
Write-Host "Keep the ROBLOX UBERS server and cloudflared PID $($tunnel.Id) running."
Write-Host "Tunnel logs: $stderrPath"
