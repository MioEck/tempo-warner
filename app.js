"use strict";

// ---------- Einstellungen ----------
const DEFAULTS = { tol: 5, sound: true, volume: 80, wake: true, assume50: false };
const settings = loadSettings();

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("tempo-settings") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  try { localStorage.setItem("tempo-settings", JSON.stringify(settings)); } catch {}
}

const $ = (id) => document.getElementById(id);
const screens = { start: $("start"), drive: $("drive"), settings: $("settings") };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

// Ab welcher Geschwindigkeit gewarnt wird: Limit + Toleranz (bei +0 erst über dem Limit)
const warnAt = (limit) => limit + Math.max(settings.tol, 1);

// ---------- Zustand ----------
let speedKmh = null;
let current = null;        // { name, limit, none, note }
let over = false;
let demo = false;

// ---------- Statistik ----------
// Eine Überschreitung = eine Warnphase (wie Banner/Warnton), gezählt ab 3 s Dauer.
// Bußgeldbereich nach deutschem Bußgeldkatalog: ab 21 km/h zu schnell nach Abzug
// der Messtoleranz (3 km/h, über 100 km/h 3 %); darunter Verwarnungsgeld.
const MIN_EPISODE = 3000;
const FINE_FROM = 21;
const stats = loadStats();
let episode = null;

function emptyStats() {
  return { since: Date.now(), inner: { n: 0, fine: 0 }, outer: { n: 0, fine: 0 }, log: [] };
}
function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem("tempo-stats"));
    return s && s.inner && s.outer ? s : emptyStats();
  } catch {
    return emptyStats();
  }
}
function saveStats() {
  try { localStorage.setItem("tempo-stats", JSON.stringify(stats)); } catch {}
}

const tolerance = (v) => (v <= 100 ? 3 : Math.ceil(v * 0.03));

function trackOver() {
  if (over && !demo && current && current.limit != null && speedKmh != null) {
    const raw = speedKmh - current.limit;
    if (!episode) episode = { start: Date.now(), raw: -Infinity };
    if (raw > episode.raw) {
      Object.assign(episode, {
        raw,
        net: Math.round(speedKmh - tolerance(speedKmh) - current.limit),
        speed: Math.round(speedKmh),
        limit: current.limit,
        area: current.area,
        street: current.name,
      });
    }
  } else if (episode) {
    endEpisode();
  }
}

function endEpisode() {
  const e = episode;
  episode = null;
  if (!e || Date.now() - e.start < MIN_EPISODE) return;
  const fine = e.net >= FINE_FROM;
  const bucket = e.area === "inner" ? stats.inner : stats.outer;
  bucket.n++;
  if (fine) bucket.fine++;
  stats.log.unshift({ t: e.start, street: e.street, limit: e.limit, speed: e.speed, net: e.net, area: e.area, fine });
  stats.log.length = Math.min(stats.log.length, 30);
  saveStats();
}
window.addEventListener("pagehide", () => { if (episode) endEpisode(); });

// ---------- Anzeige ----------
function render() {
  $("tolText").textContent = `Warnung ab +${settings.tol} km/h`;

  const sign = $("sign");
  sign.classList.remove("unknown", "none", "three");
  if (!current || (current.limit == null && !current.none)) {
    sign.classList.add("unknown");
    $("limit").textContent = "?";
    sign.setAttribute("aria-label", "Tempolimit unbekannt");
  } else if (current.none) {
    sign.classList.add("none");
    sign.setAttribute("aria-label", "Keine Geschwindigkeitsbegrenzung");
  } else {
    $("limit").textContent = current.limit;
    if (current.limit >= 100) sign.classList.add("three");
    sign.setAttribute("aria-label", `Tempolimit ${current.limit} km/h`);
  }

  $("street").textContent = current ? current.name : "Suche Straße …";
  $("speed").textContent = speedKmh == null ? "–" : Math.round(speedKmh);

  const limit = current && current.limit;
  const nowOver = limit != null && speedKmh != null &&
    (over ? speedKmh >= warnAt(limit) - 1 : speedKmh >= warnAt(limit)); // 1 km/h Hysterese gegen Flackern
  setOver(nowOver);
  trackOver();

  if (over) {
    $("bannerText").textContent = `Zu schnell · +${Math.round(speedKmh - limit)} km/h`;
    $("sub").textContent = `Warnung ab ${warnAt(limit)} km/h (Limit +${settings.tol})`;
  } else {
    $("sub").textContent = current && current.note ? current.note : "Tempolimit laut OpenStreetMap";
  }
}

