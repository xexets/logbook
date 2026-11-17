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

/** Stats for the human-powered part only: stretches faster than limitKmh (or GPS jumps
 *  over 1 km without timestamps) count as driving/lifts and are skipped. */
export function gpxStats(track, limitKmh = 25) {
  const p = track.points;
  if (p.length < 2) return null;
  let dist = 0, gain = 0, dur = 0, ref = null;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], d = hav(a, b);
    const dt = a.time && b.time && !isNaN(a.time) && !isNaN(b.time) ? (b.time - a.time) / 1000 : null;
    const ok = dt && dt > 0 ? (d / dt) * 3.6 <= limitKmh : d <= 1000;
    if (!ok) { ref = null; continue; }
    dist += d;
    if (dt && dt > 0) dur += dt;
    if (b.ele != null && !isNaN(b.ele)) {
      if (ref == null) ref = a.ele != null && !isNaN(a.ele) ? a.ele : b.ele;
      if (b.ele - ref > 4) { gain += b.ele - ref; ref = b.ele; } else if (b.ele < ref) ref = b.ele;
    }
  }
  const eles = p.map((x) => x.ele).filter((x) => x != null && !Number.isNaN(x));
  const times = p.map((x) => x.time).filter((t) => t && !Number.isNaN(t.getTime()));
  return {
    distanceKm: Math.round(dist / 10) / 100,
    elevationGainM: eles.length ? Math.round(gain) : null,
    durationMinutes: dur > 0 ? Math.round(dur / 60) : null,
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
