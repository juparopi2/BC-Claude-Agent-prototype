# Script to kill processes on ports 3000 and 3002, then restart frontend and backend

Write-Host "Cleaning up processes on ports 3000 and 3002..." -ForegroundColor Yellow

# Function to kill process by port
function Kill-ProcessOnPort {
    param([int]$Port)

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
                    Stop-Process -Id $processId -Force -ErrorAction Stop
                    Write-Host "Killed process $processId on port $Port" -ForegroundColor Green
                } catch {
                    Write-Host "Could not kill process $processId (may already be stopped)" -ForegroundColor Yellow
                }
            }
        }
    } else {
        Write-Host "No process found on port $Port" -ForegroundColor Cyan
    }
}

# Kill processes on our ports
Kill-ProcessOnPort -Port 3000
Kill-ProcessOnPort -Port 3002

Write-Host ""
Write-Host "Waiting 2 seconds for ports to be released..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Starting backend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm run dev"

Write-Host "Waiting 3 seconds for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Starting frontend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host ""
Write-Host "Done! Backend and frontend are starting up..." -ForegroundColor Green
Write-Host "   Backend: http://localhost:3002" -ForegroundColor Cyan
Write-Host "   Frontend: http://localhost:3000" -ForegroundColor Cyan
