import {
  KINDS, kindOf, kindImg, isCragDay, isClimbing, hasPitches, PITCH_STYLES, hasGrade, STYLES, newActivity, newIdea, yearOf, coverOf, titleOf, placeLine,
  fmtKm, fmtM, fmtDur, fmtDate, summary, gradeScore, gradeLabel, topGrade, parseRoutes, esc, uuid,
} from "./model.js";
import { parseGPX, gpxStats, profile, latlngs } from "./gpx.js";
import { backend, isDemo, data, loadCached, refresh, saveActivity, deleteActivity, saveIdea, deleteIdea } from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main"), sheet = $("#sheet");
const ui = { year: "", kind: "", q: "", statsYear: "", area: "", season: "" };
let charts = [], maps = [];

// ------------------------------------------------------------------ boot
async function boot() {
  if ("serviceWorker" in navigator && !isDemo) navigator.serviceWorker.register("sw.js").catch(() => {});
  let signedIn = false;
  try { signedIn = await backend.init(); }
  catch (e) {
    if (e.message === "not-configured") return showSetup();
    return fatal(e);
  }
  if (!signedIn) return showSignIn();
  $("#who").textContent = backend.user;
  if (loadCached()) route();
  else main.innerHTML = `<div class="empty">Loading your logbook…</div>`;
  try { await refresh(); route(); }
  catch (e) { if (e.message !== "redirecting") toast(e.message); }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") { try { await refresh(); if (!sheet.open) route(); } catch {} }
  });
}

function showSetup() {
  document.body.classList.add("bare");
  main.innerHTML = `<div class="hero-msg"><h1>Logbook</h1>
    <p>This copy of the app isn't connected to OneDrive yet: paste your app's <b>client ID</b> into <code>config.js</code>.</p>
    <p><a class="btn" href="?demo">Try it with sample data</a></p></div>`;
}
function showSignIn() {
  document.body.classList.add("bare");
  main.innerHTML = `<div class="hero-msg"><img class="logo" src="icons/icon-192.png" alt=""><h1>Logbook</h1>
    <p>Your climbs, hikes and trip ideas, stored in your OneDrive.</p>
    <button class="btn primary" id="signin">Sign in with Microsoft</button></div>`;
  $("#signin").onclick = () => backend.signIn();
}
function fatal(e) { main.innerHTML = `<div class="hero-msg"><h1>Something went wrong</h1><p>${esc(e.message || e)}</p></div>`; }

export function toast(msg, ms = 3500) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

// ------------------------------------------------------------------ routing (#/log, #/map, #/stats, #/ideas, #/a/<id>, #/edit/<id|new>, #/idea/<id|new>)
window.addEventListener("hashchange", route);
const wideQuery = matchMedia("(min-width: 1000px)");
const isWide = () => wideQuery.matches;
wideQuery.addEventListener("change", () => { if (sheet.open) { const h = sheet.innerHTML; sheet.close(); sheet.innerHTML = h; route(); } });

function markSelected() {
  const h = location.hash;
  document.querySelectorAll("#main .item").forEach((a) => a.classList.toggle("sel", a.getAttribute("href") === h ||
    (h.startsWith("#/edit/") && a.getAttribute("href") === "#/a/" + h.slice(7)) ||
    (h.startsWith("#/idea/") && a.getAttribute("href") === "#/i/" + h.slice(7))));
}

function route() {
  document.body.classList.remove("bare");
  const [, view = "log", id] = location.hash.split("/");
  const tabView = ["log", "map", "stats", "ideas"].includes(view) ? view : (sessionStorage.getItem("tab") || "log");
  if (["log", "map", "stats", "ideas"].includes(view)) sessionStorage.setItem("tab", view);
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tabView));
  document.body.dataset.tab = tabView;
  $("#pane-empty p").textContent = tabView === "ideas" ? "Select a trip idea" : "Select an outing";
  if (!sheet.open || ["log", "map", "stats", "ideas"].includes(view)) renderTab(tabView);
  if (view === "a") openRecord(id);
  else if (view === "edit") openEditor(id);
  else if (view === "idea") openIdea(id);
  else if (view === "i") openIdeaRecord(id);
  else if (view === "settings") openSettings();
  else if (sheet.open) closeSheet(false);
  markSelected();
}
const go = (h) => { location.hash = h; };
const back = () => (history.length > 1 ? history.back() : go("#/" + (sessionStorage.getItem("tab") || "log")));

function cleanup() { charts.forEach((c) => c.destroy()); charts = []; maps.forEach((m) => m.remove()); maps = []; }

function renderTab(tab) {
  cleanup();
  if (renderTab.last !== tab) window.scrollTo(0, 0);
  renderTab.last = tab;
  ({ log: renderLog, map: renderMap, stats: renderStats, ideas: renderIdeas }[tab])();
  $("#add").onclick = () => go(tab === "ideas" ? "#/idea/new" : "#/edit/new");
}

// ------------------------------------------------------------------ helpers
const years = () => [...new Set(data.activities.map(yearOf))].sort((a, b) => b - a);
const kindsUsed = () => Object.keys(KINDS).filter((k) => data.activities.some((a) => a.kind === k));
function filtered({ year = ui.year, kind = ui.kind, q = ui.q } = {}) {
  const ql = q.trim().toLowerCase();
  return data.activities.filter((a) =>
    (!year || yearOf(a) === +year) && (!kind || (kind === "_review" ? !!a.review : a.kind === kind)) &&
    (!ql || [a.title, a.place, a.country, a.notes, a.grade, a.partners, ...(a.routes || []).map((r) => r.name)]
      .some((s) => (s || "").toLowerCase().includes(ql))));
}
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
const yearSelect = (cur, id = "f-year") =>
  `<select id="${id}">${opt("", "All years", cur)}${years().map((y) => opt(y, y, cur)).join("")}</select>`;
const kindSelect = (cur) =>
  `<select id="f-kind">${opt("", "All kinds", cur)}${data.activities.some((a) => a.review) ? opt("_review", `⚠︎ To review (${data.activities.filter((a) => a.review).length})`, cur) : ""}${kindsUsed().map((k) => opt(k, kindOf(k).label, cur)).join("")}</select>`;
const badge = (k) => `<span class="kb" style="--c:${kindOf(k).color}">${kindOf(k).icon}</span>`;

/** Fill <img data-thumb="path"> elements as they come into view. */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const el = e.target;
    backend.thumb(el.dataset.thumb, el.dataset.size || "medium").then((u) => { if (u) { el.src = u; el.classList.add("ok"); } });
  }
}, { rootMargin: "300px" });
const hydrate = (root) => root.querySelectorAll("img[data-thumb]").forEach((i) => io.observe(i));

