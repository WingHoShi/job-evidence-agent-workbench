param([switch]$NoBrowser, [switch]$Build, [switch]$InitializeInterviews, [string]$DockerPath)

$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-DockerPath {
    param([string]$ExplicitPath)
    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { throw 'Docker executable not found at the specified path.' }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe')
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'Docker not found. Install and open Docker Desktop, or pass -DockerPath with the full docker.exe path. See README.md.'
}

function Invoke-DockerCommand {
    param([string[]]$CommandArgs)
    # Windows PowerShell 5.1 wraps native stderr as ErrorRecord, even on success.
    $ErrorActionPreference = 'Continue'
    $output = & $script:Docker @CommandArgs 2>&1 | ForEach-Object { $_.ToString() }
    $nativeExit = $LASTEXITCODE
    if ($nativeExit -ne 0) { throw "Docker command failed (exit $nativeExit).`n$($output -join [Environment]::NewLine)" }
    return $output
}

function Resolve-ComposePath {
    param([string]$DockerExecutable)
    $candidate = Join-Path (Split-Path -Parent $DockerExecutable) 'docker-compose.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    throw 'Docker Compose not found. Install Docker Desktop with Compose.'
}

function Invoke-ComposeCommand {
    param([string[]]$ComposeArgs)
    if (-not $script:StandaloneCompose) { return Invoke-DockerCommand -CommandArgs (@('compose') + $ComposeArgs) }
    $ErrorActionPreference = 'Continue'
    $output = & $script:StandaloneCompose @ComposeArgs 2>&1 | ForEach-Object { $_.ToString() }
    $nativeExit = $LASTEXITCODE
    if ($nativeExit -ne 0) { throw "Docker Compose command failed (exit $nativeExit).`n$($output -join [Environment]::NewLine)" }
    return $output
}

function Assert-LocalDockerEndpoint {
    param([string]$Endpoint)
    if ($Endpoint -notmatch '^npipe:/+\./pipe/[A-Za-z0-9_.-]+$') {
        throw 'Only a local Docker Desktop named-pipe engine is supported. Remote contexts are not used.'
    }
}

function Assert-ComposeVersion {
    param([string]$VersionText)
    if ($VersionText -notmatch '(\d+)\.(\d+)\.(\d+)' -or [version]$Matches[0] -lt [version]'2.24.0') {
        throw 'Docker Compose 2.24 or newer is required. Update Docker Desktop.'
    }
}

function Wait-AppReady {
    $deadline = (Get-Date).AddMinutes(2)
    while ($true) {
        try {
            $health = Invoke-RestMethod -Uri "$script:AppUrl/api/health" -TimeoutSec 5
            $null = Invoke-RestMethod -Uri "$script:AppUrl/api/tasks" -TimeoutSec 5
            $page = Invoke-WebRequest -Uri $script:AppUrl -UseBasicParsing -TimeoutSec 5
            if ($health.status -eq 'ok' -and $page.StatusCode -eq 200 -and $page.Content -match '<div id="root">') { return }
        } catch { }
        if ((Get-Date) -ge $deadline) {
            throw 'App readiness timeout. Check docker compose logs --tail 50 app. Containers were left running; do not delete data.'
        }
        Start-Sleep -Seconds 2
    }
}

function Open-ProjectBrowser { Start-Process $script:AppUrl }

