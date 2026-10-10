@echo off
rem ROBLOX UBERS always-online: keeps the server + Cloudflare tunnel running.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\always-online.ps1" %*