// ------------------------------------------------------------------ LOG
function renderLog() {
  const list = filtered();
  const groups = {};
  list.forEach((a) => (groups[yearOf(a)] ||= []).push(a));
  main.innerHTML = `
    <header class="bar"><h1>Logbook</h1><a href="#/settings" class="icon-btn" aria-label="Settings">⚙︎</a></header>
    <div class="filters">
      <input type="search" id="f-q" placeholder="Search places, routes, notes" value="${esc(ui.q)}">
      <div class="row">${yearSelect(ui.year)}${kindSelect(ui.kind)}</div>
    </div>
    ${list.length ? "" : `<div class="empty">${data.activities.length ? "Nothing matches." : "No outings yet — tap + to add one."}</div>`}
    ${Object.keys(groups).sort((a, b) => b - a).map((y) => {
      const items = groups[y], km = items.reduce((s, a) => s + (a.distanceKm || 0), 0);
      return `<section><h2 class="yh"><span>${y}</span><small>${items.length} outing${items.length === 1 ? "" : "s"}${km ? " · " + fmtKm(km) : ""}</small></h2>
        <ul class="list">${items.map(row).join("")}</ul></section>`;
    }).join("")}`;
  $("#f-q").oninput = (e) => { ui.q = e.target.value; const pos = e.target.selectionStart; renderLog(); const q = $("#f-q"); q.focus(); q.setSelectionRange(pos, pos); };
  $("#f-year").onchange = (e) => { ui.year = e.target.value; renderLog(); };
  $("#f-kind").onchange = (e) => { ui.kind = e.target.value; renderLog(); };
  hydrate(main);
}
function row(a) {
  const k = kindOf(a.kind), n = a.photos?.length || 0;
  const marks = (n ? ` <span class="mk">📷${n > 1 ? n : ""}</span>` : "") + (a.gpxFile ? ' <span class="mk">〰︎</span>' : "") + (a.review ? ' <em class="warn">⚠︎</em>' : "");
  const third = [placeLine(a), summary(a)].filter(Boolean).join(" · ");
  return `<li><a href="#/a/${a.id}" class="item">
    <span class="thumb">${kindImg(a.kind)}</span>
    <span class="txt"><b>${esc(titleOf(a))}</b><small>${esc(fmtDate(a.date))} · ${esc(k.label)}${marks}</small>${third ? `<small class="third">${esc(third)}</small>` : ""}</span></a></li>`;
}

// ------------------------------------------------------------------ RECORD
function openSheet(html) {
  maps = maps.filter((m) => { if (sheet.contains(m.getContainer())) { m.remove(); return false; } return true; });
  sheet.innerHTML = html;
  // On a wide screen the record opens in a side panel and the list stays usable
  if (!sheet.open) { if (isWide()) sheet.show(); else sheet.showModal(); }
  sheet.scrollTop = 0;
}
function closeSheet(nav = true) {
  maps = maps.filter((m) => { if (sheet.contains(m.getContainer())) { m.remove(); return false; } return true; });
  if (sheet.open) sheet.close();
  sheet.innerHTML = "";
  if (nav) back();
}
sheet.addEventListener("cancel", (e) => { e.preventDefault(); back(); });

async function openRecord(id) {
  const a = data.activities.find((x) => x.id === id);
  if (!a) return go("#/log");
  const c = coverOf(a);
  const facts = [
    ["Distance", a.distanceKm != null && fmtKm(a.distanceKm)], ["Height gain", a.elevationGainM != null && fmtM(a.elevationGainM)],
    ["Duration", a.durationMinutes != null && fmtDur(a.durationMinutes)], ["Highest point", a.maxAltitudeM != null && fmtM(a.maxAltitudeM)],
    ["Grade", isCragDay(a.kind) ? topGrade(a)?.label : a.grade], ["Routes", a.routes?.length ? a.routes.length : ""],
  ].filter(([, v]) => v);
  openSheet(`
    <div class="sheet-bar"><button class="link" data-back>‹ Back</button><a class="link" href="#/edit/${a.id}">Edit</a></div>
    ${c ? `<div class="cover"><img data-thumb="${esc(c)}" data-size="large" alt=""></div>` : ""}
    <div class="pad">
      <div class="kind" style="color:${kindOf(a.kind).color}">${kindImg(a.kind, "kimg-s")} ${esc(kindOf(a.kind).label)}</div>
      <h1>${esc(titleOf(a))}</h1>
      <p class="sub">${esc([fmtDate(a.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), placeLine(a)].filter(Boolean).join(" · "))}</p>
      ${a.review ? `<div class="review"><b>⚠︎ To review</b><span>${esc(a.review)}</span><div class="row"><a class="btn small" href="#/edit/${a.id}">Fix it</a><button class="btn small primary" id="reviewed">Looks right</button></div></div>` : ""}
      ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
      ${a.gpxFile || a.latitude != null ? `<div class="map" id="rec-map"></div>` : ""}
      ${a.gpxFile ? `<div class="profile"><canvas id="rec-prof"></canvas></div>
        <div class="row gpx"><span>〰︎ ${esc(a.gpxFile.split("/").pop())}</span><button class="btn small" id="dl">Download GPX</button></div>` : ""}
      ${a.routes?.length ? `<h3>${hasPitches(a.kind) ? "Pitches" : "Routes"}</h3><table class="routes">${a.routes.map((r, i) =>
        `<tr>${hasPitches(a.kind) ? `<td class="dim">P${i + 1}</td>` : ""}<td><b>${esc(r.grade || "–")}</b></td><td>${esc(r.name || "—")}</td><td class="${["onsight", "flash", "redpoint"].includes(r.style) ? "" : "dim"}">${esc((hasPitches(a.kind) ? PITCH_STYLES : STYLES)[r.style] || r.style)}</td></tr>`).join("")}</table>` : ""}
      ${a.partners ? `<p><small class="dim">Partners</small><br>${esc(a.partners)}</p>` : ""}
      ${a.notes ? `<div class="notes">${linkify(a.notes)}</div>` : ""}
      ${a.photos?.length ? `<div class="grid">${a.photos.map((p) => `<button class="ph" data-photo="${esc(p)}"><img data-thumb="${esc(p)}" alt=""></button>`).join("")}</div>` : ""}
    </div>`);
  hydrate(sheet);
  sheet.querySelector("[data-back]").onclick = back;
  sheet.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = () => openPhoto(b.dataset.photo)));
  if ($("#dl", sheet)) $("#dl", sheet).onclick = async () => {
    const u = await backend.downloadURL(a.gpxFile);
    if (u) { const l = document.createElement("a"); l.href = u; l.download = a.gpxFile.split("/").pop(); l.target = "_blank"; l.click(); }
  };
  $("#reviewed", sheet)?.addEventListener("click", async () => {
    const b = structuredClone(a); delete b.review;
    try { await saveActivity(b); toast("Marked as reviewed"); openRecord(a.id); } catch (e) { toast(e.message); }
  });
  if (a.gpxFile || a.latitude != null) drawRecordMap(a);
}

async function openPhoto(path) {
  const u = (await backend.thumb(path, "large")) || (await backend.downloadURL(path));
  const v = document.createElement("dialog");
  v.className = "viewer";
  v.innerHTML = `<img src="${esc(u)}" alt=""><button class="close" aria-label="Close">✕</button>
    <button class="btn small full" aria-label="Open original">Original</button>`;
  document.body.append(v); v.showModal();
  v.querySelector(".close").onclick = () => { v.close(); v.remove(); };
  v.querySelector(".full").onclick = async () => window.open(await backend.downloadURL(path), "_blank");
}

const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

function baseLayers() {
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)" });
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "© Esri" });
  return { Topo: topo, Streets: osm, Satellite: sat };
}
function makeMap(el) {
  const layers = baseLayers();
  const m = L.map(el, { zoomControl: false, attributionControl: true, layers: [layers.Topo] });
  L.control.layers(layers, null, { position: "topright" }).addTo(m);
  maps.push(m);
  return m;
}

const kindIcon = (k) => KINDS[k]?.noImg
  ? L.divIcon({ html: `<span class="kemoji kpin" style="--c:${KINDS[k].color}">${KINDS[k].icon}</span>`, iconSize: [28, 28], iconAnchor: [14, 14], className: "" })
  : L.icon({ iconUrl: `icons/kinds/${KINDS[k] ? k : "other"}.png`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12], className: "kmarker" });

const tracks = new Map();
async function loadTrack(path) {
  if (!tracks.has(path)) tracks.set(path, backend.readText(path).then(parseGPX).catch(() => null));
  return tracks.get(path);
}

