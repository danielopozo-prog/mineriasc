# Minería SC

Panel de minería para **Star Citizen**, inspirado en [Strata](https://seeknd.github.io/Strata/) y adaptado con precios en vivo de la [API de UEX Corp](https://uexcorp.space).

## Funcionalidades

- **Buscador de minerales** — propiedades de minado (inestabilidad, resistencia, explosión), precios en vivo (refinado y en bruto), mejores refinerías donde vender, señales de escáner y ubicaciones donde aparece cada mineral.
- **Explorador de ubicaciones** — filtro por sistema (Stanton, Pyro, Nyx), minerales disponibles en cada ubicación con su probabilidad relativa por método (nave, FPS, ROC).
- **Refinería** — métodos de refinado con valoraciones (rendimiento/coste/velocidad, en vivo de UEX) y tabla de bonos de rendimiento por estación.
- **Inventario personal** — registra lo que minas, agrupa por mineral o ubicación, calcula el valor estimado con precios UEX y exporta a JSON o al portapapeles con formato Discord. Dos modos de alta: mineral concreto (con cantidad en SCU) o materiales genéricos (Minerales/Armas/Armaduras/Tarjetas/Pinturas/Otros) marcados con checkboxes múltiples y una nota libre compartida, sin cantidad. Todo se guarda en el `localStorage` de tu navegador.
- **Señales** — multiplicadores de señal de escáner (x1-x15) por mineral, con búsqueda inversa y favoritos.
- **Crafteo** — búsqueda inversa de blueprints por material: elige un mineral y ve qué objetos lo requieren, con ficha de ingredientes por slot, tiempo de fabricación, misiones que sueltan el plano y un simulador de calidad (slider 0-1000 que interpola los efectos de cada ingrediente).
- **Contadores** (`contadores.html`, enlazada desde la cabecera) — temporizadores de Hangar Ejecutivo, impresoras de tarjetas, bóveda de Ruin Station, ciclo de loot y Compboards. Página hermana independiente, con su propio CSS y estado en `localStorage`.
- **Desplegables con buscador** — cualquier selector con muchas opciones (mineral, ubicación, material de crafteo…) se abre como un combo con un cuadro de texto que filtra en vivo, insensible a mayúsculas y acentos, con navegación por teclado.

## Cómo ejecutarlo

Es un sitio 100 % estático (HTML + CSS + JS vanilla, sin dependencias). Solo necesita un servidor local porque carga `data/mining_data.json` con `fetch`:

```bash
python -m http.server 8123
```

Y abre <http://localhost:8123>. También está publicado en GitHub Pages:
<https://danielopozo-prog.github.io/mineriasc/>.

**Windows, sin usar la terminal:** haz doble clic en `Iniciar servidor.bat`. Comprueba que
Python está instalado, levanta el servidor en el puerto 8123 y abre el navegador
automáticamente. Deja la ventana abierta mientras uses la app; para pararlo, ciérrala.

## Fuentes de datos

| Dato | Fuente | Actualización |
|---|---|---|
| Precios, terminales, métodos de refinado | API pública de UEX Corp | En vivo (caché de 30 min en localStorage) |
| Minerales, ubicaciones, señales, dificultad | `data/mining_data.json` (base de Strata) | Manual: re-descargar de Strata con cada parche |
| Estaciones, ciudades y outposts | `data/uex_locations.json` (catálogo UEX) | Manual: regenerar con `fetch_uex_locations.py` con cada parche |
| Planos de fabricación (crafteo) | `data/craft_blueprints.json` (sc-craft.tools) | Manual: regenerar con `fetch_craft_blueprints.py` con cada parche |

Para actualizar los datos de juego tras un parche:

```bash
curl -o data/mining_data.json https://seeknd.github.io/Strata/data/mining_data.json
python .claude/scripts/fetch_uex_locations.py
python .claude/scripts/fetch_craft_blueprints.py
```

## Estructura

```
index.html          Interfaz con las 6 pestañas
css/styles.css      Tema oscuro espacial
js/uex.js           Cliente de la API UEX con caché
js/data.js          Carga del JSON e índices (mineral↔ubicación)
js/searchselect.js  Combo con buscador reutilizable (selects largos)
js/finder.js        Pestaña Buscador
js/locations.js     Pestaña Ubicaciones
js/refinery.js      Pestaña Refinería
js/inventory.js     Pestaña Inventario
js/signals.js       Pestaña Señales
js/crafting.js      Pestaña Crafteo
data/mining_data.json      Datos de juego (parche 4.9)
data/uex_locations.json    Catálogo de estaciones/ciudades/outposts UEX
data/craft_blueprints.json Planos de fabricación (sc-craft.tools)

contadores.html      Página hermana de temporizadores (independiente)
css/contadores.css   Estilos propios de contadores.html
js/contadores.js     Lógica de contadores.html
```

> Proyecto personal. No afiliado a Cloud Imperium Games ni a Strata. Los datos del juego pertenecen a sus respectivos autores.
