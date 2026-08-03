/* ═══════════════════════════════════════════════════════════
   Contadores · temporizadores de Star Citizen
   Portado desde el proyecto hermano "star-citizen-timers" (mismo
   autor). Lógica sin cambios funcionales: solo la paleta duplicada
   del favicon (FAVICON_TONES) y el fondo del <canvas> se realinearon
   con css/contadores.css al retemar. Todo se ejecuta en el
   navegador; estado en localStorage bajo la clave 'pyro-ops-v1'
   (namespace propio, no colisiona con las claves mineriasc_* del
   resto del sitio).
   ═══════════════════════════════════════════════════════════ */
(() => {
'use strict';

const KEY = 'pyro-ops-v1';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ───────────────────────── Sincronización del Hangar ─────────────────────────
   Valores tomados de la configuración pública de cztimer.com
   (/timer-config.json, que a su vez se alimenta de exec.xyxyll.com).
   `anchor` es un instante real en que el hangar se abrió, así que la fase se
   calcula sola sin que haya que sincronizar nada a mano. */

const CZ = {
  anchor : 1784655458379,   // 2026-07-21T02:57:38.379Z · apertura confirmada
  openMs : 3900093,         // 65,0016 min de fase verde
  closeMs: 7200173,         // 120,0029 min de fase roja
  updatedAt: '2026-07-22',
  url: 'https://cztimer.com/timer-config.json',
};

/* Estado de los 5 pilotos del hangar según el tiempo transcurrido en el ciclo.
   Tramos exactos de cztimer, en segundos: durante la fase verde se van
   APAGANDO uno a uno hasta el cierre, y durante la roja se van encendiendo
   otra vez a medida que se acerca la reapertura.
   1 = verde · 0 = apagado · 2 = rojo */
const LED_BANDS = [
  [    0,   720, [1,1,1,1,1] ],
  [  720,  1440, [1,1,1,1,0] ],
  [ 1440,  2160, [1,1,1,0,0] ],
  [ 2160,  2880, [1,1,0,0,0] ],
  [ 2880,  3600, [1,0,0,0,0] ],
  [ 3600,  3900, [0,0,0,0,0] ],
  [ 3900,  5340, [2,2,2,2,2] ],
  [ 5340,  6780, [1,2,2,2,2] ],
  [ 6780,  8220, [1,1,2,2,2] ],
  [ 8220,  9660, [1,1,1,2,2] ],
  [ 9660, 11100, [1,1,1,1,2] ],
];
const LED_REF_OPEN = 3900, LED_REF_CYCLE = 11100;

/* Los tramos están definidos para el ciclo de 65/120. Si el usuario cambia
   las duraciones, se reescalan para que sigan cuadrando. */
function ledStates(elapsedS, openS, closeS){
  const t = elapsedS < openS
    ? elapsedS / openS * LED_REF_OPEN
    : LED_REF_OPEN + (elapsedS - openS) / closeS * (LED_REF_CYCLE - LED_REF_OPEN);
  const b = LED_BANDS.find(x => t >= x[0] && t < x[1]);
  return b ? b[2] : LED_BANDS[LED_BANDS.length - 1][2];
}

/* ───────────────────────── Catálogo estático ───────────────────────── */

const STATIONS = [
  { id:'checkmate', name:'Checkmate Station', tag:'Zona disputada', items:[
    { id:'cm-b1', name:'Impresora de Tarjeta Azul 1', chip:'blue', short:'CM Azul 1' },
    { id:'cm-b2', name:'Impresora de Tarjeta Azul 2', chip:'blue', short:'CM Azul 2' },
    { id:'cm-b3', name:'Impresora de Tarjeta Azul 3', chip:'blue', short:'CM Azul 3' },
    { id:'cm-b4', name:'Impresora de Tarjeta Azul 4', chip:'blue', short:'CM Azul 4' },
  ]},
  { id:'orbituary', name:'Orbituary Station', tag:'Zona disputada', items:[
    { id:'ob-b1', name:'Impresora de Tarjeta Azul 1', chip:'blue', short:'OB Azul 1' },
    { id:'ob-b2', name:'Impresora de Tarjeta Azul 2', chip:'blue', short:'OB Azul 2' },
  ]},
  { id:'ruin', name:'Ruin Station', tag:'Ghost Arena', items:[
    { id:'ruin-vault', type:'dual', name:'Puerta de Bóveda de Ruin Station', chip:'cyan', short:'Bóveda',
      sub:'Abre 1 min · cerrada 20 min (ciclo repetido)',
      note:'Pulsa «Puerta abierta ahora» en el momento en que la veas abrirse para sincronizar el ciclo.' },
    { id:'ruin-green',  name:'Impresora de Tarjeta Verde (Crypt)',        chip:'green',  short:'Verde Crypt' },
    { id:'ruin-yellow', name:'Impresora de Tarjeta Amarilla (Wasteland)', chip:'yellow', short:'Amarilla' },
    { id:'ruin-last',   name:'Impresora de Tarjeta (Last Resort)',        chip:'grey',   short:'Last Resort' },
  ]},
  { id:'supervisor', name:'Supervisor Outposts', tag:'Tarjetas rojas', items:[
    { id:'sv-r1', name:'Impresora de Tarjeta Roja (Pyro 3 L4)', chip:'red', short:'Roja L4' },
    { id:'sv-r2', name:'Impresora de Tarjeta Roja (Pyro 3 L5)', chip:'red', short:'Roja L5' },
  ]},
  { id:'align', name:'Align & Mine', tag:'Cueva de Carinite', items:[
    { id:'carinite', name:'Carinite Mine Hole', chip:'cyan', defMin:120, short:'Carinite',
      subVerb:'Ventana de colapso de', startLabel:'Se ha abierto',
      idleLabel:'Sin iniciar', runLabel:'Ventana activa', doneLabel:'¡Colapsa!',
      note:'El temporizador es manual: arráncalo cuando se abra la cueva.' },
  ]},
];

const BOARDS = [
  'Checkmate · Zona del hangar',
  'Checkmate · Sala de servidores',
  'Checkmate · Tras la puerta roja',
  'Orbituary · Bahía de almacenaje',
  'Ruin Station · Crypt',
  'Ruin Station · Bóveda (puerta con temporizador)',
  'Orbituary · Tras los fusibles / puertas azules',
];

const GUIDE = [
  { h:'Ciclo del Hangar Ejecutivo', li:[
    'Ciclo total: <b>185 min</b> (3 h 5 min)',
    'Fase verde: <b>~65 min</b> — abierto, ¡inserta los tableros!',
    'Fase roja: <b>~120 min</b> — cerrado, no insertes nada',
    'Sincronizado globalmente en todos los servidores',
    'Los 5 pilotos se <b>apagan</b> uno a uno hacia el cierre y se reencienden en rojo antes de reabrir',
  ]},
  { h:'Tipos de tarjeta', li:[
    '<b>Roja</b>: de los Supervisor Outposts',
    '<b>Azul</b>: impresoras con enfriamiento de 30 min',
    '<b>Verde / Amarilla</b>: específicas de Ruin Station',
    'Todas las impresoras se enfrían <b>30 min</b> tras usarse',
  ]},
  { h:'Puerta con temporizador', li:[
    'Ubicación: bóveda de Ruin Station',
    'Abierta <b>1 min</b> · cerrada <b>20 min</b>',
    'Se repite automáticamente',
    'Sincroniza con «Puerta abierta ahora»',
  ]},
  { h:'Ciclo de loot', li:[
    'Reaparición aproximada cada <b>60 min</b>',
    'Puede variar por parche y por servidor',
    'Sincroniza al ver el loot reaparecer',
    'Crea una zona por cada punto que patrulles',
  ]},
  { h:'Consejos y estrategia', li:[
    'Mantén el reloj del sistema auto-sincronizado',
    'Marca los Compboards según los recojas',
    'Arranca los contadores nada más usar una impresora',
    'Planifica la ruta según la disponibilidad',
    'Se necesitan los <b>7 tableros</b> para el hangar',
  ]},
];

/* Catálogo de pestañas/secciones conmutables. `HANGAR_ID` se referencia (no
   se repite el literal 'hangar') porque ese id ya se usa como clave de HUD/
   watch() del panel del hangar más abajo: el gate comprueba unicidad de todo
   literal `id:'...'` del archivo, y dos definiciones textuales del mismo id
   —aunque sean de catálogos distintos— se leerían como una colisión real. */
const HANGAR_ID = 'hangar';
const VIEWS = [
  { id:'inicio', label:'Inicio' },
  { id:HANGAR_ID, label:'Hangar' },
  { id:'loot',   label:'Loot' },
  { id:'zonas',  label:'Zonas' },
  { id:'custom', label:'Propios' },
  { id:'boards', label:'Compboards' },
  { id:'guia',   label:'Guía' },
];

/* ───────────────────────── Estado ───────────────────────── */

const DEFAULTS = () => ({
  cfg: {
    hangarCycle: (CZ.openMs + CZ.closeMs) / 60000,   // 185,0044 min
    hangarGreen: CZ.openMs / 60000,                  //  65,0016 min
    printerMin: 30, lootMin: 60,
    vaultOpen: 1, vaultClosed: 20,
    sound: true, notify: false, alerts: false, lead: 60, volume: .5,
  },
  hangarAnchor: CZ.anchor,     // ms en que empezó la fase verde
  timers: {},                  // id -> { start, dur }  (dur en segundos, opcional)
  cycles: {},                  // id -> anchor ms (bóveda, loot, ciclos propios)
  loot: [{ id:'loot-global', name:'Ciclo global de loot', min:60 }],
  custom: [],
  boards: BOARDS.map(() => false),
  views: [],                   // array disperso [{id,name?,hidden?}]; ver viewList()
});

let S = load();

function load(){
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || typeof raw !== 'object') return DEFAULTS();
    const d = DEFAULTS();
    return {
      cfg:   Object.assign(d.cfg, raw.cfg || {}),
      hangarAnchor: 'hangarAnchor' in raw ? raw.hangarAnchor : d.hangarAnchor,
      timers: raw.timers || {},
      cycles: raw.cycles || {},
      loot:   Array.isArray(raw.loot)   && raw.loot.length ? raw.loot : d.loot,
      custom: Array.isArray(raw.custom) ? raw.custom : [],
      boards: Array.isArray(raw.boards) && raw.boards.length === BOARDS.length ? raw.boards : d.boards,
      views:  Array.isArray(raw.views) ? raw.views : d.views,
    };
  } catch { return DEFAULTS(); }
}
/* `lastRaw` guarda lo último que escribimos nosotros. Si lo que hay en
   localStorage no coincide, otra pestaña ha tocado el estado y hay que
   recargarlo antes de seguir: si no, el próximo save() pisaría sus cambios. */
