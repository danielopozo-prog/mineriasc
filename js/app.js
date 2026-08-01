/* Arranque: carga de datos, navegación por pestañas e inicialización
   de cada módulo. Los precios UEX llegan en segundo plano. */

(async function main() {
  // Navegación por pestañas
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "refineria") Refinery.render();
    })
  );

  const meta = document.getElementById("meta-info");

  try {
    await DATA.load();
  } catch (err) {
    meta.textContent = "Error cargando datos";
    document.querySelector("main").innerHTML =
      `<p class="error-msg" style="padding:40px;text-align:center">
        No se pudo cargar <code>data/mining_data.json</code>: ${esc(err.message)}.<br>
        Si abriste el archivo con doble clic, sirve la carpeta con un servidor local
        (p. ej. <code>python -m http.server</code>).</p>`;
    return;
  }

  meta.textContent = `Parche ${DATA.raw.meta.current_patch} · datos del ${DATA.raw.meta.data_updated} · precios UEX: cargando…`;

  Finder.init();
  Locations.init();
  Inventory.init();
  Signals.init();

  // Precios en vivo, sin bloquear la interfaz
  try {
    await DATA.loadUexPrices();
    meta.textContent = `Parche ${DATA.raw.meta.current_patch} · datos del ${DATA.raw.meta.data_updated} · precios UEX en vivo ✓`;
    // refrescar vistas que muestran precios
    Finder.renderList(document.getElementById("ore-search").value.trim().toLowerCase());
    if (Finder.selected) Finder.renderDetail(Finder.selected);
    if (Locations.selected) Locations.renderDetail(Locations.selected);
    Inventory.render();
  } catch (err) {
    meta.textContent = `Parche ${DATA.raw.meta.current_patch} · datos del ${DATA.raw.meta.data_updated} · precios UEX no disponibles`;
    console.warn("UEX no disponible:", err);
  }
})();
