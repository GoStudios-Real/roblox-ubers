# Always-online supervisor: keeps the UBERS Node server and a Cloudflare Quick
# Tunnel running, restarting either one when it crashes. When the tunnel URL
# changes it updates the GitHub Pages UBERS_API_BASE_URL variable and redeploys.
#
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\always-online.ps1
# Stop: Ctrl+C (the server and cloudflared child processes are stopped too).

param(
  [string]$Repository = 'GoStudios-Real/roblox-ubers',
  [string]$BackendUrl = 'http://127.0.0.1:3000',
  [int]$HealthPort = 3000,
  [int]$CheckSeconds = 10,
  [switch]$SkipGitHubPages,
  [string]$ServerScript,
  [string]$CloudflaredPath,
  [string]$GistId = 'a18e754f09a4b45df7d4ebdddaaa47ea'
)

$ErrorActionPreference = 'Continue'
$logRoot = Join-Path $env:TEMP 'roblox-ubers-always-online'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$statusFile = Join-Path $logRoot 'status.txt'

function Write-Status([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Write-Host $line
  Add-Content -Path $statusFile -Value $line
}

function Find-Cloudflared {
  if ($CloudflaredPath -and (Test-Path $CloudflaredPath)) { return $CloudflaredPath }
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $installed = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'cloudflared\cloudflared.exe'
  if (Test-Path $installed) { return $installed }
  return $null
}

function Test-BackendHealth {
  try {
    $health = Invoke-RestMethod -Uri "$BackendUrl/api/health" -TimeoutSec 5
    return [bool]$health.ok
  } catch { return $false }
}

function Publish-TunnelUrl([string]$Url) {
  if ($SkipGitHubPages) { Write-Status "Skipping GitHub Pages update (SkipGitHubPages). URL: $Url"; return }
  # 1) Public gist: the Pages app reads this at boot (raw host has no API rate limit),
  #    so stale cached static-config.js can still self-heal to the current tunnel URL.
  if ($GistId) {
    & gh api -X PATCH "gists/$GistId" -f "files[ubers-api-base.txt][content]=$Url" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Status "WARNING: could not update gist $GistId with the tunnel URL." }
    else { Write-Status "Gist $GistId updated with $Url" }
  }
  # 2) Repo variable: baked into static-config.js by the next Pages deploy.
  & gh variable set UBERS_API_BASE_URL --repo $Repository --body $Url 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Status "WARNING: could not set UBERS_API_BASE_URL for $Repository (gh auth/permissions)."
    return
  }
  # 3) Redeploy Pages so the baked URL matches too.
  & gh workflow run 'Deploy GitHub Pages' --repo $Repository 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Status 'WARNING: Pages workflow could not be triggered.' }
  else { Write-Status "GitHub Pages redeployed for $Repository." }
}

