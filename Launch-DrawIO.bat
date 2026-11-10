@echo off
REM ===== Launch self-hosted draw.io with Page Explorer =====
set "PORT=8080"

REM Libraries baked into the image (files in the libraries folder).
REM Multiple libraries: separate with ;   Leave blank for none.
set "LIB_URL=http://localhost:%PORT%/custom-libs/ignition-perspective.xml"
set "DOCKER_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe"

REM 1) Start Docker Desktop if the engine is not running
docker info >nul 2>&1
if not errorlevel 1 goto dockerready
echo Starting Docker Desktop...
start "" "%DOCKER_EXE%"
:waitdocker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto waitdocker
:dockerready

REM 2) Make sure the draw.io container is running
docker start drawio >nul 2>&1
if errorlevel 1 (
    echo Container not found, building it...
    pushd "%~dp0"
    docker compose up -d --build
    popd
)

REM 3) Wait for draw.io to answer
:waitweb
curl -s -o nul http://localhost:%PORT%/
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto waitweb
)

REM 4) Build the URL (auto-load custom libraries)
set "URL=http://localhost:%PORT%/?https=0"
if not "%LIB_URL%"=="" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "[uri]::EscapeDataString($env:LIB_URL)"`) do set "ENC=%%i"
)
if defined ENC set "URL=%URL%&clibs=U%ENC%"

REM 5) Open as a standalone app window (no browser tabs/address bar)
start "" msedge --app="%URL%"
