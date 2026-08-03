#!/usr/bin/env python3
"""Regenera data/missions.json desde la API pública (JSON estático) de scmdb.net.

Catálogo de misiones (contratos) del juego con sus recompensas de plano de
crafteo resueltas a objeto concreto, más el catálogo de objetos crafteables
que trae scmdb.net (complementario al de sc-craft.tools ya vendorizado en
data/craft_blueprints.json). Es dato generado igual que mining_data.json/
uex_locations.json/craft_blueprints.json: no se edita a mano, se regenera con
este script tras un parche. Ver .claude/guides/datos-juego.md.

scmdb.net publica JSON plano sin autenticación pero SÍ está tras Cloudflare
(mismo motivo que sc-craft.tools y la API de UEX): hace falta un User-Agent de
navegador o responde con bloqueo. Este script hace 3 peticiones GET:
  1. /data/versions.json                              -- localizar la build live
  2. /data/merged-<version>.json          (~12 MB)     -- contratos, facciones,
                                                          pools de recompensa de plano
  3. /data/crafting_blueprints-<version>.json (~4 MB)  -- catálogo de objetos
                                                          crafteables (para resolver
                                                          blueprintRecord -> producto)

Ambos ficheros de origen son grandes pero SOLO se usan en memoria durante la
generación: lo que se escribe en data/missions.json es una proyección muy
recortada y deduplicada (~1,8 MB, ver StringTable/products más abajo), no un
volcado.

Uso:
    python .claude/scripts/fetch_missions.py

Repetible e idempotente: sobrescribe data/missions.json con datos frescos.
"""
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://scmdb.net/data"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "missions.json"