$cloudflaredExe = Find-Cloudflared
if (-not $cloudflaredExe) {
  throw 'cloudflared was not found. Install it with: winget install --id Cloudflare.cloudflared'
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodeExe -and -not $ServerScript) {
  throw 'node was not found on PATH. Install Node.js or pass -ServerScript pointing at the packaged ROBLOX UBERS exe.'
}
if (-not $ServerScript) { $ServerScript = Join-Path $PSScriptRoot '..\server.js' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverLog = Join-Path $logRoot "$stamp.server.log"
$tunnelLog = Join-Path $logRoot "$stamp.tunnel.log"
$serverProc = $null
$tunnelProc = $null
$serverOwned = $false
$tunnelUrl = $null
$lastPublishedUrl = $null
$probeFailures = 0
$nextServerRestart = [DateTime]::MinValue
$nextTunnelRestart = [DateTime]::MinValue

Write-Status "Always-online supervisor starting (backend $BackendUrl)."

try {
  while ($true) {
    # ---- backend ----
    if ($serverOwned -and $serverProc -and $serverProc.HasExited) {
      Write-Status "Server exited (code $($serverProc.ExitCode)); restarting."
      $serverProc = $null
    }
    if (Test-BackendHealth) {
      if (-not $serverOwned) { $serverProc = $null } # someone else serves the port
    } else {
      if ($serverOwned -and $serverProc -and -not $serverProc.HasExited -and [DateTime]::UtcNow -ge $nextServerRestart) {
        Write-Status 'Backend health check failed; restarting server.'
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        $serverProc = $null
      }
      if (-not $serverProc -and [DateTime]::UtcNow -ge $nextServerRestart) {
        Write-Status "Starting ROBLOX UBERS server on port $HealthPort."
        $serverWorkingDirectory = Split-Path -Parent $ServerScript
        if ($ServerScript -like '*.exe') {
          $serverProc = Start-Process -FilePath $ServerScript `
            -ArgumentList @() `
            -WorkingDirectory $serverWorkingDirectory `
            -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err" `
            -PassThru -WindowStyle Hidden
        } else {
          $env:PORT = [string]$HealthPort
          $serverProc = Start-Process -FilePath $nodeExe `
            -ArgumentList @("`"$ServerScript`"") `
            -WorkingDirectory $serverWorkingDirectory `
            -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err" `
            -PassThru -WindowStyle Hidden
        }
        $serverOwned = $true
        $nextServerRestart = [DateTime]::UtcNow.AddSeconds(60)
      }
    }

    # ---- tunnel ----
    $tunnelDown = (-not $tunnelProc) -or $tunnelProc.HasExited
    if (-not $tunnelDown -and $tunnelProc -and [DateTime]::UtcNow -ge $nextTunnelRestart) {
      # periodic end-to-end check through the public URL. Two consecutive
      # failures are required before restarting: one flaky probe must not
      # rotate a working tunnel (every rotation forces clients to relocate).
      $probeOk = $false
      try {
        $probe = Invoke-RestMethod -Uri "$tunnelUrl/api/health" `
          -Headers @{ 'cf-skip-browser-warning' = '1'; Origin = 'https://gostudios-real.github.io' } `
          -TimeoutSec 15
        $probeOk = [bool]$probe.ok
        if (-not $probeOk) { Write-Status 'Tunnel health probe returned not ok.' }
      } catch {
        Write-Status "Tunnel health probe failed: $($_.Exception.Message)"
      }
      if ($probeOk) {
        $probeFailures = 0
        $nextTunnelRestart = [DateTime]::UtcNow.AddSeconds(60)
      } else {
        $probeFailures += 1
        if ($probeFailures -ge 2) {
          Write-Status 'Public tunnel unreachable twice in a row; restarting it.'
          $tunnelDown = $true
        } else {
          Write-Status 'Tunnel probe failed once; re-probing before restarting.'
          $nextTunnelRestart = [DateTime]::UtcNow.AddSeconds(20)
        }
      }
    }

    if ($tunnelDown -and [DateTime]::UtcNow -ge $nextTunnelRestart) {
      if ($tunnelProc -and -not $tunnelProc.HasExited) {
        Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
      }
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $tunnelLog = Join-Path $logRoot "$stamp.tunnel.log"
      Write-Status "Starting Cloudflare Quick Tunnel -> $BackendUrl"
      $tunnelProc = Start-Process -FilePath $cloudflaredExe `
        -ArgumentList @('tunnel', '--url', $BackendUrl, '--no-autoupdate') `
        -RedirectStandardOutput $tunnelLog -RedirectStandardError "$tunnelLog.err" `
        -PassThru -WindowStyle Hidden
      $nextTunnelRestart = [DateTime]::UtcNow.AddSeconds(120)

      $deadline = [DateTime]::UtcNow.AddSeconds(90)
      $newUrl = $null
      while ([DateTime]::UtcNow -lt $deadline -and -not $newUrl) {
        if ($tunnelProc.HasExited) { break }
        foreach ($log in @($tunnelLog, "$tunnelLog.err")) {
          if (-not (Test-Path $log)) { continue }
          $text = Get-Content -Path $log -Raw -ErrorAction SilentlyContinue
          $match = if ($text) { [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com') } else { $null }
          if ($match -and $match.Success) { $newUrl = $match.Value; break }
        }
        if (-not $newUrl) { Start-Sleep -Milliseconds 1000 }
      }

      if ($newUrl) {
        $tunnelUrl = $newUrl
        Write-Status "Tunnel live: $tunnelUrl"
        if ($tunnelUrl -ne $lastPublishedUrl) {
          Publish-TunnelUrl $tunnelUrl
          $lastPublishedUrl = $tunnelUrl
        }
      } else {
        Write-Status 'WARNING: tunnel did not publish a URL before the deadline; retrying.'
        $nextTunnelRestart = [DateTime]::UtcNow.AddSeconds(30)
      }
    }

    Start-Sleep -Seconds $CheckSeconds
  }
} finally {
  if ($tunnelProc -and -not $tunnelProc.HasExited) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue }
  if ($serverOwned -and $serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
  Write-Status 'Always-online supervisor stopped.'
}