function setOver(v) {
  if (v === over) return;
  over = v;
  document.body.classList.toggle("over", v);
  $("banner").hidden = !v;
  if (v) startAlarm(); else stopAlarm();
}

function setStatus(text, state) {
  $("status").textContent = text;
  $("gpsDot").className = "dot" + (state ? " " + state : "");
}

// ---------- Warnton ----------
let audio = null;
let alarmTimer = null;

function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio) audio = new Ctx();
  if (audio.state === "suspended") audio.resume();
}

function beep(force) {
  if (!audio || (!settings.sound && !force)) return;
  const vol = settings.volume / 100;
  const t0 = audio.currentTime;
  [0, 0.22].forEach((offset, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = i === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0, t0 + offset);
    gain.gain.linearRampToValueAtTime(0.35 * vol, t0 + offset + 0.01);
    gain.gain.setValueAtTime(0.35 * vol, t0 + offset + 0.15);
    gain.gain.linearRampToValueAtTime(0, t0 + offset + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.2);
  });
}

function startAlarm() {
  beep();
  alarmTimer = setInterval(() => beep(), 3000);
}
function stopAlarm() {
  clearInterval(alarmTimer);
  alarmTimer = null;
}

// ---------- Bildschirm wach halten ----------
let wakeLock = null;
async function requestWake() {
  if (!settings.wake || !("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {}
}
function releaseWake() {
  if (wakeLock) wakeLock.release();
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screens.start.hidden) requestWake();
});

// ---------- Tempolimit aus OSM-Tags ----------
const ZONES = {
  // Land: [innerorts, außerorts, Autobahn (null = keine Begrenzung)]
  DE: [50, 100, null], AT: [50, 100, 130], CH: [50, 80, 120], NL: [50, 80, 100],
  DK: [50, 80, 130], PL: [50, 90, 140], FR: [50, 80, 130], BE: [50, 70, 120],
  CZ: [50, 90, 130], LU: [50, 90, 130], IT: [50, 90, 130],
};

// innerorts / außerorts: aus den Tags, sonst ob die Position in einem Wohn-/Gewerbegebiet
// laut OpenStreetMap liegt (Näherung für „innerhalb der Ortsschilder“)
function areaOf(tags, pos) {
  const t = [tags.maxspeed, tags["maxspeed:type"], tags["source:maxspeed"], tags["zone:maxspeed"]].join(" ").toLowerCase();
  if (/^(living_street|residential)$/.test(tags.highway) || /urban|zone|living_street/.test(t)) return "inner";
  if (/^motorway/.test(tags.highway) || /rural|motorway/.test(t)) return "outer";
  return inSettlement(pos) ? "inner" : "outer";
}

// Liefert { limit } oder { none: true } oder null
function parseSpeed(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (v === "none") return { none: true };
  if (v === "walk") return { limit: 7, note: "Schrittgeschwindigkeit" };
  let m = v.match(/^(\d+)\s*(mph)?$/);
  if (m) return { limit: m[2] ? Math.round(+m[1] * 1.609) : +m[1] };
  m = v.match(/^([a-z]{2}):(.+)$/);
  if (m) {
    const z = ZONES[m[1].toUpperCase()] || ZONES.DE;
    const kind = m[2];
    let n = kind.match(/zone:?(\d+)/);
    if (n) return { limit: +n[1], note: `Tempo-${n[1]}-Zone` };
    if (kind === "urban") return { limit: z[0], note: "innerorts" };
    if (kind === "rural") return { limit: z[1], note: "außerorts" };
    if (kind === "motorway") return z[2] == null ? { none: true } : { limit: z[2] };
    if (kind === "living_street") return { limit: 7, note: "Spielstraße – Schrittgeschwindigkeit" };
    if (kind === "bicycle_road") return { limit: 30, note: "Fahrradstraße" };
  }
  return null;
}

