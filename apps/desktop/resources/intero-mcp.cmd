@echo off
setlocal
set "INTERO_RESOURCE_DIR=%~dp0"
set "INTERO_MCP_LAUNCHER=%~f0"
set "ELECTRON_RUN_AS_NODE=1"
"%INTERO_RESOURCE_DIR%..\Intero.exe" "%INTERO_RESOURCE_DIR%intero-mcp-runtime\index.js" %*
