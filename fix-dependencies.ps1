# Fix Dependencies Script
# Run this to clean and reinstall all dependencies

Write-Host "Cleaning node_modules and package-lock files..." -ForegroundColor Yellow

# Navigate to web app directory
Set-Location "apps\web"

# Remove node_modules and package-lock.json
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules"
    Write-Host "✓ Removed node_modules" -ForegroundColor Green
}

if (Test-Path "package-lock.json") {
    Remove-Item -Force "package-lock.json"
    Write-Host "✓ Removed package-lock.json" -ForegroundColor Green
}

# Clear npm cache
Write-Host "`nClearing npm cache..." -ForegroundColor Yellow
npm cache clean --force

# Reinstall dependencies
Write-Host "`nInstalling dependencies..." -ForegroundColor Yellow
npm install

Write-Host "`n✓ Dependencies fixed! You can now restart the dev server." -ForegroundColor Green

# Return to root
Set-Location "..\..\"

