@echo off
setlocal
set "JAVA_HOME=C:\Program Files\Java\jdk-21"
set "ANDROID_HOME=C:\Users\Administrator\AppData\Local\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
cd /d "C:\Users\Administrator\Downloads\projects\apk's analasis\phone-app\android"
echo [build] starting %DATE% %TIME%  ABI=arm64-v8a
call gradlew.bat assembleDebug --no-daemon --console=plain -PreactNativeArchitectures=arm64-v8a
echo [build] gradle exit code: %ERRORLEVEL%
echo [build] finished %DATE% %TIME%