function limitFromTags(tags, forward, area) {
  const dir = forward ? "maxspeed:forward" : "maxspeed:backward";
  const r =
    parseSpeed(tags[dir]) ||
    parseSpeed(tags.maxspeed) ||
    parseSpeed(tags["maxspeed:type"]) ||
    parseSpeed(tags["source:maxspeed"]) ||
    parseSpeed(tags["zone:maxspeed"]);
  if (r) return r;
  if (tags.highway === "living_street") return { limit: 7, note: "Spielstraße – Schrittgeschwindigkeit" };
  if (settings.assume50 && !/^motorway/.test(tags.highway)) {
    return area === "inner"
      ? { limit: 50, note: "angenommen: innerorts – kein Eintrag in der Karte" }
      : { limit: 100, note: "angenommen: außerorts – kein Eintrag in der Karte" };
  }
  return { limit: null, note: "Kein Tempolimit in der Karte eingetragen" };
}

// ---------- Kartendaten (Overpass) ----------
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const HEDGE = 4000;        // so lange auf einen Server warten, bevor zusätzlich der nächste gefragt wird
const TIMEOUT = 30000;     // Abbruch einer einzelnen Anfrage (Server-Timeout ist 25 s)
// Kartendaten kommen in Kacheln (~2,2 × 2 km). Geladen werden immer die eigene und die
// 8 umliegenden Kacheln, damit beim Weiterfahren schon Daten da sind. Geladene Kacheln
// bleiben 30 Tage auf dem Gerät – bekannte Strecken brauchen dann keinen Server.
const TILE_LAT = 0.02;
const TILE_LON = 0.03;
const MARGIN = 0.002;      // Überlappung, damit Straßen an Kachelrändern nicht fehlen
const TILE_CACHE = "tempo-tiles-v1";
const TILE_MAX_AGE = 30 * 24 * 3600 * 1000;
const TILE_CACHE_MAX = 400;
const HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|road";
const LANDUSE = "residential|commercial|retail|industrial";

const tiles = new Map();   // key -> { ways, areas } oder nach Fehler { fails, retryAt }
let ways = [];             // [{ id, tags, pts: [{lat, lon}] }] aus den Kacheln um die Position
let areas = [];            // Wohn-/Gewerbegebiete: [{ bbox, pts }]
let loadingTile = false;
let mapError = "";
let endpointIdx = 0;
let currentWayId = null;

// Fragt zuerst den zuletzt erfolgreichen Server. Antwortet er nicht binnen HEDGE ms
// (oder mit Fehler), kommt der nächste dazu; die erste brauchbare Antwort gewinnt.
function queryOverpass(q) {
  const base = endpointIdx;
  const ctrls = [];
  return new Promise((resolve, reject) => {
    let started = 0, pending = 0, done = false, lastErr = "";
    const startNext = () => {
      if (done || started >= ENDPOINTS.length) return;
      const i = started++;
      pending++;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      const hedge = setTimeout(startNext, HEDGE);
      fetch(ENDPOINTS[(base + i) % ENDPOINTS.length], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(res.status === 429 ? "Server überlastet" : `Server-Fehler ${res.status}`);
          const json = await res.json();
          // Bei Überlast/Timeout liefert Overpass 200 mit "remark" und unvollständigen Daten
          if (!Array.isArray(json.elements) || json.remark) throw new Error("Server überlastet");
          if (done) return;
          done = true;
          endpointIdx = (base + i) % ENDPOINTS.length;
          ctrls.forEach((c) => c.abort());
          resolve(json);
        })
        .catch((e) => {
          if (!done) lastErr = e.name === "AbortError" ? "Zeitüberschreitung" : e.name === "TypeError" ? "keine Verbindung" : e.message;
          clearTimeout(hedge);
          startNext();
        })
        .finally(() => {
          clearTimeout(timer);
          pending--;
          if (!done && pending === 0 && started >= ENDPOINTS.length) reject(new Error(lastErr || "kein Server erreichbar"));
        });
    };
    startNext();
  });
}

const tileOf = (pos) => [Math.floor(pos.lat / TILE_LAT), Math.floor(pos.lon / TILE_LON)];
const tileKey = ([y, x]) => `${y}_${x}`;

function tileQuery([y, x]) {
  const bb = [y * TILE_LAT - MARGIN, x * TILE_LON - MARGIN, (y + 1) * TILE_LAT + MARGIN, (x + 1) * TILE_LON + MARGIN]
    .map((v) => v.toFixed(4)).join(",");
  return `[out:json][timeout:25];(way[highway~"^(${HIGHWAYS})$"](${bb});way[landuse~"^(${LANDUSE})$"](${bb}););out tags geom qt;`;
}

