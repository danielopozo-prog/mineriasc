/* Pestaña «Inventario»: registro de lo minado, guardado en localStorage.
   Agrupación por mineral o ubicación, valor estimado con precios UEX,
   y exportación a JSON o texto con formato Discord.

   Dos tipos de registro conviven en `entries`:
   - Mineral concreto (formato original, intacto para no perder datos ya
     guardados): { id, ore, qty, loc, date }. Se identifica por tener `ore`.
   - Entrada genérica por categoría (Minerales/Armas/Armaduras/Tarjetas/
     Pinturas/Otros), sin especificar qué mineral o qué ítem exacto:
     { id, category, qty, unit, loc, note, date }. Se identifica por tener
     `category`. Nunca tiene precio UEX: `valueOf()` devuelve null a
     propósito, no se inventa una valoración. */

const CATEGORY_ES = {
  mineral: "Minerales",
  weapon: "Armas",
  armor: "Armaduras",
  card: "Tarjetas",
  paint: "Pinturas",
  other: "Otros",
};

const CATEGORY_UNIT = {
  mineral: "SCU",
  weapon: "ud",
  armor: "ud",
  card: "ud",
  paint: "ud",
  other: "ud",
};

const Inventory = {
  STORAGE_KEY: "mineriasc_inventory",
  // Vista por defecto al entrar en la pestaña: "por ubicación" (las cajas).
  // El conmutador de arriba (Por mineral / Por ubicación) sigue funcionando
  // igual; esto solo fija el estado inicial. init() sincroniza las clases
  // "active" de los botones con este valor vía setGroup(), así que cambiar
  // esto es lo único que hace falta para cambiar la vista de entrada.
  groupBy: "loc",
  entries: [],
  // Cajas de ubicación abiertas en la vista "Por ubicación". Estado efímero
  // (no se persiste): se resetea al recargar la página, se conserva mientras
  // se navega/edita el inventario en la misma sesión.
  openLocs: new Set(),

  init() {
    try {
      this.entries = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    } catch (_) {
      this.entries = [];
    }

    // selects del formulario
    const oreSel = document.getElementById("inv-ore");
    oreSel.innerHTML =
      '<option value="" disabled selected>Mineral…</option>' +
      Object.entries(DATA.ores)
        .sort((a, b) => a[1].display_name.localeCompare(b[1].display_name))
        .map(([k, o]) => `<option value="${k}">${esc(o.display_name)}</option>`)
        .join("");

    const catSel = document.getElementById("inv-category");
    catSel.innerHTML = Object.entries(CATEGORY_ES)
      .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`)
      .join("");

    // Catálogo COMPLETO de ubicaciones (237: ciudades, estaciones tipo
    // MIC-L1, outposts y zonas de minado), agrupado por sistema.
    const locSel = document.getElementById("inv-loc");
    const bySystem = {};
    for (const l of DATA.allLocations()) {
      (bySystem[l.system || "Otro"] ??= []).push(l);
    }
    locSel.innerHTML =
      '<option value="">Ubicación (opcional)…</option>' +
      Object.entries(bySystem)
        .map(
          ([system, locs]) =>
            `<optgroup label="${esc(system)}">${locs
              .map((l) => {
                const kindLabel = LOC_TYPE_ES[l.kind] || l.kind || "";
                return `<option value="${esc(l.name)}">${esc(l.name)}${
                  kindLabel ? " · " + esc(kindLabel) : ""
                }</option>`;
              })
              .join("")}</optgroup>`
        )
        .join("");

    // Combos con buscador: mineral (100+ opciones) y ubicación (237, con
    // optgroups por sistema) los necesitan de sobra; categoría tiene 6
    // (justo por encima del umbral de 5 en el que un <select> nativo sigue
    // siendo lo más simple). El <select> original sigue siendo la fuente de
    // verdad (ver js/searchselect.js) — todo lo de abajo (updateEntryTypeUI,
    // add()) sigue leyendo/escribiendo sobre él sin cambios.
    SearchSelect.enhance(oreSel, { placeholder: "Buscar mineral…" });
    SearchSelect.enhance(catSel, { placeholder: "Buscar categoría…" });
    SearchSelect.enhance(locSel, { placeholder: "Buscar ubicación…" });

    document.getElementById("inv-entry-type").addEventListener("change", () => this.updateEntryTypeUI());
    document.getElementById("inv-category").addEventListener("change", () => this.updateEntryTypeUI());
    this.updateEntryTypeUI();

    document.getElementById("inv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.add();
    });
    document.getElementById("inv-group-ore").addEventListener("click", () => this.setGroup("ore"));
    document.getElementById("inv-group-loc").addEventListener("click", () => this.setGroup("loc"));
    document.getElementById("inv-export-json").addEventListener("click", () => this.exportJson());
    document.getElementById("inv-export-discord").addEventListener("click", () => this.exportDiscord());
    document.getElementById("inv-clear").addEventListener("click", () => this.clear());

    // setGroup() (no render() a secas) para que las clases "active" de los
    // botones Por mineral/Por ubicación queden sincronizadas con groupBy
    // desde el primer render, sin depender de qué clase venga hardcodeada
    // en el HTML.
    this.setGroup(this.groupBy);
  },

  // Alterna el formulario entre "mineral concreto" (flujo original) y
  // "categoría genérica": oculta/deshabilita lo que no toca en cada modo para
  // que el required de los campos ocultos no bloquee el submit.
  updateEntryTypeUI() {
    const isGenericMode = document.getElementById("inv-entry-type").value === "generic";
    const oreSel = document.getElementById("inv-ore");
    const catSel = document.getElementById("inv-category");
    const noteInp = document.getElementById("inv-note");
    const qtyInp = document.getElementById("inv-qty");

    oreSel.hidden = isGenericMode;
    oreSel.required = !isGenericMode;
    catSel.hidden = !isGenericMode;
    catSel.required = isGenericMode;
    noteInp.hidden = !isGenericMode;

    const unit = isGenericMode ? CATEGORY_UNIT[catSel.value] || "ud" : "SCU";
    qtyInp.placeholder = `Cantidad (${unit})`;
  },

  isGeneric(entry) {
    return entry.category !== undefined;
  },

  labelOf(entry) {
    return this.isGeneric(entry)
      ? CATEGORY_ES[entry.category] || entry.category
      : DATA.ores[entry.ore]?.display_name || entry.ore;
  },

  unitOf(entry) {
    return this.isGeneric(entry) ? entry.unit || CATEGORY_UNIT[entry.category] || "ud" : "SCU";
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.entries));
  },

  add() {
    const isGenericMode = document.getElementById("inv-entry-type").value === "generic";
    const qty = parseFloat(document.getElementById("inv-qty").value);
    const loc = document.getElementById("inv-loc").value;
    if (!(qty > 0)) return;

    if (isGenericMode) {
      const category = document.getElementById("inv-category").value;
      if (!category) return;
      const note = document.getElementById("inv-note").value.trim();
      this.entries.push({
        id: Date.now(),
        category,
        qty,
        unit: CATEGORY_UNIT[category] || "ud",
        loc,
        note: note || null,
        date: new Date().toISOString(),
      });
      document.getElementById("inv-note").value = "";
    } else {
      const ore = document.getElementById("inv-ore").value;
      if (!ore) return;
      this.entries.push({ id: Date.now(), ore, qty, loc, date: new Date().toISOString() });
    }

    this.save();
    this.render();
    document.getElementById("inv-qty").value = "";
    showToast("Añadido al inventario");
  },

  remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.save();
    this.render();
  },

  clear() {
    if (!this.entries.length) return;
    if (!confirm("¿Vaciar todo el inventario? Esta acción no se puede deshacer.")) return;
    this.entries = [];
    this.save();
    this.render();
    showToast("Inventario vaciado");
  },

  setGroup(g) {
    this.groupBy = g;
    document.getElementById("inv-group-ore").classList.toggle("active", g === "ore");
    document.getElementById("inv-group-loc").classList.toggle("active", g === "loc");
    this.render();
  },

  // Clave de agrupación por ubicación: cadena vacía = "sin ubicación" (así
  // coincide con `entry.loc`, que también es "" cuando no se eligió ninguna).
  locKey(entry) {
    return entry.loc || "";
  },

  toggleLocBox(key) {
    if (this.openLocs.has(key)) this.openLocs.delete(key);
    else this.openLocs.add(key);
    this.render();
  },

  // Solo los minerales concretos tienen precio UEX: las entradas genéricas
  // devuelven null a propósito, nunca un valor inventado.
  valueOf(entry) {
    if (this.isGeneric(entry)) return null;
    const best = DATA.bestSellFor(entry.ore);
    return best ? entry.qty * best.price : null;
  },

  render() {
    const summary = document.getElementById("inv-summary");
    const list = document.getElementById("inv-list");

    if (!this.entries.length) {
      summary.innerHTML = "";
      list.innerHTML = '<p class="placeholder">Tu inventario está vacío. Añade lo que vayas minando con el formulario de arriba.</p>';
      return;
    }

    // Total SCU: minerales concretos + entradas genéricas de categoría
    // "Minerales" (misma unidad); armas/armaduras/tarjetas/pinturas/otros se
    // cuentan aparte porque van en unidades, no en SCU.
    const scuEntries = this.entries.filter((e) => this.unitOf(e) === "SCU");
    const genericOtherEntries = this.entries.filter((e) => this.isGeneric(e) && e.unit !== "SCU");
    const totalScu = scuEntries.reduce((s, e) => s + e.qty, 0);
    const totalValue = this.entries.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
    const totalGenericUds = genericOtherEntries.reduce((s, e) => s + e.qty, 0);

    summary.innerHTML = `
      <div class="stat"><div class="label">Registros</div><div class="value">${this.entries.length}</div></div>
      <div class="stat"><div class="label">Total SCU</div><div class="value">${fmtNum(totalScu, 2)}</div></div>
      <div class="stat"><div class="label">Valor estimado (venta UEX)</div><div class="value accent">${fmtNum(totalValue)} aUEC</div></div>
      ${genericOtherEntries.length ? `<div class="stat"><div class="label">Otros objetos (sin valorar)</div><div class="value">${fmtNum(totalGenericUds, 2)} ud</div></div>` : ""}`;

    list.innerHTML = this.groupBy === "loc" ? this.renderLocationBoxes() : this.renderMineralGroups();

    list.querySelectorAll(".entry-del").forEach((b) =>
      b.addEventListener("click", () => this.remove(Number(b.dataset.id)))
    );
    list.querySelectorAll(".inv-box-head").forEach((h) =>
      h.addEventListener("click", () => this.toggleLocBox(h.dataset.key))
    );
  },

  // Vista "Por mineral": una lista de grupos por mineral/categoría; cada
  // línea muestra en qué ubicación se registró (formato original, intacto).
  renderMineralGroups() {
    const groups = {};
    for (const e of this.entries) {
      const key = this.isGeneric(e) ? `${CATEGORY_ES[e.category] || e.category} (genérico)` : this.labelOf(e);
      (groups[key] ??= []).push(e);
    }

    return Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => {
        const scu = items.filter((e) => this.unitOf(e) === "SCU").reduce((s, e) => s + e.qty, 0);
        const val = items.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
        const hasValuable = items.some((e) => !this.isGeneric(e));
        const oreEntry = items.find((e) => !this.isGeneric(e));
        const rows = items
          .map((e) => {
            const note = this.isGeneric(e) && e.note ? ` <span class="meta">· ${esc(e.note)}</span>` : "";
            return `<div class="entry">
              <span>
                ${esc(e.loc || "Sin ubicación")}${note}
                <span class="meta"> · ${new Date(e.date).toLocaleDateString("es-ES")}</span>
              </span>
              <span>
                ${fmtNum(e.qty, 2)} ${esc(this.unitOf(e))}
                <button class="entry-del" data-id="${e.id}" title="Eliminar registro">✕</button>
              </span>
            </div>`;
          })
          .join("");
        const totalsTxt = `${fmtNum(scu, 2)} SCU · ${hasValuable ? fmtNum(val) + " aUEC" : "sin valorar"}`;
        return `<div class="group">
          <div class="group-head">
            <span>${oreEntry ? rarityDotHtml(oreEntry.ore) : ""}${esc(name)}</span>
            <span>${totalsTxt}</span>
          </div>${rows}</div>`;
      })
      .join("");
  },

  // Vista "Por ubicación": una caja por ubicación con objetos (más una caja
  // "Sin ubicación" al final si aplica). El nombre de la ubicación queda en
  // grande en la cabecera; al pinchar se abre/cierra la caja (acordeón). Las
  // líneas dentro de cada caja se subagrupan por mineral/categoría —fusión
  // solo visual, sumando cantidad y valor— pero cada entrada original se
  // sigue listando por separado con su propia fecha y botón de borrado, así
  // no se pierde el historial ni la granularidad para eliminar un registro
  // concreto.
  renderLocationBoxes() {
    const boxes = {};
    for (const e of this.entries) {
      (boxes[this.locKey(e)] ??= []).push(e);
    }
    const NONE_KEY = "";
    const orderedKeys = Object.keys(boxes)
      .filter((k) => k !== NONE_KEY)
      .sort((a, b) => a.localeCompare(b));
    if (boxes[NONE_KEY]) orderedKeys.push(NONE_KEY);

    const boxesHtml = orderedKeys
      .map((key) => {
        const items = boxes[key];
        const name = key || "Sin ubicación";
        const scuItems = items.filter((e) => this.unitOf(e) === "SCU");
        const otherUdItems = items.filter((e) => this.unitOf(e) !== "SCU");
        const scu = scuItems.reduce((s, e) => s + e.qty, 0);
        const otherUd = otherUdItems.reduce((s, e) => s + e.qty, 0);
        const val = items.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
        const hasValuable = items.some((e) => !this.isGeneric(e));
        const open = this.openLocs.has(key);

        const subgroups = {};
        for (const e of items) {
          const label = this.isGeneric(e) ? `${CATEGORY_ES[e.category] || e.category} (genérico)` : this.labelOf(e);
          (subgroups[label] ??= []).push(e);
        }
        const subHtml = Object.entries(subgroups)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([label, subItems]) => {
            const subQty = subItems.reduce((s, e) => s + e.qty, 0);
            const subVal = subItems.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
            const subValuable = subItems.some((e) => !this.isGeneric(e));
            const subOreEntry = subItems.find((e) => !this.isGeneric(e));
            const unit = this.unitOf(subItems[0]);
            const rows = subItems
              .map((e) => {
                const note = this.isGeneric(e) && e.note ? ` <span class="meta">· ${esc(e.note)}</span>` : "";
                return `<div class="entry">
                  <span>
                    ${fmtNum(e.qty, 2)} ${esc(this.unitOf(e))}${note}
                    <span class="meta"> · ${new Date(e.date).toLocaleDateString("es-ES")}</span>
                  </span>
                  <span>
                    <button class="entry-del" data-id="${e.id}" title="Eliminar registro">✕</button>
                  </span>
                </div>`;
              })
              .join("");
            return `<div class="inv-box-sub">
              <div class="inv-box-sub-head">
                <span>${subOreEntry ? rarityDotHtml(subOreEntry.ore) : ""}${esc(label)}</span>
                <span>${fmtNum(subQty, 2)} ${esc(unit)}${subValuable ? " · " + fmtNum(subVal) + " aUEC" : ""}</span>
              </div>
              ${rows}
            </div>`;
          })
          .join("");

        return `<div class="inv-box">
          <button type="button" class="inv-box-head" data-key="${esc(key)}" aria-expanded="${open}">
            <span class="inv-box-name">${esc(name)}</span>
            <span class="inv-box-meta">
              <span>${items.length} obj.</span>
              ${scuItems.length ? `<span>${fmtNum(scu, 2)} SCU</span>` : ""}
              ${otherUdItems.length ? `<span>${fmtNum(otherUd, 2)} ud</span>` : ""}
              <span class="accent">${hasValuable ? fmtNum(val) + " aUEC" : "sin valorar"}</span>
              <span class="inv-box-caret">${open ? "▾" : "▸"}</span>
            </span>
          </button>
          <div class="inv-box-body"${open ? "" : " hidden"}>${subHtml}</div>
        </div>`;
      })
      .join("");

    return `<div class="inv-boxes">${boxesHtml}</div>`;
  },

  exportJson() {
    const data = this.entries.map((e) => {
      if (this.isGeneric(e)) {
        return {
          type: "generic",
          category: e.category,
          category_name: CATEGORY_ES[e.category] || e.category,
          qty: e.qty,
          unit: this.unitOf(e),
          note: e.note || null,
          location: e.loc || null,
          date: e.date,
        };
      }
      return {
        type: "ore",
        ore: e.ore,
        ore_name: DATA.ores[e.ore]?.display_name || e.ore,
        qty_scu: e.qty,
        location: e.loc || null,
        date: e.date,
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inventario_mineria.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("JSON descargado");
  },

  async exportDiscord() {
    const oreGroups = {};
    const genericGroups = {};
    for (const e of this.entries) {
      if (this.isGeneric(e)) {
        const g = (genericGroups[e.category] ??= { qty: 0, notes: [] });
        g.qty += e.qty;
        if (e.note) g.notes.push(e.note);
      } else {
        const name = DATA.ores[e.ore]?.display_name || e.ore;
        oreGroups[name] = (oreGroups[name] || 0) + e.qty;
      }
    }
    const totalValue = this.entries.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
    const lines = [
      "**⛏️ Inventario de minería**",
      ...Object.entries(oreGroups)
        .sort((a, b) => b[1] - a[1])
        .map(([name, qty]) => `> ${name}: **${fmtNum(qty, 2)} SCU**`),
      `Total estimado: **${fmtNum(totalValue)} aUEC**`,
    ];
    const genericEntries = Object.entries(genericGroups);
    if (genericEntries.length) {
      lines.push("", "**📦 Otros objetos (sin valorar)**");
      lines.push(
        ...genericEntries
          .sort((a, b) => b[1].qty - a[1].qty)
          .map(([cat, g]) => {
            const unit = CATEGORY_UNIT[cat] || "ud";
            const notesTxt = g.notes.length ? ` _(${g.notes.join(", ")})_` : "";
            return `> ${CATEGORY_ES[cat] || cat}: **${fmtNum(g.qty, 2)} ${unit}**${notesTxt}`;
          })
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("Copiado al portapapeles (formato Discord)");
    } catch (_) {
      showToast("No se pudo copiar al portapapeles");
    }
  },
};
