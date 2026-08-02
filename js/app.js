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
  const refreshBtn = document.getElementById("refresh-live-btn");

  // Fragmento fijo del indicador (parche + fecha de datos), reutilizado por
  // el arranque y por el refresco manual para no repetir la plantilla.
  const metaBase = () => `Parche ${DATA.raw.meta.current_patch} · datos del ${DATA.raw.meta.data_updated}`;

  // Re-renderiza las vistas cuyo contenido depende de precios UEX / marketplace
  // (mismo conjunto tanto en la carga inicial como en el refresco manual).
  const rerenderLiveViews = () => {
    Finder.renderList(document.getElementById("ore-search").value.trim().toLowerCase());
    if (Finder.selected) Finder.renderDetail(Finder.selected);
    if (Locations.selected) Locations.renderDetail(Locations.selected);
    Inventory.render();
  };

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

  meta.textContent = `${metaBase()} · precios UEX: cargando…`;

  Finder.init();
  Locations.init();
  Inventory.init();
  Signals.init();
  Crafting.init();

  // Precios en vivo, sin bloquear la interfaz
  try {
    await DATA.loadUexPrices();
    meta.textContent = `${metaBase()} · precios UEX en vivo ✓`;
    rerenderLiveViews();
  } catch (err) {
    meta.textContent = `${metaBase()} · precios UEX no disponibles`;
    console.warn("UEX no disponible:", err);
  }

  // Medias del Marketplace P2P (anuncios entre jugadores), igual de no bloqueante
  try {
    await DATA.loadMarketplaceAverages();
    if (Finder.selected) Finder.renderDetail(Finder.selected);
  } catch (err) {
    console.warn("Marketplace UEX no disponible:", err);
  }

  // Botón "Actualizar": refresco manual forzado de precios + marketplace,
  // saltando la caché de 30 min. DATA.refreshLive() nunca rechaza (ver
  // contrato en data.js), así que no hace falta try/catch aquí.
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    const prevLabel = refreshBtn.textContent;
    refreshBtn.textContent = "Actualizando…";

    const r = await DATA.refreshLive();
    rerenderLiveViews();

    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    if (r.prices === "ok" && r.marketplace === "ok") {
      meta.textContent = `${metaBase()} · precios UEX en vivo ✓ · actualizado a las ${time}`;
      showToast(`Precios actualizados (${time})`);
    } else if (r.prices === "ok" && r.marketplace === "error") {
      meta.textContent = `${metaBase()} · precios actualizados ✓ · marketplace no disponible`;
      showToast("Precios actualizados; marketplace no disponible");
    } else if (r.prices === "error" && r.marketplace === "ok") {
      meta.textContent = `${metaBase()} · marketplace actualizado ✓ · precios no disponibles`;
      showToast("Marketplace actualizado; precios no disponibles");
    } else {
      meta.textContent = `${metaBase()} · no se pudo conectar con UEX`;
      showToast("No se pudo conectar con UEX; se mantienen los últimos datos");
    }

    refreshBtn.disabled = false;
    refreshBtn.textContent = prevLabel;
  });
})();
