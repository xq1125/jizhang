# Install Android SDK components WITHOUT sdkmanager (curl + unzip), into buildenv\sdk.
# ASCII only.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\zhengkaiyu01\Downloads\jizhang\tools\buildenv'
$sdk  = "$root\sdk"
$tmp  = "$root\sdkzips"
New-Item -ItemType Directory -Force -Path $sdk, $tmp | Out-Null

Write-Host '>>> fetch repository xml'
curl.exe -sL --ssl-no-revoke -o "$tmp\repo.xml" 'https://dl.google.com/android/repository/repository2-3.xml'
if ((Get-Item "$tmp\repo.xml").Length -lt 100KB) { throw 'repo.xml download failed' }
[xml]$repo = Get-Content "$tmp\repo.xml" -Raw -Encoding UTF8

function Get-PkgUrl($pkgPath) {
  $node = $repo.SelectNodes("//remotePackage") | Where-Object { $_.path -eq $pkgPath } | Select-Object -First 1
  if (-not $node) { return $null }
  foreach ($a in $node.SelectNodes("archives/archive")) {
    $hos = $a.SelectSingleNode("host-os")
    if (-not $hos -or $hos.InnerText -eq 'windows') {
      $u = $a.SelectSingleNode("complete/url")
      if ($u) { return 'https://dl.google.com/android/repository/' + $u.InnerText }
    }
  }
  return $null
}

$targets = @(
  @{ path = 'platform-tools';            dest = "$sdk\platform-tools";            rootInZip = 'platform-tools' },
  @{ path = 'platforms;android-34';      dest = "$sdk\platforms\android-34";      rootInZip = $null },
  @{ path = 'build-tools;34.0.0';        dest = "$sdk\build-tools\34.0.0";        rootInZip = 'android-14' }
)

foreach ($t in $targets) {
  if (Test-Path $t.dest) { Write-Host ("skip (exists): " + $t.path); continue }
  $url = Get-PkgUrl $t.path
  if (-not $url) { Write-Host ("NO URL for " + $t.path); continue }
  $name = Split-Path $url -Leaf
  Write-Host (">>> " + $t.path + "  " + $url)
  curl.exe -sL --ssl-no-revoke -o "$tmp\$name" $url
  if ((Get-Item "$tmp\$name" -ErrorAction SilentlyContinue).Length -lt 1MB) { throw ("download failed: " + $url) }
  $ex = "$tmp\x_" + ($name -replace '[^\w]','_')
  Expand-Archive "$tmp\$name" -DestinationPath $ex -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $t.dest -Parent) | Out-Null
  if ($t.rootInZip) {
    $src = Get-ChildItem $ex -Directory | Where-Object Name -eq $t.rootInZip | Select-Object -First 1
    if (-not $src) { $src = Get-ChildItem $ex -Directory | Select-Object -First 1 }
    Move-Item $src.FullName $t.dest -Force
  } else {
    # platform zip: root dir like android-34 (or single dir)
    $src = Get-ChildItem $ex -Directory | Select-Object -First 1
    Move-Item $src.FullName $t.dest -Force
  }
  Remove-Item $ex -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '>>> write license stubs (AGP offline check)'
New-Item -ItemType Directory -Force -Path "$sdk\licenses" | Out-Null
foreach ($f in @('android-sdk-license','android-sdk-preview-license')) {
  Set-Content "$sdk\licenses\$f" ("`n24333f8a63b6825ea9c5514f83c2829b007d6b52`ne97570778f3e31d569f49b3b10d3c1b0f0b2a3c4`n") -Encoding ascii
}
Write-Host '>>> verify'
foreach ($p in @("$sdk\platforms\android-34\android.jar","$sdk\build-tools\34.0.0\aapt2.exe","$sdk\platform-tools\adb.exe")) {
  Write-Host ((Test-Path $p).ToString() + "  " + $p)
}
