// Shared data model: mirrors the Mac app's logbook.json / ideas.json.

export const KINDS = {
  hike: { label: "Hike", color: "#34a853", icon: "🥾" },
  walk: { label: "Walk", color: "#2bb3a3", icon: "🚶" },
  scramble: { label: "Scramble", color: "#9c6b3f", icon: "🐐" },
  ferrata: { label: "Via ferrata", color: "#f08c00", icon: "🔗" },
  mountaineering: { label: "Mountaineering", color: "#5b5bd6", icon: "🏔️" },
  winterMountaineering: { label: "Winter mountaineering", color: "#1aa3c9", icon: "❄️" },
  sportClimb: { label: "Sport climbing", color: "#e5484d", icon: "🧗" },
  multipitch: { label: "Multipitch", color: "#e54d8f", icon: "⛰️" },
  alpineClimb: { label: "Alpine climb", color: "#9d4edd", icon: "🔺" },
  winterClimb: { label: "Winter climb", color: "#3b82f6", icon: "🧊" },
  iceClimb: { label: "Ice climb", color: "#2563eb", icon: "⛏️" },
  bouldering: { label: "Bouldering", color: "#dc2626", icon: "🪨" },
  climbingGym: { label: "Climbing gym", color: "#f87171", icon: "🏢" },
  snowshoeing: { label: "Snowshoeing", color: "#06b6d4", icon: "🌨️" },
  skiTouring: { label: "Ski touring", color: "#0ea5e9", icon: "⛷️" },
  kayak: { label: "Kayak", color: "#0d9488", icon: "🛶" },
  trailRun: { label: "Trail run", color: "#ca8a04", icon: "🏃" },
  bike: { label: "Bike", color: "#a16207", icon: "🚴" },
  other: { label: "Other", color: "#6b7280", icon: "⭐" },
};
export const kindOf = (k) => KINDS[k] || KINDS.other;
export const isClimbing = (k) => ["sportClimb", "multipitch", "alpineClimb", "winterClimb", "iceClimb", "bouldering", "climbingGym"].includes(k);
export const isCragDay = (k) => k === "sportClimb" || k === "bouldering" || k === "climbingGym";
export const hasGrade = (k) =>
  ["ferrata", "sportClimb", "multipitch", "alpineClimb", "winterClimb", "iceClimb", "bouldering",
   "climbingGym", "mountaineering", "winterMountaineering", "scramble"].includes(k);

export const STYLES = {
  onsight: "Onsight", flash: "Flash", redpoint: "Redpoint",
  toprope: "Top rope", second: "Seconded", attempt: "Attempt",
};

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
  })).toUpperCase();