let lastRaw = null;
function save(){
  try { lastRaw = JSON.stringify(S); localStorage.setItem(KEY, lastRaw); } catch {}
}
function pullExternal(){
  let cur;
  try { cur = localStorage.getItem(KEY); } catch { return false; }
  if (lastRaw === null){ lastRaw = cur; return false; }
  if (cur === lastRaw) return false;
  lastRaw = cur;
  S = load();
  return true;
}

/* ───────────────────────── Utilidades ───────────────────────── */

const now = () => Date.now();
const clamp = (n,a,b) => Math.min(b, Math.max(a, n));
const uid = p => p + '-' + Math.random().toString(36).slice(2,8);

function fmt(sec){
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  const pad = n => String(n).padStart(2,'0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function hhmm(ms){
  return new Date(ms).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
}
/* El ciclo oficial son 185,0044 min. Se muestra redondeado para que los campos
   queden legibles, pero sólo se sobrescribe si el usuario cambia el valor. */
const round2 = v => +(+v).toFixed(2);

function minsLabel(sec){
  const m = sec/60;
  return (Number.isInteger(m) ? m : m.toFixed(1)) + ' min';
}

/* duración efectiva de un temporizador de cuenta atrás, en segundos */
function durOf(item){
  const saved = S.timers[item.id]?.dur;
  if (typeof saved === 'number' && saved > 0) return saved;
  return (item.defMin ?? S.cfg.printerMin) * 60;
}
/* duración de un ciclo de loot, en segundos */
const lootDur = z => (z.min ?? S.cfg.lootMin) * 60;

/* ───────────────────────── Sonido y avisos ───────────────────────── */

let audioCtx = null;
function beep(pattern = [880, 1180]){
  if (!S.cfg.sound || !S.cfg.alerts) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    pattern.forEach((f, i) => {
      const t = audioCtx.currentTime + i * .18;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(S.cfg.volume * .25, t + .01);
      g.gain.exponentialRampToValueAtTime(.0001, t + .16);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + .18);
    });
  } catch {}
}

function toast(title, msg, ok){
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' toast--ok' : '');
  el.innerHTML = `<b></b><span></span>`;
  el.firstChild.textContent = title;
  el.lastChild.textContent = msg || '';
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

function alertUser(title, msg, ok){
  toast(title, msg, ok);
  beep(ok ? [660, 990, 1320] : [880, 660]);
  if (S.cfg.notify && S.cfg.alerts && 'Notification' in window && Notification.permission === 'granted'){
    try { new Notification(title, { body: msg, tag: title, silent: true }); } catch {}
  }
}

/* memoria del último estado para detectar cruces de umbral */
const seen = new Map();
function watch(key, remaining, label, kind){
  const prev = seen.get(key);
  seen.set(key, remaining);
  if (prev == null || !S.cfg.alerts) return;
  const lead = S.cfg.lead;
  if (lead > 0 && prev > lead && remaining <= lead)
    alertUser(label, `Quedan ${fmt(lead)} · ${kind}`);
  if (prev > 0 && remaining <= 0)
    alertUser(label, kind, true);
}

/* ───────────────────────── HUD de contadores activos ─────────────────────────
   Sólo aparecen los contadores que el usuario ha arrancado o sincronizado a
   mano. El color va del verde al rojo según lo que quede, para leerlo de un
   vistazo sin tener que fijarse en la cifra. */

let hudItems = [];
const hudPush = o => hudItems.push(o);

function pillTone(rem, dur){
  if (rem <= 0) return 'done';
  const f = dur > 0 ? rem / dur : 1;
  if (rem <= 60 || f <= .05) return 'hot';   // inminente
  if (f <= .2)  return 'warn';               // queda poco
  if (f <= .5)  return 'mid';                // va por la mitad
  return 'calm';                             // tranquilo
}

const hudRefs = new Map();

function renderHud(){
  const list = $('#hudList');
  $('#hud').hidden = hudItems.length === 0;

  const alive = new Set(hudItems.map(i => i.id));
  for (const [k, r] of hudRefs){
    if (!alive.has(k)){ r.el.remove(); hudRefs.delete(k); }
  }

  hudItems.forEach((it, idx) => {
    let r = hudRefs.get(it.id);
    if (!r){
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pill';
      el.innerHTML = `<span class="pill__n"></span><span class="pill__t"></span><i class="pill__bar"><b></b></i>`;
      r = { el, n:$('.pill__n',el), t:$('.pill__t',el), b:$('.pill__bar b',el) };
      el.onclick = () => focusCard(r.target, r.view);
      hudRefs.set(it.id, r);
    }
    r.target = it.target;
    r.view = it.view;
    if (list.children[idx] !== r.el) list.insertBefore(r.el, list.children[idx] || null);

    if (r.n.textContent !== it.name) r.n.textContent = it.name;
    const txt = it.rem <= 0 ? (it.doneText || 'LISTO') : fmt(it.rem);
    if (r.t.textContent !== txt) r.t.textContent = txt;
    const cls = 'pill p-' + pillTone(it.rem, it.dur);
    if (r.el.className !== cls) r.el.className = cls;
    r.el.title = it.title || it.name;
    r.b.style.width = (it.dur > 0 ? clamp(it.rem / it.dur * 100, 0, 100) : 0).toFixed(1) + '%';
  });
}

/* ───────────────────────── Título y favicon dinámicos ─────────────────────────
   Ambos reflejan el temporizador más relevante de la PESTAÑA ACTIVA, no
   siempre el hangar: se recalculan en el mismo tick() que el HUD, a partir de
   los mismos hudItems (ya ordenados por rem ascendente en tick()) más el
   estado del hangar que ya calculó updateHangar(). Sólo se repinta el título
   o el favicon cuando su texto/tono cambia, para no tocarlos a cada tick. */

