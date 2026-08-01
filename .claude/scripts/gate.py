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

    # --- multipagina: cada pagina de nivel superior ("hoja" de una app) se
    # valida por separado (scripts, ids), pero js/ y el gate global siguen
    # siendo uno solo. Anadir una pagina nueva = anadirla a este dict.
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    pages = {"index.html": html}
    contadores_path = ROOT / "contadores.html"
    if contadores_path.exists():
        pages["contadores.html"] = contadores_path.read_text(encoding="utf-8")

    page_scripts = {name: re.findall(r'<script src="([^"]+)"', h) for name, h in pages.items()}
    all_scripts = set().union(*page_scripts.values()) if page_scripts else set()
    for name, srcs in page_scripts.items():
        for s in srcs:
            check(f"{name}: script referenciado existe: {s}", (ROOT / s).exists())
    js_files = {f"js/{p.name}" for p in (ROOT / "js").glob("*.js")}
    check("todo js/ esta referenciado en alguna pagina", js_files <= all_scripts,
          f"huerfanos: {sorted(js_files - all_scripts)}")

    # ids usados por JS existen en el HTML de la(s) pagina(s) que lo cargan
    page_ids = {name: set(re.findall(r'id="([^"]+)"', h)) for name, h in pages.items()}
    js_owner = {}
    for name, srcs in page_scripts.items():
        for s in srcs:
            js_owner.setdefault(s, set()).add(name)
    all_ids = set().union(*page_ids.values()) if page_ids else set()
    # ids creados dinamicamente por cualquier JS (innerHTML) tambien cuentan
    dyn = set()
    for q in (ROOT / "js").glob("*.js"):
        dyn |= set(re.findall(r'id="([^"]+)"', q.read_text(encoding="utf-8")))

    for p in (ROOT / "js").glob("*.js"):
        rel = f"js/{p.name}"
        owners = js_owner.get(rel, set())
        owner_ids = set().union(*(page_ids[o] for o in owners)) if owners else all_ids
        src = p.read_text(encoding="utf-8")
        # getElementById('x') (patron clasico) + $('#x') (helper querySelector
        # usado por js/contadores.js): ambos son referencias a un id real.
        used = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", src))
        used |= set(re.findall(r"\$\(\s*['\"]#([A-Za-z0-9_-]+)['\"]", src))
        missing = used - owner_ids - dyn
        label = ",".join(sorted(owners)) or "?"
        check(f"{p.name}: ids existen en su HTML ({label})", not missing, f"faltan: {sorted(missing)}")

    # --- pagina hermana "Contadores" (temporizadores, portada de star-citizen-timers) --
    check("contadores.html existe", contadores_path.exists())
    check("css/contadores.css existe", (ROOT / "css" / "contadores.css").exists())
    check("js/contadores.js existe", (ROOT / "js" / "contadores.js").exists())
    check("index.html enlaza a contadores.html", 'href="contadores.html"' in html)
    if contadores_path.exists():
        chtml = pages["contadores.html"]
        check("contadores.html enlaza de vuelta a index.html", 'href="index.html"' in chtml)
        ccss_path = ROOT / "css" / "contadores.css"
        cjs_path = ROOT / "js" / "contadores.js"
        if ccss_path.exists() and cjs_path.exists():
            ccss = ccss_path.read_text(encoding="utf-8")
            cjs = cjs_path.read_text(encoding="utf-8")
            # paleta duplicada en JS (favicon en <canvas>, sin acceso a la cascada
            # CSS): si alguien retoca --ok/--info/--warn/--accent/--dim en
            # contadores.css sin tocar FAVICON_TONES, el favicon queda desincronizado
            # en silencio.
            root_vars = dict(re.findall(r"--(ok|info|warn|accent|dim):\s*(#[0-9a-fA-F]{3,6})", ccss))
            tones = dict(re.findall(r"(calm|mid|warn|hot|off):\s*'(#[0-9a-fA-F]{3,6})'", cjs))
            var_to_tone = {"ok": "calm", "info": "mid", "warn": "warn", "accent": "hot", "dim": "off"}
            mismatches = [
                f"{cssvar}->{var_to_tone[cssvar]}: css={hexval} js={tones.get(var_to_tone[cssvar])}"
                for cssvar, hexval in root_vars.items()
                if var_to_tone.get(cssvar) in tones and tones[var_to_tone[cssvar]].lower() != hexval.lower()
            ]
            check("contadores.js: FAVICON_TONES coincide con las variables de contadores.css",
                  not mismatches, "; ".join(mismatches))

    # --- marketplace averages (medias P2P por tramo de calidad) --------
    uex_js = (ROOT / "js" / "uex.js").read_text(encoding="utf-8")
    check("uex.js: marketplaceAveragesAll definido", "marketplaceAveragesAll" in uex_js)
    check("uex.js: marketplaceAveragesAll expuesto en el objeto devuelto",
          re.search(r"return\s*\{[^}]*marketplaceAveragesAll[^}]*\}", uex_js, re.S) is not None)
    check("uex.js: marketplace_prices_averages_all filtra scu+sell antes de cachear",
          "unit === \"scu\"" in uex_js and "operation === \"sell\"" in uex_js,
          "el payload sin filtrar (~1,3 MB) agota la cuota de localStorage")

    data_js = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    check("data.js: loadMarketplaceAverages definido", "loadMarketplaceAverages" in data_js)
    check("data.js: marketplaceAvgFor definido", "marketplaceAvgFor" in data_js)
    check("data.js: QUALITY_TIER_LABELS definido", "QUALITY_TIER_LABELS" in data_js)

    # --- refresco manual forzado (salta la cache de 30 min) -------------
    check("data.js: refreshLive definido", "refreshLive" in data_js)
    check("data.js: refreshLive usa Promise.allSettled (un fallo no tumba al otro)",
          re.search(r"refreshLive[\s\S]{0,400}Promise\.allSettled", data_js) is not None)
    check("data.js: loadUexPrices acepta force", re.search(r"loadUexPrices\(force", data_js) is not None)
    check("data.js: loadMarketplaceAverages acepta force",
          re.search(r"loadMarketplaceAverages\(force", data_js) is not None)
    check("uex.js: commodities/marketplaceAveragesAll aceptan force (para saltar cache)",
          "force" in uex_js)
    # tabla de tramos verificada empiricamente (uexcorp.space/marketplace/averages):
    # no es floor(quality/100) — proteger contra una "correccion" a ciegas.
    m = re.search(r"QUALITY_TIER_LABELS\s*=\s*\{(.*?)\}", data_js, re.S)
    tier_labels_ok = bool(m) and "5: \"Q800-899\"" in (m.group(1) if m else "")
    check("data.js: tramo quality_tier=5 es Q800-899 (verificado, no lineal)", tier_labels_ok)

    # el estatico sigue siendo estatico (todas las paginas, todos los CSS)
    check("sin package.json (sin build)", not (ROOT / "package.json").exists())
    cdn_markers = ("cdn.", "unpkg", "jsdelivr", "fonts.googleapis", "fonts.gstatic")
    for name, h in pages.items():
        check(f"sin CDNs en {name}", not any(m in h for m in cdn_markers))
    for css_path in (ROOT / "css").glob("*.css"):
        css = css_path.read_text(encoding="utf-8")
        check(f"sin CDNs en css/{css_path.name}", not any(m in css for m in cdn_markers))
    check("css/styles.css existe", (ROOT / "css" / "styles.css").exists())

    print()
    if FAILS:
        print(f"GATE ROJO — {len(FAILS)} fallo(s).")
        return 1
    print("GATE VERDE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