function parseTile(json) {
  const w = [], a = [];
  for (const e of json.elements) {
    if (e.type !== "way" || !e.geometry) continue;
    const tags = e.tags || {};
    if (tags.highway) {
      w.push({ id: e.id, tags, pts: e.geometry });
    } else if (tags.landuse && e.geometry.length > 3) {
      const lats = e.geometry.map((p) => p.lat), lons = e.geometry.map((p) => p.lon);
      a.push({ bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)], pts: e.geometry });
    }
  }
  return { ways: w, areas: a };
}

async function cacheGet(key) {
  try {
    const res = await (await caches.open(TILE_CACHE)).match(`tiles/${key}`);
    if (!res) return null;
    const { t, data } = await res.json();
    return Date.now() - t < TILE_MAX_AGE ? data : null;
  } catch {
    return null;
  }
}
async function cachePut(key, data) {
  try {
    const c = await caches.open(TILE_CACHE);
    await c.put(`tiles/${key}`, new Response(JSON.stringify({ t: Date.now(), data })));
    const keys = await c.keys(); // in Einfügereihenfolge: älteste zuerst
    await Promise.all(keys.slice(0, Math.max(0, keys.length - TILE_CACHE_MAX)).map((k) => c.delete(k)));
  } catch {}
}

// Reihenfolge: eigene Kachel, dann die Kacheln in Fahrtrichtung (bis ~2 km voraus),
// dann die übrigen Nachbarn nach Abstand zur Position
function wantedTiles(pos, heading) {
  const list = new Map();
  const add = (t) => list.set(tileKey(t), t);
  add(tileOf(pos));
  if (heading != null) {
    const r = (heading * Math.PI) / 180;
    const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
    for (const d of [700, 1400, 2100]) {
      add(tileOf({ lat: pos.lat + (d * Math.cos(r)) / 110540, lon: pos.lon + (d * Math.sin(r)) / kx }));
    }
  }
  const [y, x] = tileOf(pos);
  const near = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.push([y + dy, x + dx]);
  // Abstand zum nächsten Punkt der Kachel
  const d = ([ty, tx]) => dist(pos, {
    lat: Math.min(Math.max(pos.lat, ty * TILE_LAT), (ty + 1) * TILE_LAT),
    lon: Math.min(Math.max(pos.lon, tx * TILE_LON), (tx + 1) * TILE_LON),
  });
  near.sort((a, b) => d(a) - d(b)).forEach(add);
  return [...list.values()];
}

function rebuildWays() {
  const byId = new Map();
  areas = [];
  for (const t of tiles.values()) {
    if (!t.ways) continue;
    for (const w of t.ways) byId.set(w.id, w);
    areas.push(...t.areas);
  }
  ways = [...byId.values()];
}

// Lädt nacheinander alle fehlenden Kacheln um die aktuelle Position
async function ensureTiles() {
  if (loadingTile || !last) return;
  const want = wantedTiles(last.pos, lastHeading);
  const keep = new Set(want.map(tileKey));
  let dropped = false;
  for (const k of tiles.keys()) if (!keep.has(k)) { tiles.delete(k); dropped = true; }
  if (dropped) rebuildWays();

  const now = Date.now();
  const next = want.find((t) => { const e = tiles.get(tileKey(t)); return !e || (!e.ways && now >= e.retryAt); });
  if (!next) return;
  const key = tileKey(next);
  loadingTile = true;
  try {
    let data = await cacheGet(key);
    if (!data) {
      if (!navigator.onLine) throw new Error("kein Internet");
      data = parseTile(await queryOverpass(tileQuery(next)));
      cachePut(key, data);
    }
    tiles.set(key, data);
    mapError = "";
    rebuildWays();
  } catch (e) {
    const fails = ((tiles.get(key) || {}).fails || 0) + 1;
    tiles.set(key, { fails, retryAt: Date.now() + Math.min(60000, 5000 * 2 ** (fails - 1)) });
    mapError = e.message;
  } finally {
    loadingTile = false;
  }
  ensureTiles();
}
// Fehlgeschlagene Kacheln auch ohne neue GPS-Position erneut versuchen
setInterval(ensureTiles, 5000);