export function newActivity(kind = "hike") {
  return { id: uuid(), date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), title: "", country: "", place: "",
           kind, grade: "", routes: [], partners: "", notes: "", photos: [] };
}
export function newIdea() {
  return { id: uuid(), title: "", area: "", country: "", kind: "hike", grade: "", solo: true, season: "any",
           links: "", notes: "", photos: [], created: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
}

export const yearOf = (a) => new Date(a.date).getFullYear();
export const coverOf = (a) => (a.coverPhoto && a.photos?.includes(a.coverPhoto) ? a.coverPhoto : a.photos?.[0]);
export const titleOf = (a) => a.title || a.place || kindOf(a.kind).label;
export const placeLine = (a) => {
  const loc = isClimbing(a.kind) && a.sector ? [a.place, a.sector].filter(Boolean).join(" › ") : a.place;
  return [loc, a.country].filter(Boolean).join(", ");
};

// ---- formatting
export const fmtKm = (v) => (v >= 100 ? `${Math.round(v)} km` : `${(Math.round(v * 10) / 10).toFixed(1)} km`);
export const fmtM = (v) => `${Math.round(v).toLocaleString()} m`;
export function fmtDur(min) {
  const t = Math.round(min), h = Math.floor(t / 60), m = t % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}
export const fmtDate = (d, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(d).toLocaleDateString(undefined, opts);

export function summary(a) {
  const p = [];
  if (isCragDay(a.kind)) {
    if (a.routes?.length) p.push(`${a.routes.length} route${a.routes.length === 1 ? "" : "s"}`);
    const g = topGrade(a); if (g) p.push(`top ${g.label}`);
  } else {
    if (a.distanceKm != null) p.push(fmtKm(a.distanceKm));
    if (a.elevationGainM != null) p.push("↑" + fmtM(a.elevationGainM));
    if (a.durationMinutes != null) p.push(fmtDur(a.durationMinutes));
    if (a.grade) p.push(a.grade);
  }
  return p.join(" · ");
}

// ---- grades (same rules as the Mac app)
export const FRENCH = (() => { const r = []; for (let n = 3; n <= 9; n++) for (const l of "abc") { r.push(`${n}${l}`); r.push(`${n}${l}+`); } return r; })();
export const FERRATA = ["A", "A/B", "B", "B/C", "C", "C/D", "D", "D/E", "E", "E/F", "F"];
export const ALPINE = ["F-", "F", "F+", "PD-", "PD", "PD+", "AD-", "AD", "AD+", "D-", "D", "D+", "TD-", "TD", "TD+", "ED-", "ED", "ED+", "ABO"];
const UIAA = [[3, "3a"], [3.67, "3c"], [4, "4a"], [4.33, "4b"], [4.67, "4c"], [5, "5a"], [5.33, "5b"], [5.67, "5c"], [6, "6a"],
  [6.33, "6a+"], [6.67, "6b"], [7, "6b+"], [7.33, "6c"], [7.67, "7a"], [8, "7a+"], [8.33, "7b"], [8.67, "7b+"], [9, "7c"],
  [9.33, "7c+"], [9.67, "8a"], [10, "8a+"], [10.33, "8b"], [10.67, "8b+"], [11, "8c"]];
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11 };

export function rockScore(g) {
  const s = g.toLowerCase();
  let m = s.match(/([3-9])([abc])(\+)?/);
  if (m) return FRENCH.indexOf(`${m[1]}${m[2]}${m[3] ? "+" : ""}`);
  let u = null;
  m = g.match(/\b(XI|IX|X|VIII|VII|VI|IV|V|III|II|I)([+-])?(?![A-Za-z])/);
  if (m) u = ROMAN[m[1]] + (m[2] === "+" ? 0.33 : m[2] === "-" ? -0.33 : 0);
  else if ((m = s.match(/\b(1[01]|[3-9])([+-])?(?![0-9a-z])/))) u = +m[1] + (m[2] === "+" ? 0.33 : m[2] === "-" ? -0.33 : 0);
  if (u == null) return null;
  const best = UIAA.reduce((a, b) => (Math.abs(b[0] - u) < Math.abs(a[0] - u) ? b : a));
  return FRENCH.indexOf(best[1]);
}
export function ferrataScore(g) {
  const s = g.toUpperCase();
  if (s.includes("EEA")) {
    if (/MD|TD/.test(s)) return 8; if (s.includes("PD")) return 4; if (/-D\b| D$/.test(s)) return 6; if (/-F\b| F$/.test(s)) return 2;
    return null;
  }
  const m = s.match(/\b([A-F])(?:\s*\/\s*([A-F]))?(?![A-Z])/);
  if (!m) return null;
  const i = FERRATA.indexOf(m[2] ? `${m[1]}/${m[2]}` : m[1]);
  return i < 0 ? null : i;
}
export function alpineScore(g) {
  const m = g.toUpperCase().match(/\b(ABO|ED|TD|AD|PD|D|F)([+-])?(?![A-Z])/);
  if (!m) return null;
  let i = ALPINE.indexOf(m[1] + (m[2] || ""));
  if (i < 0) i = ALPINE.indexOf(m[1]);
  return i < 0 ? null : i;
}
export function gradeScore(g, kind) {
  g = (g || "").trim();
  if (!g) return null;
  let v;
  if (kind === "ferrata") return (v = ferrataScore(g)) != null ? { scale: "ferrata", value: v } : null;
  if (["alpineClimb", "mountaineering", "winterMountaineering", "winterClimb", "scramble", "iceClimb"].includes(kind)) {
    if ((v = alpineScore(g)) != null) return { scale: "alpine", value: v };
    return (v = rockScore(g)) != null ? { scale: "rock", value: v } : null;
  }
  if ((v = rockScore(g)) != null) return { scale: "rock", value: v };
  return (v = alpineScore(g)) != null ? { scale: "alpine", value: v } : null;
}
export const gradeLabel = (scale, v) => {
  const list = scale === "rock" ? FRENCH : scale === "ferrata" ? FERRATA : ALPINE;
  return list[Math.max(0, Math.min(list.length - 1, Math.round(v)))];
};
export function topGrade(a) {
  let best = null;
  for (const r of a.routes || []) {
    const s = gradeScore(r.grade, a.kind);
    if (s && (!best || s.value > best.score)) best = { label: r.grade, score: s.value };
  }
  if (!best) { const s = gradeScore(a.grade, a.kind); if (s) best = { label: a.grade, score: s.value }; }
  return best;
}

// "6a+ - Slalom - da secondo" -> route
export function parseRoutes(text) {
  return text.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const low = l.toLowerCase();
    const gm = low.match(/\b[3-9][abc]\+?/);
    const grade = gm ? gm[0] : "";
    let style = "redpoint";
    if (/vista|onsight|on sight/.test(low)) style = "onsight";
    else if (/flash/.test(low)) style = "flash";
    else if (/secondo|second/.test(low)) style = "second";
    else if (/top ?rope|moulinette/.test(low)) style = "toprope";
    else if (/tentat|attempt|resting/.test(low)) style = "attempt";
    const parts = l.split(/\s+-\s+/).map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== grade &&
      !/vista|secondo|flash|rotpunkt|onsight/.test(p.toLowerCase()));
    let name = parts[0] || "";
    if (grade && name.toLowerCase().startsWith(grade)) name = name.slice(grade.length).trim();
    return { id: uuid(), name, grade, style };
  });
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
