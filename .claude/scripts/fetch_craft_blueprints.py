#!/usr/bin/env python3
"""Regenera data/craft_blueprints.json desde la API pública de sc-craft.tools.

Catálogo de planos de crafteo del juego (~1589 en el parche actual): qué
materiales (incluidos los 39 minerales de mining_data.json) hacen falta para
fabricar cada ítem, en qué cantidad, con qué efectos de calidad y en qué
misiones puede caer el plano. Es dato generado igual que mining_data.json y
uex_locations.json: no se edita a mano, se regenera con este script tras un
parche. Ver .claude/guides/datos-juego.md.

sc-craft.tools está tras Cloudflare: hace falta un User-Agent de navegador o
responde 403 (mismo motivo que fetch_uex_locations.py con la API de UEX).

Uso:
    python .claude/scripts/fetch_craft_blueprints.py

Repetible e idempotente: sobrescribe data/craft_blueprints.json con datos
frescos. Sin token (endpoints GET públicos). ~17 peticiones (1 de config +
16 páginas de 100), con una pausa breve entre páginas por cortesía con el
servidor — no hay límite documentado de sc-craft.tools, a diferencia de UEX.
"""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://sc-craft.tools/api"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "craft_blueprints.json"
PAGE_LIMIT = 100  # el propio servidor cae a 100 aunque se pida mas (verificado)
PAGE_DELAY_S = 0.4

HEADERS = {
    # Cloudflare (delante de la API) bloquea con 403 peticiones sin User-Agent
    # de navegador -- urllib manda uno propio ("Python-urllib/x.y") que cae en
    # esa regla. Mismo motivo y misma solucion que fetch_uex_locations.py.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}


def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def active_live_version():
    """Version activa del canal 'live' (la que juega todo el mundo). Ignora
    PTU: los planos de crafteo de PTU pueden no reflejar el juego publicado."""
    cfg = fetch_json(f"{BASE}/config")
    for v in cfg.get("versions", []):
        if v.get("channel") == "live" and v.get("active") == 1:
            return v["version"]
    raise RuntimeError("No se encontro una version 'live' activa en /api/config")


def fetch_all_blueprints(version):
    """Pagina /api/blueprints SIN ownable=1 (queremos el catalogo completo de
    ~1589 planos, no solo los que posee una cuenta). limit=100 es el maximo
    real que acepta el servidor (probado con limit=500: lo capa a 100)."""
    items = []
    page = 1
    total_pages = None
    while total_pages is None or page <= total_pages:
        url = f"{BASE}/blueprints?page={page}&limit={PAGE_LIMIT}&search=&version={version}"
        payload = fetch_json(url)
        items.extend(payload.get("items", []))
        pagination = payload.get("pagination", {})
        total_pages = pagination.get("pages", page)
        print(f"  pagina {page}/{total_pages} ({len(payload.get('items', []))} planos)")
        page += 1
        if page <= total_pages:
            time.sleep(PAGE_DELAY_S)
    return items


def trim_quality_effect(qe):
    out = {
        "stat": qe.get("stat"),
        "quality_min": qe.get("quality_min"),
        "quality_max": qe.get("quality_max"),
        "modifier_at_min": qe.get("modifier_at_min"),
        "modifier_at_max": qe.get("modifier_at_max"),
        "type": qe.get("type"),
    }
    # `ranges`: tramos de calidad no lineales (el efecto cambia de pendiente a
    # media escala) -- solo presente quality_effects que lo tienen (998 de
    # 5207 en el parche 4.9). Se conserva completo: es exactamente el tipo de
    # dato "no es lineal, no lo aproximes" que ya justifica QUALITY_TIER_LABELS
    # en js/data.js.
    if qe.get("ranges"):
        out["ranges"] = [
            {
                "quality_min": r.get("quality_min"),
                "quality_max": r.get("quality_max"),
                "modifier_at_min": r.get("modifier_at_min"),
                "modifier_at_max": r.get("modifier_at_max"),
            }
            for r in qe["ranges"]
        ]
    return out


def trim_ingredient(ing):
    # La API trae `options` (variantes de material por slot) ademas de
    # `name`/`quantity_scu` ya resueltos al nivel del ingrediente. Comprobado
    # contra el catalogo completo (parche 4.9, ~4254 filas de ingrediente):
    # `options` SIEMPRE tiene exactamente 1 entrada -- no hay slots con
    # material alternativo todavia. `unit` y `min_quality` solo viven dentro
    # de `options[0]`, no al nivel del ingrediente, así que se leen de ahi.
    opt = (ing.get("options") or [{}])[0]
    return {
        "slot": ing.get("slot"),
        "name": ing.get("name"),
        "quantity_scu": ing.get("quantity_scu"),
        "unit": opt.get("unit"),
        "min_quality": opt.get("min_quality"),
        "quality_effects": [trim_quality_effect(qe) for qe in (ing.get("quality_effects") or [])],
    }


def trim_item_stats(stats):
    # Se descartan `fire_modes` (cadencias/dispersion detalladas de armas: no
    # aporta a la vista mineral->plano) pero se conserva el resto tal cual
    # (masa, resistencias, temperatura, tipo...) -- varia mucho de forma segun
    # la categoria del item (arma/armadura/escudo/municion), no se normaliza.
    if not isinstance(stats, dict):
        return stats
    return {k: v for k, v in stats.items() if k != "fire_modes"}


def trim_blueprint(item):
    return {
        "id": item.get("id"),
        "blueprint_id": item.get("blueprint_id"),
        "name": item.get("name"),
        "category": item.get("category"),
        "craft_time_seconds": item.get("craft_time_seconds"),
        "tiers": item.get("tiers"),
        "item_stats": trim_item_stats(item.get("item_stats")),
        "ingredients": [trim_ingredient(i) for i in item.get("ingredients", [])],
        "missions": [
            {
                "mission_id": m.get("mission_id"),
                "name": m.get("name"),
                # la API trae drop_chance como string ("1.0000"): a numero,
                # sin falsa precision de mas de 4 decimales (los que trae).
                "drop_chance": round(float(m["drop_chance"]), 4) if m.get("drop_chance") is not None else None,
            }
            for m in (item.get("missions") or [])
        ],
    }


def main():
    print("Consultando version live activa en sc-craft.tools/api/config...")
    try:
        version = active_live_version()
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"ERROR: no se pudo contactar sc-craft.tools ({e}).")
        print("Si esto es un bloqueo de Cloudflare (403) pese al User-Agent de "
              "navegador, hace falta un fetch manual desde un navegador con sesion "
              "abierta -- reportarlo, no forzar reintentos.")
        raise SystemExit(1)
    print(f"Version live activa: {version}")

    print("Descargando planos de crafteo (paginado, SIN ownable=1)...")
    raw_items = fetch_all_blueprints(version)

    # Dedup por id (por si una pagina se solapara en un reintento futuro).
    by_id = {}
    for item in raw_items:
        by_id[item["id"]] = trim_blueprint(item)
    blueprints = list(by_id.values())
    blueprints.sort(key=lambda b: (b["category"] or "", b["name"] or ""))

    out = {
        "meta": {
            "source": "sc-craft.tools",
            "version": version,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "total": len(blueprints),
        },
        "blueprints": blueprints,
    }

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(f"Escrito {OUT} -- {len(blueprints)} planos, {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
