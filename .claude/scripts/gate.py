#!/usr/bin/env python3
"""Gate de verificación de MINERIASC. Bloqueante: exit != 0 = no cerrar.

Uso: python .claude/scripts/gate.py [-v]
Cada feature nueva añade aquí su check. Idempotente y sin dependencias externas.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERBOSE = "-v" in sys.argv
FAILS = []


def check(name, ok, detail=""):
    if ok:
        if VERBOSE:
            print(f"  OK  {name}")
    else:
        FAILS.append(name)
        print(f"FALLO {name}" + (f" — {detail}" if detail else ""))


def main():
    # --- integridad de la capa de agentes -------------------------------
    guides_dir = ROOT / ".claude" / "guides"
    index_md = guides_dir / "INDEX.md"
    guides = {p.name for p in guides_dir.glob("*.md")} - {"INDEX.md"}
    indexed = set(re.findall(r"\]\(([^)]+\.md)\)", index_md.read_text(encoding="utf-8"))) if index_md.exists() else set()
    check("INDEX.md existe", index_md.exists())
    check("guias sin indexar", not (guides - indexed), f"faltan en INDEX.md: {sorted(guides - indexed)}")
    check("indice sin guia", not (indexed - guides), f"entradas colgando: {sorted(indexed - guides)}")

    agents_dir = ROOT / ".claude" / "agents"
    agents = list(agents_dir.glob("*.md"))
    check("hay agentes definidos", bool(agents))
    check("sin tech-lead.md (el orquestador es la sesion)", not (agents_dir / "tech-lead.md").exists())
    for a in agents:
        text = a.read_text(encoding="utf-8")
        check(f"{a.name}: protocolo estandar", "## Protocolo estandar" in text)
        check(f"{a.name}: model pineado", re.search(r"^model:\s*\S+", text, re.M) is not None)
        check(f"{a.name}: effort pineado", re.search(r"^effort:\s*\S+", text, re.M) is not None)

    claude_md = ROOT / "CLAUDE.md"
    if claude_md.exists():
        cm = claude_md.read_text(encoding="utf-8")
        lines = cm.count("\n") + 1
        check("CLAUDE.md < 160 lineas", lines < 160, f"tiene {lines}")
        check("CLAUDE.md: tabla de routing", "routing:start" in cm and "routing:end" in cm)
        check("CLAUDE.md: directiva de mentor", "rigorous, honest mentor" in cm)
        # cada dir top-level relevante aparece en el routing
        routing = cm.split("routing:start")[1].split("routing:end")[0] if "routing:start" in cm else ""
        for zona in ("index.html", "css/", "js/", "data/", ".claude/"):
            check(f"routing cubre {zona}", zona in routing)
    else:
        check("CLAUDE.md existe", False)

    # --- integridad del producto (solo lectura, no lo modifica) ---------
    mdata_path = ROOT / "data" / "mining_data.json"
    try:
        mdata = json.loads(mdata_path.read_text(encoding="utf-8"))
        check("mining_data.json parsea", True)
        for key in ("meta", "ores", "locations", "location_ores", "scanner_signals", "refineries"):
            check(f"mining_data.json tiene '{key}'", key in mdata and bool(mdata[key]))
    except Exception as e:  # noqa: BLE001
        check("mining_data.json parsea", False, str(e))

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r'<script src="([^"]+)"', html)
    for s in scripts:
        check(f"script referenciado existe: {s}", (ROOT / s).exists())
    js_files = {f"js/{p.name}" for p in (ROOT / "js").glob("*.js")}
    check("todo js/ esta referenciado en index.html", js_files <= set(scripts),
          f"huerfanos: {sorted(js_files - set(scripts))}")

    # ids usados por JS existen en el HTML
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    for p in (ROOT / "js").glob("*.js"):
        used = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", p.read_text(encoding="utf-8")))
        # ids creados dinamicamente por JS (innerHTML) tambien cuentan
        dyn = set()
        for q in (ROOT / "js").glob("*.js"):
            dyn |= set(re.findall(r'id="([^"]+)"', q.read_text(encoding="utf-8")))
        missing = used - html_ids - dyn
        check(f"{p.name}: ids existen en el HTML", not missing, f"faltan: {sorted(missing)}")

    # el estatico sigue siendo estatico
    check("sin package.json (sin build)", not (ROOT / "package.json").exists())
    check("sin CDNs en index.html", "cdn." not in html and "unpkg" not in html and "jsdelivr" not in html)

    print()
    if FAILS:
        print(f"GATE ROJO — {len(FAILS)} fallo(s).")
        return 1
    print("GATE VERDE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
