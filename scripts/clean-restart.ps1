# Enhanced Script to clean and restart the BC Claude Agent Prototype
# Kills all processes, clears caches, and launches fresh terminals

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   BC Claude Agent - Clean Restart" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Function to kill process by port
function Kill-ProcessOnPort {
    param([int]$Port)

    Write-Host "Checking port $Port..." -ForegroundColor Yellow
    $connections = netstat -ano | findstr ":$Port"
    if ($connections) {
        $pids = $connections | ForEach-Object {
            if ($_ -match '\s+(\d+)\s*$') {
                $matches[1]
            }
        } | Select-Object -Unique

        foreach ($processId in $pids) {
            if ($processId -and $processId -ne "0") {
                try {
                    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                    if ($process) {
                        Write-Host "  -> Killing process $processId ($($process.Name)) on port $Port" -ForegroundColor Red
                        Stop-Process -Id $processId -Force -ErrorAction Stop
                        Write-Host "  OK Process $processId killed" -ForegroundColor Green
                    }
                }
                catch {
                    Write-Host "  ! Could not kill process $processId (may already be stopped)" -ForegroundColor Yellow
                }
            }
        }
    }
    else {
        Write-Host "  OK No process found on port $Port" -ForegroundColor Green
    }
}

# Step 1: Kill processes on ports 3000 and 3002
Write-Host "`n[1/5] Cleaning up processes..." -ForegroundColor Cyan
Kill-ProcessOnPort -Port 3000
Kill-ProcessOnPort -Port 3002

Write-Host "`nWaiting 2 seconds for ports to be released..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Step 2: Clear backend cache
Write-Host "`n[2/5] Clearing backend cache..." -ForegroundColor Cyan
$backendCachePaths = @(
    "backend\node_modules\.cache",
    "backend\tsconfig.tsbuildinfo",
    "backend\dist"
)

foreach ($path in $backendCachePaths) {
    if (Test-Path $path) {
        Write-Host "  -> Removing $path" -ForegroundColor Yellow
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  OK Removed $path" -ForegroundColor Green
    } else {
        Write-Host "  OK $path does not exist (skipping)" -ForegroundColor Gray
    }
}

# Step 3: Clear frontend cache (optional, usually not needed)
Write-Host "`n[3/5] Clearing frontend cache..." -ForegroundColor Cyan
$frontendCachePaths = @(
    "frontend\.next"
)

foreach ($path in $frontendCachePaths) {
    if (Test-Path $path) {
        Write-Host "  -> Removing $path" -ForegroundColor Yellow
        Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  OK Removed $path" -ForegroundColor Green
    } else {
        Write-Host "  OK $path does not exist (skipping)" -ForegroundColor Gray
    }
}

# Step 4: Start backend in new terminal
Write-Host "`n[4/5] Starting backend..." -ForegroundColor Cyan
$backendCmd = "cd '$PSScriptRoot\..\backend'; Write-Host 'Starting Backend...' -ForegroundColor Green; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Write-Host "  OK Backend terminal launched" -ForegroundColor Green

Write-Host "`nWaiting 5 seconds for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Step 5: Start frontend in new terminal
Write-Host "`n[5/5] Starting frontend..." -ForegroundColor Cyan
$frontendCmd = "cd '$PSScriptRoot\..\frontend'; Write-Host 'Starting Frontend...' -ForegroundColor Green; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd
Write-Host "  OK Frontend terminal launched" -ForegroundColor Green

# Final summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   OK Clean Restart Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nServices:" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:3002" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "`nTwo new PowerShell windows have been opened." -ForegroundColor Gray
Write-Host "Check them for startup logs.`n" -ForegroundColor Gray
