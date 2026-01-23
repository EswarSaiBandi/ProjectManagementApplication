# Node.js Setup Script for Windows
# Run this script to configure PowerShell execution policy for npm

Write-Host "Setting up Node.js environment..." -ForegroundColor Green

# Check Node.js installation
Write-Host "`nChecking Node.js installation..." -ForegroundColor Yellow
$nodeVersion = node --version
$npmVersion = npm --version
Write-Host "Node.js: $nodeVersion" -ForegroundColor Cyan
Write-Host "npm: $npmVersion" -ForegroundColor Cyan

# Set execution policy for current user (doesn't require admin)
Write-Host "`nSetting PowerShell execution policy..." -ForegroundColor Yellow
try {
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Write-Host "✓ Execution policy set successfully!" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to set execution policy: $_" -ForegroundColor Red
    Write-Host "You may need to run PowerShell as Administrator" -ForegroundColor Yellow
}

# Verify npm works
Write-Host "`nVerifying npm..." -ForegroundColor Yellow
try {
    npm --version | Out-Null
    Write-Host "✓ npm is working correctly!" -ForegroundColor Green
} catch {
    Write-Host "✗ npm is not working: $_" -ForegroundColor Red
}

# Check npm global packages location
Write-Host "`nNode.js Configuration:" -ForegroundColor Yellow
$npmPrefix = npm config get prefix
Write-Host "npm prefix: $npmPrefix" -ForegroundColor Cyan

Write-Host "`nSetup complete!" -ForegroundColor Green
Write-Host "You can now use npm commands in PowerShell." -ForegroundColor Cyan

