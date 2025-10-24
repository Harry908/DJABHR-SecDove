@echo off
echo 🔄 Recreating SecureDove Database...
echo =====================================

REM Check if Turso CLI is installed
turso --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Turso CLI not found. Install it first:
    echo npm install -g @tursodatabase/turso-cli
    pause
    exit /b 1
)

REM Check if logged in
turso auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Not logged in to Turso. Run: turso auth login
    pause
    exit /b 1
)

echo 🗑️  Destroying existing database...
turso db destroy securedove --yes 2>nul || echo Note: Database may not exist yet

echo 🆕 Creating new database...
turso db create securedove

echo 🔑 Creating database token...
for /f "tokens=*" %%i in ('turso db tokens create securedove') do set TOKEN=%%i

echo 📋 Database Information:
echo ========================
echo Database Name: securedove
for /f "tokens=*" %%i in ('turso db show securedove ^| findstr URL') do echo %%i
echo Auth Token: %TOKEN%
echo.

echo ⚠️  IMPORTANT: Update your Vercel environment variables!
echo ======================================================
echo Go to Vercel → Backend Project → Settings → Environment Variables:
echo.
for /f "tokens=*" %%i in ('turso db show securedove ^| findstr URL') do echo TURSO_DATABASE_URL=%%i
echo TURSO_AUTH_TOKEN=%TOKEN%
echo.
echo Then redeploy your backend project.
echo.
echo ✅ Database recreation complete!
pause