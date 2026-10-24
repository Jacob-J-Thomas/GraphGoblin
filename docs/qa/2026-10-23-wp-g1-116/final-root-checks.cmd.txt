@echo off
setlocal
set "PATH=%APPDATA%\nvm\v22.14.0;%PATH%"
node --version > docs\qa\2026-10-23-wp-g1-116-final-root-results.log.txt
call pnpm.cmd lint > docs\qa\2026-10-23-wp-g1-116-lint-final.log.txt 2>&1
set "WP116_LINT_EXIT=%ERRORLEVEL%"
echo lint exit: %WP116_LINT_EXIT% >> docs\qa\2026-10-23-wp-g1-116-final-root-results.log.txt
call pnpm.cmd typecheck > docs\qa\2026-10-23-wp-g1-116-typecheck-final.log.txt 2>&1
set "WP116_TYPE_EXIT=%ERRORLEVEL%"
echo typecheck exit: %WP116_TYPE_EXIT% >> docs\qa\2026-10-23-wp-g1-116-final-root-results.log.txt
if not "%WP116_LINT_EXIT%"=="0" exit /b %WP116_LINT_EXIT%
exit /b %WP116_TYPE_EXIT%