/* Mismos tonos que .pill.p-* en css/contadores.css (variables --ok/--info/--warn/
   --accent), más 'off' (var(--dim)) para cuando la sección activa no tiene
   nada corriendo. Se duplican aquí como literales porque el favicon se pinta
   en <canvas>, sin acceso a la cascada CSS; el gate comprueba que sigan
   coincidiendo con contadores.css si alguien retoca la paleta allí. */
const FAVICON_TONES = {
  calm: '#4cd97b',  // --ok
  mid:  '#4fd8d0',  // --info (restyle "terminal": azul -> cian, ver css/contadores.css)
  warn: '#fcbb00',  // --warn
  hot:  '#d81f2b',  // --accent
  done: '#4cd97b',  // --ok (igual que .pill.p-done)
  off:  '#6b5754',  // --dim (restyle "terminal": ver css/contadores.css)
};

let faviconCanvas = null, faviconCtx = null, faviconLink = null;
let lastTitle = null, lastFaviconTone = null;

/* Repinta el <link rel="icon"> ya presente en contadores.html (no se crea uno
   nuevo: se reutiliza y actualiza su href). Un punto de color sobre el mismo
   fondo que el favicon estático original. */
function paintFavicon(tone){
  faviconLink ||= $('link[rel="icon"]');
  if (!faviconLink) return;
  if (!faviconCtx){
    faviconCanvas = document.createElement('canvas');
    faviconCanvas.width = faviconCanvas.height = 32;
    faviconCtx = faviconCanvas.getContext('2d');
  }
  const c = faviconCtx;
  c.clearRect(0, 0, 32, 32);
  c.fillStyle = '#0a0a0a';           // --bg, mismo fondo que el favicon estático
  c.fillRect(0, 0, 32, 32);
  c.beginPath();
  c.arc(16, 16, 9, 0, Math.PI * 2);
  c.fillStyle = FAVICON_TONES[tone] || FAVICON_TONES.off;
  c.fill();
  faviconLink.href = faviconCanvas.toDataURL('image/png');
}

/* Elige el temporizador que titula la pestaña según la vista activa:
   1) el de esa misma vista en curso más próximo a terminar (hudItems ya
      viene ordenado por rem ascendente en tick(), así que basta el primero
      con rem > 0);
   2) si ninguno está en curso, el "valor de la sección" -aunque esté listo o
      vencido- para no perder de vista que hay algo pendiente ahí;
   3) si la vista no empuja ningún hudItem propio (inicio/hangar/compboards/
      guía, o zonas/loot/propios sin nada sincronizado), el hangar como
      último recurso;
   4) si ni el hangar está sincronizado, no hay nada que mostrar. */
function pickTitleTimer(viewId, hangar){
  const own = hudItems.filter(it => it.view === viewId);
  if (own.length) return own.find(it => it.rem > 0) || own[0];
  if (hangar.phase) return { rem: hangar.rem, dur: hangar.dur };
  return null;
}

function updateTitleAndFavicon(hangar){
  const id = currentView();
  const meta = viewList().find(v => v.id === id);
  const label = (meta ? meta.label : id).toUpperCase();
  const pick = pickTitleTimer(id, hangar);
  const tone = pick ? pillTone(pick.rem, pick.dur) : 'off';
  const timeText = pick ? (pick.rem <= 0 ? (pick.doneText || 'LISTO') : fmt(pick.rem)) : null;
  const title = timeText ? `${timeText} · ${label}` : 'Contadores · Star Citizen';

  if (title !== lastTitle){ document.title = title; lastTitle = title; }
  if (tone !== lastFaviconTone){ paintFavicon(tone); lastFaviconTone = tone; }
}

/* Si el elemento vive en una vista oculta, hay que conmutar primero: un
   elemento recién desocultado no tiene layout todavía en el mismo turno, así
   que el scroll se hace un frame después (requestAnimationFrame), no antes. */
function focusCard(el, view){
  if (!el) return;
  if (view) setView(view);
  requestAnimationFrame(() => {
    el.scrollIntoView({ block:'center', behavior:'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;          // reinicia la animación
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2600);
  });
}

/* ───────────────────────── Construcción del DOM ───────────────────────── */

const refs = { timers:{}, loot:{}, custom:{}, boards:[] };

/* Cambia sólo las clases de estado. Asignar `className` entero borraría las
   que añaden otros sitios, como el resalte `flash` del HUD. */
function setState(el, state){
  el.classList.remove('is-running','is-ready','is-open');
  if (state) el.classList.add(state);
}

const ICON_EDIT = `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_DEL  = `<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`;

/* ---- tarjeta genérica de cuenta atrás (impresoras, Carinite, propias) ---- */
function cardCooldown(item){
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="card__top">
      <div>
        <div class="card__name">${item.chip ? `<span class="chip chip--${item.chip}"></span>` : ''}${item.name}</div>
        <div class="card__sub" data-sub></div>
      </div>
      <button class="card__edit" type="button" title="Personalizar duración">${ICON_EDIT}</button>
    </div>
    <div class="card__mid">
      <div class="card__time" data-time>--:--</div>
      <div class="card__state" data-state></div>
    </div>
    <div class="card__mini"><i data-mini></i></div>
    <div class="card__act">
      <button class="btn btn--primary btn--sm" data-start>${item.startLabel || 'Iniciar'}</button>
      <button class="btn btn--ghost btn--sm" data-reset hidden>Listo</button>
    </div>
    ${item.note ? `<div class="card__note">${item.note}</div>` : ''}`;

  const r = {
    el, time: $('[data-time]',el), state: $('[data-state]',el),
    mini: $('[data-mini]',el), sub: $('[data-sub]',el),
    start: $('[data-start]',el), reset: $('[data-reset]',el), item,
  };
  r.start.onclick = () => { S.timers[item.id] = { ...(S.timers[item.id]||{}), start: now() }; save(); tick(); };
  r.reset.onclick = () => { if (S.timers[item.id]) S.timers[item.id].start = null; save(); tick(); };
  $('.card__edit',el).onclick = () => editCooldown(item);
  refs.timers[item.id] = r;
  return el;
}

function updateCooldown(r){
  const { item } = r;
  const dur = durOf(item);
  const st  = S.timers[item.id]?.start ?? null;
  r.sub.textContent = `${item.subVerb || 'Enfriamiento de'} ${minsLabel(dur)}`;

  if (!st){
    r.time.textContent = fmt(dur);
    r.time.className = 'card__time card__time--ready';
    r.state.textContent = item.idleLabel || 'Listo';
    r.state.className = 'card__state s-ready';
    r.mini.style.width = '100%'; r.mini.className = 'ok';
    setState(r.el, 'is-ready');
    r.start.hidden = false; r.start.textContent = item.startLabel || 'Iniciar';
    r.reset.hidden = true;
    seen.delete(item.id);
    return { running:false, rem:0 };
  }
  const rem = dur - (now() - st)/1000;
  watch(item.id, rem, item.name, 'Temporizador completado');
  hudPush({ id:item.id, name:item.short || item.name, rem, dur, target:r.el, view:'zonas',
            title:item.name, doneText:item.doneLabel || 'LISTO' });

  if (rem <= 0){
    r.time.textContent = fmt(0);
    r.time.className = 'card__time card__time--ready';
    r.state.textContent = item.doneLabel || '¡Listo!';
    r.state.className = 'card__state s-ready';
    r.mini.style.width = '100%'; r.mini.className = 'ok';
    setState(r.el, 'is-ready');
    r.start.hidden = false; r.start.textContent = 'Reiniciar';
    r.reset.hidden = false; r.reset.textContent = 'Limpiar';
    return { running:false, rem:0 };
  }
  r.time.textContent = fmt(rem);
  r.time.className = 'card__time card__time--run';
  r.state.textContent = item.runLabel || 'En enfriamiento';
  r.state.className = 'card__state s-run';
  r.mini.style.width = (100 - rem/dur*100).toFixed(1) + '%';
  r.mini.className = '';
  setState(r.el, 'is-running');
  r.start.hidden = false; r.start.textContent = 'Reiniciar';
  r.reset.hidden = false; r.reset.textContent = 'Listo';
  return { running:true, rem };
}

