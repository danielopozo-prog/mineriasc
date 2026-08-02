/* Pestaña «Crafteo»: búsqueda inversa de planos de fabricación por material
   (inspirada en sc-craft.tools, pero al revés — del material al objeto).
   Flujo: elegir material (combo con buscador) -> lista de objetos que lo
   requieren, ordenada de menor a mayor cantidad -> ficha con ingredientes
   por slot, tiempo, tiers, simulador de calidad (slider 0-1000) y misiones
   que sueltan el plano. Datos: DATA.craftBlueprints()/DATA.craftByMaterial()
   (ver js/data.js y .claude/guides/datos-juego.md) — 100% local, sin API en
   vivo, así que ya están disponibles tras `await DATA.load()`. */

// Cantidad de un ingrediente, formateada según su unidad real (contrato de
// data/craft_blueprints.json, ver datos-juego.md):
//  - unit "scu": quantity_scu YA está en SCU — si es <1 se muestra en cSCU
//    (×100, más legible que "0,06 SCU"); si es ≥1, en SCU con 2 decimales.
//  - unit "unit": quantity_scu es un conteo de unidades sueltas, NO SCU pese
//    al nombre del campo — se muestra tal cual con sufijo "ud".
function fmtCraftQty(qty, unit) {
  if (unit === "unit") return `${fmtNum(qty, 0)} ud`;
  if (qty < 1) return `${fmtNum(qty * 100, 0)} cSCU`;
  return `${fmtNum(qty, 2)} SCU`;
}