async function drawRecordMap(a) {
  const el = $("#rec-map", sheet);
  const m = makeMap(el);
  if (a.latitude != null) m.setView([a.latitude, a.longitude], 12);
  if (!a.gpxFile) { L.marker([a.latitude, a.longitude], { icon: kindIcon(a.kind) }).addTo(m); return; }
  const t = await loadTrack(a.gpxFile);
  if (!t || !t.points.length || !document.contains(el)) return;
  const line = L.polyline(latlngs(t), { color: kindOf(a.kind).color, weight: 4 }).addTo(m);
  m.fitBounds(line.getBounds(), { padding: [20, 20], animate: false });
  const prof = profile(t);
  if (prof.length > 1 && $("#rec-prof", sheet)) {
    const col = kindOf(a.kind).color;
    charts.push(new Chart($("#rec-prof", sheet), {
      type: "line",
      data: { datasets: [{ data: prof, borderColor: col, backgroundColor: col + "33", fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { type: "linear", ticks: { callback: (v) => `${v} km`, maxTicksLimit: 6 } }, y: { ticks: { callback: (v) => `${v} m`, maxTicksLimit: 4 } } } },
    }));
  }
}

// ------------------------------------------------------------------ EDITOR
let draft = null, pending = [];   // pending: [{path, blob, type}]

function openEditor(id) {
  const existing = id !== "new" && data.activities.find((x) => x.id === id);
  if (!draft || draft.id !== (existing?.id || draft.id) || (id === "new" && draft._saved)) {
    draft = existing ? structuredClone(existing) : (sessionStorage.getItem("fromIdea") ? ideaToActivity() : newActivity());
    pending = [];
  }
  renderEditor(!existing);
}

function ideaToActivity() {
  const idea = data.ideas.find((x) => x.id === sessionStorage.getItem("fromIdea"));
  const a = newActivity(idea?.kind || "hike");
  if (idea) Object.assign(a, { title: idea.title, place: idea.area, country: idea.country || "", grade: idea.grade || "",
    notes: [idea.notes, idea.links].filter(Boolean).join("\n\n"), gpxFile: idea.gpxFile, photos: [...(idea.photos || [])],
    coverPhoto: idea.coverPhoto, latitude: idea.latitude, longitude: idea.longitude });
  return a;
}

function renderEditor(isNew) {
  const a = draft, crag = isCragDay(a.kind);
  const d = new Date(a.date), dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dur = a.durationMinutes != null ? a.durationMinutes : null;
  openSheet(`
    <div class="sheet-bar"><button class="link" data-cancel>Cancel</button><b>${isNew ? "New outing" : "Edit"}</b><button class="link strong" data-save>Save</button></div>
    <form class="form" onsubmit="return false">
      <label>Title<input name="title" value="${esc(a.title)}" placeholder="e.g. An Teallach traverse"></label>
      <div class="row2">
        <label>Date<input type="date" name="date" value="${dateStr}"></label>
        <label>Kind<select name="kind">${Object.entries(KINDS).map(([k, v]) => opt(k, `${v.icon} ${v.label}`, a.kind)).join("")}</select></label>
      </div>
      ${isClimbing(a.kind) ? `
      <div class="row2">
        <label>Location<input name="place" value="${esc(a.place)}" placeholder="e.g. Napoleonica" list="dl-loc" autocomplete="off"></label>
        <label>Sector<input name="sector" value="${esc(a.sector || "")}" placeholder="e.g. Calabroni" list="dl-sec" autocomplete="off"></label>
      </div>
      <datalist id="dl-loc">${knownLocations().map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <datalist id="dl-sec">${knownSectors(a.place).map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <label>Country<input name="country" value="${esc(a.country)}"></label>` : `
      <div class="row2">
        <label>Place<input name="place" value="${esc(a.place)}" placeholder="e.g. Glencoe"></label>
        <label>Country<input name="country" value="${esc(a.country)}"></label>
      </div>`}
      <fieldset><legend>${isClimbing(a.kind) ? "Sector position" : "Position"}</legend>
        <div class="row"><input type="search" id="pos-q" placeholder="Search a crag, village, summit…"><button class="btn small" data-possearch>Search</button></div>
        <div id="pos-res" class="pos-res"></div>
        <div class="map small" id="pos-map"></div>
        <p class="hint" id="pos-note">${a.latitude != null ? `${(+a.latitude).toFixed(5)}, ${(+a.longitude).toFixed(5)} — tap the map to move it` : "Search, or tap the map to set the position"}</p>
      </fieldset>
      ${crag ? `
        <fieldset><legend>Routes</legend>
          <div id="routes">${(a.routes || []).map(routeRow).join("")}</div>
          <button class="btn small" data-addroute>+ Add route</button>
          <details><summary>Paste a list (one route per line, OneNote style)</summary>
            <textarea id="paste" rows="4" placeholder="6a+ - Slalom - da secondo"></textarea>
            <button class="btn small" data-paste>Add these routes</button></details>
        </fieldset>` : `
        <fieldset><legend>Track</legend>
          <div class="row gpx"><span>${a.gpxFile ? "〰︎ " + esc(a.gpxFile.split("/").pop()) : "No GPX track"}</span>
            <label class="btn small">${a.gpxFile ? "Replace" : "Import GPX"}<input type="file" id="gpx-in" hidden></label>
            ${a.gpxFile ? `<button class="btn small" data-rmgpx>Remove</button>` : ""}</div>
          <p class="hint" id="gpx-note"></p>
          <div class="row3">
            <label>Distance (km)<input name="distanceKm" inputmode="decimal" value="${a.distanceKm ?? ""}"></label>
            <label>Height gain (m)<input name="elevationGainM" inputmode="numeric" value="${a.elevationGainM ?? ""}"></label>
          </div>
          <div class="row3">
            <label>Hours<input name="h" inputmode="numeric" value="${dur != null ? Math.floor(dur / 60) : ""}"></label>
            <label>Minutes<input name="m" inputmode="numeric" value="${dur != null ? Math.round(dur % 60) : ""}"></label>
            ${hasGrade(a.kind) ? `<label>Grade<input name="grade" value="${esc(a.grade)}" placeholder="${a.kind === "ferrata" ? "C/D" : "AD+ / 6a"}"></label>` : ""}
          </div>
        </fieldset>
        ${hasPitches(a.kind) ? `<fieldset><legend>Pitches</legend>
          <div id="routes" class="pitches">${(a.routes || []).map((r, i) => routeRow(r, i, true)).join("")}</div>
          <button class="btn small" data-addroute>+ Add pitch</button>
        </fieldset>` : ""}`}
      <label>Partners<input name="partners" value="${esc(a.partners)}"></label>
      <label>Notes<textarea name="notes" rows="6">${esc(a.notes)}</textarea></label>
      <fieldset><legend>Photos</legend>
        <div class="grid edit">${(a.photos || []).map((p) => photoTile(p, a)).join("")}</div>
        <label class="btn small">+ Add photos<input type="file" id="ph-in" accept="image/*" multiple hidden></label>
        ${a.photos?.length > 1 ? `<p class="hint">Tap ☆ to choose the cover photo.</p>` : ""}
      </fieldset>
      ${isNew ? "" : `<button class="btn danger" data-delete>Delete outing</button>`}
    </form>`);
  hydrate(sheet);
  bindEditor(isNew);
}

const routeRow = (r, i = 0, pitch = false) => `<div class="route${pitch ? " pitch" : ""}" data-id="${r.id}">
  ${pitch ? `<span class="pn">P${i + 1}</span>` : ""}<input class="g" value="${esc(r.grade)}" placeholder="${pitch ? "5b" : "6a"}"><input class="n" value="${esc(r.name)}" placeholder="${pitch ? "Pitch notes" : "Route"}">
  <select class="s">${Object.entries(pitch ? PITCH_STYLES : STYLES).map(([k, v]) => opt(k, v, r.style)).join("")}</select>
  <button class="x" aria-label="Remove">✕</button></div>`;

function photoTile(p, a) {
  const pend = pending.find((x) => x.path === p);
  const isCover = (a.coverPhoto && a.photos.includes(a.coverPhoto) ? a.coverPhoto : a.photos[0]) === p;
  return `<div class="ph ${isCover ? "cover-on" : ""}" data-p="${esc(p)}">
    <img ${pend ? `src="${pend.preview}"` : `data-thumb="${esc(p)}"`} alt="">
    <button class="star" aria-label="Use as cover">${isCover ? "★" : "☆"}</button><button class="x" aria-label="Remove">✕</button></div>`;
}

function readForm() {
  const f = sheet.querySelector("form"), v = (n) => f.elements[n]?.value;
  const a = draft;
  a.title = v("title").trim();
  const [y, mo, d] = v("date").split("-").map(Number);
  const old = new Date(a.date);
  a.date = new Date(Date.UTC(y, mo - 1, d, old.getUTCHours() || 9, old.getUTCMinutes())).toISOString().replace(/\.\d+Z$/, "Z");
  a.kind = v("kind"); a.place = v("place").trim(); a.country = v("country").trim();
  if (f.elements.sector) a.sector = v("sector").trim();
  a.partners = v("partners").trim(); a.notes = v("notes");
  if (f.elements.distanceKm) {
    const num = (s) => (s && s.trim() !== "" && !Number.isNaN(+s.replace(",", ".")) ? +s.replace(",", ".") : null);
    a.distanceKm = num(v("distanceKm")); a.elevationGainM = num(v("elevationGainM"));
    const h = num(v("h")) || 0, m = num(v("m")) || 0;
    a.durationMinutes = h || m ? h * 60 + m : null;
    for (const k of ["distanceKm", "elevationGainM", "durationMinutes"]) if (a[k] == null) delete a[k];
  }
  if (f.elements.grade) a.grade = v("grade").trim();
  if (sheet.querySelector("#routes")) {
    a.routes = [...sheet.querySelectorAll(".route")].map((r) => ({
      id: r.dataset.id, grade: $(".g", r).value.trim(), name: $(".n", r).value.trim(), style: $(".s", r).value,
    })).filter((r) => hasPitches(a.kind) || r.grade || r.name);
  }
}

function bindEditor(isNew) {
  const s = sheet;
  s.querySelector("[data-cancel]").onclick = () => { draft = null; pending = []; sessionStorage.removeItem("fromIdea"); back(); };
  s.querySelector("[name=kind]").onchange = () => { readForm(); renderEditor(isNew); };
  s.querySelector("[data-save]").onclick = () => saveDraft(isNew);
  s.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm("Delete this outing? Its GPX and photos stay in OneDrive.")) return;
    await deleteActivity(draft.id); draft = null; toast("Deleted"); go("#/log");
  });
  s.querySelector("[data-addroute]")?.addEventListener("click", () => {
    readForm(); draft.routes.push({ id: uuid(), name: "", grade: "", style: "redpoint" }); renderEditor(isNew);
  });
  s.querySelector("[data-paste]")?.addEventListener("click", () => {
    readForm(); draft.routes.push(...parseRoutes($("#paste", s).value)); renderEditor(isNew);
  });
  s.querySelectorAll(".route .x").forEach((b) => (b.onclick = () => { b.closest(".route").remove(); }));
  s.querySelector("[data-rmgpx]")?.addEventListener("click", () => { readForm(); delete draft.gpxFile; renderEditor(isNew); });
  s.querySelector("#gpx-in")?.addEventListener("change", (e) => importGPX(e.target.files[0], isNew));
  s.querySelector("#ph-in").onchange = (e) => addPhotos([...e.target.files], isNew);
  bindPosition(isNew);
  s.querySelectorAll(".grid.edit .ph").forEach((t) => {
    t.querySelector(".star").onclick = () => { readForm(); draft.coverPhoto = t.dataset.p; renderEditor(isNew); };
    t.querySelector(".x").onclick = () => {
      readForm(); draft.photos = draft.photos.filter((p) => p !== t.dataset.p);
      pending = pending.filter((x) => x.path !== t.dataset.p);
      if (draft.coverPhoto === t.dataset.p) delete draft.coverPhoto;
      renderEditor(isNew);
    };
  });
}

