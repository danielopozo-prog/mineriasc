# Minería SC

Panel de minería para **Star Citizen**, inspirado en [Strata](https://seeknd.github.io/Strata/) y adaptado con precios en vivo de la [API de UEX Corp](https://uexcorp.space).

## Funcionalidades

- **Buscador de minerales** — propiedades de minado (inestabilidad, resistencia, explosión), precios en vivo (refinado y en bruto), mejores refinerías donde vender, señales de escáner y ubicaciones donde aparece cada mineral.
- **Explorador de ubicaciones** — filtro por sistema (Stanton, Pyro, Nyx), minerales disponibles en cada ubicación con su probabilidad relativa por método (nave, FPS, ROC).
- **Refinería** — métodos de refinado con valoraciones (rendimiento/coste/velocidad, en vivo de UEX) y tabla de bonos de rendimiento por estación.
- **Inventario personal** — registra lo que minas, agrupa por mineral o ubicación, calcula el valor estimado con precios UEX y exporta a JSON o al portapapeles con formato Discord. Todo se guarda en el `localStorage` de tu navegador.

## Cómo ejecutarlo

Es un sitio 100 % estático (HTML + CSS + JS vanilla, sin dependencias). Solo necesita un servidor local porque carga `data/mining_data.json` con `fetch`:

```bash
python -m http.server 8123
```

Y abre <http://localhost:8123>. También puede desplegarse tal cual en GitHub Pages.

## Fuentes de datos

| Dato | Fuente | Actualización |
|---|---|---|
| Precios, terminales, métodos de refinado | API pública de UEX Corp | En vivo (caché de 30 min en localStorage) |
| Minerales, ubicaciones, señales, dificultad | `data/mining_data.json` (base de Strata) | Manual: re-descargar de Strata con cada parche |

Para actualizar los datos de juego tras un parche:

```bash
curl -o data/mining_data.json https://seeknd.github.io/Strata/data/mining_data.json
```

## Estructura

```
index.html          Interfaz con las 4 pestañas
css/styles.css      Tema oscuro espacial
js/uex.js           Cliente de la API UEX con caché
js/data.js          Carga del JSON e índices (mineral↔ubicación)
js/finder.js        Pestaña Buscador
js/locations.js     Pestaña Ubicaciones
js/refinery.js      Pestaña Refinería
js/inventory.js     Pestaña Inventario
data/mining_data.json  Datos de juego (parche 4.9)
```

> Proyecto personal. No afiliado a Cloud Imperium Games ni a Strata. Los datos del juego pertenecen a sus respectivos autores.