function Invoke-WorkbenchStart {
    param([switch]$NoBrowser, [switch]$Build, [switch]$InitializeInterviews, [string]$DockerPath)
    $script:Docker = Resolve-DockerPath -ExplicitPath $DockerPath
    Push-Location -LiteralPath $script:ProjectRoot
    try {
        Write-Host '[1/4] Checking local Docker Desktop and Compose...'
        # DOCKER_CONTEXT takes precedence over DOCKER_HOST. Never rewrite either.
        if ($env:DOCKER_HOST -and -not $env:DOCKER_CONTEXT) { $endpoint = $env:DOCKER_HOST }
        else {
            $endpoint = ((Invoke-DockerCommand -CommandArgs @('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}')) -join '').Trim('"')
        }
        Assert-LocalDockerEndpoint $endpoint
        try { $engine = (Invoke-DockerCommand -CommandArgs @('info', '--format', '{{.OSType}}')) -join '' }
        catch { throw 'Docker Desktop is not ready. Open it, wait for the Linux engine, then retry. No containers have been started.' }
        if ($engine.Trim() -ne 'linux') { throw 'Switch Docker Desktop to Linux containers, then retry.' }
        $script:StandaloneCompose = $null
        try { $version = (Invoke-DockerCommand -CommandArgs @('compose', 'version')) -join ' ' }
        catch {
            $script:StandaloneCompose = Resolve-ComposePath -DockerExecutable $script:Docker
            $version = (Invoke-ComposeCommand -ComposeArgs @('version')) -join ' '
        }
        Assert-ComposeVersion $version
        # Let Compose honor the project directory, .env and COMPOSE_PROJECT_NAME,
        # exactly as the documented manual commands do.
        $prefix = @('-f', (Join-Path $script:ProjectRoot 'compose.yaml'))

        Write-Host '[2/4] Starting the workbench...'
        if ($Build) {
            Write-Host 'Explicit build requested: dependencies/images may be downloaded. Existing data is retained.'
            Invoke-ComposeCommand -ComposeArgs ($prefix + @('up', '-d', '--build', '--no-deps', 'app')) | Out-Host
        } else {
            $ids = @(Invoke-ComposeCommand -ComposeArgs ($prefix + @('ps', '-a', '-q', 'app')) | Where-Object { $_.Trim() })
            if ($ids.Count -eq 0) { throw 'No installed container found. First installation: run .\"Start Workbench.cmd" -Build -InitializeInterviews . Daily startup never builds or initializes automatically.' }
            if ($ids.Count -ne 1) { throw 'Multiple app containers found. Check the deployment before starting.' }
            Invoke-ComposeCommand -ComposeArgs ($prefix + @('start', 'app')) | Out-Host
        }
        $ids = @(Invoke-ComposeCommand -ComposeArgs ($prefix + @('ps', '-a', '-q', 'app')) | Where-Object { $_.Trim() })
        if ($ids.Count -ne 1) { throw 'Expected exactly one app container after startup.' }
        $binding = @(Invoke-DockerCommand -CommandArgs @('port', $ids[0], '8000/tcp'))
        if ($binding.Count -ne 1 -or $binding[0].Trim() -notmatch '^127\.0\.0\.1:(\d+)$') {
            throw 'Expected one local port bound to 127.0.0.1. Check the container configuration; it was left running.'
        }
        $script:AppUrl = "http://127.0.0.1:$($Matches[1])"
        Wait-AppReady

        Write-Host '[3/4] Checking interview initialization (read-only)...'
        # This probe opens the existing database read-only and never creates a DB.
        $probe = @'
from contextlib import closing
from pathlib import Path
import sqlite3
with closing(sqlite3.connect(Path('/app/data/workbench.sqlite3').as_uri() + '?mode=ro', uri=True)) as db:
    tables = {row[0] for row in db.execute('SELECT name FROM sqlite_master WHERE type=\'table\'')}
required = {'interview_v2_sessions', 'interview_v2_turns', 'interview_v2_requests', 'interview_v2_operations'}
print('ready' if required <= tables else 'missing' if not required & tables else 'partial')
'@
        $schema = ((Invoke-ComposeCommand -ComposeArgs ($prefix + @('exec', '-T', 'app', 'python', '-c', $probe))) -join '').Trim()
        if ($schema -eq 'missing') {
            if (-not $InitializeInterviews) { throw 'Interview tables are not initialized. Run .\"Start Workbench.cmd" -InitializeInterviews . This will ask for confirmation and create a backup before initialization.' }
            Write-Host 'Initialization will STOP this project, back up its business database under data/backups, then add interview tables. Existing records are retained.'
            Write-Host 'Do not use the app or launch another instance during initialization. On failure the app stays stopped; keep the backup and inspect the error.'
            if ((Read-Host 'Type INITIALIZE to continue; anything else cancels') -cne 'INITIALIZE') { throw 'Initialization cancelled. No database initialization was performed.' }
            $image = ((Invoke-DockerCommand -CommandArgs @('inspect', '--format', '{{.Image}}', $ids[0])) -join '').Trim()
            if (-not $image) { throw 'Cannot identify the running image; initialization cancelled.' }
            Invoke-ComposeCommand -ComposeArgs ($prefix + @('stop', 'app')) | Out-Host
            # Pin the original image and actual mounts, not a possibly changed compose environment.
            Invoke-DockerCommand -CommandArgs @('run', '--rm', '--network', 'none', '--volumes-from', $ids[0], '--workdir', '/app', $image, 'python', '-m', 'job_evidence_agent.migrate_interviews', '--database', '/app/data/workbench.sqlite3', '--backup-dir', '/app/data/backups') | Out-Host
            Invoke-ComposeCommand -ComposeArgs ($prefix + @('start', 'app')) | Out-Host
            Wait-AppReady
            $schema = ((Invoke-ComposeCommand -ComposeArgs ($prefix + @('exec', '-T', 'app', 'python', '-c', $probe))) -join '').Trim()
        }
        if ($schema -ne 'ready') { throw 'Interview schema is incomplete or unrecognized. Keep all data and backups; manual investigation is required.' }
        Write-Host '[4/4] Ready.'
        Write-Host $script:AppUrl -ForegroundColor Green
        Write-Host 'Model API configuration is completed in the web page. This launcher does not call a model.'
        if (-not $NoBrowser) { Open-ProjectBrowser }
    } finally { Pop-Location }
}

# Dot-sourcing for tests only defines functions; it does not start anything.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-WorkbenchStart -NoBrowser:$NoBrowser -Build:$Build -InitializeInterviews:$InitializeInterviews -DockerPath $DockerPath
        exit 0
    } catch {
        Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}
