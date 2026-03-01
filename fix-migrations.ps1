# Fix Database Migrations Script
# This script will combine all pending migrations into one file for easy execution

Write-Host "=== Database Migration Fix Script ===" -ForegroundColor Cyan
Write-Host ""

# Define migration files in order
$migrations = @(
    "supabase/migrations/20260208160000_add_lead_estimate_workflow.sql",
    "supabase/migrations/20260208170000_add_dynamic_fields.sql",
    "supabase/migrations/20260208180000_enhance_lead_project_flow.sql",
    "supabase/migrations/20260208190000_add_quote_number_generation.sql",
    "supabase/migrations/20260208200000_add_order_number_generation.sql",
    "supabase/migrations/20260208210000_global_store_inventory_system.sql",
    "supabase/migrations/20260208_add_attendance_and_leaves.sql"
)

# Create output file
$outputFile = "combined-migrations.sql"
$header = "-- ============================================`n"
$header += "-- COMBINED MIGRATIONS FOR MANUAL EXECUTION`n"
$header += "-- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"
$header += "-- ============================================`n"
$header += "-- `n"
$header += "-- INSTRUCTIONS:`n"
$header += "-- 1. Go to your Supabase Dashboard`n"
$header += "-- 2. Navigate to SQL Editor`n"
$header += "-- 3. Copy and paste this entire file`n"
$header += "-- 4. Click 'Run' to execute`n"
$header += "-- 5. After success, run: npx supabase db push --linked`n"
$header += "--`n"
$header += "-- ============================================`n`n"

$content = $header

Write-Host "Processing migrations..." -ForegroundColor Yellow

foreach ($migration in $migrations) {
    if (Test-Path $migration) {
        $filename = Split-Path $migration -Leaf
        Write-Host "  [OK] Adding: $filename" -ForegroundColor Green
        
        $separator = "`n-- ============================================`n"
        $separator += "-- Migration: $filename`n"
        $separator += "-- ============================================`n`n"
        
        $content += $separator
        $content += Get-Content $migration -Raw
        $content += "`n`n"
    } else {
        Write-Host "  [MISSING] $filename" -ForegroundColor Red
    }
}

# Save combined file
$content | Out-File -FilePath $outputFile -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "=== DONE! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Created file: $outputFile" -ForegroundColor Cyan
Write-Host "File size: $((Get-Item $outputFile).Length) bytes" -ForegroundColor Gray
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Open your Supabase Dashboard" -ForegroundColor White
Write-Host "2. Go to SQL Editor section" -ForegroundColor White
Write-Host "3. Create a new query" -ForegroundColor White
Write-Host "4. Copy contents from: $outputFile" -ForegroundColor Cyan
Write-Host "5. Paste and execute in SQL Editor" -ForegroundColor White
Write-Host ""
Write-Host "After successful execution, run:" -ForegroundColor Yellow
Write-Host "  npx supabase db push --linked" -ForegroundColor Green
Write-Host ""