// ---- known crags and the position picker
function knownLocations() {
  return [...new Set(data.activities.filter((x) => isClimbing(x.kind) && x.place).map((x) => x.place))].sort();
}
function knownSectors(loc) {
  const l = (loc || "").toLowerCase();
  return [...new Set(data.activities.filter((x) => (x.place || "").toLowerCase() === l && x.sector).map((x) => x.sector))].sort();
}
function knownPosition(loc, sec, id) {
  const l = (loc || "").trim().toLowerCase(), s = (sec || "").trim().toLowerCase();
  if (!l) return null;
  return data.activities.find((x) => x.id !== id && x.latitude != null && (x.place || "").toLowerCase() === l && (x.sector || "").toLowerCase() === s) || null;
}

let autoPositioned = false;
function bindPosition(isNew, obj = draft, autoFill = true) {
  const el = $("#pos-map", sheet);
  const m = makeMap(el);
  let marker = null;
  const note = $("#pos-note", sheet);
  const setPos = (lat, lon, msg, zoom) => {
    obj.latitude = +lat.toFixed(6); obj.longitude = +lon.toFixed(6);
    if (marker) marker.setLatLng([lat, lon]);
    else marker = L.marker([lat, lon], { draggable: true }).addTo(m).on("dragend", (e) => { const p = e.target.getLatLng(); setPos(p.lat, p.lng); autoPositioned = false; });
    if (zoom) m.setView([lat, lon], zoom, { animate: false });
    note.textContent = msg || `${obj.latitude.toFixed(5)}, ${obj.longitude.toFixed(5)} — tap the map or drag the pin to move it`;
  };
  if (obj.latitude != null) { setPos(obj.latitude, obj.longitude); m.setView([obj.latitude, obj.longitude], 14, { animate: false }); }
  else m.setView([45.65, 13.78], 9, { animate: false });
  m.on("click", (e) => { setPos(e.latlng.lat, e.latlng.lng); autoPositioned = false; });

  const q = $("#pos-q", sheet), res = $("#pos-res", sheet);
  const search = async () => {
    const term = q.value.trim() || [obj.sector, obj.place || obj.area, obj.country].filter(Boolean).join(", ");
    if (!term) return;
    q.value = term; res.innerHTML = `<p class="hint">Searching…</p>`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(term)}`);
      const items = await r.json();
      res.innerHTML = items.length ? items.map((it, i) => `<button class="pos-item" data-i="${i}"><b>${esc(it.name || it.display_name.split(",")[0])}</b><small>${esc(it.display_name)}</small></button>`).join("") : `<p class="hint">Nothing found — try a nearby village, or tap the map.</p>`;
      res.querySelectorAll(".pos-item").forEach((b) => (b.onclick = (ev) => {
        ev.preventDefault(); const it = items[+b.dataset.i];
        setPos(+it.lat, +it.lon, null, 15); res.innerHTML = ""; autoPositioned = false;
      }));
    } catch { res.innerHTML = `<p class="hint">Search isn't available right now — tap the map instead.</p>`; }
  };
  sheet.querySelector("[data-possearch]").onclick = (e) => { e.preventDefault(); search(); };
  q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } };

  // known location + sector → reuse the position from earlier outings
  const f = sheet.querySelector("form");
  if (!autoFill) { setTimeout(() => { if (document.contains(el)) m.invalidateSize(); }, 50); return; }
  const auto = () => {
    if (!isClimbing(f.elements.kind.value) || obj.gpxFile || (obj.latitude != null && !autoPositioned)) return;
    const hit = knownPosition(f.elements.place.value, f.elements.sector?.value, obj.id);
    if (!hit) return;
    autoPositioned = true;
    setPos(hit.latitude, hit.longitude, `Position filled in from your earlier outings at ${placeLine(hit)}`, 14);
    if (!f.elements.country.value && hit.country) f.elements.country.value = hit.country;
  };
  f.elements.place.addEventListener("change", () => {
    auto();
    const dl = $("#dl-sec", sheet); if (dl) dl.innerHTML = knownSectors(f.elements.place.value).map((x) => `<option value="${esc(x)}">`).join("");
  });
  f.elements.sector?.addEventListener("change", auto);
  setTimeout(() => { if (document.contains(el)) m.invalidateSize(); }, 50);
}

