#!/usr/bin/env python3
"""Regenera data/uex_locations.json desde la API pública de UEX Corp.

Catálogo de ubicaciones NOMBRADAS del juego (ciudades, estaciones espaciales,
outposts) — complementa (no sustituye) las zonas de minado de
data/mining_data.json para usos que necesiten el listado completo del juego
(p. ej. el selector de ubicación del Inventario). Ver .claude/guides/datos-juego.md.

A diferencia de mining_data.json (un único fetch a Strata, ya en el formato
que usa la app), UEX no ofrece un endpoint combinado ni con el formato final,
así que este script hace 3 peticiones GET públicas (cities, space_stations,
outposts), filtra y normaliza. Es dato generado igual que mining_data.json:
no se edita a mano, se regenera con este script.

Uso:
    python .claude/scripts/fetch_uex_locations.py

Repetible e idempotente: sobrescribe data/uex_locations.json con datos
frescos. Sin token (endpoints GET públicos, CORS abierto, límite 120
peticiones/min — este script hace solo 3).
"""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://api.uexcorp.uk/2.0"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "uex_locations.json"

# endpoint -> (kind, campo de nombre preferido)
# - space_stations: se prefiere 'nickname' (p.ej. "MIC-L1", "Checkmate",
#   "Grim HEX") — es como Strata y la propia comunidad nombran estaciones,
#   sobre todo puntos de Lagrange (el 'name' completo es texto de sabor:
#   "MIC-L1 Shallow Frontier Station"). Coincide con el display_name que ya
#   usa mining_data.json para las mismas estaciones (necesario para el dedup).
# - outposts: se prefiere 'name' completo ("HDMS-Bezdek", "Shubin Mining
#   Facility SM0-22") — más descriptivo, el nickname corto pierde contexto.
# - cities: no tienen nickname en la API, solo 'name'.
ENDPOINTS = {
    "cities": ("city", "name"),
    "space_stations": ("station", "nickname"),
    "outposts": ("outpost", "name"),
}


def fetch(endpoint):
    # Cloudflare (delante de la API) bloquea con 403 peticiones sin
    # User-Agent de navegador — urllib manda uno propio ("Python-urllib/x.y")
    # que cae en esa regla. curl/fetch del navegador no la disparan.
    req = urllib.request.Request(
        f"{BASE}/{endpoint}",
        headers={"User-Agent": "Mozilla/5.0 (compatible; mineriasc-fetch-script/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.load(r)
    if payload.get("status") != "ok":
        raise RuntimeError(f"{endpoint}: status={payload.get('status')}")
    return payload["data"]


def is_live(row):
    # Solo ubicaciones vigentes en build live (no PTU-only), visibles y no
    # decomisionadas. Ver .claude/guides/uex-api.md.
    return (
        row.get("is_available_live") == 1
        and row.get("is_visible") == 1
        and row.get("is_decommissioned") == 0
    )


def main():
    by_key = {}  # (nombre en minusculas, sistema) -> entrada
    counts = {}

    for endpoint, (kind, namefield) in ENDPOINTS.items():
        rows = [r for r in fetch(endpoint) if is_live(r)]
        counts[endpoint] = len(rows)
        for r in rows:
            name = (r.get(namefield) or r.get("name") or r.get("nickname") or "").strip()
            if not name:
                continue
            system = r.get("star_system_name")
            key = (name.lower(), system)

            entry = {
                "name": name,
                "system": system,
                "kind": kind,
                "planet": r.get("planet_name"),
            }
            if r.get("moon_name"):
                entry["moon"] = r["moon_name"]

            # UEX arrastra alguna entrada duplicada/obsoleta bajo el mismo
            # nombre (ej.: dos outposts "Jumptown" en Stanton — Yela, ghost
            # pre-reubicación, y Daymar, el actual). Ante colisión de
            # (nombre, sistema) nos quedamos con la de mayor date_added: la
            # más reciente en la API suele ser la vigente.
            ts = r.get("date_added") or 0
            prev = by_key.get(key)
            if prev is None or ts >= prev["_ts"]:
                entry["_ts"] = ts
                by_key[key] = entry

    locations = []
    for entry in by_key.values():
        entry.pop("_ts", None)
        locations.append(entry)

    locations.sort(key=lambda e: ((e["system"] or ""), (e["name"] or "")))

    out = {
        "meta": {
            "source": f"{BASE} — endpoints: {', '.join(ENDPOINTS)}",
            "filter": "is_available_live=1 && is_visible=1 && is_decommissioned=0",
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "counts": counts,
            "total": len(locations),
        },
        "locations": locations,
    }

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Escrito {OUT} — {len(locations)} ubicaciones únicas (crudo: {counts})")


if __name__ == "__main__":
    main()
