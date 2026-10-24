@echo off
setlocal
set "PATH=%APPDATA%\nvm\v22.14.0;%PATH%"
node --version > docs\qa\2026-10-23-wp-g1-116-format-final.log.txt
call pnpm.cmd format:check >> docs\qa\2026-10-23-wp-g1-116-format-final.log.txt 2>&1
exit /b %ERRORLEVEL%