async function importGPX(file, isNew) {
  if (!file) return;
  readForm();
  const text = await file.text();
  const t = parseGPX(text), st = gpxStats(t, draft.kind === "bike" ? 70 : 25);
  if (st && draft.kind === "kayak") st.elevationGainM = null;
  if (!st) { $("#gpx-note", sheet).textContent = "Couldn't find a track in that file."; return; }
  const day = new Date(draft.date).toISOString().slice(0, 10);
  const name = file.name.toLowerCase().endsWith(".gpx") ? file.name : file.name + ".gpx";
  const path = `gpx/${day} ${name}`;
  pending = pending.filter((x) => x.path !== draft.gpxFile);
  pending.push({ path, blob: new Blob([text], { type: "application/gpx+xml" }), type: "application/gpx+xml" });
  tracks.set(path, Promise.resolve(t));
  draft.gpxFile = path;
  for (const k of ["distanceKm", "elevationGainM", "durationMinutes", "maxAltitudeM"]) if (st[k] != null) draft[k] = st[k];
  draft.latitude = st.start.lat; draft.longitude = st.start.lon;
  if (isNew && st.startTime) draft.date = st.startTime.toISOString().replace(/\.\d+Z$/, "Z");
  if (!draft.title && t.name) draft.title = t.name;
  if (!draft.country || !draft.place) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat=${st.start.lat}&lon=${st.start.lon}`);
      const j = await r.json(), ad = j.address || {};
      draft.country ||= ad.country || "";
      draft.place ||= ad.village || ad.town || ad.city || ad.hamlet || ad.county || ad.state || "";
    } catch {}
  }
  renderEditor(isNew);
  $("#gpx-note", sheet).textContent = `${t.points.length} points read — distance, height gain and time filled in from the track.`;
}

async function shrink(file, max = 2560) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  } catch { return file; }
}

async function addPhotos(files, isNew) {
  readForm();
  toast(`Preparing ${files.length} photo${files.length === 1 ? "" : "s"}…`);
  for (const f of files) {
    const blob = await shrink(f);
    const base = (f.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "_") || "photo";
    const path = `photos/${draft.id.slice(0, 8)}/${base}-${Date.now().toString(36)}.jpg`;
    pending.push({ path, blob, type: "image/jpeg", preview: URL.createObjectURL(blob) });
    draft.photos = [...(draft.photos || []), path];
  }
  renderEditor(isNew);
}

async function saveDraft(isNew) {
  readForm();
  const btn = sheet.querySelector("[data-save]");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    for (const [i, p] of pending.entries()) {
      toast(`Uploading ${i + 1} of ${pending.length}…`, 60000);
      const stored = await backend.upload(p.path, p.blob, p.type);
      if (stored !== p.path) {
        draft.photos = draft.photos.map((x) => (x === p.path ? stored : x));
        if (draft.gpxFile === p.path) draft.gpxFile = stored;
        if (draft.coverPhoto === p.path) draft.coverPhoto = stored;
      }
    }
    pending = [];
    const clean = { ...draft }; delete clean._saved; delete clean.review;   // saving an edit counts as reviewed
    await saveActivity(clean);
    const fromIdea = sessionStorage.getItem("fromIdea");
    if (fromIdea) { await deleteIdea(fromIdea); sessionStorage.removeItem("fromIdea"); }
    toast("Saved");
    const id = draft.id; draft = null;
    location.replace(`#/a/${id}`);
  } catch (e) {
    toast(e.message || "Couldn't save");
    btn.disabled = false; btn.textContent = "Save";
  }
}

// ------------------------------------------------------------------ MAP
function renderMap() {
  const list = filtered({ q: "" }).filter((a) => a.latitude != null);
  main.innerHTML = `<div class="mapwrap"><div id="bigmap"></div>
    <div class="map-filters">${yearSelect(ui.year)}${kindSelect(ui.kind)}<button class="btn small" id="tracks">Show tracks</button></div></div>`;
  const m = makeMap($("#bigmap"));
  const pts = [];
  for (const a of list) {
    const k = kindOf(a.kind);
    const mk = L.marker([a.latitude, a.longitude], { icon: kindIcon(a.kind) }).addTo(m);
    mk.bindPopup(`<b>${esc(titleOf(a))}</b><br><small>${esc(fmtDate(a.date))} · ${esc(summary(a))}</small><br><a href="#/a/${a.id}">Open ›</a>`);
    pts.push([a.latitude, a.longitude]);
  }
  if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); else m.setView([46, 11], 5);
  $("#f-year").onchange = (e) => { ui.year = e.target.value; renderTab("map"); };
  $("#f-kind").onchange = (e) => { ui.kind = e.target.value; renderTab("map"); };
  $("#tracks").onclick = async () => {
    const withTracks = list.filter((a) => a.gpxFile).slice(0, 60);
    if (!withTracks.length) return toast("No GPX tracks for this selection");
    toast(`Loading ${withTracks.length} track${withTracks.length === 1 ? "" : "s"}${withTracks.length === 60 ? " (first 60 — pick a year for fewer)" : ""}…`);
    await Promise.all(withTracks.map(async (a) => {
      const t = await loadTrack(a.gpxFile);
      if (t?.points.length) L.polyline(latlngs(t), { color: kindOf(a.kind).color, weight: 3, opacity: 0.85 })
        .bindPopup(`<b>${esc(titleOf(a))}</b><br><a href="#/a/${a.id}">Open ›</a>`).addTo(m);
    }));
  };
}

