# ============================================================================
# สคริปต์ตั้งค่าอัตโนมัติ — สร้างไฟล์ .env ให้จากไฟล์ JSON ของ service account
#
# วิธีใช้: คลิกขวาที่ไฟล์นี้ > Run with PowerShell
#         หรือพิมพ์ในหน้าต่าง PowerShell:  .\setup.ps1
#
# ทำไมต้องมีสคริปต์นี้: ค่า private_key ในไฟล์ JSON เก็บเป็นข้อความหลายบรรทัด
# แต่ไฟล์ .env ต้องการให้อยู่บรรทัดเดียวโดยใช้ \n คั่น ถ้าคัดลอกวางเองมักพลาดตรงนี้
# สคริปต์นี้แปลงให้เรียบร้อย จะได้ไม่ต้องมานั่งแก้ทีหลัง
# ============================================================================

# บังคับให้หน้าจอแสดงภาษาไทยได้ถูกต้อง
# Windows PowerShell ใช้ชุดอักขระเดิมของระบบ (windows-874 ในเครื่องภาษาไทย)
# ถ้าไม่ตั้งค่านี้ ข้อความไทยจะออกมาเป็นตัวอักษรมั่วๆ อ่านไม่ออก
#
# หมายเหตุสำคัญสำหรับคนที่จะมาแก้ไฟล์นี้:
# ไฟล์นี้ต้องบันทึกเป็น "UTF-8 with BOM" เท่านั้น
# ถ้าบันทึกเป็น UTF-8 เฉยๆ (ไม่มี BOM) PowerShell จะอ่านภาษาไทยผิดทั้งไฟล์
# จนโค้ดพังตั้งแต่ยังไม่ได้เริ่มทำงาน (ใน VS Code เลือก "UTF-8 with BOM" ที่มุมขวาล่าง)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ถามคำถามแล้วคืนค่าเป็นข้อความเสมอ
# Read-Host เปล่าๆ จะคืนค่า null ได้ถ้าไม่มีการพิมพ์อะไรเข้ามาเลย
# ซึ่งพอเอาไป .Trim() ต่อจะพังทันทีด้วยข้อความ error ที่อ่านไม่รู้เรื่อง
function Ask($prompt) {
    $answer = Read-Host $prompt
    if ($null -eq $answer) { return '' }
    return $answer.Trim()
}

Write-Host ""
Write-Host "=== ตั้งค่าระบบบริหารจัดการเครื่องปรับอากาศ ITEL ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1) หาไฟล์ JSON ของ service account
# ---------------------------------------------------------------------------

Write-Host "[1/3] กำลังมองหาไฟล์ key ของ service account..." -ForegroundColor Yellow

$candidates = @()
foreach ($dir in @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", $root)) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Filter *.json -File -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $content = Get-Content $_.FullName -Raw -ErrorAction Stop
            if ($content -match '"type"\s*:\s*"service_account"') { $candidates += $_ }
        } catch { }
    }
}
$candidates = $candidates | Sort-Object LastWriteTime -Descending

$keyPath = $null
if ($candidates.Count -eq 0) {
    Write-Host "      ไม่เจอไฟล์อัตโนมัติ" -ForegroundColor Red
    Write-Host "      ลากไฟล์ JSON มาวางในหน้าต่างนี้แล้วกด Enter (หรือพิมพ์ที่อยู่ไฟล์)"
    $keyPath = (Ask "      ไฟล์ JSON").Trim('"')
} elseif ($candidates.Count -eq 1) {
    $keyPath = $candidates[0].FullName
    Write-Host "      เจอแล้ว: $keyPath" -ForegroundColor Green
} else {
    Write-Host "      เจอหลายไฟล์ เลือกหมายเลข:" -ForegroundColor Green
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        "        [{0}] {1}  (แก้ไขล่าสุด {2})" -f ($i+1), $candidates[$i].Name, $candidates[$i].LastWriteTime
    }
    $pick = Ask "      หมายเลข"

    # ต้องตรวจให้ครบว่าเป็นตัวเลขและอยู่ในช่วงที่มีจริง
    # ถ้าปล่อยผ่าน การกด Enter เฉยๆ จะกลายเป็นเลข 0 แล้ว $candidates[-1]
    # จะวนไปหยิบไฟล์ตัวสุดท้ายให้เงียบๆ ซึ่งอาจเป็นคนละไฟล์กับที่ตั้งใจ
    $idx = 0
    if (-not [int]::TryParse($pick, [ref]$idx) -or $idx -lt 1 -or $idx -gt $candidates.Count) {
        Write-Host "`n❌ ต้องพิมพ์หมายเลขระหว่าง 1 ถึง $($candidates.Count)`n" -ForegroundColor Red
        exit 1
    }
    $keyPath = $candidates[$idx - 1].FullName
    Write-Host "      เลือก: $($candidates[$idx - 1].Name)" -ForegroundColor Green
}