/* ---- tarjeta de ciclo doble (bóveda: abierta / cerrada) ---- */
function cardDual(item){
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="card__top">
      <div>
        <div class="card__name">${item.chip ? `<span class="chip chip--${item.chip}"></span>` : ''}${item.name}</div>
        <div class="card__sub" data-sub></div>
      </div>
      <button class="card__edit" type="button" title="Personalizar ciclo">${ICON_EDIT}</button>
    </div>
    <div class="card__mid">
      <div class="card__time" data-time>--:--</div>
      <div class="card__state" data-state></div>
    </div>
    <div class="card__mini"><i data-mini></i></div>
    <div class="card__act">
      <button class="btn btn--primary btn--sm" data-sync>Puerta abierta ahora</button>
      <button class="btn btn--ghost btn--sm" data-clear>Reset</button>
    </div>
    <div class="card__note" data-note>${item.note || ''}</div>`;

  const r = { el, time:$('[data-time]',el), state:$('[data-state]',el), mini:$('[data-mini]',el),
              sub:$('[data-sub]',el), note:$('[data-note]',el), item };
  $('[data-sync]',el).onclick  = () => { S.cycles[item.id] = now(); save(); tick(); };
  $('[data-clear]',el).onclick = () => { delete S.cycles[item.id]; save(); tick(); };
  $('.card__edit',el).onclick  = () => editVault();
  refs.timers[item.id] = r;
  return el;
}

function updateDual(r){
  const { item } = r;
  const openS = S.cfg.vaultOpen * 60, closedS = S.cfg.vaultClosed * 60;
  const cycle = openS + closedS;
  r.sub.textContent = `Abierta ${minsLabel(openS)} · cerrada ${minsLabel(closedS)}`;
  const anchor = S.cycles[item.id];

  if (!anchor){
    r.time.textContent = '--:--';
    r.time.className = 'card__time card__time--idle';
    r.state.textContent = 'Sin sincronizar';
    r.state.className = 'card__state';
    r.mini.style.width = '0%';
    setState(r.el);
    r.note.textContent = item.note;
    seen.delete(item.id);
    return;
  }
  const e = ((now() - anchor)/1000 % cycle + cycle) % cycle;
  const open = e < openS;
  const rem  = open ? openS - e : cycle - e;
  watch(item.id, rem, item.name, open ? 'La puerta se cierra' : '¡La puerta se abre!');
  hudPush({ id:item.id, name:(item.short || item.name) + (open ? ' ·ABIERTA' : ''),
            rem, dur: open ? openS : closedS, target:r.el, view:'zonas',
            title:`${item.name} — ${open ? 'abierta' : 'cerrada'}` });

  r.time.textContent = fmt(rem);
  r.time.className = 'card__time ' + (open ? 'card__time--open' : 'card__time--run');
  r.state.textContent = open ? 'Abierta' : 'Cerrada';
  r.state.className = 'card__state ' + (open ? 's-open' : 's-closed');
  r.mini.style.width = (e/cycle*100).toFixed(1) + '%';
  r.mini.className = open ? 'ok' : 'hot';
  setState(r.el, open ? 'is-open' : 'is-running');
  r.note.textContent = open
    ? `Se cierra a las ${hhmm(now() + rem*1000)}`
    : `Próxima apertura a las ${hhmm(now() + rem*1000)}`;
}

/* ---- tarjeta de ciclo de loot ---- */
function cardLoot(zone){
  const el = document.createElement('div');
  el.className = 'card card--loot';
  el.innerHTML = `
    <div class="card__top">
      <div>
        <div class="card__name"><span class="chip chip--yellow"></span><span data-name></span></div>
        <div class="card__sub" data-sub></div>
      </div>
      <div style="display:flex;gap:2px">
        <button class="card__edit" type="button" data-edit title="Personalizar">${ICON_EDIT}</button>
        <button class="card__edit" type="button" data-del title="Eliminar zona">${ICON_DEL}</button>
      </div>
    </div>
    <div class="card__mid">
      <div class="card__time" data-time>--:--</div>
      <div class="card__state" data-state></div>
    </div>
    <div class="card__mini"><i data-mini></i></div>
    <div class="card__rowmeta"><span data-last>—</span><span data-next>—</span></div>
    <div class="card__act">
      <button class="btn btn--primary btn--sm" data-sync>Reapareció ahora</button>
      <button class="btn btn--ghost btn--sm" data-clear>Reset</button>
    </div>`;

  const r = { el, name:$('[data-name]',el), time:$('[data-time]',el), state:$('[data-state]',el),
              mini:$('[data-mini]',el), sub:$('[data-sub]',el),
              last:$('[data-last]',el), next:$('[data-next]',el), zone };
  $('[data-sync]',el).onclick  = () => { S.cycles[zone.id] = now(); save(); tick(); };
  $('[data-clear]',el).onclick = () => { delete S.cycles[zone.id]; save(); tick(); };
  $('[data-edit]',el).onclick  = () => editLoot(zone);
  $('[data-del]',el).onclick   = () => {
    if (S.loot.length === 1) return toast('No se puede', 'Debe quedar al menos una zona de loot.');
    if (!confirm(`¿Eliminar la zona «${zone.name}»?`)) return;
    S.loot = S.loot.filter(z => z.id !== zone.id);
    delete S.cycles[zone.id];
    save(); buildLoot(); tick();
  };
  refs.loot[zone.id] = r;
  return el;
}

function updateLoot(r){
  const z = S.loot.find(x => x.id === r.zone.id);
  if (!z) return;
  r.zone = z;
  const dur = lootDur(z);
  r.name.textContent = z.name;
  r.sub.textContent  = `Ciclo de ${minsLabel(dur)}`;
  const anchor = S.cycles[z.id];

  if (!anchor){
    r.time.textContent = fmt(dur);
    r.time.className = 'card__time card__time--idle';
    r.state.textContent = 'Sin sincronizar';
    r.state.className = 'card__state';
    r.mini.style.width = '0%';
    r.last.textContent = 'Último: —';
    r.next.textContent = 'Próximo: —';
    setState(r.el);
    seen.delete(z.id);
    return;
  }
  const e   = ((now() - anchor)/1000 % dur + dur) % dur;
  const rem = dur - e;
  const cyclesDone = Math.floor((now() - anchor)/1000 / dur);
  watch(z.id, rem, z.name, '¡Loot reaparecido!');
  hudPush({ id:z.id, name:'Loot · ' + z.name, rem, dur, target:r.el, view:'loot',
            title:`Loot — ${z.name}` });

  r.time.textContent = fmt(rem);
  r.time.className = 'card__time ' + (rem <= 60 ? 'card__time--open' : '');
  r.state.textContent = rem <= 60 ? 'Inminente' : 'En curso';
  r.state.className = 'card__state ' + (rem <= 60 ? 's-open' : 's-run');
  r.mini.style.width = (e/dur*100).toFixed(1) + '%';
  r.last.textContent = `Último: ${hhmm(anchor + cyclesDone*dur*1000)}`;
  r.next.textContent = `Próximo: ${hhmm(now() + rem*1000)}`;
  setState(r.el, 'is-running');
}

/* ---- tarjeta personalizada ---- */
function cardCustom(t){
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="card__top">
      <div>
        <div class="card__name"><span class="chip chip--red"></span><span data-name></span></div>
        <div class="card__sub" data-sub></div>
      </div>
      <div style="display:flex;gap:2px">
        <button class="card__edit" type="button" data-edit title="Editar">${ICON_EDIT}</button>
        <button class="card__edit" type="button" data-del title="Eliminar">${ICON_DEL}</button>
      </div>
    </div>
    <div class="card__mid">
      <div class="card__time" data-time>--:--</div>
      <div class="card__state" data-state></div>
    </div>
    <div class="card__mini"><i data-mini></i></div>
    <div class="card__act">
      <button class="btn btn--primary btn--sm" data-start>Iniciar</button>
      <button class="btn btn--ghost btn--sm" data-clear>Reset</button>
    </div>`;

  const r = { el, name:$('[data-name]',el), time:$('[data-time]',el), state:$('[data-state]',el),
              mini:$('[data-mini]',el), sub:$('[data-sub]',el), t };
  $('[data-start]',el).onclick = () => {
    if (t.repeat) S.cycles[t.id] = now();
    else S.timers[t.id] = { ...(S.timers[t.id]||{}), start: now() };
    save(); tick();
  };
  $('[data-clear]',el).onclick = () => {
    delete S.cycles[t.id];
    if (S.timers[t.id]) S.timers[t.id].start = null;
    save(); tick();
  };
  $('[data-edit]',el).onclick = () => editCustom(t);
  $('[data-del]',el).onclick  = () => {
    if (!confirm(`¿Eliminar «${t.name}»?`)) return;
    S.custom = S.custom.filter(x => x.id !== t.id);
    delete S.cycles[t.id]; delete S.timers[t.id];
    save(); buildCustom(); tick();
  };
  refs.custom[t.id] = r;
  return el;
}

