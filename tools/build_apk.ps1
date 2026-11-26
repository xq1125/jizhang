# Build APK from the ledger web app (Capacitor remote-shell mode).
# Idempotent: completed steps are skipped. ASCII-only to avoid encoding issues.
$ErrorActionPreference = 'Continue'
$root    = 'C:\Users\zhengkaiyu01\Downloads\jizhang'
$envdir  = "$root\tools\buildenv"
$nodebin = 'C:\Users\zhengkaiyu01\.leihuo-dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin'
New-Item -ItemType Directory -Force -Path $envdir | Out-Null
$env:PATH = "$nodebin;$env:PATH"
$env:npm_config_registry = 'https://registry.npmmirror.com'

# ---------- 1. JDK 17 ----------
$jdk = "$envdir\jdk"
if (-not (Test-Path "$jdk\bin\java.exe")) {
  Write-Host '>>> [1/5] Downloading Microsoft JDK 17 ...'
  $zip = "$envdir\jdk.zip"
  curl.exe -sL --ssl-no-revoke -o $zip 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip'
  if ((Get-Item $zip -ErrorAction SilentlyContinue).Length -lt 50MB) { throw 'JDK download failed' }
  Expand-Archive $zip -DestinationPath "$envdir\jdktmp" -Force
  $d = Get-ChildItem "$envdir\jdktmp" -Directory | Where-Object Name -like 'jdk*' | Select-Object -First 1
  Move-Item $d.FullName $jdk -Force
  Remove-Item $zip, "$envdir\jdktmp" -Recurse -Force
} else { Write-Host '>>> [1/5] JDK present, skip' }
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
java -version 2>&1 | Out-String | Write-Host
if (-not (Test-Path "$jdk\bin\java.exe")) { throw 'JDK missing after step 1' }

# ---------- 2. Android SDK ----------
$sdk = "$envdir\sdk"
New-Item -ItemType Directory -Force -Path $sdk | Out-Null
$sm = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sm)) {
  Write-Host '>>> [2/5] Downloading Android cmdline-tools ...'
  $z = "$envdir\cmdtools.zip"
  $urls = @(
    'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip',
    'https://dl.google.com/android/repository/commandlinetools-win-10407896_latest.zip')
  foreach ($u in $urls) {
    curl.exe -sL --ssl-no-revoke -o $z $u
    if ((Get-Item $z -ErrorAction SilentlyContinue).Length -gt 50MB) { break }
  }
  if ((Get-Item $z -ErrorAction SilentlyContinue).Length -lt 50MB) { throw 'cmdline-tools download failed' }
  Expand-Archive $z -DestinationPath "$envdir\cmdtmp" -Force
  New-Item -ItemType Directory -Force -Path "$sdk\cmdline-tools" | Out-Null
  Move-Item "$envdir\cmdtmp\cmdline-tools" "$sdk\cmdline-tools\latest" -Force
  Remove-Item $z, "$envdir\cmdtmp" -Recurse -Force
}
if (-not (Test-Path "$sdk\platforms\android-34")) {
  Write-Host '>>> [2/5] Accepting licenses and installing platform-tools / android-34 / build-tools 34 ...'
  ("y`n" * 30) | & $sm --licenses --sdk_root=$sdk *> $null
  & $sm --sdk_root=$sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0" | Out-String | Write-Host
}
if (-not (Test-Path "$sdk\platforms\android-34")) { throw 'android-34 platform missing after step 2' } else { Write-Host '>>> [2/5] SDK components present, skip' }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

