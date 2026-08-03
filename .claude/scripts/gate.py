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
        mdata = None

    # --- catálogo ampliado de ubicaciones (data/uex_locations.json) -----
    # Vendorizado desde UEX (script .claude/scripts/fetch_uex_locations.py),
    # complementa las zonas de minado de mining_data.json — ver
    # .claude/guides/datos-juego.md. DATA.allLocations() fusiona ambos.
    uexloc_path = ROOT / "data" / "uex_locations.json"
    try:
        uexloc = json.loads(uexloc_path.read_text(encoding="utf-8"))
        check("uex_locations.json parsea", True)
        locs = uexloc.get("locations")
        check("uex_locations.json tiene 'locations' no vacio", isinstance(locs, list) and bool(locs))
        if isinstance(locs, list) and locs:
            check("uex_locations.json: entradas tienen name/system/kind",
                  all({"name", "system", "kind"} <= r.keys() for r in locs))
            kinds = {r.get("kind") for r in locs}
            check("uex_locations.json: kinds esperados (city/station/outpost)",
                  kinds <= {"city", "station", "outpost"}, f"kinds vistos: {sorted(kinds)}")
            # Valor añadido real del catálogo: una estación grande de Stanton
            # que NO está en mining_data.json (Strata se centra en minería).
            names_lower = {(r.get("name") or "").strip().lower() for r in locs}
            check("uex_locations.json: incluye estaciones fuera de mining_data.json (ej. Everus)",
                  any("everus" in n for n in names_lower))
    except Exception as e:  # noqa: BLE001
        check("uex_locations.json parsea", False, str(e))
        uexloc = None

    # MIC-L1 (y hermanas L1-L5 de cada planeta) deben aparecer en el catalogo
    # fusionado: ya viven en mining_data.json (type 'lagrange'), lo que
    # DATA.allLocations() respeta como fuente prioritaria en el dedup.
    if mdata is not None:
        mic_l = [k for k in mdata.get("locations", {}) if k.startswith("MIC-L")]
        check("mining_data.json: MIC-L1..L5 presentes", len(mic_l) == 5, f"encontrados: {sorted(mic_l)}")

    data_js_src = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    check("data.js: allLocations definido", "allLocations()" in data_js_src)
    check("data.js: uexLocations se carga en load()", "uex_locations.json" in data_js_src)
    check("data.js: LOC_TYPE_ES cubre 'city' y 'outpost'",
          '"Ciudad"' in data_js_src and '"Puesto avanzado"' in data_js_src)

    # --- catálogo de planos de crafteo (data/craft_blueprints.json) --------
    # Vendorizado desde sc-craft.tools (script .claude/scripts/fetch_craft_blueprints.py),
    # índice inverso material -> planos consumido por DATA.craftByMaterial() —
    # ver .claude/guides/datos-juego.md.
    craft_path = ROOT / "data" / "craft_blueprints.json"
    try:
        craft = json.loads(craft_path.read_text(encoding="utf-8"))
        check("craft_blueprints.json parsea", True)
        check("craft_blueprints.json tiene 'meta'", "meta" in craft and bool(craft["meta"]))
        bps = craft.get("blueprints")
        check("craft_blueprints.json tiene 'blueprints' no vacio", isinstance(bps, list) and bool(bps))
        if isinstance(bps, list) and bps:
            required_bp_keys = {"id", "blueprint_id", "name", "category", "craft_time_seconds",
                                 "tiers", "ingredients", "missions"}
            check("craft_blueprints.json: planos tienen las claves esperadas",
                  all(required_bp_keys <= b.keys() for b in bps),
                  "faltan claves en algun plano")
            ing_sample = [i for b in bps for i in (b.get("ingredients") or [])]
            check("craft_blueprints.json: hay ingredientes", bool(ing_sample))
            required_ing_keys = {"slot", "name", "quantity_scu", "unit", "min_quality", "quality_effects"}
            check("craft_blueprints.json: ingredientes tienen las claves esperadas",
                  all(required_ing_keys <= i.keys() for i in ing_sample),
                  "faltan claves en algun ingrediente")
            # material real conocido (verificado en el parche 4.9, ver CRAFT_NAME_OVERRIDES
            # en data.js): si esto desaparece, la fuente cambio de forma y hay que revisar.
            ing_names = {i.get("name") for i in ing_sample}
            check("craft_blueprints.json: incluye Quantainium (grafia real de sc-craft.tools)",
                  "Quantainium" in ing_names)
    except Exception as e:  # noqa: BLE001
        check("craft_blueprints.json parsea", False, str(e))
        craft = None

    data_js_src_for_craft = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    check("data.js: craftBlueprints() definido", "craftBlueprints()" in data_js_src_for_craft)
    check("data.js: craftByMaterial definido", "craftByMaterial(oreKeyOrName)" in data_js_src_for_craft)
    check("data.js: craft_blueprints.json se carga en load()",
          "craft_blueprints.json" in data_js_src_for_craft)
    check("data.js: CRAFT_NAME_OVERRIDES definido", "CRAFT_NAME_OVERRIDES" in data_js_src_for_craft)
    for ore_key in ("ALUMINUM", "QUANTANIUM"):
        check(f"data.js: CRAFT_NAME_OVERRIDES cubre {ore_key}",
              re.search(rf"\b{ore_key}\s*:", data_js_src_for_craft) is not None)
    check("data.js: craftBaseName definido", "function craftBaseName" in data_js_src_for_craft)
    check("data.js: craftByMaterial usa craftBaseName",
          re.search(r"craftByMaterial\(oreKeyOrName\)\s*\{[\s\S]{0,300}craftBaseName", data_js_src_for_craft)
          is not None)

    # --- catálogo de misiones (data/missions.json) ------------------------
    # Vendorizado desde scmdb.net (script .claude/scripts/fetch_missions.py),
    # cruza contratos del juego con sus recompensas de plano de crafteo (ya
    # resueltas a producto) — ver .claude/guides/datos-juego.md. El script es
    # DURO (siempre debe existir); el propio missions.json es TOLERANTE
    # (mismo patrón que uex_locations.json/craft_blueprints.json: si falta,
    # DATA.missionsList()/etc. degradan a [] sin romper el arranque — ver
    # data.js más abajo) así que sus checks de contenido solo corren si el
    # fichero existe.
    check("fetch_missions.py existe", (ROOT / ".claude" / "scripts" / "fetch_missions.py").exists())

    missions_path = ROOT / "data" / "missions.json"
    if missions_path.exists():
        try:
            missions_data = json.loads(missions_path.read_text(encoding="utf-8"))
            check("missions.json parsea", True)
            required_top_keys = {"meta", "titles", "descriptions", "reputations",
                                  "missions", "products", "productToMissions"}
            check("missions.json tiene las claves de nivel superior esperadas",
                  required_top_keys <= missions_data.keys(),
                  f"faltan: {sorted(required_top_keys - missions_data.keys())}")
            missions_list = missions_data.get("missions")
            check("missions.json tiene 'missions' no vacio", isinstance(missions_list, list) and bool(missions_list))
            if isinstance(missions_list, list) and missions_list:
                # title/description/repMin/repMax son INDICES enteros en las
                # tablas titles/descriptions/reputations (deduplicacion, ver
                # datos-juego.md) — no texto/objeto repetido por mision.
                required_mission_keys = {"id", "title", "description", "category", "missionType",
                                          "faction", "illegal", "systems", "rewardUEC", "buyIn",
                                          "canBeShared", "onceOnly", "repMin", "repMax",
                                          "prerequisiteLocations", "cooldownMinutes", "blueprintRewards"}
                check("missions.json: misiones tienen las claves esperadas",
                      all(required_mission_keys <= m.keys() for m in missions_list),
                      "faltan claves en alguna mision")
                rewarded = [m for m in missions_list if m.get("blueprintRewards")]
                check("missions.json: hay misiones con blueprintRewards", bool(rewarded))
                if rewarded:
                    reward_sample = rewarded[0]["blueprintRewards"][0]
                    check("missions.json: blueprintRewards trae tag/chance/trigger",
                          {"tag", "chance", "trigger"} <= reward_sample.keys())
                    # el tag debe resolver contra 'products' (dict tag -> producto,
                    # no lista) — si no resuelve, DATA.missionsList() devolveria
                    # productName/gear/type/subtype vacios en silencio.
                    check("missions.json: el tag de blueprintRewards resuelve en 'products'",
                          reward_sample["tag"] in (missions_data.get("products") or {}))
        except Exception as e:  # noqa: BLE001
            check("missions.json parsea", False, str(e))

    data_js_for_missions = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    check("data.js: missions.json se carga en load() (try/catch, no bloqueante)",
          "data/missions.json" in data_js_for_missions
          and re.search(r"try\s*\{[\s\S]{0,200}data/missions\.json", data_js_for_missions) is not None)
    check("data.js: buildMissionsIndex definido", "buildMissionsIndex(raw)" in data_js_for_missions)
    for fn in ("missionsList()", "missionById(id)", "missionProducts()",
               "missionsForProduct(productName)", "missionsForCraftBlueprint(blueprint)"):
        check(f"data.js: {fn} definido", fn in data_js_for_missions)
    # cruce por TAG (no por nombre) con sc-craft.tools: mas fiable (100%
    # verificado) que cruzar por productName/name (99,4%, ver datos-juego.md).
    check("data.js: missionsForCraftBlueprint cruza por blueprint_id/tag, no por nombre",
          re.search(r"missionsForCraftBlueprint\(blueprint\)\s*\{[\s\S]{0,300}blueprint_id",
                     data_js_for_missions) is not None)

    # --- pestaña "Crafteo" (busqueda inversa de blueprints por material) ---
    craft_view_path = ROOT / "js" / "crafting.js"
    check("js/crafting.js existe", craft_view_path.exists())
    if craft_view_path.exists():
        craft_view_src = craft_view_path.read_text(encoding="utf-8")
        # La lista de materiales es una lista lateral SIEMPRE VISIBLE
        # (#craft-materials), no un <select>/combo: reordenarla dentro de un
        # combo cerrado no se percibia como "se reordena de verdad" (feedback
        # de usuario). searchselect.js sigue existiendo y en uso en
        # Inventario/Señales — este check solo confirma que Crafteo YA NO lo
        # usa, para no reintroducir el combo por error.
        check("crafting.js: NO llama a SearchSelect.enhance (retirado a favor de una lista lateral visible)",
              "SearchSelect.enhance(" not in craft_view_src)
        check("crafting.js: lista de materiales visible con buscador propio",
              "craft-material-search" in craft_view_src and "craft-materials" in craft_view_src)
        check("crafting.js: interpolacion de calidad respeta 'ranges' (tramos no lineales)",
              ".ranges" in craft_view_src)
        check("crafting.js: fmtCraftQty distingue unit 'unit' (ud) de 'scu' (SCU/cSCU)",
              '"unit"' in craft_view_src and "cSCU" in craft_view_src)
        check("crafting.js: degrada con mensaje si DATA.craft no cargo (no rompe)",
              "DATA.craft.ready" in craft_view_src)
        check("crafting.js: lista de objetos agrupada por seccion de categoria",
              "craftSectionKey" in craft_view_src and "CRAFT_SECTION_ES" in craft_view_src)
        check("crafting.js: craftSectionLabel degrada sin romper ante categorias sin traducir",
              re.search(r"craftSectionLabel\(key\)\s*\{[\s\S]{0,150}\|\|", craft_view_src) is not None)
        check("crafting.js: secciones plegables via <button> real (accesible con teclado, no div+onclick)",
              '<button type="button" class="side-group-head"' in craft_view_src)
        check("crafting.js: cambiar de material repliega todas las secciones (acordeon)",
              re.search(r"selectMaterial\(rawName\)\s*\{[\s\S]{0,1500}openSections\s*=\s*new Set\(\)", craft_view_src)
              is not None)
        check("crafting.js: cambiar de material tambien pone los filtros a cero",
              re.search(r"selectMaterial\(rawName\)\s*\{[\s\S]{0,1500}filters\s*=\s*\{\s*weight:\s*new Set\(\)",
                         craft_view_src) is not None)
        check("crafting.js: chips de filtro son <button> reales (accesibles con teclado, no div+onclick)",
              'class="craft-filter-chip' in craft_view_src and "<button" in craft_view_src)
        # La pieza de armadura (Helmet/Core/Arms/Legs) se busca en el NOMBRE del
        # plano, no en category — sin este guard, un arma o componente de nave
        # cuyo nombre contuviera por casualidad "Arms"/"Core" quedaria mal
        # etiquetado como pieza de armadura y contaminaria el filtro "Pieza".
        check("crafting.js: craftArmorPiece solo etiqueta objetos de categoria Armour",
              re.search(r"function craftArmorPiece\(category, name\)\s*\{[\s\S]{0,120}!==\s*\"Armour\"",
                         craft_view_src) is not None)
    app_js_src = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    check("app.js: Crafting.init() llamado", "Crafting.init()" in app_js_src)
    # Si sc-craft.tools reorganiza las categorias de primer nivel en un parche
    # futuro, craftSectionLabel() no rompe (fallback ya cubierto arriba) pero
    # el mapeo CRAFT_SECTION_ES quedaria incompleto en silencio (secciones sin
    # traducir) — este check avisa explicitamente si aparece una categoria de
    # primer nivel nueva, para que alguien revise el mapeo a proposito.
    if craft is not None:
        top_cats = {(b.get("category") or "").split("/")[0].strip() for b in craft.get("blueprints", [])}
        known_top_cats = {"Armour", "Vehiclegear", "Weapons", "Ammo"}
        check("craft_blueprints.json: categorias de primer nivel conocidas (revisar CRAFT_SECTION_ES si cambian)",
              top_cats <= known_top_cats, f"nuevas: {sorted(top_cats - known_top_cats)}")

    # --- ordenacion de listas (Buscador/Ubicaciones/Crafteo) -------------
    # Cada criterio numerico manda los minerales/materiales sin dato al
    # final (nunca se inventa un valor) y persiste en localStorage bajo una
    # clave mineriasc_* (convencion del proyecto, ver CLAUDE.md).
    finder_js_src = (ROOT / "js" / "finder.js").read_text(encoding="utf-8")
    check("finder.js: finderSortValue definido (criterios de orden)", "function finderSortValue" in finder_js_src)
    check("finder.js: criterio 'refined' usa DATA.uexRefinedFor", "DATA.uexRefinedFor(oreKey)" in finder_js_src)
    check("finder.js: finderP2pBest no descarta unidades sueltas (usa TODAS las filas de marketplaceAvgFor)",
          "function finderP2pBest" in finder_js_src
          and re.search(r"function finderP2pBest[\s\S]{0,300}const pool = scuRows\.length \? scuRows : rows",
                         finder_js_src) is not None)
    check("finder.js: precio P2P separa SCU y unidad suelta en bloques, no los mezcla en un ranking",
          re.search(r"ra !== rb\)\s*return ra - rb", finder_js_src) is not None)
    check("finder.js: subLabelFor muestra la unidad real del precio P2P (no siempre SCU)",
          "aUEC/${finderUnitShortLabel(info.unit)}" in finder_js_src)
    check("finder.js: criterio 'rarity' usa RARITY_ORDER", "RARITY_ORDER[r.tier]" in finder_js_src)
    check("finder.js: valores sin dato van al final del orden (nunca se inventan)",
          re.search(r"if \(va == null\) return 1", finder_js_src) is not None)
    check("finder.js: persiste el criterio en localStorage bajo clave mineriasc_*",
          'SORT_KEY: "mineriasc_finder_sort"' in finder_js_src)
    check("finder.js: degrada mientras UEX/marketplace no cargan (sin romper, reordena al llegar)",
          "DATA.uexReady" in finder_js_src and "DATA.marketplaceReady" in finder_js_src)

    locations_js_src = (ROOT / "js" / "locations.js").read_text(encoding="utf-8")
    check("locations.js: persiste el criterio de orden en localStorage bajo clave mineriasc_*",
          'SORT_KEY: "mineriasc_locations_sort"' in locations_js_src)

    check("crafting.js: persiste el orden del selector de material en localStorage bajo clave mineriasc_*",
          'MATERIAL_SORT_KEY: "mineriasc_crafting_sort"' in craft_view_src)
    check("crafting.js: craftMaterialRarity usa DATA.oreKeyForCraftMaterial (resolutor inverso expuesto por datos-uex)",
          re.search(r"function craftMaterialRarity\(rawName\)\s*\{[\s\S]{0,120}DATA\.oreKeyForCraftMaterial\(rawName\)",
                     craft_view_src) is not None)
    check("crafting.js: orden 'count' es descendente por defecto (mas objetos primero)",
          re.search(r"materialSort === \"count\"[\s\S]{0,200}b\.count - a\.count", craft_view_src) is not None)

    # --- multipagina: cada pagina de nivel superior ("hoja" de una app) se
    # valida por separado (scripts, ids), pero js/ y el gate global siguen
    # siendo uno solo. Anadir una pagina nueva = anadirla a este dict.
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    check("index.html: pestana Crafteo enlazada (tab + seccion)",
          'data-tab="crafteo"' in html and 'id="tab-crafteo"' in html)
    check("index.html: credito de blueprints a sc-craft.tools", "sc-craft.tools" in html)
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
    check("uex.js: marketplace_prices_averages_all filtra sell antes de cachear",
          "operation === \"sell\"" in uex_js,
          "el payload sin filtrar (~1,3 MB, todos los items del juego) agota la cuota de localStorage")
    # Desde el parche 4.9 ya NO se filtra por unit === "scu": eso descartaba
    # anuncios reales de 13 minerales que solo se trafican en unidades sueltas
    # (Carinite, Tin...). No reintroducir ese filtro sin volver a medir contra
    # la API en vivo (ver comentario largo en uex.js y uex-api.md).
    check("uex.js: NO reintroduce el filtro unit===scu (excluía 13 minerales reales)",
          "r.unit === \"scu\"" not in uex_js,
          "ver .claude/guides/uex-api.md: ese filtro descarta anuncios reales de gemas de cueva/vehiculo")

    data_js = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    check("data.js: loadMarketplaceAverages definido", "loadMarketplaceAverages" in data_js)
    check("data.js: marketplaceAvgFor definido", "marketplaceAvgFor" in data_js)
    check("data.js: QUALITY_TIER_LABELS definido", "QUALITY_TIER_LABELS" in data_js)
    check("data.js: marketplaceAvgFor devuelve `unit` por fila (contrato post-4.9)",
          re.search(r"marketplaceAvgFor\(oreKey\)\s*\{[\s\S]{0,900}unit:\s*r\.unit", data_js) is not None)
    check("data.js: marketplaceAvgFor ya no usa el nombre priceAvgScu (renombrado a priceAvg, sin alias)",
          "priceAvgScu:" not in data_js)

    # --- alias de nombre UEX (naming quirks verificados contra la API real,
    # ver .claude/guides/uex-api.md): sin esto, uexFor devuelve el commodity
    # REFINADO etiquetado como "en bruto" (Lindinium/Savrilium) o ninguno de
    # los dos cruza (Ice/Saldynium/Carinite Pure). No aceptar una "correccion"
    # que borre estas 5 claves sin volver a verificar contra la API en vivo.
    check("data.js: UEX_NAME_OVERRIDES definido", "UEX_NAME_OVERRIDES" in data_js)
    for ore_key in ("CARINITEPURE", "LINDINIUM", "SAVRILIUM", "ICE", "SALDYNIUM"):
        check(f"data.js: UEX_NAME_OVERRIDES cubre {ore_key}",
              re.search(rf"\b{ore_key}\s*:", data_js) is not None)
    check("data.js: uexFor usa UEX_NAME_OVERRIDES",
          re.search(r"uexFor\(oreKey\)\s*\{[\s\S]{0,200}UEX_NAME_OVERRIDES", data_js) is not None)
    check("data.js: uexBaseName definido (normaliza sufijo bruto de 3 formas distintas)",
          "function uexBaseName" in data_js)
    check("data.js: uexRefinedFor usa uexBaseName",
          re.search(r"uexRefinedFor\(oreKey\)\s*\{[\s\S]{0,300}uexBaseName", data_js) is not None)
    check("data.js: marketplaceAvgFor usa uexBaseName",
          re.search(r"marketplaceAvgFor\(oreKey\)\s*\{[\s\S]{0,300}uexBaseName", data_js) is not None)

    # --- etiqueta de mineral segura ante claves UNKNOWN_<hash> de location_ores
    # (nodos FPS que el propio Strata no ha podido identificar aun): el usuario
    # nunca debe ver la clave hash cruda en pantalla. Ver .claude/guides/datos-juego.md.
    check("data.js: oreLabel definido", "oreLabel(oreKey)" in data_js)
    check("data.js: oreLabel nunca devuelve una clave UNKNOWN_ cruda",
          re.search(r"oreLabel\(oreKey\)\s*\{[\s\S]{0,200}UNKNOWN_", data_js) is not None)

    # location_ores puede traer relative_probability null (dato genuino, no
    # ausencia por bug de lectura) para minerales confirmados sin porcentaje
    # medido aun: se preserva tal cual, no se inventa un 0. La vista debe
    # distinguir esto de un "-%" generico (contrato en datos-juego.md; el
    # render en si es dominio web-ui, no de este gate).
    if mdata is not None:
        prob_values = [
            e.get("relative_probability")
            for loc in mdata.get("location_ores", {}).values()
            for entries in (loc.get("ores") or {}).values()
            for e in entries
        ]
        check("mining_data.json: location_ores trae relative_probability null en algun caso (esperado, no bug)",
              any(p is None for p in prob_values), "si esto cambia en un parche, revisar si el contrato sigue aplicando")

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

    # --- rareza de mineral (oreRarity / rarityFor / RARITY_ES) ----------
    # Fuente: scanner_signals.tier, filtrado a valores de rareza genuinos
    # (ver comentario largo junto a RARITY_TIERS_VALID en data.js) — NO
    # confundir con los pseudo-tiers "fps"/"vehicle" que ese mismo campo
    # trae en mining_data.json para otro tipo de señal.
    check("data.js: RARITY_TIERS_VALID definido", "RARITY_TIERS_VALID" in data_js)
    check("data.js: RARITY_ES cubre las 5 rarezas conocidas",
          all(f'{t}:' in data_js.replace('"', '') for t in
              ("common", "uncommon", "rare", "epic", "legendary")))
    check("data.js: rarityFor definido", "rarityFor(oreKey)" in data_js)
    check("data.js: oreRarity se construye en buildIndexes filtrando por RARITY_TIERS_VALID",
          re.search(r"oreRarity\[.*?\]\s*=.*RARITY_TIERS_VALID", data_js, re.S) is not None
          or re.search(r"RARITY_TIERS_VALID\.has\(sig\.tier\)", data_js) is not None)

    # --- mejor refinería por mineral (bestRefineryFor) -------------------
    # 100% local (this.refineries, ya cargado desde mining_data.json): no
    # depende de ninguna llamada en vivo a UEX.
    check("data.js: bestRefineryFor definido", "bestRefineryFor(oreKey" in data_js)
    check("data.js: bestRefineryFor ordena por bonusPct descendente",
          re.search(r"bestRefineryFor[\s\S]{0,400}sort\(\(a,\s*b\)\s*=>\s*b\.bonusPct\s*-\s*a\.bonusPct\)", data_js)
          is not None)

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