HEADERS = {
    # Cloudflare (delante de scmdb.net) bloquea con 403 peticiones sin
    # User-Agent de navegador -- urllib manda uno propio ("Python-urllib/x.y")
    # que cae en esa regla. Mismo motivo y misma solucion que
    # fetch_craft_blueprints.py / fetch_uex_locations.py.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

# Solo se han visto estos dos tags de enfasis en `description` (EM y EM4 --
# el juego los usa sin cerrar de forma consistente: alguna descripcion abre
# <EM> y cierra </EM4>, es asi en el dato fuente, no un bug de este script).
# El texto interior se conserva, solo se quitan las etiquetas.
EM_TAG_RE = re.compile(r"</?EM4?>")


def fetch_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def active_live_version():
    """Version activa del canal 'live' (la que juega todo el mundo). Ignora
    PTU: versions.json trae [{version, file}, ...] y la entrada 'live' es la
    que tiene '-live.' en `version` (p.ej. '4.9.0-live.12344265'; la PTU trae
    '-ptu.'). No hay campo `channel` explicito en este endpoint (a diferencia
    de sc-craft.tools/api/config), asi que se detecta por el propio string."""
    versions = fetch_json(f"{BASE}/versions.json")
    for v in versions:
        if "-live." in (v.get("version") or ""):
            return v["version"]
    raise RuntimeError("No se encontro una version '-live.' en /data/versions.json")


def clean_text(s):
    """Limpia `title`/`description` de contract: quita <EM>/<EM4> (se
    conserva el texto interior) y convierte el salto de linea LITERAL de dos
    caracteres (barra invertida + 'n', tal como viene en el JSON fuente -- NO
    es un '\\n' real, verificado byte a byte contra el JSON descargado) en un
    salto de linea real."""
    if not s:
        return ""
    s = EM_TAG_RE.sub("", s)
    s = s.replace("\\n", "\n")
    return s.strip()


class StringTable:
    """Tabla de deduplicacion: `title`/`description` de contract se repiten
    muchisimo (755 descripciones y 762 titulos UNICOS para 1487 misiones --
    la mitad son variantes que comparten el mismo texto de sabor) -- guardar
    cada valor una sola vez y referenciarlo por indice entero recorta el JSON
    final a poco mas de la mitad frente a repetir la cadena/objeto completo
    en cada mision. Mismo criterio para `reputations` (solo 45 combinaciones
    {name, minReputation, scope} unicas en las 2*1487 referencias
    repMin/repMax). `add(None)` devuelve None (no todas las misiones tienen
    reputacion minima/maxima)."""

    def __init__(self):
        self._index = {}
        self.values = []

    def add(self, value):
        if value is None:
            return None
        key = json.dumps(value, sort_keys=True) if isinstance(value, dict) else value
        if key not in self._index:
            self._index[key] = len(self.values)
            self.values.append(value)
        return self._index[key]


def build_product_catalog(crafting_blueprints):
    """Catalogo de objetos crafteables tal como los trae scmdb.net, indexado
    por `tag` (identificador estable del plano, sin duplicados verificado --
    a diferencia de `productName`, que SI tiene 15 colisiones en el parche
    actual, ej. dos "Argus Helmet Black/Silver" con guid/tag distintos, asi
    que NO sirve como clave unica). Dict en vez de lista: es la forma en que
    `missions[].blueprintRewards[].tag` resuelve el producto completo (ver
    js/data.js, DATA.missionsList()), y evita repetir la clave "tag" dentro
    de cada valor."""
    catalog = {}
    for bp in crafting_blueprints.get("blueprints", []):
        tag = bp.get("tag")
        if not tag or tag in catalog:
            continue
        catalog[tag] = {
            "productName": bp.get("productName"),
            "gear": bp.get("gear"),
            "type": bp.get("type"),
            "subtype": bp.get("subtype"),
            "manufacturer": bp.get("manufacturer"),
        }
    return dict(sorted(catalog.items(), key=lambda kv: (kv[1]["productName"] or "").lower()))


def resolve_blueprint_rewards(contract, blueprint_pools, blueprints_by_guid):
    """contract.blueprintRewards[] -> pool (blueprintPools[guid]) -> cada
    entrada de pool (blueprintRecord) -> tag resuelto contra
    crafting_blueprints.json (mismo guid, coincidencia 715/715 verificada en
    el parche actual). Devuelve SOLO {tag, chance, trigger} -- el resto del
    producto (nombre/gear/type/subtype) vive una unica vez en `products` (ver
    build_product_catalog): repetir esas 4 cadenas en cada una de las 7152
    filas de recompensa (660 tags unicos) costaba mas de 1 MB solo en este
    campo.

    El `chance` de cada entrada de `blueprintRewards` del contrato es a nivel
    de POOL (se dispara ese grupo con esa probabilidad); dentro del pool el
    juego reparte uniformemente entre sus entradas -- verificado: `weight` es
    SIEMPRE 1 en las 94 pools referenciadas por mision en el parche actual,
    asi que dividir el chance del pool entre el numero de items del pool es
    fiel al reparto real, no una aproximacion inventada. Si algun parche
    futuro trae `weight` != 1 en alguna pool, esta cuenta dejaria de ser
    exacta -- revisar entonces (se documenta la asuncion, no se ignora)."""
    out = []
    for br in contract.get("blueprintRewards") or []:
        pool = blueprint_pools.get(br.get("blueprintPool"))
        items = (pool or {}).get("blueprints") or []
        if not items:
            continue
        item_chance = round((br.get("chance") or 0) / len(items), 4)
        for it in items:
            rec = blueprints_by_guid.get(it.get("blueprintRecord"))
            if not rec or not rec.get("tag"):
                continue
            out.append({"tag": rec["tag"], "chance": item_chance, "trigger": br.get("trigger")})
    return out


def resolve_reputation(rep):
    if not rep:
        return None
    return {
        "name": rep.get("name"),
        "minReputation": rep.get("minReputation"),
        "scope": rep.get("scopeDisplayName"),
    }


def build_mission(idx, contract, factions, blueprint_pools, blueprints_by_guid, titles, descriptions, reputations):
    faction = factions.get(contract.get("factionGuid") or "")
    prereq_locations = [
        {"name": p.get("name"), "navIcon": p.get("navIcon")}
        for p in (contract.get("prerequisites") or {}).get("location") or []
    ]
    return {
        "id": idx,
        "title": titles.add(clean_text(contract.get("title"))),
        "description": descriptions.add(clean_text(contract.get("description"))),
        "category": contract.get("category"),
        "missionType": contract.get("missionType"),
        "faction": faction.get("name") if faction else None,
        "illegal": bool(contract.get("illegal")),
        "systems": contract.get("systems") or [],
        "rewardUEC": contract.get("rewardUEC"),
        "buyIn": contract.get("buyIn"),
        "canBeShared": bool(contract.get("canBeShared")),
        "onceOnly": bool(contract.get("onceOnly")),
        "repMin": reputations.add(resolve_reputation(contract.get("minStanding"))),
        "repMax": reputations.add(resolve_reputation(contract.get("maxStanding"))),
        "prerequisiteLocations": prereq_locations,
        # personalCooldownTime viaja en minutos pero solo es real cuando
        # hasPersonalCooldown es true -- verificado: 891 contratos traen un
        # valor de personalCooldownTime "residual" con hasPersonalCooldown en
        # false (dato del juego, no se usa; si se copiara tal cual insinuaria
        # un cooldown que no existe).
        "cooldownMinutes": contract.get("personalCooldownTime")
        if contract.get("hasPersonalCooldown")
        else None,
        "blueprintRewards": resolve_blueprint_rewards(contract, blueprint_pools, blueprints_by_guid),
    }


def build_missions(contracts, factions, blueprint_pools, blueprints_by_guid, titles, descriptions, reputations):
    return [
        build_mission(idx, c, factions, blueprint_pools, blueprints_by_guid, titles, descriptions, reputations)
        for idx, c in enumerate(contracts)
    ]


def build_product_to_missions(missions, products_by_tag):
    """productName normalizado (trim + minusculas -- mismo criterio simple
    que usa el resto de la app para nombres "libres" no-mineral, ver
    craftBaseName en js/data.js para el equivalente en el dominio de
    minerales) -> lista de ids de mision que lo recompensan, sin duplicados,
    ordenada."""
    index = {}
    for m in missions:
        for reward in m["blueprintRewards"]:
            product = products_by_tag.get(reward["tag"])
            name = ((product or {}).get("productName") or "").strip().lower()
            if not name:
                continue
            index.setdefault(name, set()).add(m["id"])
    return {k: sorted(v) for k, v in sorted(index.items())}


def main():
    print("Consultando version live activa en scmdb.net/data/versions.json...")
    try:
        version = active_live_version()
        print(f"Version live activa: {version}")

        print("Descargando merged-<version>.json (contratos, facciones, pools)...")
        merged = fetch_json(f"{BASE}/merged-{version}.json")

        print("Descargando crafting_blueprints-<version>.json (catalogo de objetos)...")
        crafting_blueprints = fetch_json(f"{BASE}/crafting_blueprints-{version}.json")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"ERROR: no se pudo contactar scmdb.net ({e}).")
        print("Si esto es un bloqueo de Cloudflare (403) pese al User-Agent de "
              "navegador, hace falta un fetch manual desde un navegador con sesion "
              "abierta -- reportarlo, no forzar reintentos.")
        raise SystemExit(1)

    contracts = merged.get("contracts", [])
    factions = merged.get("factions", {})
    blueprint_pools = merged.get("blueprintPools", {})
    blueprints_by_guid = {
        bp["guid"]: bp for bp in crafting_blueprints.get("blueprints", []) if bp.get("guid")
    }

    print(f"Contratos: {len(contracts)} -- resolviendo recompensas de plano...")
    products = build_product_catalog(crafting_blueprints)
    titles, descriptions, reputations = StringTable(), StringTable(), StringTable()
    missions = build_missions(
        contracts, factions, blueprint_pools, blueprints_by_guid, titles, descriptions, reputations
    )
    product_to_missions = build_product_to_missions(missions, products)

    with_rewards = sum(1 for m in missions if m["blueprintRewards"])

    out = {
        "meta": {
            "source": "scmdb.net",
            "version": version,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "total_missions": len(missions),
            "total_missions_with_blueprint_rewards": with_rewards,
            "total_products": len(products),
        },
        # `title`/`description` de cada mision son INDICES enteros en estas
        # dos tablas (ver StringTable) -- no repetir la busqueda: usar
        # DATA.missionsList() en vez de leer data/missions.json a pelo desde
        # una vista si algun dia se toca este dominio directamente.
        "titles": titles.values,
        "descriptions": descriptions.values,
        "reputations": reputations.values,
        "missions": missions,
        # dict tag -> {productName, gear, type, subtype, manufacturer}
        "products": products,
        # productName normalizado (minusculas) -> [missionId, ...]
        "productToMissions": product_to_missions,
    }

    # SIN indent: a diferencia de mining_data.json/craft_blueprints.json/
    # uex_locations.json (indent=2, se pueden inspeccionar a mano), este
    # fichero es denso por diseno (indices a StringTable/products) -- la
    # pretty-print no ayuda a leerlo a ojo y casi duplica el peso en disco
    # (2,86 MB con indent=2 frente a 1,87 MB compacto, medido en el parche
    # actual). El objetivo explicito es <2 MB.
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(
        f"Escrito {OUT} -- {len(missions)} misiones ({with_rewards} con recompensa de "
        f"plano), {len(products)} productos, {size_kb:.0f} KB"
    )


if __name__ == "__main__":
    main()