# ---------- 3. Capacitor project ----------
$proj = "$envdir\apkproj"
New-Item -ItemType Directory -Force -Path $proj | Out-Null
Set-Location $proj
if (-not (Test-Path "$proj\node_modules\@capacitor\android")) {
  Write-Host '>>> [3/5] Installing Capacitor ...'
  '{"name":"jizhang-apk","version":"1.0.0","private":true}' | Set-Content package.json
  npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 --no-fund --no-audit --loglevel=error
}
Write-Host '>>> [3/5] Writing config and local assets ...'
New-Item -ItemType Directory -Force -Path www | Out-Null
Copy-Item "$root\index.html","$root\style.css","$root\app.js","$root\sync.js","$root\sw.js","$root\manifest.webmanifest" www\ -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path www\icons | Out-Null
Copy-Item "$root\icons\*.png" www\icons\ -Force
$cfg = @{
  appId   = 'dev.pages.jizhangxq.app'
  appName = [string][char]0x8BB0 + [char]0x8D26 + [char]0x672C
  webDir  = 'www'
  server  = @{ url = 'https://jizhang-xq.pages.dev'; allowNavigation = @('jizhang-xq.pages.dev') }
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$proj\capacitor.config.json", $cfg, [System.Text.UTF8Encoding]::new($false))
if (-not (Test-Path "$proj\android")) {
  Write-Host '>>> [3/5] Generating android project ...'
  npx --yes cap add android 2>&1 | Out-String | Write-Host
}
if (-not (Test-Path "$proj\android")) { throw 'capacitor android project missing after step 3' }
npx --yes cap sync android 2>&1 | Out-String | Write-Host

# ---------- 4. Gradle build ----------
Write-Host '>>> [4/5] gradle assembleDebug (first run downloads Gradle, 5-15 min) ...'
Set-Location "$proj\android"
$env:GRADLE_USER_HOME = "$envdir\gradlehome"
New-Item -ItemType Directory -Force -Path "$env:GRADLE_USER_HOME\wrapper\dists" | Out-Null
# Redirect temp to project-local dir (system TEMP had AccessDenied under sandbox)
New-Item -ItemType Directory -Force -Path "$envdir\tmp" | Out-Null
$env:TEMP = "$envdir\tmp"
$env:TMP  = "$envdir\tmp"
# Redirect ~/.android (debug keystore) into project too
New-Item -ItemType Directory -Force -Path "$envdir\androidhome" | Out-Null
$env:ANDROID_USER_HOME = "$envdir\androidhome"
$gp = "$proj\android\gradle.properties"
$tmpArg = "-Djava.io.tmpdir=$($envdir -replace '\\','/')/tmp"
if (Test-Path $gp) {
  $txt = Get-Content $gp -Raw
  if ($txt -match '(?m)^org\.gradle\.jvmargs=(.*)$') {
    $cur = $Matches[1]
    if ($cur -notmatch 'java\.io\.tmpdir') {
      $txt = $txt -replace '(?m)^org\.gradle\.jvmargs=.*$', ('org.gradle.jvmargs=' + $cur + ' ' + $tmpArg)
      [System.IO.File]::WriteAllText($gp, $txt)
    }
  } else {
    [System.IO.File]::AppendAllText($gp, "`norg.gradle.jvmargs=$tmpArg -Xmx1536m`n")
  }
}
"sdk.dir=$($sdk -replace '\\','/')" | Set-Content local.properties -Encoding ascii
& .\gradlew.bat assembleDebug --no-daemon 2>&1 | Out-String | Write-Host
$apk = "$proj\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw 'APK not produced' }
$sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 1)
Write-Host "APK built: $sizeMB MB"

# ---------- 5. Deploy to site ----------
Write-Host '>>> [5/5] Copying APK to site and deploying ...'
Copy-Item $apk "$root\cf-dist\jizhang.apk" -Force
Copy-Item "$root\index.html","$root\style.css","$root\app.js","$root\sync.js","$root\sw.js","$root\manifest.webmanifest" "$root\cf-dist\" -Force
Set-Location $root
npx --yes wrangler pages deploy cf-dist --project-name jizhang-xq --branch main --commit-dirty=true 2>&1 | Select-String 'Success|complete|ERROR'
Write-Host '>>> ALL DONE'
