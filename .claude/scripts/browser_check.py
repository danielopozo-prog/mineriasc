#!/usr/bin/env python3
"""Verificacion real en navegador para MINERIASC via Chrome DevTools Protocol.

Encapsula el patron que los especialistas repiten a mano: servir la carpeta del
proyecto, lanzar Chrome headless, abrir la pagina, esperar (opcionalmente) una
condicion JS y evaluar una o varias expresiones JS, devolviendo el resultado en
JSON por stdout con codigo de salida 0 (todo OK) o 1 (fallo).

No sustituye al gate (`python .claude/scripts/gate.py -v`), que es estatico.
Este script es para la parte que el gate no puede cubrir: "esto realmente
funciona en un navegador".

Requiere: Python stdlib + el paquete `websocket-client` (ya instalado en este
entorno) y Chrome/Chromium instalado localmente.

Ejemplos
--------
Comprobar que el marketplace ya esta listo y leer un precio medio:

    python .claude/scripts/browser_check.py ^
        --wait "DATA.marketplaceReady === true" ^
        --eval "DATA.marketplaceAvgFor('COPPER').find(t => t.qualityTier === 5).priceAvgScu"

Abrir una pestana concreta y comprobar que no hay errores de consola relevantes
(usando solo --eval, sin --wait):

    python .claude/scripts/browser_check.py --path index.html \
        --eval "document.querySelectorAll('.side-item').length"

Reutiliza un servidor ya levantado en el puerto (por ejemplo uno que dejaste
corriendo con `python -m http.server 8123`); si no hay nada escuchando, este
script levanta uno temporal sirviendo `--root` (por defecto, la raiz del
repo) y lo cierra al terminar. Chrome siempre se lanza y se cierra en cada
ejecucion.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import websocket  # websocket-client
except ImportError:  # pragma: no cover
    print(
        json.dumps(
            {
                "success": False,
                "error": (
                    "Falta el paquete 'websocket-client'. Instalalo con: "
                    "pip install websocket-client"
                ),
            },
            ensure_ascii=False,
        )
    )
    sys.exit(1)

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CHROME_CANDIDATES_WIN = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files\Chromium\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Chromium\Application\chrome.exe"),
]
CHROME_CANDIDATES_OTHER = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome(explicit: str | None) -> str:
    if explicit:
        if Path(explicit).exists():
            return explicit
        raise SystemExit(f"--chrome apunta a una ruta que no existe: {explicit}")
    env = os.environ.get("CHROME_PATH")
    if env and Path(env).exists():
        return env
    on_path = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
    if on_path:
        return on_path
    candidates = CHROME_CANDIDATES_WIN if os.name == "nt" else CHROME_CANDIDATES_OTHER
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise SystemExit(
        "No se encontro Chrome/Chromium. Indica la ruta con --chrome o la variable "
        "de entorno CHROME_PATH."
    )


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http_up(url: str, timeout: float = 1.0) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except urllib.error.URLError:
        return False
    except Exception:  # noqa: BLE001
        return False


def wait_for(predicate, timeout: float, interval: float = 0.2) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


class ServerHandle:
    """Servidor HTTP local: reutiliza uno ya levantado o arranca uno temporal."""

    def __init__(self, root: Path, port: int):
        self.root = root
        self.port = port
        self.proc: subprocess.Popen | None = None
        self.reused = False

    def ensure_up(self) -> None:
        base = f"http://localhost:{self.port}/"
        if http_up(base):
            self.reused = True
            return
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port)],
            cwd=str(self.root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not wait_for(lambda: http_up(base), timeout=10.0):
            self.stop()
            raise SystemExit(
                f"El servidor local en el puerto {self.port} no respondio a tiempo."
            )

    def stop(self) -> None:
        if self.proc is not None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = None


class ChromeHandle:
    """Chrome headless con remote debugging, en un perfil temporal desechable."""

    def __init__(self, chrome_path: str, debug_port: int):
        self.chrome_path = chrome_path
        self.debug_port = debug_port
        self.proc: subprocess.Popen | None = None
        self.user_data_dir = tempfile.mkdtemp(prefix="mineriasc_chrome_")

    def start(self) -> None:
        args = [
            self.chrome_path,
            f"--remote-debugging-port={self.debug_port}",
            f"--user-data-dir={self.user_data_dir}",
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-popup-blocking",
            # Chrome >=111 rechaza el handshake ws si el origin no esta permitido
            # explicitamente (CVE-2022-3699 hardening). Sin este flag, todo
            # connect() del CDP falla con 403 Forbidden.
            "--remote-allow-origins=*",
            "about:blank",
        ]
        self.proc = subprocess.Popen(
            args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        version_url = f"http://localhost:{self.debug_port}/json/version"
        if not wait_for(lambda: http_up(version_url), timeout=10.0):
            self.stop()
            raise SystemExit("Chrome no expuso el DevTools Protocol a tiempo.")

    def new_tab_ws_url(self) -> str:
        # Chrome moderno exige PUT para /json/new (GET devuelve 405).
        req = urllib.request.Request(
            f"http://localhost:{self.debug_port}/json/new?about:blank", method="PUT"
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            info = json.loads(r.read().decode("utf-8"))
        return info["webSocketDebuggerUrl"]

    def stop(self) -> None:
        if self.proc is not None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = None
        shutil.rmtree(self.user_data_dir, ignore_errors=True)


class CDP:
    """Sesion minima sobre una pestana via websocket (Runtime/Page domains)."""

    def __init__(self, ws_url: str, recv_timeout: float = 5.0):
        # El endpoint ws de una pestana recien creada tarda un instante en aceptar
        # conexiones bajo carga (justo despues de /json/new); un par de reintentos
        # evita falsos negativos por una unica conexion que llega demasiado pronto.
        last_err: Exception | None = None
        for attempt in range(5):
            try:
                self.ws = websocket.create_connection(ws_url, timeout=recv_timeout)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(0.5)
        else:
            raise TimeoutError(f"No se pudo conectar al websocket del CDP: {last_err}")
        self._next_id = 1

    def send(self, method: str, params: dict | None = None) -> int:
        msg_id = self._next_id
        self._next_id += 1
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        return msg_id

    def wait_result(self, msg_id: int, overall_timeout: float = 15.0) -> dict:
        deadline = time.time() + overall_timeout
        while time.time() < deadline:
            try:
                raw = self.ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                return msg
        raise TimeoutError(f"Sin respuesta del CDP para el mensaje {msg_id}")

    def navigate_and_wait_load(self, url: str, timeout: float = 15.0) -> None:
        self.send("Page.enable")
        nav_id = self.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        got_nav_response = False
        while time.time() < deadline:
            try:
                raw = self.ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            msg = json.loads(raw)
            if msg.get("id") == nav_id:
                got_nav_response = True
            if msg.get("method") == "Page.loadEventFired":
                return
        if not got_nav_response:
            raise TimeoutError("Page.navigate no respondio a tiempo")
        # loadEventFired no llego pero la navegacion se acepto: seguimos igualmente,
        # el --wait/--eval posteriores ya reintentan si la pagina aun no esta lista.

    def evaluate(self, expression: str, timeout: float = 10.0) -> dict:
        msg_id = self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
        )
        return self.wait_result(msg_id, overall_timeout=timeout)

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001
            pass


def eval_value(cdp: CDP, expression: str, timeout: float = 10.0):
    """Evalua expression; devuelve (valor_o_None, error_o_None)."""
    try:
        msg = cdp.evaluate(expression, timeout=timeout)
    except TimeoutError as e:
        return None, str(e)
    result = msg.get("result", {})
    if result.get("exceptionDetails"):
        exc = result["exceptionDetails"]
        text = exc.get("exception", {}).get("description") or exc.get("text") or "excepcion JS"
        return None, text
    inner = result.get("result", {})
    if "value" in inner:
        return inner["value"], None
    if inner.get("type") == "undefined":
        return None, None
    return inner.get("description"), None


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="browser_check.py",
        description=(
            "Sirve la carpeta del proyecto, abre la pagina en Chrome headless "
            "(via Chrome DevTools Protocol) y evalua expresiones JS reales. "
            "Pensado para que los agentes de MINERIASC verifiquen en el "
            "navegador sin reinventar el montaje cada vez."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--root", default=str(ROOT), help="Carpeta a servir si hay que levantar el servidor (por defecto, la raiz del repo)."
    )
    parser.add_argument(
        "--port", type=int, default=8123, help="Puerto HTTP del sitio (por defecto 8123; se reutiliza si ya hay algo escuchando ahi)."
    )
    parser.add_argument(
        "--path",
        default="/index.html",
        help=(
            "Ruta a abrir dentro del sitio (por defecto /index.html). "
            "Usar sin barra inicial (index.html, no /index.html): en Git "
            "Bash/MSYS, un argumento que parece un path absoluto Unix se "
            "reescribe a un path de Windows antes de llegar a Python (p.ej. "
            "/index.html -> file:///C:/Program Files/Git/index.html), y "
            "Chrome navega a un archivo inexistente en vez de al servidor "
            "local."
        ),
    )
    parser.add_argument(
        "--chrome", default=None, help="Ruta a chrome.exe/chromium; si se omite, se autodetecta (o usa CHROME_PATH)."
    )
    parser.add_argument(
        "--wait", default=None, help="Expresion JS booleana a esperar antes de evaluar (ej: \"DATA.marketplaceReady === true\")."
    )
    parser.add_argument(
        "--timeout", type=float, default=10.0, help="Segundos maximos para --wait (por defecto 10)."
    )
    parser.add_argument(
        "--eval", dest="evals", action="append", default=[], help="Expresion JS a evaluar tras cargar la pagina (repetible)."
    )
    parser.add_argument(
        "--nav-timeout", type=float, default=15.0, help="Segundos maximos para que la pagina termine de cargar (por defecto 15)."
    )
    parser.add_argument(
        "--width", type=int, default=None,
        help=(
            "Ancho de viewport en px (requiere --height). Sin este flag, Chrome "
            "headless usa su tamano de ventana por defecto (~758px de ancho), "
            "insuficiente para verificar breakpoints de escritorio (la web tiene "
            "max-width 1600px). Usa --width 1900 --height 950 para simular un "
            "monitor de escritorio real antes de --wait/--eval."
        ),
    )
    parser.add_argument(
        "--height", type=int, default=None,
        help="Alto de viewport en px (requiere --width). Ver --width.",
    )
    args = parser.parse_args()

    if (args.width is None) != (args.height is None):
        print(
            json.dumps(
                {"success": False, "error": "--width y --height deben pasarse juntos."},
                ensure_ascii=False,
            )
        )
        return 1

    root = Path(args.root).resolve()
    if not root.exists():
        print(json.dumps({"success": False, "error": f"--root no existe: {root}"}, ensure_ascii=False))
        return 1

    chrome_path = find_chrome(args.chrome)
    server = ServerHandle(root, args.port)
    chrome = ChromeHandle(chrome_path, free_port())
    cdp: CDP | None = None
    output = {"success": False, "results": [], "wait": None, "error": None}

    try:
        server.ensure_up()
        chrome.start()
        ws_url = chrome.new_tab_ws_url()
        cdp = CDP(ws_url)

        target_url = urllib.parse.urljoin(f"http://localhost:{args.port}/", args.path.lstrip("/"))
        cdp.send("Runtime.enable")
        if args.width is not None and args.height is not None:
            metrics_id = cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": args.width,
                    "height": args.height,
                    "deviceScaleFactor": 1,
                    "mobile": False,
                },
            )
            cdp.wait_result(metrics_id, overall_timeout=5.0)
        try:
            cdp.navigate_and_wait_load(target_url, timeout=args.nav_timeout)
        except TimeoutError as e:
            output["error"] = str(e)
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 1

        ok_overall = True

        if args.wait:
            deadline = time.time() + args.timeout
            wait_error = None
            met = False
            last_value = None
            while time.time() < deadline:
                last_value, wait_error = eval_value(cdp, args.wait, timeout=min(5.0, args.timeout))
                if wait_error:
                    break
                if last_value:
                    met = True
                    break
                time.sleep(0.3)
            output["wait"] = {
                "expression": args.wait,
                "met": met,
                "last_value": last_value,
                "error": wait_error,
            }
            if not met:
                ok_overall = False

        for expr in args.evals:
            value, err = eval_value(cdp, expr, timeout=10.0)
            output["results"].append({"expression": expr, "value": value, "error": err})
            if err:
                ok_overall = False

        output["success"] = ok_overall
    except Exception as e:  # noqa: BLE001 — cualquier fallo debe limpiar chrome/server
        output["error"] = f"{type(e).__name__}: {e}"
        output["success"] = False
    finally:
        if cdp is not None:
            cdp.close()
        chrome.stop()
        server.stop()

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if output["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