const tileReady = (pos) => !!(tiles.get(tileKey(tileOf(pos))) || {}).ways;

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

// Abstand in m von p zur Strecke a–b
function segDist(p, a, b) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
  const dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * ky;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// Im Wohn-/Gewerbegebiet oder höchstens 25 m davon entfernt (Ortsdurchfahrten liegen oft
// genau zwischen zwei Gebietsflächen)
function inSettlement(pos) {
  const m = 0.0004; // ~25–45 m
  for (const a of areas) {
    const [s, w, n, e] = a.bbox;
    if (pos.lat < s - m || pos.lat > n + m || pos.lon < w - m || pos.lon > e + m) continue;
    if (pointInPoly(pos, a.pts)) return true;
    for (let i = 0; i < a.pts.length - 1; i++) if (segDist(pos, a.pts[i], a.pts[i + 1]) <= 25) return true;
  }
  return false;
}

// Abstand in m zwischen zwei Punkten (für kurze Strecken ausreichend genau)
function dist(a, b) {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 110540);
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Nächste Straße zur Position finden; Fahrtrichtung (heading) hilft an Kreuzungen
function matchWay(pos, heading) {
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 110540;
  let best = null;

  for (const w of ways) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const ax = (w.pts[i].lon - pos.lon) * kx, ay = (w.pts[i].lat - pos.lat) * ky;
      const bx = (w.pts[i + 1].lon - pos.lon) * kx, by = (w.pts[i + 1].lat - pos.lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

      let score = d;
      let forward = true;
      if (heading != null) {
        const diff = angleDiff(heading, bearing);
        forward = diff <= 90;
        score += (Math.min(diff, 180 - diff) / 90) * 30;
      }
      if (w.tags.highway === "service") score += 8;
      if (w.id === currentWayId) score -= 5;

      if (!best || score < best.score) best = { way: w, score, d, forward };
    }
  }
  return best && best.d < 40 ? best : null;
}

function wayName(tags) {
  if (tags.name && tags.ref) return `${tags.name} (${tags.ref})`;
  return tags.name || tags.ref || "Unbenannte Straße";
}

// ---------- GPS ----------
let last = null;
let lastHeading = null;
let lastFixAt = 0;

function onPosition(p) {
  const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
  const now = p.timestamp || Date.now();

  let v = p.coords.speed;
  if (v == null || Number.isNaN(v)) {
    // Gerät liefert keine Geschwindigkeit: aus den letzten zwei Positionen berechnen
    v = last && now - last.t > 500 ? dist(last.pos, pos) / ((now - last.t) / 1000) : null;
  }
  speedKmh = v == null ? null : v * 3.6 < 3 ? 0 : v * 3.6;

  let heading = p.coords.heading;
  if ((heading == null || Number.isNaN(heading)) && last && dist(last.pos, pos) > 5) {
    const kx = Math.cos((pos.lat * Math.PI) / 180);
    heading = ((Math.atan2((pos.lon - last.pos.lon) * kx, pos.lat - last.pos.lat) * 180) / Math.PI + 360) % 360;
  }
  if (speedKmh != null && speedKmh < 8) heading = null; // im Stand ist die Richtung unzuverlässig

  last = { pos, t: now };
  if (heading != null) lastHeading = heading;
  lastFixAt = Date.now();

  ensureTiles();

  const m = ways.length ? matchWay(pos, heading) : null;
  if (m) {
    currentWayId = m.way.id;
    const area = areaOf(m.way.tags, pos);
    const lim = limitFromTags(m.way.tags, m.forward, area);
    current = { name: wayName(m.way.tags), limit: lim.none ? null : lim.limit, none: !!lim.none, note: lim.note, area };
  } else if (tileReady(pos)) {
    currentWayId = null;
    current = { name: "Keine Straße erkannt", limit: null, none: false, note: "" };
  } else {
    current = null; // Kachel noch nicht geladen
  }

  const acc = Math.round(p.coords.accuracy);
  if (tileReady(pos)) {
    setStatus(`GPS aktiv · Genauigkeit ${acc} m`, acc <= 25 ? "ok" : "bad");
  } else {
    setStatus(mapError ? `Kartendaten: ${mapError} – neuer Versuch …` : "Lade Kartendaten …", "bad");
  }
  render();
}

