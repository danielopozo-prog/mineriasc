@echo off
title Mineria SC - Servidor local
cd /d "%~dp0"

echo.
echo  ================================================
echo   MINERIA SC - Servidor local
echo  ================================================
echo.

set PY_CMD=python
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo  ERROR: no se encontro Python en este equipo.
        echo  Instala Python desde https://www.python.org/downloads/
        echo  ^(marca la casilla "Add python.exe to PATH" durante la instalacion^)
        echo  y vuelve a ejecutar este archivo.
        echo.
        pause
        exit /b 1
    )
    set PY_CMD=py
)

set PORT=8123

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo  El puerto %PORT% ya esta en uso.
    echo  Es probable que el servidor ya este corriendo en otra ventana.
    echo  Abriendo el navegador en http://localhost:%PORT% ...
    echo.
    start "" http://localhost:%PORT%
    echo  Si la pagina no carga bien, cierra la otra ventana del servidor
    echo  y vuelve a ejecutar este archivo.
    echo.
    pause
    exit /b 0
)

echo  Iniciando servidor en http://localhost:%PORT%
echo  Abriendo el navegador...
echo.
echo  Deja esta ventana abierta mientras uses la app.
echo  Para parar el servidor: cierra esta ventana o pulsa Ctrl+C.
echo.

start "" http://localhost:%PORT%
%PY_CMD% -m http.server %PORT%

pause