function fmtCraftTime(seconds) {
  if (!seconds && seconds !== 0) return "—";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s}s` : `${m} min`;
}

// Interpola modifier_at_min -> modifier_at_max sobre quality_min -> quality_max
// para una calidad `q` (0-1000, la del slider del simulador). Si el efecto
// trae `ranges` (tramos no lineales, ver datos-juego.md), se interpola
// DENTRO del tramo que contiene `q`, no sobre el rango global — un plano con
// tramos (p.ej. Power Pips en escalones de 250 en 250) daría un resultado
// intermedio incorrecto si se ignorara `ranges` y se interpolara en línea
// recta de extremo a extremo.
function interpolateQualityEffect(qe, q) {
  const segments = qe.ranges && qe.ranges.length ? qe.ranges : [qe];
  const clamped = Math.min(qe.quality_max, Math.max(qe.quality_min, q));
  const seg =
    segments.find((s) => clamped >= s.quality_min && clamped <= s.quality_max) ||
    segments[segments.length - 1];
  const span = seg.quality_max - seg.quality_min;
  const t = span > 0 ? (clamped - seg.quality_min) / span : 0;
  return seg.modifier_at_min + (seg.modifier_at_max - seg.modifier_at_min) * t;
}

// Texto del modificador ya interpolado: los efectos "multiplicative" son un
// factor sobre el valor base del stat (se muestran como % del valor base,
// p.ej. 115,0%); los "additive" son una cifra que se SUMA al valor base
// (p.ej. Power Pips ±2) — mostrarlos como porcentaje sería falso, no son
// una proporción. No simplificar a un único formato "%" para los dos tipos.
function fmtQualityEffectValue(qe, value) {
  return qe.type === "multiplicative"
    ? `${fmtNum(value * 100, 1)}%`
    : `${value > 0 ? "+" : ""}${fmtNum(value, 2)}`;
}

// Tramos de `category` ("Vehiclegear / Weapons / Ballistic / Cannon", ver
// datos-juego.md), separados y sin espacios sueltos. Robusto a que el JSON
// venga con o sin espacio alrededor de "/".
function craftCategoryParts(category) {
  return (category || "").split("/").map((s) => s.trim()).filter(Boolean);
}

// Sección de la lista de objetos crafteables, agrupando por categoría (ver
// Crafting.renderList). Verificado contra los 1589 planos del parche actual
// (python -c sobre data/craft_blueprints.json, no una muestra): solo 4
// categorías de primer nivel — Armour (915), Vehiclegear (464), Weapons
// (174), Ammo (36) — muy desiguales en tamaño y, las dos grandes, muy
// heterogéneas (Armour cubre desde armadura de combate hasta trajes de
// minero; Vehiclegear cubre desde refrigeración hasta escudos de nave, sin
// relación entre sí). Por eso el nivel de agrupación NO es uniforme:
//   - Armour y Vehiclegear se parten por su 2º nivel (14 y 10 subtipos
//     respectivamente — Combat/Engineer/Hunter…, Cooler/Powerplant/Shield…):
//     son los dos "paraguas" demasiado grandes y dispares para una sola
//     sección (más de la mitad del catálogo entre las dos).
//   - Weapons y Ammo se quedan en su nivel 1: ya son conceptos coherentes y
//     razonablemente compactos (174 y 36 planos) — partirlos por tipo de
//     arma/munición fragmentaría de más sin aportar claridad.
// Resultado: 26 secciones GLOBALES posibles (2 + 14 + 10), pero para
// cualquier material concreto solo aparecen las que de verdad tienen algún
// objeto — de 2 (p.ej. Pressurized Ice) a ~12 (p.ej. Iron) en la práctica,
// nunca las 26 a la vez.
function craftSectionKey(category) {
  const parts = craftCategoryParts(category);
  const top = parts[0] || "";
  if ((top === "Armour" || top === "Vehiclegear") && parts[1]) {
    return `${top}/${parts[1]}`;
  }
  return top || "(sin categoría)";
}

// Traducción de cada sección (ver craftSectionKey de arriba). Un término sin
// entrada aquí (parche futuro con una subcategoría nueva) se muestra tal
// cual en vez de romper — ver el fallback en craftSectionLabel.
const CRAFT_SECTION_ES = {
  Weapons: "Armas",
  Ammo: "Munición",
  "Armour/Combat": "Armadura de combate",
  "Armour/Engineer": "Armadura de ingeniero",
  "Armour/Hunter": "Armadura de cazador",
  "Armour/Stealth": "Armadura sigilosa",
  "Armour/Miner": "Armadura de minero",
  "Armour/Undersuit": "Ropa interior (undersuit)",
  "Armour/Flightsuit": "Traje de vuelo",
  "Armour/Explorer": "Armadura de explorador",
  "Armour/Environment": "Armadura ambiental",
  "Armour/Cosmonaut": "Traje de cosmonauta",
  "Armour/Medic": "Armadura médica",
  "Armour/Salvager": "Armadura de reciclaje",
  "Armour/Radiation": "Armadura antirradiación",
  "Armour/Racer": "Armadura de piloto de carreras",
  "Vehiclegear/Weapons": "Armamento de nave",
  "Vehiclegear/Cooler": "Refrigeración de nave",
  "Vehiclegear/Powerplant": "Planta de energía",
  "Vehiclegear/Shield": "Escudos de nave",
  "Vehiclegear/Radar": "Radar y contramedidas",
  "Vehiclegear/Quantumdrive": "Motor cuántico",
  "Vehiclegear/Mininglaser": "Láser de minería (nave)",
  "Vehiclegear/Tractorbeam": "Rayo tractor",
  "Vehiclegear/Refuelling": "Repostaje",
  "Vehiclegear/Salvage": "Reciclaje de nave",
};

function craftSectionLabel(key) {
  return CRAFT_SECTION_ES[key] || key.split("/").join(" · ");
}

const Crafting = {
  selectedMaterial: null, // rawName tal cual aparece en ingredients[].name, o null
  selectedBlueprintId: null,
  quality: 500, // valor del slider del simulador; se conserva al cambiar de objeto
  items: [], // [{blueprint, qty, unit, mixedUnit}] del material activo, orden ascendente por cantidad

  init() {
    if (!DATA.craft.ready) {
      this.renderUnavailable();
      return;
    }

    const sel = document.getElementById("craft-material-select");
    const materials = this.materialsIndex();
    sel.innerHTML =
      '<option value="" disabled selected>Elige un material…</option>' +
      materials.map((m) => `<option value="${esc(m.rawName)}">${esc(m.label)} (${m.count})</option>`).join("");
    SearchSelect.enhance(sel, { placeholder: "Buscar material…" });
    sel.addEventListener("change", () => this.selectMaterial(sel.value));

    this.renderList();
  },

  // Materiales que aparecen en algún ingrediente de algún plano, con cuántos
  // planos DISTINTOS los usan. Deriva de DATA.craftBlueprints() en vez de
  // recorrer DATA.ores porque no todo material de sc-craft.tools es un
  // mineral de mining_data.json (p.ej. "Pressurized Ice" — ver comentario de
  // CRAFT_NAME_OVERRIDES en js/data.js). `rawName` es el nombre EXACTO tal
  // como aparece en ingredients[].name: se le pasa tal cual a
  // DATA.craftByMaterial(), que ya sabe normalizarlo (craftBaseName). `label`
  // solo pela el sufijo "(Ore)" para que el combo no muestre "Saldynium
  // (Ore)" — normalización puramente de presentación, no toca el índice.
  materialsIndex() {
    const map = new Map();
    for (const bp of DATA.craftBlueprints()) {
      for (const ing of bp.ingredients || []) {
        const rawName = ing.name;
        if (!rawName) continue;
        const label = rawName.replace(/\s*\(Ore\)\s*$/i, "").trim();
        const key = label.toLowerCase();
        let entry = map.get(key);
        if (!entry) {
          entry = { label, rawName, blueprintIds: new Set() };
          map.set(key, entry);
        }
        entry.blueprintIds.add(bp.id);
      }
    }
    return [...map.values()]
      .map((e) => ({ label: e.label, rawName: e.rawName, count: e.blueprintIds.size }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  selectMaterial(rawName) {
    this.selectedMaterial = rawName || null;
    this.selectedBlueprintId = null;

    // Un mismo plano puede usar el mismo material en 2+ slots distintos
    // (p.ej. "QuikCool" usa Iron en SHELL y en PUMP IMPELLER): se agrupa por
    // blueprint.id sumando la cantidad, para que la lista muestre un objeto
    // por plano con el total real de ese material, no una fila por slot.
    const byBp = new Map();
    for (const { blueprint, ingredient } of DATA.craftByMaterial(rawName)) {
      let g = byBp.get(blueprint.id);
      if (!g) {
        g = { blueprint, qty: 0, unit: ingredient.unit, mixedUnit: false };
        byBp.set(blueprint.id, g);
      }
      if (g.unit !== ingredient.unit) g.mixedUnit = true;
      g.qty += ingredient.quantity_scu;
    }
    this.items = [...byBp.values()].sort((a, b) => a.qty - b.qty);

    this.renderList();
    document.getElementById("craft-detail").innerHTML =
      '<p class="placeholder">Selecciona un objeto de la lista para ver su ficha de fabricación.</p>';
  },

  renderList() {
    const listEl = document.getElementById("craft-list");
    const countHint = document.getElementById("craft-count-hint");

    if (!this.selectedMaterial) {
      countHint.textContent = "";
      listEl.innerHTML = '<p class="placeholder">Elige un material arriba para ver qué se fabrica con él.</p>';
      return;
    }

    const materialLabel = this.selectedMaterial.replace(/\s*\(Ore\)\s*$/i, "").trim();
    countHint.textContent = this.items.length
      ? `${this.items.length} objeto${this.items.length === 1 ? "" : "s"} usan ${materialLabel}`
      : `Ningún objeto registrado usa ${materialLabel}.`;

    if (!this.items.length) {
      listEl.innerHTML = '<p class="placeholder">Sin resultados para este material.</p>';
      return;
    }

    // Agrupar por sección de categoría (ver craftSectionKey/CRAFT_SECTION_ES
    // arriba): el orden ascendente por cantidad de this.items se conserva
    // DENTRO de cada sección (Map conserva orden de inserción). Las secciones
    // se ordenan de más a menos objetos — la más relevante para este
    // material primero — y a empate, alfabéticamente por su etiqueta.
    const sections = new Map(); // key -> { label, rows: [] }
    for (const row of this.items) {
      const key = craftSectionKey(row.blueprint.category);
      let sec = sections.get(key);
      if (!sec) {
        sec = { label: craftSectionLabel(key), rows: [] };
        sections.set(key, sec);
      }
      sec.rows.push(row);
    }
    const orderedSections = [...sections.values()].sort(
      (a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label)
    );

    listEl.innerHTML = orderedSections
      .map((sec) => {
        const head = `<div class="side-group-head">${esc(sec.label)} · ${sec.rows.length} objeto${
          sec.rows.length === 1 ? "" : "s"
        }</div>`;
        const rows = sec.rows
          .map(({ blueprint, qty, unit, mixedUnit }) => {
            const catLeaf = craftCategoryParts(blueprint.category).pop() || "";
            const qtyTxt = mixedUnit ? "varias unidades" : fmtCraftQty(qty, unit);
            const timeTxt = fmtCraftTime(blueprint.craft_time_seconds);
            return `<div class="side-item ${blueprint.id === this.selectedBlueprintId ? "active" : ""}" data-id="${blueprint.id}">
              <span class="side-item-name">${esc(blueprint.name)}<br><span class="sub">${esc(catLeaf)}</span></span>
              <span class="sub craft-side-meta">${esc(qtyTxt)}<br>${esc(timeTxt)}</span>
            </div>`;
          })
          .join("");
        return head + rows;
      })
      .join("");

    listEl.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.selectBlueprint(Number(el.dataset.id)))
    );
  },

  selectBlueprint(id) {
    this.selectedBlueprintId = id;
    this.renderList();
    this.renderDetail();
  },

  renderDetail() {
    const el = document.getElementById("craft-detail");
    const bp = DATA.craftBlueprints().find((b) => b.id === this.selectedBlueprintId);
    if (!bp) {
      el.innerHTML = '<p class="placeholder">Selecciona un objeto de la lista para ver su ficha de fabricación.</p>';
      return;
    }

    const timeTxt = fmtCraftTime(bp.craft_time_seconds);
    const catTxt = craftCategoryParts(bp.category).join(" › ");
    const massTxt =
      bp.item_stats && bp.item_stats.mass_kg != null ? `${fmtNum(bp.item_stats.mass_kg, 2)} kg` : null;
    const ingredients = bp.ingredients || [];
    const missions = bp.missions || [];

    const ingredientRows = ingredients
      .map(
        (ing) => `<tr>
          <td>${esc(ing.slot || "—")}</td>
          <td>${esc(ing.name)}</td>
          <td class="num">${esc(fmtCraftQty(ing.quantity_scu, ing.unit))}</td>
          <td class="num">${ing.min_quality > 0 ? fmtNum(ing.min_quality) : "—"}</td>
        </tr>`
      )
      .join("");

    const missionRows = [...missions]
      .sort((a, b) => b.drop_chance - a.drop_chance)
      .map(
        (m) => `<tr>
          <td>${esc(m.name)}</td>
          <td class="num">${fmtNum(m.drop_chance * 100, 1)}%</td>
        </tr>`
      )
      .join("");

    el.innerHTML = `
      <div class="detail-head-row">
        <h3>${esc(bp.name)}</h3>
        ${bp.tiers ? `<span class="pill">Tier ${esc(bp.tiers)}</span>` : ""}
      </div>
      <p class="subtitle">${esc(catTxt || "Sin categoría")}</p>

      <div class="stat-grid">
        <div class="stat"><div class="label">Tiempo de fabricación</div><div class="value">${esc(timeTxt)}</div></div>
        <div class="stat"><div class="label">Ingredientes</div><div class="value">${ingredients.length}</div></div>
        ${massTxt ? `<div class="stat"><div class="label">Masa</div><div class="value">${esc(massTxt)}</div></div>` : ""}
      </div>

      <h4>Ingredientes por slot (${ingredients.length})</h4>
      ${
        ingredients.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Slot</th><th>Material</th><th>Cantidad</th><th>Calidad mín.</th></tr></thead>
              <tbody>${ingredientRows}</tbody></table></div>`
          : '<span class="hint">Sin ingredientes registrados.</span>'
      }

      <h4>Simulador de calidad</h4>
      <div class="craft-quality-row">
        <input type="range" id="craft-quality-slider" min="0" max="1000" step="1" value="${this.quality}"
          aria-label="Calidad simulada (0 a 1000)">
        <span class="craft-quality-value" id="craft-quality-value">${this.quality}</span>
      </div>
      <div id="craft-quality-effects" class="cards-row"></div>

      <h4>Misiones que sueltan este plano (${missions.length})</h4>
      ${
        missions.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Misión</th><th>Probabilidad</th></tr></thead>
              <tbody>${missionRows}</tbody></table></div>`
          : '<span class="hint">Sin misiones registradas que suelten este plano.</span>'
      }
    `;

    document.getElementById("craft-quality-slider").addEventListener("input", (e) => {
      this.quality = Number(e.target.value);
      document.getElementById("craft-quality-value").textContent = this.quality;
      this.renderQualityEffects(bp);
    });
    this.renderQualityEffects(bp);
  },

  // Tarjetas del simulador: una por ingrediente con quality_effects, cada una
  // con el % (o modificador aditivo) resultante por stat a la calidad actual
  // del slider (this.quality). Un slider ÚNICO ("global") controla todos los
  // ingredientes a la vez, no hay un slider por ingrediente.
  renderQualityEffects(bp) {
    const box = document.getElementById("craft-quality-effects");
    const withEffects = (bp.ingredients || []).filter((ing) => (ing.quality_effects || []).length);
    if (!withEffects.length) {
      box.innerHTML = '<p class="hint">Ningún ingrediente de este objeto tiene efecto de calidad.</p>';
      return;
    }
    box.innerHTML = withEffects
      .map((ing) => {
        const rows = ing.quality_effects
          .map((qe) => {
            const value = interpolateQualityEffect(qe, this.quality);
            return `<div class="row"><span>${esc(qe.stat)}</span><b>${fmtQualityEffectValue(qe, value)}</b></div>`;
          })
          .join("");
        return `<div class="card">
          <h5>${esc(ing.name)} <span class="craft-slot-tag">(${esc(ing.slot || "—")})</span></h5>
          ${rows}
        </div>`;
      })
      .join("");
  },

  // Degradación cuando data/craft_blueprints.json no cargó (falta o está
  // corrupto): DATA.craft.ready queda en false pero el resto de la app sigue
  // funcionando (ver contrato en js/data.js) — aquí solo se avisa, sin
  // romper nada ni dejar el selector en un estado ambiguo.
  renderUnavailable() {
    const sel = document.getElementById("craft-material-select");
    sel.disabled = true;
    sel.innerHTML = '<option value="">Datos de crafteo no disponibles</option>';
    document.getElementById("craft-count-hint").textContent = "";
    document.getElementById("craft-list").innerHTML = "";
    document.getElementById("craft-detail").innerHTML =
      '<p class="placeholder">No se pudo cargar el catálogo de planos de crafteo ' +
      "(data/craft_blueprints.json). El resto de la app sigue funcionando con normalidad.</p>";
  },
};
