@echo off
title Midnight Stories - Push to GitHub
echo ===================================================
echo   Midnight Stories GitHub Uploader
echo ===================================================
echo.

:: Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed on your computer.
    echo Please install Git from https://git-scm.com/ and try again.
    echo.
    pause
    exit /b
)

:: Initialize Git if needed
if not exist .git (
    echo [1/4] Initializing Git repository...
    git init
) else (
    echo [*] Git repository already initialized.
)

:: Add files
echo [2/4] Adding files...
git add .

:: Commit
echo [3/4] Creating commit...
git commit -m "Deploy to Vercel setup - Midnight Stories"

echo.
echo Please create a new repository on https://github.com/
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g., https://github.com/yourusername/repo-name.git): "

if "%REPO_URL%"=="" (
    echo [ERROR] Repository URL cannot be empty.
    pause
    exit /b
)

:: Set remote and push
echo [4/4] Uploading to GitHub...
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO_URL%
git push -u origin main --force

echo.
echo ===================================================
echo   SUCCESS: Code uploaded to GitHub!
echo ===================================================
echo   You can now go to Vercel (vercel.com), import this 
echo   repo, and deploy it live.
echo ===================================================
echo.
pause
