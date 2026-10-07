@echo off
setlocal
echo Compiling GorillaFlix Native C++ App (.exe)...

set CXX=C:\Users\allab\.gemini\antigravity-ide\scratch\w64devkit\bin\g++.exe
set INCLUDE_DIR=C:\Users\allab\.gemini\antigravity-ide\scratch\gorillaflix\include
set SRC=C:\Users\allab\.gemini\antigravity-ide\scratch\gorillaflix\main.cpp
set OUT=C:\Users\allab\.gemini\antigravity-ide\scratch\gorillaflix\GorillaFlix.exe

"%CXX%" -std=c++17 -O2 -mwindows -DUNICODE -D_UNICODE -I"%INCLUDE_DIR%" "%SRC%" -o "%OUT%" -lgdiplus -lmfplat -lmf -lmfplay -lmfuuid -lole32 -lcomdlg32 -static -static-libgcc -static-libstdc++

if %ERRORLEVEL% EQU 0 (
    echo [BUILD SUCCESS] Created standalone GorillaFlix.exe
) else (
    echo [BUILD FAILED] Compilation error occurred.
    exit /b %ERRORLEVEL%
)