function onGeoError(e) {
  const msg = e.code === 1
    ? "Standort nicht erlaubt – bitte in den Browser-Einstellungen freigeben"
    : "Kein GPS-Signal";
  setStatus(msg, "bad");
}

// Hinweis, wenn länger keine Position kommt
setInterval(() => {
  if (!demo && lastFixAt && Date.now() - lastFixAt > 6000) {
    speedKmh = null;
    setStatus("GPS-Signal verloren …", "bad");
    render();
  }
}, 2000);

// ---------- Demo ----------
function startDemo() {
  demo = true;
  current = { name: "Demo-Straße", limit: 50, none: false, note: "Demo – keine echten Daten" };
  setStatus("Demo-Modus", "ok");
  const t0 = Date.now();
  const tick = () => {
    const s = (Date.now() - t0) / 1000;
    speedKmh = 50 + 10 * Math.sin(s / 3);
    render();
  };
  tick();
  setInterval(tick, 250);
}

// ---------- Bedienung ----------
function start(isDemo) {
  unlockAudio();
  requestWake();
  show("drive");
  render();
  if (isDemo) return startDemo();
  if (!("geolocation" in navigator)) return setStatus("Dieses Gerät hat kein GPS", "bad");
  navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
}

$("startBtn").addEventListener("click", () => start(false));
$("demoBtn").addEventListener("click", () => start(true));
$("settingsBtn").addEventListener("click", () => { syncSettingsUI(); renderStats(); show("settings"); });
$("backBtn").addEventListener("click", () => { show("drive"); render(); });

function syncSettingsUI() {
  for (const b of $("tolGrid").children) b.classList.toggle("active", +b.dataset.tol === settings.tol);
  $("tolHint").textContent = `Bei Limit 50 piept es ab ${warnAt(50)} km/h.`;
  $("soundOn").checked = settings.sound;
  $("volume").value = settings.volume;
  $("wakeOn").checked = settings.wake;
  $("assume50").checked = settings.assume50;
}

$("tolGrid").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  settings.tol = +b.dataset.tol;
  saveSettings();
  syncSettingsUI();
});
$("soundOn").addEventListener("change", (e) => { settings.sound = e.target.checked; saveSettings(); });
$("volume").addEventListener("input", (e) => { settings.volume = +e.target.value; saveSettings(); });
$("wakeOn").addEventListener("change", (e) => {
  settings.wake = e.target.checked;
  saveSettings();
  settings.wake ? requestWake() : releaseWake();
});
$("assume50").addEventListener("change", (e) => { settings.assume50 = e.target.checked; saveSettings(); });
$("testBtn").addEventListener("click", () => { unlockAudio(); beep(true); });

function renderStats() {
  const fmt = (t, opt) => new Date(t).toLocaleString("de-DE", opt);
  $("statInnerN").textContent = stats.inner.n;
  $("statInnerFine").textContent = stats.inner.fine;
  $("statOuterN").textContent = stats.outer.n;
  $("statOuterFine").textContent = stats.outer.fine;
  $("statTotalN").textContent = stats.inner.n + stats.outer.n;
  $("statTotalFine").textContent = stats.inner.fine + stats.outer.fine;
  $("statSince").textContent = `seit ${fmt(stats.since, { dateStyle: "medium" })}`;

  const list = $("statLog");
  list.replaceChildren();
  $("statEmpty").hidden = stats.log.length > 0;
  for (const e of stats.log) {
    const li = document.createElement("li");
    if (e.fine) li.className = "fine";
    const top = document.createElement("div");
    top.className = "log__top";
    top.textContent = `${e.speed} bei ${e.limit} · ${e.area === "inner" ? "innerorts" : "außerorts"}${e.fine ? " · Bußgeld" : ""}`;
    const sub = document.createElement("div");
    sub.className = "muted small";
    sub.textContent = `${fmt(e.t, { dateStyle: "short", timeStyle: "short" })} · ${e.street}`;
    li.append(top, sub);
    list.append(li);
  }
}

$("statReset").addEventListener("click", () => {
  if (!confirm("Statistik wirklich löschen?")) return;
  Object.assign(stats, emptyStats());
  saveStats();
  renderStats();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
