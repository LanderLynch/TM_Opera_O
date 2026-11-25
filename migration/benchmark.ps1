param(
    [string]$Label = "manual",
    [string]$OutputDirectory = ".\migration\benchmarks",
    [string]$WorkspaceHint = "TM_Opera_O",
    [string[]]$RootNames = @("electron.exe", "tm-opera-o-tauri.exe", "opera-o-tauri.exe")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeLabel = ($Label -replace '[^a-zA-Z0-9_-]', '_')
$csvPath = Join-Path $OutputDirectory "$timestamp-$safeLabel-processes.csv"
$summaryPath = Join-Path $OutputDirectory "$timestamp-$safeLabel-summary.txt"

$allProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
$byPid = @{}
$childrenByParent = @{}
foreach ($p in $allProcs) {
    $pidInt = [int]$p.ProcessId
    $ppidInt = [int]$p.ParentProcessId
    $byPid[$pidInt] = $p
    if (-not $childrenByParent.ContainsKey($ppidInt)) {
        $childrenByParent[$ppidInt] = New-Object System.Collections.Generic.List[int]
    }
    $childrenByParent[$ppidInt].Add($pidInt)
}

# Identify root processes belonging to TM Opera O (avoiding unrelated Electron/WebView2 apps)
$rootPids = New-Object System.Collections.Generic.HashSet[int]
foreach ($p in $allProcs) {
    $nameLower = ($p.Name | ForEach-Object { $_.ToLowerInvariant() })
    if ($RootNames -contains $nameLower) {
        $cmd = [string]$p.CommandLine
        $parent = $byPid[[int]$p.ParentProcessId]
        $parentIsRoot = $parent -and ($RootNames -contains $parent.Name.ToLowerInvariant())
        if (-not $parentIsRoot) {
            if ($nameLower -ne "electron.exe" -or ($cmd -match [regex]::Escape($WorkspaceHint))) {
                [void]$rootPids.Add([int]$p.ProcessId)
            }
        }
    }
}

# Walk full process tree from verified roots
$treePids = New-Object System.Collections.Generic.HashSet[int]
$queue = New-Object System.Collections.Generic.Queue[int]
foreach ($rp in $rootPids) {
    if ($treePids.Add($rp)) { $queue.Enqueue($rp) }
}
while ($queue.Count -gt 0) {
    $cur = $queue.Dequeue()
    if ($childrenByParent.ContainsKey($cur)) {
        foreach ($child in $childrenByParent[$cur]) {
            if ($treePids.Add($child)) { $queue.Enqueue($child) }
        }
    }
}

# Separate Python/MaaFramework external workers from the main app tree
$rows = New-Object System.Collections.Generic.List[object]
$capturedAt = (Get-Date).ToString("o")

foreach ($pidInt in ($treePids | Sort-Object)) {
    $p = $byPid[$pidInt]
    if (-not $p) { continue }
    $isPython = $p.Name -match '^python'
    $role = if ($isPython) { "external-python" } else { "app-tree" }
    $rows.Add([PSCustomObject]@{
        Timestamp       = $capturedAt
        Role            = $role
        ProcessName     = $p.Name
        Id              = $pidInt
        ParentProcessId = [int]$p.ParentProcessId
        WorkingSetMB    = [math]::Round(($p.WorkingSetSize / 1MB), 2)
        PrivateBytesMB  = [math]::Round(($p.PrivatePageCount / 1MB), 2)
    })
}

# Also catch detached Python MaaFramework workers referencing TM_Opera_O / runner.py
foreach ($p in $allProcs) {
    $pidInt = [int]$p.ProcessId
    if ($treePids.Contains($pidInt)) { continue }
    if ($p.Name -match '^python' -and ([string]$p.CommandLine) -match ([regex]::Escape($WorkspaceHint) + '|MaaStellaSora|runner\.py')) {
        $rows.Add([PSCustomObject]@{
            Timestamp       = $capturedAt
            Role            = "external-python"
            ProcessName     = $p.Name
            Id              = $pidInt
            ParentProcessId = [int]$p.ParentProcessId
            WorkingSetMB    = [math]::Round(($p.WorkingSetSize / 1MB), 2)
            PrivateBytesMB  = [math]::Round(($p.PrivatePageCount / 1MB), 2)
        })
    }
}

$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csvPath

$appRows = @($rows | Where-Object { $_.Role -eq "app-tree" })
$pyRows = @($rows | Where-Object { $_.Role -eq "external-python" })

$appWs = (($appRows | Measure-Object -Property WorkingSetMB -Sum).Sum); if ($null -eq $appWs) { $appWs = 0 }
$appPriv = (($appRows | Measure-Object -Property PrivateBytesMB -Sum).Sum); if ($null -eq $appPriv) { $appPriv = 0 }
$pyWs = (($pyRows | Measure-Object -Property WorkingSetMB -Sum).Sum); if ($null -eq $pyWs) { $pyWs = 0 }
$pyPriv = (($pyRows | Measure-Object -Property PrivateBytesMB -Sum).Sum); if ($null -eq $pyPriv) { $pyPriv = 0 }

@(
    "Label: $Label"
    "Captured: $capturedAt"
    "Verified Root PIDs: $(if ($rootPids.Count -gt 0) { ($rootPids | Sort-Object) -join ', ' } else { 'none' })"
    "App Tree Process Count: $($appRows.Count)"
    "App Tree Working Set MB: $([math]::Round($appWs, 2))"
    "App Tree Private Bytes MB: $([math]::Round($appPriv, 2))"
    "External Python Process Count: $($pyRows.Count)"
    "External Python Working Set MB: $([math]::Round($pyWs, 2))"
    "External Python Private Bytes MB: $([math]::Round($pyPriv, 2))"
    "Combined Total Working Set MB: $([math]::Round($appWs + $pyWs, 2))"
    "Combined Total Private Bytes MB: $([math]::Round($appPriv + $pyPriv, 2))"
) | Set-Content -Encoding UTF8 -Path $summaryPath

Write-Host "Saved process-tree snapshot: $csvPath"
Write-Host "Saved summary: $summaryPath"
Write-Host "App Tree -> Processes: $($appRows.Count) | Working Set: $([math]::Round($appWs, 2)) MB | Private Bytes: $([math]::Round($appPriv, 2)) MB"
Write-Host "External Python -> Processes: $($pyRows.Count) | Working Set: $([math]::Round($pyWs, 2)) MB | Private Bytes: $([math]::Round($pyPriv, 2)) MB"