// ------------------------------------------------------------------ STATS
function renderStats() {
  const list = filtered({ year: ui.statsYear, kind: "", q: "" });
  const sum = (k) => list.reduce((s, a) => s + (a[k] || 0), 0);
  const days = new Set(list.map((a) => a.date.slice(0, 10))).size;
  const countries = [...new Set(list.map((a) => a.country).filter(Boolean))].sort();
  const routes = list.reduce((s, a) => s + (a.routes?.length || 0), 0);
  main.innerHTML = `
    <header class="bar"><h1>${ui.statsYear ? "Your " + ui.statsYear : "All time"}</h1>${yearSelect(ui.statsYear, "s-year")}</header>
    <div class="tiles">
      ${tile("Outings", list.length, "#34a853")}${tile("Days out", days, "#f08c00")}
      ${tile("Distance", fmtKm(sum("distanceKm")), "#3b82f6")}${tile("Height gain", fmtM(sum("elevationGainM")), "#5b5bd6")}
      ${tile("Time out", Math.round(sum("durationMinutes") / 60) + " h", "#0d9488")}${tile("Routes climbed", routes, "#e5484d")}
      ${tile("Countries", countries.length, "#9d4edd")}
    </div>
    <h2 class="sec">Records</h2><div class="records">${records(list).map((r) =>
      `<a class="rec" href="#/a/${r.a.id}"><small>${r.t}</small><b>${esc(r.v)}</b><span>${esc(titleOf(r.a))} · ${esc(fmtDate(r.a.date))}</span></a>`).join("") || `<p class="dim">Log some outings to see records.</p>`}</div>
    <h2 class="sec">Charts</h2>
    <div class="chart"><h3>Outings per ${ui.statsYear ? "month" : "year"}</h3><canvas id="c-count"></canvas></div>
    <div class="chart"><h3>Distance per ${ui.statsYear ? "month" : "year"} (km)</h3><canvas id="c-dist"></canvas></div>
    <div class="chart"><h3>Height gain per ${ui.statsYear ? "month" : "year"} (m)</h3><canvas id="c-gain"></canvas></div>
    ${["rock", "ferrata", "alpine"].map((s) => `<div class="chart" id="w-${s}"><h3>${{ rock: "Rock grade progression", ferrata: "Via ferrata grades", alpine: "Alpine grades" }[s]}</h3><canvas id="c-${s}"></canvas></div>`).join("")}
    <div class="chart"><h3>Distance of each outing (km)</h3><canvas id="c-each"></canvas></div>
    ${countries.length ? `<h2 class="sec">Countries</h2><div class="chips">${countries.map((c) => `<span>${esc(c)} · ${list.filter((a) => a.country === c).length}</span>`).join("")}</div>` : ""}`;
  $("#s-year").onchange = (e) => { ui.statsYear = e.target.value; renderTab("stats"); };
  if (list.length) drawCharts(list);
}
const tile = (t, v, c) => `<div class="tile" style="--c:${c}"><b>${esc(v)}</b><small>${t}</small></div>`;

function records(list) {
  const out = [];
  const best = (t, items, fmt) => { const m = items.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null); if (m) out.push({ t, v: fmt(m), a: m[0] }); };
  const crag = ["sportClimb", "climbingGym", "bouldering"];
  const hardest = (t, styles) => best(t, list.filter((a) => crag.includes(a.kind)).flatMap((a) => (a.routes || [])
    .filter((r) => styles.includes(r.style)).map((r) => [a, gradeScore(r.grade, a.kind), r.grade]).filter((x) => x[1]?.scale === "rock")
    .map((x) => [x[0], x[1].value, x[2]])), (m) => m[2]);
  const hardestGrade = (t, kinds) => best(t, list.filter((a) => kinds.includes(a.kind)).map((a) => [a, gradeScore(a.grade, a.kind)?.value ?? null]).filter((x) => x[1] != null), (m) => m[0].grade);
  hardest("Hardest onsight", ["onsight", "flash"]);
  hardest("Hardest redpoint", ["onsight", "flash", "redpoint"]);
  hardestGrade("Hardest multipitch", ["multipitch"]);
  hardestGrade("Hardest mountaineering", ["mountaineering", "winterMountaineering", "winterClimb"]);
  hardestGrade("Hardest via ferrata", ["ferrata"]);
  const f = (k, fmt) => (m) => fmt(m[1]);
  list = list.filter((a) => a.kind !== "other");   // no ski days, road trips, boat trips in records
  best("Longest distance", list.filter((a) => a.distanceKm != null).map((a) => [a, a.distanceKm]), f(0, fmtKm));
  best("Biggest height gain", list.filter((a) => a.elevationGainM != null).map((a) => [a, a.elevationGainM]), f(0, fmtM));
  best("Longest day", list.filter((a) => a.durationMinutes != null).map((a) => [a, a.durationMinutes]), f(0, fmtDur));
  best("Highest point", list.filter((a) => a.maxAltitudeM != null).map((a) => [a, a.maxAltitudeM]), f(0, fmtM));
  return out;
}

