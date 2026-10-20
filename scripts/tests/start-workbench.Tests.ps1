# No real Docker commands, browser, model requests or services are used.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot '../start-workbench.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Missing portable workbench launcher' }
. $launcher
function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action } catch { $caught = $_.Exception.Message -match $Pattern }
    Assert-True $caught "Expected error matching $Pattern"
}
Assert-Throws { Resolve-DockerPath -ExplicitPath 'Z:/missing/docker.exe' } 'Docker'
Assert-LocalDockerEndpoint 'npipe:////./pipe/dockerDesktopLinuxEngine'
Assert-Throws { Assert-LocalDockerEndpoint 'tcp://example.com:2375' } 'local'
Assert-Throws { Assert-LocalDockerEndpoint 'ssh://host' } 'local'
Assert-ComposeVersion 'Docker Compose version v2.30.0-desktop.1'
Assert-Throws { Assert-ComposeVersion 'Docker Compose version v2.20.0' } '2.24'
$script:Docker = $env:ComSpec
$progress = @(Invoke-DockerCommand -CommandArgs @('/d', '/c', 'echo progress 1>&2'))
Assert-True ($progress.Count -eq 1 -and $progress[0] -is [string] -and $progress[0].Trim() -eq 'progress') 'stderr progress is not a PowerShell error'
Assert-Throws { Invoke-DockerCommand -CommandArgs @('/d', '/c', 'exit', '17') } 'exit 17'
$script:StandaloneCompose = $env:ComSpec
$progress = @(Invoke-ComposeCommand -ComposeArgs @('/d', '/c', 'echo compose-progress 1>&2'))
Assert-True ($progress[0].Trim() -eq 'compose-progress') 'standalone Compose handles stderr'

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('workbench startup ' + [char]0x6750 + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixtureRoot
$fakeDocker = Join-Path $fixtureRoot 'docker.exe'
$fakeCompose = Join-Path $fixtureRoot 'docker-compose.exe'
$null = New-Item -ItemType File -Path $fakeDocker
$null = New-Item -ItemType File -Path $fakeCompose
Assert-True ((Resolve-DockerPath -ExplicitPath $fakeDocker) -eq $fakeDocker) 'explicit Docker path supports spaces and Unicode'
Assert-True ((Resolve-ComposePath -DockerExecutable $fakeDocker) -eq $fakeCompose) 'standalone Compose resolved next to Docker'
function Get-Command { param($Name, $ErrorAction) return @{ Source = 'C:/mock-path/docker.exe' } }
Assert-True ((Resolve-DockerPath) -eq 'C:/mock-path/docker.exe') 'Docker discovered on PATH'
function Get-Command { param($Name, $ErrorAction) return $null }
function Test-Path { param($LiteralPath, $PathType) return $LiteralPath -eq (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe') }
Assert-True ((Resolve-DockerPath) -eq (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe')) 'standard per-user installation discovered'
function Test-Path { param($LiteralPath, $PathType) return $false }
Assert-Throws { Resolve-DockerPath } 'Docker not found'
Remove-Item Function:Get-Command
Remove-Item Function:Test-Path

$script:Calls = @()
$script:Opened = 0
$script:Mode = 'ready'
$script:Schema = 'ready'
$script:Answer = 'INITIALIZE'
function Resolve-DockerPath { param([string]$ExplicitPath) return 'C:/Program Files/Docker/docker.exe' }
function Resolve-ComposePath { param([string]$DockerExecutable) return 'C:/mock/docker-compose.exe' }
function Invoke-DockerCommand {
    param([string[]]$CommandArgs)
    $script:Calls += ,$CommandArgs
    $command = $CommandArgs -join ' '
    if ($command -like 'context inspect*') { return '"npipe:////./pipe/dockerDesktopLinuxEngine"' }
    if ($command -eq 'info --format {{.OSType}}') {
        if ($script:Mode -eq 'stopped') { throw 'not ready' }
        if ($script:Mode -eq 'windows-engine') { return 'windows' }
        return 'linux'
    }
    if ($command -eq 'compose version') {
        if ($script:Mode -eq 'standalone') { throw 'no plugin' }
        return 'Docker Compose version v2.30.0'
    }
    if ($command -like 'port *') {
        if ($script:Mode -eq 'public-port') { return '0.0.0.0:8001' }
        return '127.0.0.1:18081'
    }
    if ($command -eq 'inspect --format {{.Image}} fixture-container') { return 'sha256:fixture-image' }
    if ($CommandArgs -contains 'run') {
        if ($script:Mode -eq 'migration-failed') { throw 'migration failed' }
        $script:Schema = 'ready'
        return 'fixture backup verified'
    }
    throw "Unexpected Docker command: $command"
}
function Invoke-ComposeCommand {
    param([string[]]$ComposeArgs)
    $script:Calls += ,$ComposeArgs
    if ($ComposeArgs -contains 'version') { return 'Docker Compose version v2.30.0' }
    if ($ComposeArgs -contains 'ps') {
        if ($script:Mode -eq 'no-container') { return @() }
        if ($script:Mode -eq 'multiple') { return @('one', 'two') }
        return 'fixture-container'
    }
    if ($ComposeArgs -contains 'exec') {
        $script:LastProbe = $ComposeArgs[$ComposeArgs.IndexOf('-c') + 1]
        return $script:Schema
    }
    if ($ComposeArgs -contains 'up' -and $script:Mode -eq 'build-failed') { throw 'build failed' }
    return @()
}
function Wait-AppReady { if ($script:Mode -eq 'timeout') { throw 'readiness timeout' } }
function Open-ProjectBrowser { $script:Opened++ }
function Read-Host { param([string]$Prompt) return $script:Answer }
function Reset-Fixture {
    $script:Calls = @(); $script:Opened = 0; $script:Mode = 'ready'; $script:Schema = 'ready'; $script:Answer = 'INITIALIZE'
}
$savedHost = $env:DOCKER_HOST
$savedContext = $env:DOCKER_CONTEXT
$savedConfig = $env:DOCKER_CONFIG
try {
    $env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'
    $env:DOCKER_CONTEXT = ''
    $env:DOCKER_CONFIG = 'C:/custom docker profile'
    Reset-Fixture
    Invoke-WorkbenchStart -NoBrowser
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'start' }).Count -eq 1) 'daily start uses existing container'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'up' -or $_ -contains 'run' -or $_ -contains 'stop' }).Count -eq 0) 'daily start never rebuilds, migrates or stops'
    Assert-True ($script:AppUrl -eq 'http://127.0.0.1:18081' -and $script:Opened -eq 0) 'actual loopback port and NoBrowser honored'
    Assert-True ($env:DOCKER_CONFIG -eq 'C:/custom docker profile') 'user Docker config preserved'
    Reset-Fixture
    Invoke-WorkbenchStart -Build
    $up = @($script:Calls | Where-Object { $_ -contains 'up' })
    Assert-True ($up.Count -eq 1 -and $up[0] -contains '--build') 'explicit build used'
    Assert-True ($script:Opened -eq 1) 'browser opens only after readiness'
    Reset-Fixture; $script:Mode = 'no-container'
    Assert-Throws { Invoke-WorkbenchStart } '-Build'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'up' }).Count -eq 0) 'fresh download never silently builds'
    Reset-Fixture; $script:Schema = 'missing'
    Assert-Throws { Invoke-WorkbenchStart } 'InitializeInterviews'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'run' -or $_ -contains 'stop' }).Count -eq 0 -and $script:Opened -eq 0) 'missing schema never migrates automatically'
    Reset-Fixture; $script:Schema = 'partial'
    Assert-Throws { Invoke-WorkbenchStart -InitializeInterviews } 'schema'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'stop' }).Count -eq 0) 'partial schema stops for manual investigation'
    Reset-Fixture; $script:Schema = 'missing'; $script:Answer = 'no'
    Assert-Throws { Invoke-WorkbenchStart -InitializeInterviews } 'cancel'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'stop' -or $_ -contains 'run' }).Count -eq 0) 'declining never stops or migrates'
    Reset-Fixture; $script:Schema = 'missing'
    Invoke-WorkbenchStart -InitializeInterviews -NoBrowser
    $writes = @($script:Calls | Where-Object { $_ -contains 'start' -or $_ -contains 'stop' -or $_ -contains 'run' })
    Assert-True (($writes | ForEach-Object { if ($_ -contains 'run') { 'run' } elseif ($_ -contains 'stop') { 'stop' } else { 'start' } }) -join ',' -eq 'start,stop,run,start') 'confirmation then stop, migration and restart in order'
    $migration = @($script:Calls | Where-Object { $_ -contains 'run' })[0]
    Assert-True ($migration -contains 'job_evidence_agent.migrate_interviews' -and $migration -contains '/app/data/backups') 'existing backup migration with correct paths'
    Assert-True ($migration -contains '--volumes-from' -and $migration -contains 'fixture-container' -and $migration -contains 'sha256:fixture-image' -and $migration -contains '--network' -and $migration -contains 'none') 'migration uses exact running image/mounts and no network'
    Reset-Fixture
    Invoke-WorkbenchStart -InitializeInterviews -NoBrowser
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'run' -or $_ -contains 'stop' }).Count -eq 0) 'ready schema does not migrate twice'
    Reset-Fixture; $script:Schema = 'missing'; $script:Mode = 'migration-failed'
    Assert-Throws { Invoke-WorkbenchStart -InitializeInterviews } 'migration failed'
    Assert-True (@($script:Calls | Where-Object { $_ -contains 'start' }).Count -eq 1 -and $script:Opened -eq 0) 'failed migration never restarts or opens browser'
    foreach ($case in @('stopped', 'windows-engine', 'public-port', 'multiple', 'timeout', 'build-failed')) {
        Reset-Fixture; $script:Mode = $case
        Assert-Throws { Invoke-WorkbenchStart -Build } '.'
        Assert-True ($script:Opened -eq 0) "failure $case never opens browser"
    }
    Reset-Fixture; $script:Mode = 'standalone'
    Invoke-WorkbenchStart -NoBrowser
    Reset-Fixture; $env:DOCKER_HOST = 'tcp://remote.example:2375'
    Assert-Throws { Invoke-WorkbenchStart -Build } 'local'
    Assert-True ($script:Calls.Count -eq 0) 'remote endpoint rejected before Docker commands'
    $env:DOCKER_CONTEXT = 'desktop-linux'
    Invoke-WorkbenchStart -NoBrowser
    Assert-True ($env:DOCKER_CONTEXT -eq 'desktop-linux' -and $env:DOCKER_HOST -eq 'tcp://remote.example:2375') 'context precedence and environment preserved'
} finally {
    $env:DOCKER_HOST = $savedHost; $env:DOCKER_CONTEXT = $savedContext; $env:DOCKER_CONFIG = $savedConfig
}

