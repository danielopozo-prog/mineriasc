/* Pestaña «Inventario»: registro de lo minado, guardado en localStorage.
   Agrupación por mineral o ubicación, valor estimado con precios UEX,
   y exportación a JSON o texto con formato Discord.

   Dos tipos de registro conviven en `entries`:
   - Mineral concreto (formato original, intacto para no perder datos ya
     guardados): { id, ore, qty, loc, date }. Se identifica por tener `ore`.
     Modo de formulario "Mineral concreto": select con buscador + SCU,
     sin cambios de comportamiento.
   - Entrada genérica por categoría (Minerales/Armas/Armaduras/Tarjetas/
     Pinturas/Otros): { id, category, qty, unit, loc, note, date }. Se
     identifica por tener `category`. Nunca tiene precio UEX: `valueOf()`
     devuelve null a propósito, no se inventa una valoración. Dos variantes
     conviven por compatibilidad hacia atrás — distinguirlas con `hasQty()`,
     nunca comprobando `qty` a pelo:
       - Con cantidad (formato original, ya no se crea desde el formulario
         actual pero los datos guardados se siguen leyendo/exportando tal
         cual): qty/unit numéricos, un select de categoría + campo SCU.
       - Sin cantidad (modo por defecto del formulario actual: tira de
         checkboxes múltiples + una nota de texto libre compartida): qty y
         unit son `null` a propósito, nunca se inventa una cantidad ni una
         unidad. Marcar varias categorías a la vez crea una entrada por
         cada una, con la misma nota y fecha. */

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

    // Tira de categorías con checkbox (modo "Materiales genéricos"): un
    // <label> por categoría, marcado múltiple. El listener de "change" solo
    // sincroniza la clase visual ".checked" del <label> — la lectura real
    // de qué está marcado ocurre en add() al enviar el formulario.
    const catChecksEl = document.getElementById("inv-cat-checks");
    catChecksEl.innerHTML = Object.entries(CATEGORY_ES)
      .map(
        ([k, label]) =>
          `<label class="inv-cat-check"><input type="checkbox" value="${k}"><span>${esc(label)}</span></label>`
      )
      .join("");
    catChecksEl.addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        e.target.closest(".inv-cat-check")?.classList.toggle("checked", e.target.checked);
      }
    });

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
    // optgroups por sistema) los necesitan de sobra. El <select> original
    // sigue siendo la fuente de verdad (ver js/searchselect.js) — todo lo
    // de abajo (updateEntryTypeUI, add()) sigue leyendo/escribiendo sobre
    // él sin cambios.
    SearchSelect.enhance(oreSel, { placeholder: "Buscar mineral…" });
    SearchSelect.enhance(locSel, { placeholder: "Buscar ubicación…" });

    document.getElementById("inv-entry-type").addEventListener("change", () => this.updateEntryTypeUI());
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

  // Alterna el formulario entre "Materiales genéricos" (checkboxes múltiples
  // + nota, por defecto) y "Mineral concreto" (select con buscador + SCU):
  // oculta/deshabilita lo que no toca en cada modo para que el required de
  // los campos ocultos no bloquee el submit.
  updateEntryTypeUI() {
    const isGenericMode = document.getElementById("inv-entry-type").value === "generic";
    const oreSel = document.getElementById("inv-ore");
    const qtyInp = document.getElementById("inv-qty");
    const catChecksEl = document.getElementById("inv-cat-checks");
    const noteInp = document.getElementById("inv-note");

    oreSel.hidden = isGenericMode;
    oreSel.required = !isGenericMode;
    qtyInp.hidden = isGenericMode;
    qtyInp.required = !isGenericMode;
    catChecksEl.hidden = !isGenericMode;
    noteInp.hidden = !isGenericMode;
  },

  isGeneric(entry) {
    return entry.category !== undefined;
  },

  // Distingue las dos variantes de entrada genérica (ver comentario de
  // cabecera): comprobar esto en vez de `entry.qty` a pelo, porque `0` sería
  // falsy pero sí es una cantidad real.
  hasQty(entry) {
    return entry.qty !== null && entry.qty !== undefined;
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
    const loc = document.getElementById("inv-loc").value;

    if (isGenericMode) {
      // Una entrada por cada categoría marcada (sin cantidad SCU, ver
      // comentario de cabecera), todas con la misma nota y fecha.
      const checked = [...document.querySelectorAll('#inv-cat-checks input[type="checkbox"]:checked')];
      if (!checked.length) return;
      const note = document.getElementById("inv-note").value.trim();
      const now = new Date().toISOString();
      checked.forEach((box, i) => {
        this.entries.push({
          id: Date.now() + i, // +i: evita ids duplicados al crear varias entradas en el mismo ms
          category: box.value,
          qty: null,
          unit: null,
          loc,
          note: note || null,
          date: now,
        });
        box.checked = false;
        box.closest(".inv-cat-check")?.classList.remove("checked");
      });
      document.getElementById("inv-note").value = "";
    } else {
      const qty = parseFloat(document.getElementById("inv-qty").value);
      if (!(qty > 0)) return;
      const ore = document.getElementById("inv-ore").value;
      if (!ore) return;
      this.entries.push({ id: Date.now(), ore, qty, loc, date: new Date().toISOString() });
      document.getElementById("inv-qty").value = "";
    }

    this.save();
    this.render();
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
    // "Minerales" con cantidad (misma unidad); armas/armaduras/tarjetas/
    // pinturas/otros se cuentan aparte porque van en unidades, no en SCU.
    // Las entradas genéricas "sin cantidad" (checkboxes múltiples, sin
    // campo SCU) se excluyen de ambos totales y se cuentan aparte, igual
    // que ya se hace con "sin valorar" para el precio.
    const scuEntries = this.entries.filter((e) => this.hasQty(e) && this.unitOf(e) === "SCU");
    const genericOtherEntries = this.entries.filter((e) => this.isGeneric(e) && this.hasQty(e) && e.unit !== "SCU");
    const noQtyEntries = this.entries.filter((e) => !this.hasQty(e));
    const totalScu = scuEntries.reduce((s, e) => s + e.qty, 0);
    const totalValue = this.entries.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
    const totalGenericUds = genericOtherEntries.reduce((s, e) => s + e.qty, 0);

    summary.innerHTML = `
      <div class="stat"><div class="label">Registros</div><div class="value">${this.entries.length}</div></div>
      <div class="stat"><div class="label">Total SCU</div><div class="value">${fmtNum(totalScu, 2)}</div></div>
      <div class="stat"><div class="label">Valor estimado (venta UEX)</div><div class="value accent">${fmtNum(totalValue)} aUEC</div></div>
      ${genericOtherEntries.length ? `<div class="stat"><div class="label">Otros objetos (sin valorar)</div><div class="value">${fmtNum(totalGenericUds, 2)} ud</div></div>` : ""}
      ${noQtyEntries.length ? `<div class="stat"><div class="label">Materiales sin cantidad</div><div class="value">${noQtyEntries.length}</div></div>` : ""}`;

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
        const qtyItems = items.filter((e) => this.hasQty(e));
        const scu = qtyItems.filter((e) => this.unitOf(e) === "SCU").reduce((s, e) => s + e.qty, 0);
        const val = items.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
        const hasValuable = items.some((e) => !this.isGeneric(e));
        const oreEntry = items.find((e) => !this.isGeneric(e));
        const rows = items
          .map((e) => {
            const note = this.isGeneric(e) && e.note ? ` <span class="meta">· ${esc(e.note)}</span>` : "";
            const qtyTxt = this.hasQty(e) ? `${fmtNum(e.qty, 2)} ${esc(this.unitOf(e))}` : "Sin cantidad";
            return `<div class="entry">
              <span>
                ${esc(e.loc || "Sin ubicación")}${note}
                <span class="meta"> · ${new Date(e.date).toLocaleDateString("es-ES")}</span>
              </span>
              <span>
                ${qtyTxt}
                <button class="entry-del" data-id="${e.id}" title="Eliminar registro">✕</button>
              </span>
            </div>`;
          })
          .join("");
        const qtyTxt = qtyItems.length ? `${fmtNum(scu, 2)} SCU` : "sin cantidad";
        const totalsTxt = `${qtyTxt} · ${hasValuable ? fmtNum(val) + " aUEC" : "sin valorar"}`;
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
        const qtyItems = items.filter((e) => this.hasQty(e));
        const scuItems = qtyItems.filter((e) => this.unitOf(e) === "SCU");
        const otherUdItems = qtyItems.filter((e) => this.unitOf(e) !== "SCU");
        const noQtyCount = items.length - qtyItems.length;
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
            const subQtyItems = subItems.filter((e) => this.hasQty(e));
            const subQty = subQtyItems.reduce((s, e) => s + e.qty, 0);
            const subVal = subItems.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
            const subValuable = subItems.some((e) => !this.isGeneric(e));
            const subOreEntry = subItems.find((e) => !this.isGeneric(e));
            const unit = this.unitOf(subQtyItems[0] || subItems[0]);
            const subQtyTxt = subQtyItems.length ? `${fmtNum(subQty, 2)} ${esc(unit)}` : "sin cantidad";
            const rows = subItems
              .map((e) => {
                const note = this.isGeneric(e) && e.note ? ` <span class="meta">· ${esc(e.note)}</span>` : "";
                const qtyTxt = this.hasQty(e) ? `${fmtNum(e.qty, 2)} ${esc(this.unitOf(e))}` : "Sin cantidad";
                return `<div class="entry">
                  <span>
                    ${qtyTxt}${note}
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
                <span>${subQtyTxt}${subValuable ? " · " + fmtNum(subVal) + " aUEC" : ""}</span>
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
              ${noQtyCount ? `<span>${noQtyCount} sin cantidad</span>` : ""}
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
          qty: this.hasQty(e) ? e.qty : null,
          unit: this.hasQty(e) ? this.unitOf(e) : null,
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
        const g = (genericGroups[e.category] ??= { qty: 0, hasQty: false, noQtyCount: 0, notes: [] });
        if (this.hasQty(e)) {
          g.qty += e.qty;
          g.hasQty = true;
        } else {
          g.noQtyCount++;
        }
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
          .sort((a, b) => b[1].qty + b[1].noQtyCount - (a[1].qty + a[1].noQtyCount))
          .map(([cat, g]) => {
            const unit = CATEGORY_UNIT[cat] || "ud";
            const notesTxt = g.notes.length ? ` _(${g.notes.join(", ")})_` : "";
            const parts = [];
            if (g.hasQty) parts.push(`${fmtNum(g.qty, 2)} ${unit}`);
            if (g.noQtyCount) parts.push(`${g.noQtyCount} sin cantidad`);
            return `> ${CATEGORY_ES[cat] || cat}: **${parts.join(" + ")}**${notesTxt}`;
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
