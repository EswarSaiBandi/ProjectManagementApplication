# ============================================================================
# End-to-end Supabase backup.
#
# Produces a timestamped folder with:
#   * db/supabase_<timestamp>.sql        — plain SQL dump of public + auth schemas
#   * db/supabase_<timestamp>.dump       — compressed custom-format dump (pg_restore)
#   * buckets/<bucket>/<path>/<file>     — every file from every Storage bucket
#   * MANIFEST.txt                       — a summary of what was captured
#
# Usage (run from PowerShell):
#   .\backup-supabase.ps1
#
# It will prompt for three things (nothing is saved or echoed to the shell):
#   1. Supabase project URL         e.g. https://zgwopedbqkygwqxaixzc.supabase.co
#   2. Supabase service_role JWT    (from dashboard → Project Settings → API)
#   3. DB connection URI            the DIRECT connection, port 5432 (not pooler 6543)
#
# Override by setting these env vars before running (skips prompts):
#   $env:SUPABASE_URL              = "https://<project-ref>.supabase.co"
#   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."
#   $env:SUPABASE_DB_URL           = "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
#
# Output root (override):
#   $env:SUPABASE_BACKUP_DIR       = "C:\backups\supabase"   (default)
# ============================================================================

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    Write-Host "pg_dump not found on PATH." -ForegroundColor Red
    Write-Host "Install PostgreSQL client tools, then re-run:"
    Write-Host "  - https://www.postgresql.org/download/windows/  (uncheck server, keep CLI)"
    Write-Host "  - or: choco install postgresql"
    exit 1
}
Write-Host "Found pg_dump: $($pgDump.Source)" -ForegroundColor Gray