# Execute the real generated Python probe against real disposable SQLite DBs.
# This catches quoting bugs and accidental writes that a Docker fake cannot see.
$python = Join-Path $PSScriptRoot '../../.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Install backend development dependencies in .venv before running startup tests.' }
$fixtureCode = @'
import sqlite3, sys
names = ['interview_v2_sessions', 'interview_v2_turns', 'interview_v2_requests', 'interview_v2_operations']
db = sqlite3.connect(sys.argv[1])
db.execute('CREATE TABLE tasks (id INTEGER PRIMARY KEY)')
for name in names[:int(sys.argv[2])]:
    db.execute('CREATE TABLE ' + name + ' (id INTEGER PRIMARY KEY)')
db.commit()
db.close()
'@
foreach ($case in @(@(0, 'missing'), @(1, 'partial'), @(4, 'ready'))) {
    $database = Join-Path $fixtureRoot ("schema-$($case[0]).sqlite3")
    & $python -c $fixtureCode $database $case[0]
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create SQLite fixture' }
    $before = (Get-FileHash -LiteralPath $database -Algorithm SHA256).Hash
    $probe = $script:LastProbe.Replace('/app/data/workbench.sqlite3', $database.Replace('\', '/'))
    $actual = & $python -c $probe
    Assert-True ($LASTEXITCODE -eq 0 -and $actual -eq $case[1]) "real SQLite probe returns $($case[1])"
    Assert-True ((Get-FileHash -LiteralPath $database -Algorithm SHA256).Hash -eq $before) 'schema probe does not write to database'
}
$missingDatabase = Join-Path $fixtureRoot 'not-created.sqlite3'
$probe = $script:LastProbe.Replace('/app/data/workbench.sqlite3', $missingDatabase.Replace('\', '/'))
$ErrorActionPreference = 'Continue'
& $python -c $probe 2>$null
$missingExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Assert-True ($missingExit -ne 0 -and -not (Test-Path -LiteralPath $missingDatabase)) 'probe refuses missing DB without creating empty database'

# Exercise the real CMD wrapper's exit code without touching Docker. NUL input
# dismisses its pause; a nonexistent DockerPath must still return failure.
$wrapper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../Start Workbench.cmd')).Path
$commandLine = '"' + $wrapper + '" -NoBrowser -DockerPath Z:\missing\docker.exe < NUL'
$ErrorActionPreference = 'Continue'
$wrapperOutput = (& $env:ComSpec /d /s /c $commandLine 2>&1) -join "`n"
$wrapperExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Assert-True ($wrapperOutput -match 'Docker executable not found') 'failure test actually reaches the PowerShell launcher'
Assert-True ($wrapperExit -ne 0) 'CMD wrapper preserves PowerShell failure after pause'
Write-Host 'PASS: portable workbench startup behavior checks (no real services or data touched).'
