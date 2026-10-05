$taskNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $taskNode) { throw 'Node.js is required. Install Node.js and ensure node is on PATH.' }
Push-Location $PSScriptRoot
try { & $taskNode.Source server.mjs; $taskServerExit = $LASTEXITCODE } finally { Pop-Location }
exit $taskServerExit
