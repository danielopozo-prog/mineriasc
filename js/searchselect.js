/* Combo con buscador: envuelve un <select> con muchas opciones (5+) en un
   desplegable personalizado que añade un cuadro de texto para filtrarlas en
   vivo, insensible a mayúsculas y acentos. Vanilla, sin dependencias.

   El <select> original NUNCA se quita del DOM: se oculta visualmente
   (opacidad 0, superpuesto exactamente al botón visible) y sigue siendo la
   única fuente de verdad — conserva su `id`, su `value`, `required`,
   `disabled`, `hidden`, y dispara su propio evento nativo "change" al elegir
   una opción. Por eso ningún módulo que ya usa `document.getElementById(id)`,
   `.value` o `addEventListener("change", ...)` sobre el select original tiene
   que cambiar: la mejora es puramente de presentación.

   Uso: SearchSelect.enhance(selectEl, {
     placeholder: "Buscar…", // opcional, texto del cuadro de búsqueda
   }); — selectEl es un <select> ya presente en el DOM, p. ej. obtenido con
   document.getElementById(...) por quien llama.
   Devuelve un API con `.sync()` — llamar tras cambiar `select.value` desde
   fuera por código (asignar `.value` no dispara "change", así que la
   etiqueta del botón no se actualiza sola).

   No usar en selects de 5 opciones o menos: para esos el <select> nativo
   sigue siendo la opción más simple y accesible; el criterio de cuándo
   envolver uno lo decide quien llama a enhance(), no este módulo. */

const SearchSelect = {
  enhance(select, opts = {}) {
    if (!select) return null;
    if (select._sselApi) return select._sselApi;

    const placeholder = opts.placeholder || "Buscar…";

    const wrap = document.createElement("div");
    wrap.className = "ssel";
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add("ssel-native");
    select.tabIndex = -1;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ssel-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML =
      '<span class="ssel-trigger-label"></span><span class="ssel-caret" aria-hidden="true">▾</span>';

    const panel = document.createElement("div");
    panel.className = "ssel-panel";
    panel.hidden = true;

    const search = document.createElement("input");
    search.type = "text";
    search.className = "ssel-search";
    search.placeholder = placeholder;
    search.autocomplete = "off";

    const optionsBox = document.createElement("div");
    optionsBox.className = "ssel-options";
    optionsBox.setAttribute("role", "listbox");

    const empty = document.createElement("p");
    empty.className = "ssel-empty";
    empty.hidden = true;
    empty.textContent = "Sin resultados";

    panel.append(search, optionsBox, empty);
    wrap.append(trigger, panel);

    const label = trigger.querySelector(".ssel-trigger-label");
    let currentRows = [];
    let highlightIndex = -1;

    function normalize(s) {
      return (s || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }

    function updateLabel() {
      const opt = select.selectedOptions[0];
      const text = opt ? opt.textContent : "";
      label.textContent = text;
      label.classList.toggle("placeholder", !opt || opt.disabled || opt.value === "");
    }

    function syncAttrs() {
      wrap.hidden = select.hidden;
      trigger.disabled = select.disabled;
      wrap.classList.toggle("disabled", select.disabled);
    }

    function makeRow(optionEl) {
      const row = document.createElement("div");
      row.className = "ssel-option" + (optionEl.value === select.value ? " selected" : "");
      row.textContent = optionEl.textContent;
      row.setAttribute("role", "option");
      row._value = optionEl.value;
      row.addEventListener("mousedown", (e) => {
        // mousedown, no click: evita que el blur del buscador cierre el
        // panel antes de procesar la selección.
        e.preventDefault();
        choose(optionEl.value);
      });
      optionsBox.appendChild(row);
      return row;
    }

    function updateHighlight() {
      currentRows.forEach((r, i) => r.classList.toggle("highlight", i === highlightIndex));
      if (highlightIndex >= 0 && currentRows[highlightIndex]) {
        currentRows[highlightIndex].scrollIntoView({ block: "nearest" });
      }
    }

    // Relee el <select> en cada apertura/tecleo (no cachea la lista de
    // opciones) porque inventory.js/signals.js pueden regenerar su
    // contenido (innerHTML) después de enhance().
    function buildList(filterText) {
      optionsBox.innerHTML = "";
      const term = normalize(filterText);
      let anyVisible = false;
      const rows = [];

      for (const node of Array.from(select.children)) {
        if (node.tagName === "OPTGROUP") {
          const opts = Array.from(node.children).filter(
            (o) => o.tagName === "OPTION" && !o.disabled && (!term || normalize(o.textContent).includes(term))
          );
          if (!opts.length) continue;
          const groupLabel = document.createElement("div");
          groupLabel.className = "ssel-group-label";
          groupLabel.textContent = node.label;
          optionsBox.appendChild(groupLabel);
          for (const o of opts) rows.push(makeRow(o));
          anyVisible = true;
        } else if (node.tagName === "OPTION") {
          if (node.disabled) continue;
          if (term && !normalize(node.textContent).includes(term)) continue;
          rows.push(makeRow(node));
          anyVisible = true;
        }
      }

      empty.hidden = anyVisible;
      currentRows = rows;
      highlightIndex = rows.length ? 0 : -1;
      updateHighlight();
      return rows;
    }

    function choose(value) {
      const changed = select.value !== value;
      select.value = value;
      updateLabel();
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      trigger.focus();
    }

    function open() {
      if (select.disabled || select.hidden) return;
      wrap.classList.add("open");
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      buildList("");
      search.focus();
    }

    function close() {
      wrap.classList.remove("open");
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", () => {
      if (panel.hidden) open();
      else close();
    });
    trigger.addEventListener("keydown", (e) => {
      if (panel.hidden && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        open();
      } else if (e.key === "Escape") {
        close();
      }
    });

    search.addEventListener("input", () => buildList(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!currentRows.length) return;
        highlightIndex = (highlightIndex + 1) % currentRows.length;
        updateHighlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!currentRows.length) return;
        highlightIndex = (highlightIndex - 1 + currentRows.length) % currentRows.length;
        updateHighlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIndex >= 0 && currentRows[highlightIndex]) {
          choose(currentRows[highlightIndex]._value);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
        trigger.focus();
      } else if (e.key === "Tab") {
        close();
      }
    });

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) close();
    });

    // Sincroniza si otro módulo cambia hidden/disabled directamente sobre el
    // <select> original (p. ej. Inventory.updateEntryTypeUI()), o si
    // regenera sus <option>/<optgroup> tras enhance().
    const observer = new MutationObserver((mutations) => {
      const attrChanged = mutations.some((m) => m.type === "attributes");
      const childChanged = mutations.some((m) => m.type === "childList");
      if (attrChanged) syncAttrs();
      if (childChanged) {
        updateLabel();
        if (!panel.hidden) buildList(search.value);
      }
    });
    observer.observe(select, {
      attributes: true,
      attributeFilter: ["hidden", "disabled", "required"],
      childList: true,
      subtree: true,
    });

    updateLabel();
    syncAttrs();

    const api = {
      // Llamar tras asignar select.value desde fuera (no dispara "change").
      sync() {
        updateLabel();
        syncAttrs();
        if (!panel.hidden) buildList(search.value);
      },
      close,
    };
    select._sselApi = api;
    return api;
  },
};
