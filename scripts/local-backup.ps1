$ErrorActionPreference = 'Stop'
$sacsiRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sacsiSecurePassword = $null
$sacsiPasswordPointer = [IntPtr]::Zero
$sacsiOriginalPassword = $env:SACSI_DR_DB_PASSWORD
try {
    Set-Location -LiteralPath $sacsiRoot
    if (-not (Test-Path -LiteralPath (Join-Path $sacsiRoot '.env.local'))) {
        throw 'Project .env.local is missing. Do not enter a password until configuration is ready.'
    }
    $sacsiSecurePassword = Read-Host 'Enter existing Supabase DATABASE password (hidden; not your SACSI login password)' -AsSecureString
    if ($sacsiSecurePassword.Length -eq 0) { throw 'No password entered.' }
    $sacsiPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sacsiSecurePassword)
    $env:SACSI_DR_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sacsiPasswordPointer)
    # Node loads Storage credentials locally; the password is process-only, never a command argument.
    & node --env-file=.env.local scripts/backup-disaster-recovery.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Backup did not complete. Do not treat partial output as a valid backup.' }
    Write-Host 'Encrypted backup completed. Return to the chat for isolated restore and external-drive verification.'
} finally {
    $env:SACSI_DR_DB_PASSWORD = $sacsiOriginalPassword
    if ($sacsiPasswordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sacsiPasswordPointer)
    }
    if ($null -ne $sacsiSecurePassword) { $sacsiSecurePassword.Dispose() }
}
