param(
    [string]$Label = "manual",
    [string]$OutputDirectory = ".\migration\benchmarks",
    [string[]]$ProcessName = @("electron", "TM_Opera_O", "msedgewebview2", "opera-o-tauri")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeLabel = ($Label -replace '[^a-zA-Z0-9_-]', '_')
$csvPath = Join-Path $OutputDirectory "$timestamp-$safeLabel-processes.csv"
$summaryPath = Join-Path $OutputDirectory "$timestamp-$safeLabel-summary.txt"

$processes = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $ProcessName -contains $_.ProcessName } |
    Sort-Object ProcessName, Id |
    Select-Object `
        @{ Name = "Timestamp"; Expression = { (Get-Date).ToString("o") } },
        ProcessName,
        Id,
        @{ Name = "WorkingSetMB"; Expression = { [math]::Round($_.WorkingSet64 / 1MB, 2) } },
        @{ Name = "PrivateMemoryMB"; Expression = { [math]::Round($_.PrivateMemorySize64 / 1MB, 2) } }

$processes | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csvPath

$workingSet = ($processes | Measure-Object -Property WorkingSetMB -Sum).Sum
$privateMemory = ($processes | Measure-Object -Property PrivateMemoryMB -Sum).Sum
if ($null -eq $workingSet) { $workingSet = 0 }
if ($null -eq $privateMemory) { $privateMemory = 0 }

@(
    "Label: $Label"
    "Captured: $(Get-Date -Format o)"
    "Matched process names: $($ProcessName -join ', ')"
    "Process count: $($processes.Count)"
    "Total Working Set MB: $([math]::Round($workingSet, 2))"
    "Total Private Memory MB: $([math]::Round($privateMemory, 2))"
    ""
    "WARNING: This is a name-filtered snapshot, not a verified application process tree."
    "Review the CSV and exclude unrelated msedgewebview2 processes before comparing totals."
    "Record Python/MaaFramework worker memory separately when that workload is active."
) | Set-Content -Encoding UTF8 -Path $summaryPath

Write-Host "Saved process snapshot: $csvPath"
Write-Host "Saved summary: $summaryPath"
Write-Host "Working Set total (name-filtered): $([math]::Round($workingSet, 2)) MB"
Write-Host "Private Memory total (name-filtered): $([math]::Round($privateMemory, 2)) MB"
