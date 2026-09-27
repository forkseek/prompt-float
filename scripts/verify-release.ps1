param(
  [string]$ReleaseDirectory = "",
  [switch]$RequireValidSignature,
  [switch]$AllowUnsignedLocalVerification,
  [string]$ExpectedPublisher = $env:PROMPT_FLOAT_PUBLISHER_NAME
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
  $ReleaseDirectory = Join-Path "release" "v$($package.version)"
}
$resolvedRelease = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$rootPrefix = $resolvedRelease.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($RequireValidSignature -and $AllowUnsignedLocalVerification) {
  throw "Cannot require a valid signature and allow an unsigned local build together"
}
$enforceSignature = -not $AllowUnsignedLocalVerification
if ($AllowUnsignedLocalVerification) {
  $localRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\local-verification"))
  $localPrefix = $localRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedRelease.StartsWith($localPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsigned verification is restricted to release/local-verification/"
  }
}
$manifestPath = Join-Path $resolvedRelease "SHA256SUMS.txt"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing release manifest: $manifestPath"
}

function Get-Sha256Hex([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($stream)
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$failures = [System.Collections.Generic.List[string]]::new()
$manifestLines = Get-Content -LiteralPath $manifestPath
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRelease 'SBOM.cdx.json'))) {
  $failures.Add('Missing SBOM.cdx.json')
}
if (-not ($manifestLines | Where-Object { $_ -match '^[a-f0-9]{64}  SBOM\.cdx\.json$' })) {
  $failures.Add('SBOM.cdx.json is absent from the release manifest')
}
foreach ($line in $manifestLines) {
  if ($line -notmatch '^([a-f0-9]{64})  (.+)$') {
    $failures.Add("Invalid manifest line: $line")
    continue
  }
  $expected = $Matches[1]
  $relativePath = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
  $artifactPath = [IO.Path]::GetFullPath((Join-Path $resolvedRelease $relativePath))
  if (-not $artifactPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $failures.Add("Manifest path escapes release directory: $relativePath")
    continue
  }
  if (-not (Test-Path -LiteralPath $artifactPath)) {
    $failures.Add("Missing artifact: $relativePath")
    continue
  }
  $actual = Get-Sha256Hex $artifactPath
  if ($actual -ne $expected) {
    $failures.Add("Hash mismatch: $relativePath")
  }
}

$signatureCommand = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue
$executables = Get-ChildItem -LiteralPath $resolvedRelease -Filter '*.exe' -File
if ($executables.Count -eq 0) {
  $failures.Add('No executable artifacts found')
}
if ($enforceSignature -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
  throw "ExpectedPublisher is required for release verification"
}
foreach ($executable in $executables) {
  if (-not $signatureCommand) {
    Write-Output "$($executable.Name): signature=Unavailable"
    if ($enforceSignature) {
      $failures.Add("Authenticode verification is unavailable: $($executable.Name)")
    }
    continue
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
  Write-Output "$($executable.Name): signature=$($signature.Status)"
  if ($enforceSignature -and $signature.Status -ne 'Valid') {
    $failures.Add("Invalid or missing signature: $($executable.Name)")
  } elseif ($enforceSignature -and $signature.SignerCertificate.Subject -ne $ExpectedPublisher) {
    $failures.Add("Unexpected signature publisher: $($executable.Name)")
  }
}

if ($failures.Count -gt 0) {
  throw ($failures -join [Environment]::NewLine)
}

Write-Output "Release hashes verified."