function drawCharts(list) {
  const css = getComputedStyle(document.body);
  Chart.defaults.color = css.getPropertyValue("--dim").trim() || "#888";
  Chart.defaults.borderColor = css.getPropertyValue("--line").trim() || "#ddd";
  Chart.defaults.font.family = "-apple-system, system-ui, sans-serif";
  const byMonth = !!ui.statsYear;
  const periods = byMonth ? [...Array(12).keys()] : [...new Set(list.map(yearOf))].sort();
  const label = (p) => (byMonth ? new Date(2000, p, 1).toLocaleString(undefined, { month: "short" }) : String(p));
  const pOf = (a) => (byMonth ? new Date(a.date).getMonth() : yearOf(a));
  const kinds = Object.keys(KINDS).filter((k) => list.some((a) => a.kind === k));
  const stacked = (id, val) => charts.push(new Chart($(id), {
    type: "bar",
    data: { labels: periods.map(label), datasets: kinds.map((k) => ({ label: kindOf(k).label, backgroundColor: kindOf(k).color,
      data: periods.map((p) => list.filter((a) => a.kind === k && pOf(a) === p).reduce((s, a) => s + val(a), 0)) })).filter((d) => d.data.some((v) => v > 0)) },
    options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
  }));
  stacked("#c-count", () => 1);
  stacked("#c-dist", (a) => a.distanceKm || 0);
  stacked("#c-gain", (a) => a.elevationGainM || 0);

  for (const scale of ["rock", "ferrata", "alpine"]) {
    const pts = [];
    for (const a of list) {
      const t = +new Date(a.date);
      if (a.routes?.length) for (const r of a.routes) { const s = gradeScore(r.grade, a.kind); if (s?.scale === scale) pts.push({ x: t, y: s.value, style: STYLES[r.style] || r.style, label: `${r.grade} ${r.name || ""}` }); }
      else { const s = gradeScore(a.grade, a.kind); if (s?.scale === scale) pts.push({ x: t, y: s.value, style: kindOf(a.kind).label, label: `${a.grade} ${titleOf(a)}` }); }
    }
    if (!pts.length) { $(`#w-${scale}`).remove(); continue; }
    pts.sort((a, b) => a.x - b.x);
    let top = -1; const bestLine = pts.map((p) => ({ x: p.x, y: (top = Math.max(top, p.y)) }));
    const styles = [...new Set(pts.map((p) => p.style))];
    const palette = ["#34a853", "#3b82f6", "#f08c00", "#e5484d", "#9d4edd", "#0d9488", "#6b7280"];
    charts.push(new Chart($(`#c-${scale}`), {
      data: { datasets: [
        ...styles.map((s, i) => ({ type: "scatter", label: s, data: pts.filter((p) => p.style === s), backgroundColor: palette[i % palette.length], pointRadius: 4 })),
        { type: "line", label: "Best so far", data: bestLine, stepped: true, borderColor: "#9995", borderDash: [4, 3], pointRadius: 0, borderWidth: 1.5 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { type: "linear", ticks: { maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString(undefined, { month: "short", year: "2-digit" }) } },
                  y: { ticks: { stepSize: scale === "rock" ? 2 : 1, callback: (v) => gradeLabel(scale, v) } } },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => c.raw.label || gradeLabel(scale, c.raw.y) } } } },
    }));
  }
  const each = list.filter((a) => a.distanceKm != null);
  charts.push(new Chart($("#c-each"), {
    type: "scatter",
    data: { datasets: [{ data: each.map((a) => ({ x: +new Date(a.date), y: a.distanceKm, label: titleOf(a) })), backgroundColor: each.map((a) => kindOf(a.kind).color), pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw.label}: ${fmtKm(c.raw.y)}` } } },
      scales: { x: { type: "linear", ticks: { maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString(undefined, { month: "short", year: "2-digit" }) } } } },
  }));
}

// ------------------------------------------------------------------ IDEAS
function renderIdeas() {
  const areas = [...new Set(data.ideas.map((i) => i.area).filter(Boolean))].sort();
  const list = data.ideas.filter((i) => (!ui.area || i.area === ui.area) && (!ui.season || i.season === ui.season || i.season === "any"));
  const groups = {};
  list.forEach((i) => (groups[i.area || "Elsewhere"] ||= []).push(i));
  main.innerHTML = `
    <header class="bar"><h1>Trip ideas</h1></header>
    <div class="filters"><div class="row">
      <select id="i-area">${opt("", "All areas", ui.area)}${areas.map((a) => opt(a, a, ui.area)).join("")}</select>
      <select id="i-season">${opt("", "Any season", ui.season)}${opt("summer", "Summer", ui.season)}${opt("winter", "Winter", ui.season)}</select>
    </div></div>
    ${list.length ? "" : `<div class="empty">No trip ideas yet — tap + to jot one down.</div>`}
    ${Object.keys(groups).sort().map((g) => `<section><h2 class="yh"><span>${esc(g)}</span><small>${groups[g].length}</small></h2>
      <ul class="list">${groups[g].map((i) => `<li><a class="item" href="#/i/${i.id}">
        <span class="thumb">${kindImg(i.kind)}</span>
        <span class="txt"><b>${esc(i.title)}</b><small>${esc([kindOf(i.kind).label, i.grade, i.solo === false ? "with partner" : "solo", i.season !== "any" ? i.season : ""].filter(Boolean).join(" · "))}</small></span></a></li>`).join("")}</ul></section>`).join("")}`;
  $("#i-area").onchange = (e) => { ui.area = e.target.value; renderIdeas(); };
  $("#i-season").onchange = (e) => { ui.season = e.target.value; renderIdeas(); };
}

function openIdeaRecord(id) {
  const i = data.ideas.find((x) => x.id === id);
  if (!i) return go("#/ideas");
  const k = kindOf(i.kind);
  const cover = i.coverPhoto && i.photos?.includes(i.coverPhoto) ? i.coverPhoto : i.photos?.[0];
  const links = (i.links || "").split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  const hasMap = i.gpxFile || i.latitude != null;
  openSheet(`
    <div class="sheet-bar"><button class="link" data-back>‹ Back</button><a class="link" href="#/idea/${i.id}">Edit</a></div>
    ${cover ? `<div class="cover"><img data-thumb="${esc(cover)}" data-size="large" alt=""></div>` : ""}
    <div class="pad">
      <div class="kind" style="color:${k.color}">${kindImg(i.kind, "kimg-s")} ${esc(k.label)}</div>
      <h1>${esc(i.title)}</h1>
      <p class="sub">${esc([i.area, i.country].filter(Boolean).join(", "))}</p>
      <div class="chips idea-chips">${[i.grade && "Grade " + i.grade, i.solo === false ? "With partner" : "Solo", i.season && i.season !== "any" ? i.season[0].toUpperCase() + i.season.slice(1) : "Any season"].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      <button class="btn primary wide" id="idea-done">✓ Done it — add to logbook</button>
      ${hasMap ? `<div class="map" id="idea-map"></div>` : ""}
      ${i.gpxFile ? `<div class="profile"><canvas id="idea-prof"></canvas></div>
        <div class="row gpx"><span>〰︎ ${esc(i.gpxFile.split("/").pop())}</span><button class="btn small" id="idea-dl">Download GPX</button></div>` : ""}
      ${links.length ? `<h3>Links</h3><div class="links">${links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">↗ ${esc(new URL(u).hostname)}</a>`).join("")}</div>` : ""}
      ${i.notes ? `<div class="notes">${linkify(i.notes)}</div>` : ""}
      ${i.photos?.length ? `<div class="grid">${i.photos.map((p) => `<button class="ph" data-photo="${esc(p)}"><img data-thumb="${esc(p)}" alt=""></button>`).join("")}</div>` : ""}
      ${!hasMap && !i.notes && !links.length && !i.photos?.length ? `<p class="hint">Nothing added yet — tap Edit to add notes, links, pictures, a GPX track or a map position.</p>` : ""}
    </div>`);
  hydrate(sheet);
  sheet.querySelector("[data-back]").onclick = back;
  sheet.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = () => openPhoto(b.dataset.photo)));
  $("#idea-done", sheet).onclick = () => { sessionStorage.setItem("fromIdea", i.id); draft = null; location.replace("#/edit/new"); };
  $("#idea-dl", sheet)?.addEventListener("click", async () => {
    const u = await backend.downloadURL(i.gpxFile);
    if (u) { const l = document.createElement("a"); l.href = u; l.download = i.gpxFile.split("/").pop(); l.target = "_blank"; l.click(); }
  });
  if (hasMap) drawIdeaMap(i);
}

async function drawIdeaMap(i) {
  const el = $("#idea-map", sheet), m = makeMap(el), col = kindOf(i.kind).color;
  if (i.latitude != null) { m.setView([i.latitude, i.longitude], 13, { animate: false }); L.marker([i.latitude, i.longitude], { icon: kindIcon(i.kind) }).addTo(m); }
  if (!i.gpxFile) return;
  const t = await loadTrack(i.gpxFile);
  if (!t || !t.points.length || !document.contains(el)) return;
  const line = L.polyline(latlngs(t), { color: col, weight: 4 }).addTo(m);
  m.fitBounds(line.getBounds(), { padding: [20, 20], animate: false });
  const prof = profile(t);
  if (prof.length > 1 && $("#idea-prof", sheet)) charts.push(new Chart($("#idea-prof", sheet), {
    type: "line",
    data: { datasets: [{ data: prof, borderColor: col, backgroundColor: col + "33", fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { type: "linear", ticks: { callback: (v) => `${v} km`, maxTicksLimit: 6 } }, y: { ticks: { callback: (v) => `${v} m`, maxTicksLimit: 4 } } } },
  }));
}

let ideaDraft = null, ideaPending = [];
function openIdea(id) {
  const existing = id !== "new" && data.ideas.find((x) => x.id === id);
  if (!ideaDraft || (existing && ideaDraft.id !== existing.id)) { ideaDraft = existing ? structuredClone(existing) : newIdea(); ideaPending = []; }
  const i = ideaDraft;
  const links = (i.links || "").split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  openSheet(`
    <div class="sheet-bar"><button class="link" data-cancel>Cancel</button><b>${existing ? "Trip idea" : "New trip idea"}</b><button class="link strong" data-save>Save</button></div>
    <form class="form" onsubmit="return false">
      <label>Idea<input name="title" value="${esc(i.title)}" placeholder="e.g. Balza della Penna"></label>
      <div class="row2"><label>Area<input name="area" value="${esc(i.area)}" placeholder="Mercatale, Trieste, UK…" list="areas"></label>
        <label>Country<input name="country" value="${esc(i.country)}"></label></div>
      <datalist id="areas">${[...new Set(data.ideas.map((x) => x.area).filter(Boolean))].map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
      <div class="row2"><label>Kind<select name="kind">${Object.entries(KINDS).map(([k, v]) => opt(k, `${v.icon} ${v.label}`, i.kind)).join("")}</select></label>
        <label>Grade<input name="grade" value="${esc(i.grade)}" placeholder="optional"></label></div>
      <div class="seg" data-name="solo">${[["true", "Solo"], ["false", "With partner"]].map(([v, l]) => `<button data-v="${v}" class="${String(i.solo !== false) === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="seg" data-name="season">${[["any", "Any season"], ["summer", "Summer"], ["winter", "Winter"]].map(([v, l]) => `<button data-v="${v}" class="${(i.season || "any") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <label>Links<textarea name="links" rows="2" placeholder="Paste web links">${esc(i.links)}</textarea></label>
      ${links.length ? `<div class="links">${links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">↗ ${esc(new URL(u).hostname)}</a>`).join("")}</div>` : ""}
      <label>Notes<textarea name="notes" rows="5">${esc(i.notes)}</textarea></label>
      <fieldset><legend>Track</legend>
        <div class="row gpx"><span>${i.gpxFile ? "〰︎ " + esc(i.gpxFile.split("/").pop()) : "No GPX track"}</span>
          <label class="btn small">${i.gpxFile ? "Replace" : "Import GPX"}<input type="file" id="igpx-in" hidden></label>
          ${i.gpxFile ? `<button class="btn small" data-rmgpx>Remove</button>` : ""}</div>
        <p class="hint" id="igpx-note"></p>
      </fieldset>
      <fieldset><legend>Position</legend>
        <div class="row"><input type="search" id="pos-q" placeholder="Search a crag, village, summit…"><button class="btn small" data-possearch>Search</button></div>
        <div id="pos-res" class="pos-res"></div>
        <div class="map small" id="pos-map"></div>
        <p class="hint" id="pos-note">${i.latitude != null ? `${(+i.latitude).toFixed(5)}, ${(+i.longitude).toFixed(5)}` : "Search, or tap the map to set the position"}</p>
      </fieldset>
      <fieldset><legend>Pictures / maps</legend>
        <div class="grid edit">${(i.photos || []).map((p) => { const pend = ideaPending.find((x) => x.path === p);
          const isCover = (i.coverPhoto && i.photos.includes(i.coverPhoto) ? i.coverPhoto : i.photos[0]) === p;
          return `<div class="ph ${isCover ? "cover-on" : ""}" data-p="${esc(p)}"><img ${pend ? `src="${pend.preview}"` : `data-thumb="${esc(p)}"`} alt=""><button class="star" aria-label="Use as cover">${isCover ? "★" : "☆"}</button><button class="x">✕</button></div>`; }).join("")}</div>
        <label class="btn small">+ Add pictures<input type="file" id="ph-in" accept="image/*" multiple hidden></label>
      </fieldset>
      ${existing ? `<button class="btn primary" data-done>✓ Done it — add to logbook</button><button class="btn danger" data-delete>Delete idea</button>` : ""}
    </form>`);
  hydrate(sheet);
  const s = sheet, f = s.querySelector("form");
  const read = () => {
    for (const k of ["title", "area", "country", "kind", "grade", "links", "notes"]) i[k] = f.elements[k].value.trim();
    i.solo = s.querySelector('[data-name=solo] .on').dataset.v === "true";
    i.season = s.querySelector('[data-name=season] .on').dataset.v;
  };
  s.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => { b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
  s.querySelector("[data-cancel]").onclick = () => { ideaDraft = null; back(); };
  f.elements.links.onchange = () => { read(); openIdea(id); };
  s.querySelector("#ph-in").onchange = async (e) => {
    read();
    for (const file of e.target.files) {
      const blob = await shrink(file), path = `photos/idea-${i.id.slice(0, 8)}/${Date.now().toString(36)}.jpg`;
      ideaPending.push({ path, blob, type: "image/jpeg", preview: URL.createObjectURL(blob) });
      i.photos = [...(i.photos || []), path];
    }
    openIdea(id);
  };
  s.querySelectorAll(".grid.edit .x").forEach((b) => (b.onclick = () => { read(); const p = b.parentElement.dataset.p; i.photos = i.photos.filter((x) => x !== p); if (i.coverPhoto === p) delete i.coverPhoto; openIdea(id); }));
  s.querySelectorAll(".grid.edit .star").forEach((b) => (b.onclick = (e) => { e.preventDefault(); read(); i.coverPhoto = b.parentElement.dataset.p; openIdea(id); }));
  s.querySelector("[data-rmgpx]")?.addEventListener("click", (e) => { e.preventDefault(); read(); delete i.gpxFile; openIdea(id); });
  s.querySelector("#igpx-in").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    read();
    const text = await file.text(), t = parseGPX(text), st = gpxStats(t);
    if (!st) { $("#igpx-note", s).textContent = "Couldn't find a track in that file."; return; }
    const path = `gpx/idea ${file.name.toLowerCase().endsWith(".gpx") ? file.name : file.name + ".gpx"}`;
    ideaPending.push({ path, blob: new Blob([text], { type: "application/gpx+xml" }), type: "application/gpx+xml" });
    tracks.set(path, Promise.resolve(t));
    i.gpxFile = path;
    if (i.latitude == null) { i.latitude = st.start.lat; i.longitude = st.start.lon; }
    openIdea(id);
    $("#igpx-note", sheet).textContent = `${fmtKm(st.distanceKm)}${st.elevationGainM != null ? " · ↑" + fmtM(st.elevationGainM) : ""}${st.maxAltitudeM != null ? " · top " + fmtM(st.maxAltitudeM) : ""}`;
  };
  bindPosition(false, i, false);
  s.querySelector("[data-save]").onclick = async () => {
    read();
    if (!i.title) return toast("Give the idea a name first");
    try {
      for (const p of ideaPending) {
        if (!i.photos.includes(p.path) && i.gpxFile !== p.path) continue;   // removed before saving
        const st = await backend.upload(p.path, p.blob, p.type);
        i.photos = i.photos.map((x) => (x === p.path ? st : x));
        if (i.gpxFile === p.path) i.gpxFile = st;
        if (i.coverPhoto === p.path) i.coverPhoto = st;
      }
      await saveIdea(i); ideaDraft = null; ideaPending = []; toast("Saved"); location.replace(`#/i/${i.id}`);
    } catch (e) { toast(e.message); }
  };
  s.querySelector("[data-delete]")?.addEventListener("click", async () => {
    if (!confirm("Delete this idea?")) return;
    await deleteIdea(i.id); ideaDraft = null; back();
  });
  s.querySelector("[data-done]")?.addEventListener("click", () => {
    sessionStorage.setItem("fromIdea", i.id); ideaDraft = null; draft = null; location.replace("#/edit/new");
  });
}

// ------------------------------------------------------------------ SETTINGS
function openSettings() {
  openSheet(`<div class="sheet-bar"><button class="link" data-back>‹ Back</button><b>Settings</b><span></span></div>
    <div class="pad">
      <p><small class="dim">Signed in as</small><br>${esc(backend.user)}</p>
      ${isDemo ? `<p class="hint">You're looking at sample data. Nothing is saved.</p>` : `
      <label class="form">Logbook folder in OneDrive<input id="folder" value="${esc(backend.root)}"></label>
      <p class="hint">Must match the folder the Mac app uses (default: Logbook).</p>`}
      <p><button class="btn" id="reload">Reload from OneDrive</button></p>
      <p><button class="btn danger" id="signout">${isDemo ? "Leave demo" : "Sign out"}</button></p>
      <p class="hint">Add to your Home Screen: Share ▸ Add to Home Screen.</p>
    </div>`);
  sheet.querySelector("[data-back]").onclick = back;
  $("#folder", sheet)?.addEventListener("change", (e) => { localStorage.setItem("logbook.folder", e.target.value.trim() || "Logbook"); localStorage.removeItem("logbook.cache"); location.reload(); });
  $("#reload", sheet).onclick = async () => { try { await refresh(); toast("Up to date"); } catch (e) { toast(e.message); } };
  $("#signout", sheet).onclick = () => backend.signOut();
}

boot();
