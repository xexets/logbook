// GPX parsing + stats (same maths as the Mac app).

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts = [];
  for (const el of doc.querySelectorAll("trkpt, rtept")) {
    const lat = parseFloat(el.getAttribute("lat")), lon = parseFloat(el.getAttribute("lon"));
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const e = el.getElementsByTagName("ele")[0], t = el.getElementsByTagName("time")[0];
    pts.push({ lat, lon, ele: e ? parseFloat(e.textContent) : null, time: t ? new Date(t.textContent.trim()) : null });
  }
  const nameEl = doc.querySelector("trk > name, metadata > name, rte > name");
  return { name: nameEl?.textContent?.trim() || null, points: pts };
}

function hav(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dp = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function gpxStats(track) {
  const p = track.points;
  if (p.length < 2) return null;
  let dist = 0;
  for (let i = 1; i < p.length; i++) dist += hav(p[i - 1], p[i]);
  const eles = p.map((x) => x.ele).filter((x) => x != null && !Number.isNaN(x));
  let gain = null;
  if (eles.length) {
    let ref = eles[0]; gain = 0;
    for (const e of eles.slice(1)) { if (e - ref > 4) { gain += e - ref; ref = e; } else if (e < ref) ref = e; }
  }
  const times = p.map((x) => x.time).filter((t) => t && !Number.isNaN(t.getTime()));
  const dur = times.length > 1 && times.at(-1) > times[0] ? (times.at(-1) - times[0]) / 60000 : null;
  return {
    distanceKm: Math.round(dist / 10) / 100,
    elevationGainM: gain != null ? Math.round(gain) : null,
    durationMinutes: dur != null ? Math.round(dur) : null,
    maxAltitudeM: eles.length ? Math.round(Math.max(...eles)) : null,
    start: p[0], startTime: times[0] || null,
  };
}

export function profile(track, maxPoints = 400) {
  const p = track.points, out = [];
  const step = Math.max(1, Math.floor(p.length / maxPoints));
  let d = 0;
  for (let i = 0; i < p.length; i++) {
    if (i > 0) d += hav(p[i - 1], p[i]);
    if (i % step === 0 && p[i].ele != null) out.push({ x: d / 1000, y: p[i].ele });
  }
  return out;
}

export const latlngs = (track) => {
  const p = track.points, step = Math.max(1, Math.floor(p.length / 2000));
  return p.filter((_, i) => i % step === 0 || i === p.length - 1).map((x) => [x.lat, x.lon]);
};