function updateCustom(r){
  const t = S.custom.find(x => x.id === r.t.id);
  if (!t) return;
  r.t = t;
  const dur = t.min * 60;
  r.name.textContent = t.name;
  r.sub.textContent  = (t.repeat ? 'Ciclo repetido de ' : 'Cuenta atrás de ') + minsLabel(dur);

  if (t.repeat){
    const anchor = S.cycles[t.id];
    if (!anchor){
      r.time.textContent = fmt(dur);
      r.time.className = 'card__time card__time--idle';
      r.state.textContent = 'Sin sincronizar';
      r.state.className = 'card__state';
      r.mini.style.width = '0%'; setState(r.el);
      seen.delete(t.id); return;
    }
    const e = ((now() - anchor)/1000 % dur + dur) % dur, rem = dur - e;
    watch(t.id, rem, t.name, '¡Ciclo reiniciado!');
    hudPush({ id:t.id, name:t.name, rem, dur, target:r.el, view:'custom' });
    r.time.textContent = fmt(rem);
    r.time.className = 'card__time card__time--run';
    r.state.textContent = 'En curso';
    r.state.className = 'card__state s-run';
    r.mini.style.width = (e/dur*100).toFixed(1) + '%';
    setState(r.el, 'is-running');
    return;
  }
  const st = S.timers[t.id]?.start ?? null;
  if (!st){
    r.time.textContent = fmt(dur);
    r.time.className = 'card__time card__time--idle';
    r.state.textContent = 'Parado';
    r.state.className = 'card__state';
    r.mini.style.width = '0%'; setState(r.el);
    seen.delete(t.id); return;
  }
  const rem = dur - (now() - st)/1000;
  watch(t.id, rem, t.name, 'Temporizador completado');
  hudPush({ id:t.id, name:t.name, rem, dur, target:r.el, view:'custom' });
  if (rem <= 0){
    r.time.textContent = fmt(0);
    r.time.className = 'card__time card__time--ready';
    r.state.textContent = '¡Listo!';
    r.state.className = 'card__state s-ready';
    r.mini.style.width = '100%'; r.mini.className = 'ok';
    setState(r.el, 'is-ready');
    return;
  }
  r.time.textContent = fmt(rem);
  r.time.className = 'card__time card__time--run';
  r.state.textContent = 'En curso';
  r.state.className = 'card__state s-run';
  r.mini.style.width = (100 - rem/dur*100).toFixed(1) + '%';
  r.mini.className = '';
  setState(r.el, 'is-running');
}

/* ───────────────────────── Montaje de secciones ───────────────────────── */