if (-not (Test-Path $keyPath)) {
    Write-Host "`n❌ ไม่พบไฟล์: $keyPath`n" -ForegroundColor Red
    exit 1
}

$key = Get-Content $keyPath -Raw | ConvertFrom-Json
if (-not $key.client_email -or -not $key.private_key) {
    Write-Host "`n❌ ไฟล์นี้ไม่ใช่ key ของ service account (ไม่มี client_email หรือ private_key)`n" -ForegroundColor Red
    exit 1
}

Write-Host "      อีเมล service account: $($key.client_email)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2) ถามว่าจะใช้ Google Sheet ไฟล์ไหน
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "[2/3] Google Sheet ที่จะใช้" -ForegroundColor Yellow
Write-Host "      วางลิงก์ของไฟล์ Sheet (กด Enter เฉยๆ เพื่อใช้ค่าเดิมในไฟล์ .env.example)"
$sheetInput = Ask "      ลิงก์หรือ ID"

$sheetId = "1utgGVyDGtof8rh_fe9VtqcNPmyf61lbEkqwS6spMxc0"
if ($sheetInput) {
    if ($sheetInput -match '/d/([a-zA-Z0-9_-]+)') { $sheetId = $Matches[1] }
    elseif ($sheetInput -match '^[a-zA-Z0-9_-]{20,}$') { $sheetId = $sheetInput }
    else {
        Write-Host "`n❌ อ่านลิงก์ไม่ออก ให้วางลิงก์เต็มจากแถบที่อยู่ของเบราว์เซอร์`n" -ForegroundColor Red
        exit 1
    }
}
Write-Host "      ใช้ Sheet ID: $sheetId" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3) เขียนไฟล์ .env
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "[3/3] กำลังเขียนไฟล์ .env" -ForegroundColor Yellow

$envPath = Join-Path $root ".env"
if (Test-Path $envPath) {
    $ans = Ask "      มีไฟล์ .env อยู่แล้ว เขียนทับไหม? (y/n)"
    if ($ans -ne 'y') { Write-Host "`nยกเลิก ไม่ได้แก้อะไร`n"; exit 0 }
    Copy-Item $envPath "$envPath.backup" -Force
    Write-Host "      สำรองของเดิมไว้ที่ .env.backup แล้ว" -ForegroundColor Green
}

# แปลงการขึ้นบรรทัดใหม่จริงในค่า private_key ให้เป็นตัวอักษร \n สองตัว
# นี่คือขั้นตอนที่คนทำเองแล้วพลาดบ่อยที่สุด
$privateKey = $key.private_key -replace "`r`n", '\n' -replace "`n", '\n'

# เก็บค่าเดิมของบริการ PDF ไว้ ถ้าเคยตั้งไว้แล้ว
$pdfUrl = ""
$pdfSecret = ""
if (Test-Path "$envPath.backup") {
    foreach ($line in Get-Content "$envPath.backup") {
        if ($line -match '^\s*PDF_SERVICE_URL\s*=\s*"?([^"]*)"?') { $pdfUrl = $Matches[1] }
        if ($line -match '^\s*PDF_SERVICE_SECRET\s*=\s*"?([^"]*)"?') { $pdfSecret = $Matches[1] }
    }
}

$content = @"
# ไฟล์นี้สร้างโดยสคริปต์ setup.ps1 เมื่อ $(Get-Date -Format 'yyyy-MM-dd HH:mm')
# ⚠️ ห้ามส่งไฟล์นี้ให้ใคร หรือนำขึ้น git — ข้างในมีกุญแจเข้าถึงชีต

SPREADSHEET_ID="$sheetId"
GOOGLE_SERVICE_ACCOUNT_EMAIL="$($key.client_email)"
GOOGLE_PRIVATE_KEY="$privateKey"

PORT="8787"

# บริการสร้าง PDF ฟอร์มล้างแอร์ (ไม่ใส่ก็ได้ เมนูอื่นทำงานได้ครบ)
PDF_SERVICE_URL="$pdfUrl"
PDF_SERVICE_SECRET="$pdfSecret"
"@

[System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding $false))

Write-Host "      เขียนไฟล์ .env เรียบร้อย" -ForegroundColor Green

# ---------------------------------------------------------------------------
# สรุปสิ่งที่ต้องทำต่อ
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "=== เสร็จแล้ว เหลืออีก 2 อย่าง ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. แชร์ Google Sheet ให้อีเมลนี้เป็น " -NoNewline
Write-Host '"ผู้แก้ไข"' -ForegroundColor Yellow
Write-Host ""
Write-Host "   $($key.client_email)" -ForegroundColor White
Write-Host ""
Write-Host "   (เปิดชีต > กดปุ่มแชร์ > วางอีเมลนี้ > เลือกผู้แก้ไข > ส่ง)"
Write-Host ""
Write-Host "2. เปิดระบบด้วยคำสั่ง:" -NoNewline
Write-Host "  npm start" -ForegroundColor Yellow
Write-Host ""
