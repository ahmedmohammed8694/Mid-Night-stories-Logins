$path = "D:\My Applications\Midnigth stories\src\worker.js"
$lines = [System.IO.File]::ReadAllLines($path)
Write-Host "Total lines before: $($lines.Count)"
# Remove lines 3003..3038 (0-indexed: 3002..3037)
$newLines = $lines[0..3001] + $lines[3038..($lines.Count - 1)]
Write-Host "Total lines after: $($newLines.Count)"
[System.IO.File]::WriteAllLines($path, $newLines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Done. Wrote $($newLines.Count) lines."