function buildStations(){
  const host = $('#stations'); host.innerHTML = '';
  for (const st of STATIONS){
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<div class="group__head">
        <div class="group__name">${st.name}</div>
        <div class="group__rule"></div>
        <div class="group__tag">${st.tag}</div>
      </div><div class="cards"></div>`;
    const grid = $('.cards', g);
    st.items.forEach(it => grid.appendChild(it.type === 'dual' ? cardDual(it) : cardCooldown(it)));
    host.appendChild(g);
  }
}

function buildLoot(){
  const host = $('#lootGrid'); host.innerHTML = ''; refs.loot = {};
  S.loot.forEach(z => host.appendChild(cardLoot(z)));
}

function buildCustom(){
  const host = $('#customGrid'); host.innerHTML = ''; refs.custom = {};
  S.custom.forEach(t => host.appendChild(cardCustom(t)));
  $('#customEmpty').hidden = S.custom.length > 0;
}

function buildBoards(){
  const host = $('#boardsGrid'); host.innerHTML = ''; refs.boards = [];
  BOARDS.forEach((name, i) => {
    const [place, spot] = name.split(' · ');
    const el = document.createElement('div');
    el.className = 'card board';
    el.innerHTML = `
      <div class="board__head">
        <div class="board__idx">${i+1}</div>
        <div>
          <div class="card__name">Tablero ${i+1}</div>
          <div class="card__sub">${place} · ${spot}</div>
        </div>
      </div>
      <div class="card__act">
        <button class="btn btn--sm" data-toggle></button>
      </div>`;
    const btn = $('[data-toggle]', el);
    btn.onclick = () => { S.boards[i] = !S.boards[i]; save(); renderBoards(); };
    refs.boards.push({ el, btn });
    host.appendChild(el);
  });
  renderBoards();
}

function renderBoards(){
  const n = S.boards.filter(Boolean).length;
  $('#boardsCount').textContent = n;
  $('#boardsProgress').style.width = (n/BOARDS.length*100) + '%';
  refs.boards.forEach((r, i) => {
    const done = S.boards[i];
    r.el.classList.toggle('done', done);
    r.btn.textContent = done ? 'Recogido ✓' : 'Marcar como recogido';
    r.btn.className = 'btn btn--sm ' + (done ? 'btn--ok' : 'btn--ghost');
  });
}

function buildGuide(){
  const host = $('#guideGrid'); host.innerHTML = '';
  GUIDE.forEach(g => {
    const el = document.createElement('div');
    el.className = 'guide';
    el.innerHTML = `<h4>${g.h}</h4><ul>${g.li.map(x => `<li><span>${x}</span></li>`).join('')}</ul>`;
    host.appendChild(el);
  });
}

/* ───────────────────────── Hangar Ejecutivo ───────────────────────── */

function buildLeds(){
  const host = $('#hangarLeds'); host.innerHTML = '';
  for (let i = 1; i <= 5; i++){
    const d = document.createElement('div');
    d.className = 'led';
    d.innerHTML = `<div class="led__b"></div><div class="led__l">LED ${i}</div><div class="led__s">—</div>`;
    host.appendChild(d);
  }
}

function hangarNote(){
  const el = $('#hangarNote');
  if (S.hangarAnchor == null){
    el.innerHTML = '<b>Sin sincronizar:</b> pulsa «Se abre ahora» en el instante exacto en que veas abrirse el hangar, o «Volver al ciclo oficial».';
  } else if (S.hangarAnchor === CZ.anchor){
    el.innerHTML = `<b>Sincronizado con el ciclo global</b> (ancla de cztimer.com, dato del ${CZ.updatedAt}). Si en el juego lo ves desfasado, corrígelo con «Se abre ahora».`;
  } else {
    el.innerHTML = `<b>Ancla propia</b> del ${new Date(S.hangarAnchor).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}. Usa «Volver al ciclo oficial» para descartarla.`;
  }
}

function updateHangar(){
  hangarNote();
  const cycleS = S.cfg.hangarCycle * 60;
  const greenS = clamp(S.cfg.hangarGreen * 60, 1, cycleS - 1);
  const leds   = $$('#hangarLeds .led');

  const badge = $('#phaseBadge'), big = $('#hangarCountdown');

  if (S.hangarAnchor == null){
    badge.className = 'phase phase--none';
    $('#phaseName').textContent = 'Sin sincronizar';
    $('#phaseDesc').textContent = 'Pulsa «Sincronizar» cuando veas el cambio del hangar.';
    $('#phaseNext').textContent = '—';
    $('#countLabel').textContent = 'Tiempo restante';
    big.textContent = '--:--'; big.className = 'bigclock';
    $('#hangarUntil').textContent = `Ciclo configurado: ${S.cfg.hangarCycle} min (${S.cfg.hangarGreen} verde / ${(S.cfg.hangarCycle - S.cfg.hangarGreen).toFixed(0)} rojo)`;
    $('#hangarProgress').style.width = '0%';
    $('#hangarProgressTxt').textContent = '0%';
    leds.forEach(l => { l.className = 'led off'; l.lastChild.textContent = '—'; });
    seen.delete(HANGAR_ID);
    return { phase:null, rem:0, dur:0 };
  }

  const e = ((now() - S.hangarAnchor)/1000 % cycleS + cycleS) % cycleS;
  const green = e < greenS;
  const rem = green ? greenS - e : cycleS - e;
  watch(HANGAR_ID, rem, 'Hangar Ejecutivo', green ? 'El hangar se cierra' : '¡El hangar se abre!');
  // El hangar ya tiene su propia cuenta atrás destacada en el panel (tarjeta
  // roja/verde "ABRE EN" / "CIERRA EN" de #hangarPanel), así que no se
  // duplica como píldora en la fila "ACTIVOS" del HUD: sería redundante.

  badge.className = 'phase ' + (green ? 'phase--green' : 'phase--red');
  $('#phaseName').textContent = green ? 'Fase verde' : 'Fase roja';
  $('#phaseDesc').textContent = green
    ? 'Hangar abierto — inserta los Compboards'
    : 'Hangar cerrado — NO insertes tableros';
  $('#phaseNext').textContent = green ? 'Fase roja' : 'Fase verde';
  $('#countLabel').textContent = green ? 'Tiempo hasta el cierre' : 'Tiempo hasta la apertura';

  big.textContent = fmt(rem);
  big.className = 'bigclock ' + (rem <= 120 ? 'bigclock--warn' : green ? 'bigclock--green' : 'bigclock--red');
  $('#hangarUntil').textContent = green
    ? `Abierto hasta las ${hhmm(now() + rem*1000)}`
    : `Se abre a las ${hhmm(now() + rem*1000)}`;

  const pct = e/cycleS*100;
  $('#hangarProgress').style.width = pct.toFixed(1) + '%';
  $('#hangarProgressTxt').textContent = Math.round(pct) + '%';

  const st = ledStates(e, greenS, cycleS - greenS);
  leds.forEach((l, i) => {
    l.className = 'led ' + ['off','on','red'][st[i]];
    l.lastChild.textContent = ['APAGADO','ACTIVO','ROJO'][st[i]];
  });
  return { phase: green ? 'green' : 'red', rem, dur: green ? greenS : cycleS - greenS };
}

/* Trae el ancla actualizada de cztimer. Es una petición a otro dominio, así
   que sólo se lanza cuando el usuario pulsa el botón, nunca sola. Puede fallar
   por CORS o sin conexión: en ese caso no se toca nada. */
async function fetchCzConfig(){
  const btn = $('#btnFetchCz');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Consultando…';
  try {
    const r = await fetch(CZ.url, { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const c = await r.json();

    // Mismas comprobaciones que hace cztimer antes de fiarse del archivo
    const near = (v, ref) => Number.isFinite(v) && Math.abs(v - ref) < ref * .05;
    if (!near(c.openDuration, 3900000) || !near(c.closeDuration, 7200000) ||
        !Number.isFinite(c.initialOpenTime) ||
        c.initialOpenTime < Date.UTC(2020,0,1) || c.initialOpenTime > now() + 366*864e5)
      throw new Error('datos fuera de rango');

    S.hangarAnchor    = c.initialOpenTime;
    S.cfg.hangarGreen = c.openDuration / 60000;
    S.cfg.hangarCycle = (c.openDuration + c.closeDuration) / 60000;
    save(); tick();
    const d = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('es-ES') : 'hoy';
    toast('Ciclo actualizado', `Ancla oficial del ${d}.`, true);
  } catch (e){
    toast('No se pudo consultar', 'Sin conexión o el sitio no lo permite. Sincroniza a mano con «Se abre ahora».');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

/* ───────────────────────── Bucle principal ───────────────────────── */

function tick(){
  if (pullExternal()) rebuildAll();
  hudItems = [];
  const h = updateHangar();

  let running = 0, ready = 0;
  for (const id in refs.timers){
    const r = refs.timers[id];
    if (r.item.type === 'dual') updateDual(r);
    else { const res = updateCooldown(r); res.running ? running++ : ready++; }
  }
  for (const id in refs.loot)   updateLoot(refs.loot[id]);
  for (const id in refs.custom) updateCustom(refs.custom[id]);

  // Los más urgentes primero, para que no haya que buscarlos en la lista.
  hudItems.sort((a, b) => a.rem - b.rem);
  renderHud();

  // Estadísticas del hero
  const boards = S.boards.filter(Boolean).length;
  const stats = [
    { v: h.phase ? fmt(h.rem) : '--:--', l: h.phase === 'green' ? 'Cierra en' : h.phase === 'red' ? 'Abre en' : 'Hangar', c: h.phase === 'green' ? 'ok' : 'hot' },
    { v: String(ready), l: 'Objetivos listos', c: 'ok' },
    { v: String(running), l: 'En enfriamiento', c: '' },
    { v: `${boards}/7`, l: 'Compboards', c: boards === 7 ? 'ok' : '' },
  ];
  const host = $('#heroStats');
  if (host.children.length !== stats.length){
    host.innerHTML = stats.map(() => `<div class="stat"><b></b><span></span></div>`).join('');
  }
  [...host.children].forEach((el, i) => {
    el.className = 'stat' + (stats[i].c ? ' stat--' + stats[i].c : '');
    el.firstChild.textContent = stats[i].v;
    el.lastChild.textContent  = stats[i].l;
  });

  // Título y favicon de la pestaña, según la vista activa (ver arriba).
  updateTitleAndFavicon(h);
}

/* ───────────────────────── Diálogo de edición genérico ───────────────────────── */

function openEdit({ eyebrow, title, fields, onSave }){
  $('#editEyebrow').textContent = eyebrow;
  $('#editTitle').textContent   = title;
  const body = $('#editBody');
  body.innerHTML = '';
  const inputs = {};

  fields.forEach(f => {
    if (f.type === 'checkbox'){
      const l = document.createElement('label');
      l.className = 'chk';
      l.innerHTML = `<input type="checkbox"><span>${f.label}</span>`;
      l.firstChild.checked = !!f.value;
      inputs[f.key] = l.firstChild;
      body.appendChild(l);
    } else {
      const l = document.createElement('label');
      l.className = 'fld';
      l.innerHTML = `<span>${f.label}</span><input type="${f.type||'number'}">`;
      const inp = l.lastChild;
      if (f.type === 'text'){ inp.value = f.value; inp.maxLength = 48; inp.required = true; }
      else { inp.value = f.value; inp.min = f.min ?? .1; inp.max = f.max ?? 1440; inp.step = f.step ?? .1; inp.required = true; }
      inputs[f.key] = inp;
      body.appendChild(l);
    }
    if (f.hint){
      const p = document.createElement('p');
      p.className = 'hint'; p.innerHTML = f.hint;
      body.appendChild(p);
    }
  });

  const dlg = $('#dlgEdit');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const out = {};
    for (const k in inputs){
      const i = inputs[k];
      out[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? parseFloat(i.value) : i.value.trim();
    }
    onSave(out);
    save(); tick();
  };
}

function editCooldown(item){
  openEdit({
    eyebrow:'Personalizar temporizador', title:item.name,
    fields:[{ key:'min', label:'Duración (minutos)', value:(durOf(item)/60),
      hint:'Valor por defecto: <b>' + (item.defMin ?? S.cfg.printerMin) + ' min</b>. Escríbelo de nuevo para volver a él.' }],
    onSave:v => {
      if (!(v.min > 0)) return;
      S.timers[item.id] = { ...(S.timers[item.id]||{}), dur: v.min * 60 };
    },
  });
}

function editVault(){
  openEdit({
    eyebrow:'Personalizar ciclo', title:'Puerta de bóveda',
    fields:[
      { key:'open',   label:'Abierta (minutos)', value:S.cfg.vaultOpen,   max:600 },
      { key:'closed', label:'Cerrada (minutos)', value:S.cfg.vaultClosed, max:600 },
    ],
    onSave:v => {
      if (v.open > 0)   S.cfg.vaultOpen   = v.open;
      if (v.closed > 0) S.cfg.vaultClosed = v.closed;
    },
  });
}

function editLoot(zone){
  openEdit({
    eyebrow:'Zona de loot', title:zone.name,
    fields:[
      { key:'name', label:'Nombre', type:'text', value:zone.name },
      { key:'min',  label:'Ciclo (minutos)', value:lootDur(zone)/60,
        hint:'El ciclo de spawn del loot ronda los <b>60 minutos</b>, pero varía. Ajústalo según lo que observes.' },
    ],
    onSave:v => {
      const z = S.loot.find(x => x.id === zone.id); if (!z) return;
      if (v.name) z.name = v.name;
      if (v.min > 0) z.min = v.min;
      buildLoot();
    },
  });
}

function editCustom(t){
  openEdit({
    eyebrow:'Temporizador propio', title:t.name,
    fields:[
      { key:'name',   label:'Nombre', type:'text', value:t.name },
      { key:'min',    label:'Duración (minutos)', value:t.min },
      { key:'repeat', label:'Ciclo repetido (se reinicia solo)', type:'checkbox', value:t.repeat },
    ],
    onSave:v => {
      const x = S.custom.find(c => c.id === t.id); if (!x) return;
      if (v.name) x.name = v.name;
      if (v.min > 0) x.min = v.min;
      x.repeat = v.repeat;
      buildCustom();
    },
  });
}

function editHangar(){
  openEdit({
    eyebrow:'Personalizar ciclo', title:'Hangar Ejecutivo',
    fields:[
      { key:'cycle', label:'Ciclo completo (minutos)', value:round2(S.cfg.hangarCycle) },
      { key:'green', label:'Fase verde / abierto (minutos)', value:round2(S.cfg.hangarGreen),
        hint:'La fase roja es la diferencia entre ambos. Valores oficiales: <b>185</b> de ciclo y <b>65</b> de fase verde.' },
    ],
    onSave:v => {
      if (v.cycle > 1 && v.cycle !== round2(S.cfg.hangarCycle)) S.cfg.hangarCycle = v.cycle;
      if (v.green > 0 && v.green !== round2(S.cfg.hangarGreen)) S.cfg.hangarGreen = v.green;
      S.cfg.hangarGreen = clamp(S.cfg.hangarGreen, .1, S.cfg.hangarCycle - .1);
    },
  });
}

/* ───────────────────────── Ajustes globales ───────────────────────── */

function openSettings(){
  const c = S.cfg;
  $('#setHangarCycle').value = round2(c.hangarCycle);
  $('#setHangarGreen').value = round2(c.hangarGreen);
  $('#setPrinter').value     = c.printerMin;
  $('#setLoot').value        = c.lootMin;
  $('#setVaultOpen').value   = c.vaultOpen;
  $('#setVaultClosed').value = c.vaultClosed;
  $('#setSound').checked     = c.sound;
  $('#setNotify').checked    = c.notify;
  $('#setLead').value        = c.lead;
  $('#setVolume').value      = c.volume;
  refreshRedHint();
  const dlg = $('#dlgSettings');
  dlg.returnValue = '';
  dlg.showModal();
}
function refreshRedHint(){
  const cy = parseFloat($('#setHangarCycle').value) || 0;
  const gr = parseFloat($('#setHangarGreen').value) || 0;
  $('#setHangarRed').textContent = Math.max(0, +(cy - gr).toFixed(1));
}

$('#dlgSettings').addEventListener('close', e => {
  if (e.target.returnValue !== 'ok') return;
  const num = (sel, min, max, def) => {
    const v = parseFloat($(sel).value);
    return Number.isFinite(v) && v >= min && v <= max ? v : def;
  };
  const c = S.cfg;
  const cy = num('#setHangarCycle', 1, 1440, round2(c.hangarCycle));
  const gr = num('#setHangarGreen', .1, 1440, round2(c.hangarGreen));
  if (cy !== round2(c.hangarCycle)) c.hangarCycle = cy;
  if (gr !== round2(c.hangarGreen)) c.hangarGreen = gr;
  c.hangarGreen = clamp(c.hangarGreen, .1, c.hangarCycle - .1);
  c.printerMin  = num('#setPrinter', .1, 1440, c.printerMin);
  c.lootMin     = num('#setLoot', .1, 1440, c.lootMin);
  c.vaultOpen   = num('#setVaultOpen', .1, 600, c.vaultOpen);
  c.vaultClosed = num('#setVaultClosed', .1, 600, c.vaultClosed);
  c.lead        = num('#setLead', 0, 600, c.lead);
  c.volume      = num('#setVolume', 0, 1, c.volume);
  c.sound       = $('#setSound').checked;
  c.notify      = $('#setNotify').checked;
  if (c.notify) requestNotify();
  save(); tick();
  toast('Ajustes guardados', 'Los temporizadores se han actualizado.', true);
});

function requestNotify(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

/* ───────────────────────── Vistas conmutables ─────────────────────────
   La vista activa vive en `location.hash`, NUNCA en `S`: si estuviera en el
   estado, dos pestañas del navegador se arrastrarían la una a la otra a
   través de `pullExternal()`/el evento `storage`, y cada una quiere mirar
   una sección distinta. `S.views` sólo guarda orden/nombre/visibilidad. */

/* Deriva la lista final de vistas a partir de S.views sin mutar S: descarta
   ids desconocidos y duplicados, añade al final (en orden de catálogo) las
   vistas que falten, y si todas quedan ocultas desoculta la primera. Un
   S.views vacío o corrupto degrada así al catálogo completo. */
function viewList(){
  const byId = new Map(VIEWS.map(v => [v.id, v]));
  const out = [];
  const used = new Set();
  (Array.isArray(S.views) ? S.views : []).forEach(v => {
    if (!v || typeof v.id !== 'string' || used.has(v.id) || !byId.has(v.id)) return;
    used.add(v.id);
    out.push({ id:v.id, label: v.name || byId.get(v.id).label, hidden: !!v.hidden });
  });
  VIEWS.forEach(cat => {
    if (used.has(cat.id)) return;
    used.add(cat.id);
    out.push({ id:cat.id, label:cat.label, hidden:false });
  });
  if (out.length && out.every(v => v.hidden)) out[0].hidden = false;
  return out;
}

function currentView(){
  const list = viewList();
  const visible = list.filter(v => !v.hidden);
  const hash = location.hash.replace(/^#/, '');
  if (visible.some(v => v.id === hash)) return hash;
  return (visible[0] || list[0] || VIEWS[0]).id;
}

/* Pinta las pestañas de #viewNav (más la de edición) y muestra/oculta las
   secciones de <main data-view> según la vista activa. */
function applyView(){
  const active = currentView();
  document.body.dataset.view = active;
  $$('main [data-view]').forEach(sect => { sect.hidden = sect.dataset.view !== active; });

  const list = viewList().filter(v => !v.hidden);
  const host = $('#viewNav');
  host.innerHTML = '';
  list.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vtab' + (v.id === active ? ' is-active' : '');
    b.dataset.goto = v.id;
    b.textContent = v.label;
    if (v.id === active) b.setAttribute('aria-current', 'page');
    b.onclick = () => setView(v.id);
    host.appendChild(b);
  });
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'vtab vtab--edit';
  editBtn.title = 'Editar vistas';
  editBtn.setAttribute('aria-label', 'Editar vistas');
  editBtn.innerHTML = ICON_EDIT;
  editBtn.onclick = openViewEditor;
  host.appendChild(editBtn);
}

/* Cambia de vista. Aplica siempre en el acto (no espera al evento
   `hashchange`, que puede llegar después del siguiente requestAnimationFrame
   de quien la llamó, p.ej. focusCard). */
function setView(id){
  if (location.hash.replace(/^#/, '') !== id) location.hash = id;
  applyView();
}

/* ---- editor de vistas (#dlgViews) ---- */

function openViewEditor(){
  renderViewEditor();
  $('#dlgViews').showModal();
}

/* Convierte una lista ya reordenada/editada a la forma dispersa de S.views
   (sólo guarda `name` si difiere del catálogo, sólo guarda `hidden` si es
   true) y la aplica al momento: mutar -> guardar -> aplicar. */
function commitViews(list){
  if (list.length && list.every(v => v.hidden)) list[0].hidden = false;
  S.views = list.map(v => {
    const cat = VIEWS.find(c => c.id === v.id);
    const out = { id:v.id };
    if (v.label !== cat.label) out.name = v.label;
    if (v.hidden) out.hidden = true;
    return out;
  });
  save();
  applyView();
  renderViewEditor();
}

function renderViewEditor(){
  const list = viewList();
  const host = $('#viewEditor');
  host.innerHTML = '';
  list.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'fld';
    row.innerHTML = `
      <span style="display:flex;gap:4px">
        <button type="button" class="btn btn--ghost btn--sm" data-up title="Subir">↑</button>
        <button type="button" class="btn btn--ghost btn--sm" data-down title="Bajar">↓</button>
      </span>
      <input type="text" data-name maxlength="24" style="flex:1;min-width:0;margin:0 8px">
      <label class="chk" style="padding:0"><input type="checkbox" data-visible><span>Visible</span></label>`;
    const up = $('[data-up]', row), down = $('[data-down]', row);
    const nameInp = $('[data-name]', row), visInp = $('[data-visible]', row);
    nameInp.value = v.label;
    visInp.checked = !v.hidden;
    up.disabled = i === 0;
    down.disabled = i === list.length - 1;

    up.onclick = () => {
      const copy = list.map(x => ({ ...x }));
      [copy[i-1], copy[i]] = [copy[i], copy[i-1]];
      commitViews(copy);
    };
    down.onclick = () => {
      const copy = list.map(x => ({ ...x }));
      [copy[i], copy[i+1]] = [copy[i+1], copy[i]];
      commitViews(copy);
    };
    visInp.onchange = () => {
      const copy = list.map(x => ({ ...x }));
      copy[i].hidden = !visInp.checked;
      commitViews(copy);
    };
    nameInp.onchange = () => {
      const copy = list.map(x => ({ ...x }));
      const cat = VIEWS.find(c => c.id === copy[i].id);
      copy[i].label = nameInp.value.trim() || cat.label;
      commitViews(copy);
    };
    host.appendChild(row);
  });
}

/* ───────────────────────── Exportar / importar ───────────────────────── */

function exportData(){
  const blob = new Blob([JSON.stringify(S, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pyro-ops-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importData(file){
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const raw = JSON.parse(fr.result);
      localStorage.setItem(KEY, JSON.stringify(raw));
      S = load(); save();
      rebuildAll(); tick();
      toast('Importado', 'Configuración cargada correctamente.', true);
    } catch { toast('Error', 'El archivo no es válido.'); }
  };
  fr.readAsText(file);
}

/* ───────────────────────── Eventos globales ───────────────────────── */

/* Reconstruye el DOM dinámico. No llama a tick(): es tick() quien puede
   invocarlo, y así evitamos la recursión. Al final reaplica la vista activa
   (pestañas + secciones visibles), porque cualquier llamada a rebuildAll()
   —incluida la de tick() vía pullExternal()— puede venir de un S.views
   cambiado desde otra pestaña. */
function rebuildAll(){
  buildStations(); buildLoot(); buildCustom(); buildBoards();
  applyView();
}

function wire(){
  buildLeds(); buildGuide(); rebuildAll(); tick();

  $('#btnSyncHangar').onclick    = () => { S.hangarAnchor = now(); save(); tick(); toast('Hangar sincronizado', 'Fase verde iniciada ahora.', true); };
  $('#btnSyncHangarRed').onclick = () => { S.hangarAnchor = now() - S.cfg.hangarGreen*60000; save(); tick(); toast('Hangar sincronizado', 'Fase roja iniciada ahora.', true); };
  $('#btnResetHangar').onclick   = () => {
    S.hangarAnchor = CZ.anchor;
    S.cfg.hangarCycle = (CZ.openMs + CZ.closeMs) / 60000;
    S.cfg.hangarGreen = CZ.openMs / 60000;
    save(); tick();
    toast('Ciclo oficial restaurado', 'Se usa de nuevo el ancla global.', true);
  };
  $('#btnFetchCz').onclick = fetchCzConfig;
  $('[data-edit="hangar"]').onclick = editHangar;

  $('#btnResetTimers').onclick = () => {
    if (!confirm('¿Reiniciar todos los temporizadores de zonas disputadas?')) return;
    STATIONS.flatMap(s => s.items).forEach(it => {
      if (S.timers[it.id]) S.timers[it.id].start = null;
      delete S.cycles[it.id];
    });
    save(); tick();
  };

  $('#btnResetBoards').onclick = () => { S.boards = BOARDS.map(() => false); save(); renderBoards(); };

  $('#btnAddLoot').onclick = () => {
    openEdit({
      eyebrow:'Nueva zona de loot', title:'Añadir zona',
      fields:[
        { key:'name', label:'Nombre de la zona', type:'text', value:'Nueva zona' },
        { key:'min',  label:'Ciclo (minutos)', value:S.cfg.lootMin },
      ],
      onSave:v => {
        S.loot.push({ id: uid('loot'), name: v.name || 'Nueva zona', min: v.min > 0 ? v.min : S.cfg.lootMin });
        buildLoot();
      },
    });
  };

  $('#btnAddCustom').onclick = () => {
    openEdit({
      eyebrow:'Nuevo temporizador', title:'Crear temporizador',
      fields:[
        { key:'name',   label:'Nombre', type:'text', value:'Mi temporizador' },
        { key:'min',    label:'Duración (minutos)', value:10 },
        { key:'repeat', label:'Ciclo repetido (se reinicia solo)', type:'checkbox', value:false },
      ],
      onSave:v => {
        S.custom.push({ id: uid('c'), name: v.name || 'Temporizador', min: v.min > 0 ? v.min : 10, repeat: !!v.repeat });
        buildCustom();
      },
    });
  };

  $('#btnSettings').onclick = openSettings;
  $('#setHangarCycle').oninput = refreshRedHint;
  $('#setHangarGreen').oninput = refreshRedHint;
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };
  $('#btnWipe').onclick = () => {
    if (!confirm('Esto borrará TODOS tus temporizadores y ajustes. ¿Continuar?')) return;
    S = DEFAULTS();
    save();
    $('#dlgSettings').close();
    rebuildAll(); tick();
    toast('Datos borrados', 'Se han restaurado los valores por defecto.', true);
  };

  $('#btnResetViews').onclick = () => {
    S.views = [];
    save();
    applyView();
    renderViewEditor();
    toast('Vistas restablecidas', 'Se recupera el catálogo completo de pestañas.', true);
  };
  $('#btnCloseViews').onclick = () => $('#dlgViews').close();

  const btnAlerts = $('#btnAlerts');
  const syncAlertBtn = () => {
    btnAlerts.setAttribute('aria-pressed', String(S.cfg.alerts));
    btnAlerts.title = S.cfg.alerts ? 'Alertas activadas' : 'Alertas desactivadas';
  };
  btnAlerts.onclick = () => {
    S.cfg.alerts = !S.cfg.alerts;
    if (S.cfg.alerts){ requestNotify(); beep([990]); }
    save(); syncAlertBtn();
    toast(S.cfg.alerts ? 'Alertas activadas' : 'Alertas desactivadas',
          S.cfg.alerts ? `Aviso previo de ${S.cfg.lead}s y al finalizar.` : '', S.cfg.alerts);
  };
  syncAlertBtn();

  // Reloj
  const clock = () => {
    const d = new Date();
    $('#clockTime').textContent = d.toLocaleTimeString('es-ES', { hour12:false });
    $('#clockZone').textContent = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'LOCAL').split('/').pop().replace('_',' ');
  };
  clock(); setInterval(clock, 1000);

  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    S = load();
    try { lastRaw = localStorage.getItem(KEY); } catch {}
    rebuildAll(); tick();
  });
  window.addEventListener('hashchange', applyView);
}

document.addEventListener('DOMContentLoaded', wire);
})();
