@echo off
REM proxima-up.bat — start Proxima REST API server for Hermes plugin
REM Called by hermes-agent plugins/proxima-tool/__init__.py
cd /d "E:\Proxima"
npm start
exit /b %ERRORLEVEL%