function Read-Secret([string]$prompt) {
    $sec = Read-Host -Prompt $prompt -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$supabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else {
    Read-Host -Prompt "Supabase project URL (e.g. https://xxx.supabase.co)"
}
$serviceKey = if ($env:SUPABASE_SERVICE_ROLE_KEY) { $env:SUPABASE_SERVICE_ROLE_KEY } else {
    Read-Secret "service_role key (will be hidden)"
}
$dbUrl = if ($env:SUPABASE_DB_URL) { $env:SUPABASE_DB_URL } else {
    Read-Secret "DB connection URI (DIRECT port 5432; will be hidden)"
}

if (-not $supabaseUrl -or -not $serviceKey -or -not $dbUrl) {
    Write-Host "Missing one or more credentials. Aborting." -ForegroundColor Red
    exit 1
}

if ($dbUrl -match ':6543') {
    Write-Host "WARNING: DB URL is on port 6543 (transaction pooler)." -ForegroundColor Yellow
    Write-Host "pg_dump works unreliably on the pooler. Prefer the DIRECT connection on port 5432." -ForegroundColor Yellow
    $cont = Read-Host "Continue anyway? (y/N)"
    if ($cont -ne 'y' -and $cont -ne 'Y') { exit 1 }
}

# ---------------------------------------------------------------------------
# 2. Output directory
# ---------------------------------------------------------------------------

$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$root   = if ($env:SUPABASE_BACKUP_DIR) { $env:SUPABASE_BACKUP_DIR } else { "C:\backups\supabase" }
$dir    = Join-Path $root $stamp
$dbDir  = Join-Path $dir "db"
$bucDir = Join-Path $dir "buckets"
New-Item -ItemType Directory -Force -Path $dbDir  | Out-Null
New-Item -ItemType Directory -Force -Path $bucDir | Out-Null

Write-Host "`nBackup folder: $dir" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 3. Database dumps
# ---------------------------------------------------------------------------

$sqlFile  = Join-Path $dbDir "supabase_$stamp.sql"
$dumpFile = Join-Path $dbDir "supabase_$stamp.dump"

Write-Host "`n[1/3] Plain SQL dump (public + auth)..." -ForegroundColor Cyan
& pg_dump $dbUrl `
    --schema=public --schema=auth `
    --no-owner --no-privileges `
    --file="$sqlFile"
if ($LASTEXITCODE -ne 0) {
    Write-Host "pg_dump (SQL) failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
$sqlSize = (Get-Item $sqlFile).Length
Write-Host "  wrote $sqlFile ($([math]::Round($sqlSize/1MB, 2)) MB)" -ForegroundColor Green

Write-Host "`n[2/3] Custom-format compressed dump (public + auth)..." -ForegroundColor Cyan
& pg_dump $dbUrl `
    --schema=public --schema=auth `
    --no-owner --no-privileges `
    -F c -f "$dumpFile"
if ($LASTEXITCODE -ne 0) {
    Write-Host "pg_dump (custom) failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
$dumpSize = (Get-Item $dumpFile).Length
Write-Host "  wrote $dumpFile ($([math]::Round($dumpSize/1MB, 2)) MB)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Storage buckets
# ---------------------------------------------------------------------------

Write-Host "`n[3/3] Downloading Storage bucket files..." -ForegroundColor Cyan

$headers = @{
    "apikey"        = $serviceKey
    "Authorization" = "Bearer $serviceKey"
}

# List all buckets
$bucketsRes = Invoke-RestMethod -Method GET `
    -Uri "$supabaseUrl/storage/v1/bucket" `
    -Headers $headers
$bucketCount = 0
$fileCount   = 0
$byteCount   = [int64]0

if (-not $bucketsRes -or $bucketsRes.Count -eq 0) {
    Write-Host "  No buckets found." -ForegroundColor Yellow
} else {
    foreach ($b in $bucketsRes) {
        $bucketCount++
        $bucketName = $b.name
        $bucketRoot = Join-Path $bucDir $bucketName
        New-Item -ItemType Directory -Force -Path $bucketRoot | Out-Null
        Write-Host "  Bucket: $bucketName" -ForegroundColor White

        # Recursive listing with a BFS over prefixes
        $queue = New-Object System.Collections.Generic.Queue[string]
        $queue.Enqueue("")
        while ($queue.Count -gt 0) {
            $prefix = $queue.Dequeue()
            $body = @{
                prefix = $prefix
                limit  = 1000
                offset = 0
                sortBy = @{ column = "name"; order = "asc" }
            } | ConvertTo-Json -Compress
            try {
                $items = Invoke-RestMethod -Method POST `
                    -Uri "$supabaseUrl/storage/v1/object/list/$bucketName" `
                    -Headers $headers `
                    -ContentType "application/json" `
                    -Body $body
            } catch {
                Write-Host "    list failed for prefix '$prefix': $_" -ForegroundColor Yellow
                continue
            }
            if (-not $items) { continue }
            foreach ($it in $items) {
                # Folders come back with id = null; files have an id.
                $fullPath = if ($prefix) { "$prefix/$($it.name)" } else { $it.name }
                if ($null -eq $it.id) {
                    # folder — recurse
                    $queue.Enqueue($fullPath)
                } else {
                    # file — download
                    $localPath = Join-Path $bucketRoot ($fullPath -replace '/', '\')
                    $localDir  = Split-Path $localPath -Parent
                    New-Item -ItemType Directory -Force -Path $localDir | Out-Null
                    # URL-encode each path segment (spaces, special chars)
                    $encoded = ($fullPath -split '/' | ForEach-Object {
                        [System.Uri]::EscapeDataString($_)
                    }) -join '/'
                    $objUrl = "$supabaseUrl/storage/v1/object/$bucketName/$encoded"
                    try {
                        Invoke-WebRequest -Uri $objUrl -Headers $headers -OutFile $localPath | Out-Null
                        $fileCount++
                        $byteCount += (Get-Item $localPath).Length
                    } catch {
                        Write-Host "    download failed: $bucketName/$fullPath  ($_)" -ForegroundColor Yellow
                    }
                }
            }
        }
    }
    Write-Host "  Buckets: $bucketCount, files: $fileCount, total: $([math]::Round($byteCount/1MB, 2)) MB" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 5. Manifest
# ---------------------------------------------------------------------------

$manifestPath = Join-Path $dir "MANIFEST.txt"
@"
Supabase backup
Timestamp        : $stamp
Supabase URL     : $supabaseUrl
Schemas dumped   : public, auth
Dump files       :
  - db\supabase_$stamp.sql       ($([math]::Round($sqlSize/1MB, 2)) MB)
  - db\supabase_$stamp.dump      ($([math]::Round($dumpSize/1MB, 2)) MB)
Storage          :
  - buckets scanned : $bucketCount
  - files captured  : $fileCount
  - total size      : $([math]::Round($byteCount/1MB, 2)) MB

Restore tips:
  - Plain SQL:   psql "postgresql://user:pw@host:5432/db" -f supabase_$stamp.sql
  - Custom:      pg_restore -d "postgresql://user:pw@host:5432/db" --no-owner --no-privileges supabase_$stamp.dump
  - Storage:     upload files from buckets\<bucket>\... via the Supabase Storage UI or the Storage API.
"@ | Set-Content -Encoding UTF8 -Path $manifestPath

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Backup folder: $dir" -ForegroundColor Cyan
Write-Host "Manifest:      $manifestPath" -ForegroundColor Cyan
