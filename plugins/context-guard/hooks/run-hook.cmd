:; # Polyglot hook launcher. bash runs the ":;" lines; cmd.exe treats them as labels.
:; SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; exec bash "$SCRIPT_DIR/$1"; exit 0
@echo off
setlocal
if exist "C:\Program Files\Git\bin\bash.exe" (
  "C:\Program Files\Git\bin\bash.exe" "%~dp0%~1"
) else (
  bash "%~dp0%~1"
)
exit /b 0
