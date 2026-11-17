// Storage: the Logbook folder in OneDrive (via Microsoft Graph), or ./demo/ in demo mode.
import { CONFIG } from "../config.js";
import { Dropbox, GoogleDrive } from "./providers.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Files.ReadWrite"];

const encPath = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

// ------------------------------------------------------------------ OneDrive backend
class OneDrive {
  constructor() {
    this.root = localStorage.getItem("logbook.folder") || CONFIG.folder || "Logbook";
    this.thumbs = new Map();      // path -> {medium, large}
    this.urls = new Map();        // path -> download url
    this.queue = [];
    this.timer = null;
  }

  static get configured() { return !!CONFIG.clientId && !CONFIG.clientId.startsWith("PASTE"); }

  async init() {
    if (!OneDrive.configured) throw new Error("not-configured");
    this.msal = new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: "https://login.microsoftonline.com/consumers",
        redirectUri: location.origin + location.pathname,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await this.msal.initialize();
    const res = await this.msal.handleRedirectPromise();
    this.account = res?.account || this.msal.getAllAccounts()[0] || null;
    return !!this.account;
  }

  signIn() { return this.msal.loginRedirect({ scopes: SCOPES, prompt: "select_account" }); }
  signOut() { localStorage.removeItem("logbook.cache"); localStorage.removeItem("logbook.provider"); return this.msal.logoutRedirect({ account: this.account }); }
  get user() { return this.account?.username || ""; }

  async token() {
    try {
      return (await this.msal.acquireTokenSilent({ scopes: SCOPES, account: this.account })).accessToken;
    } catch (e) {
      await this.msal.acquireTokenRedirect({ scopes: SCOPES, account: this.account });
      throw new Error("redirecting");
    }
  }

  async api(path, opts = {}) {
    const url = path.startsWith("http") ? path : GRAPH + path;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${await this.token()}`, ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); continue; }
      return r;
    }
    throw new Error("OneDrive is not responding, try again later");
  }

  item(path) { return `/me/drive/root:/${encPath(this.root + "/" + path)}`; }

  async readJSON(name) {
    const r = await this.api(this.item(name) + ":/content");
    if (r.status === 404) return { data: null, etag: null };
    if (!r.ok) throw new Error(`Couldn't read ${name} (${r.status})`);
    const meta = await this.api(this.item(name) + "?$select=eTag");
    return { data: await r.json(), etag: meta.ok ? (await meta.json()).eTag : null };
  }

  /** Writes JSON; returns false on an edit conflict (someone else saved first). */
  async writeJSON(name, data, etag) {
    const r = await this.api(this.item(name) + ":/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
      body: JSON.stringify(data, null, 2),
    });
    if (r.status === 412 || r.status === 409) return false;
    if (!r.ok) throw new Error(`Couldn't save ${name} (${r.status})`);
    return (await r.json()).eTag || true;
  }

  async readText(path) {
    const r = await this.api(this.item(path) + ":/content");
    if (!r.ok) throw new Error(`Couldn't read ${path} (${r.status})`);
    return r.text();
  }

  async downloadURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const r = await this.api(this.item(path) + "?$select=id,@microsoft.graph.downloadUrl");
    if (!r.ok) return null;
    const u = (await r.json())["@microsoft.graph.downloadUrl"];
    this.urls.set(path, u);
    return u;
  }

  /** Thumbnail URL for a photo; requests are batched 20 at a time. */
  thumb(path, size = "medium") {
    const hit = this.thumbs.get(path);
    if (hit) return Promise.resolve(hit[size] || hit.medium || null);
    return new Promise((resolve) => {
      this.queue.push({ path, size, resolve });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 30);
    });
  }

  async flush() {
    while (this.queue.length) {
      const batch = this.queue.splice(0, 20);
      const body = { requests: batch.map((q, i) => ({ id: String(i), method: "GET",
        url: this.item(q.path) + "?$select=id&$expand=thumbnails($select=medium,large)" })) };
      try {
        const r = await this.api("/$batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const res = r.ok ? (await r.json()).responses : [];
        for (const q of batch) {
          const resp = res.find((x) => x.id === String(batch.indexOf(q)));
          const t = resp?.body?.thumbnails?.[0];
          const v = { medium: t?.medium?.url || null, large: t?.large?.url || null };
          this.thumbs.set(q.path, v);
          q.resolve(v[q.size] || v.medium);
        }
      } catch { batch.forEach((q) => q.resolve(null)); }
    }
  }

  async upload(path, blob, type) {
    const r = await this.api(this.item(path) + ":/content?@microsoft.graph.conflictBehavior=rename", {
      method: "PUT", headers: { "Content-Type": type || blob.type || "application/octet-stream" }, body: blob,
    });
    if (!r.ok) throw new Error(`Upload failed (${r.status})`);
    const j = await r.json();
    // OneDrive may have renamed it to avoid a clash: return the stored path
    return path.split("/").slice(0, -1).concat(j.name).join("/");
  }

  async remove(path) { await this.api(this.item(path), { method: "DELETE" }); }
}

// ------------------------------------------------------------------ Demo backend (sample data, read-only-ish)
class Demo {
  constructor() { this.files = new Map(); this.root = "demo"; }
  async init() { return true; }
  get user() { return "Demo data"; }
  signIn() {} signOut() { location.search = ""; }
  async readJSON(name) {
    if (this.files.has(name)) return { data: this.files.get(name), etag: "x" };
    const r = await fetch(`demo/${name}`);
    return { data: r.ok ? await r.json() : null, etag: "x" };
  }
  async writeJSON(name, data) { this.files.set(name, structuredClone(data)); return "x"; }
  async readText(path) { return (await fetch(`demo/${encPath(path)}`)).text(); }
  async downloadURL(path) { return this.files.get(path) || `demo/${encPath(path)}`; }
  async thumb(path) { return this.downloadURL(path); }
  async upload(path, blob) { this.files.set(path, URL.createObjectURL(blob)); return path; }
  async remove() {}
}

// Where the logbook lives: chosen on the sign-in screen, remembered on this device.
export const PROVIDERS = {
  onedrive: { name: "Microsoft OneDrive", cls: OneDrive },
  dropbox: { name: "Dropbox", cls: Dropbox },
  google: { name: "Google Drive", cls: GoogleDrive },
};
export const isDemo = new URLSearchParams(location.search).has("demo");
export let providerKey = PROVIDERS[localStorage.getItem("logbook.provider")] ? localStorage.getItem("logbook.provider") : "onedrive";
export let backend = isDemo ? new Demo() : new PROVIDERS[providerKey].cls();

export function chooseProvider(key) {
  localStorage.setItem("logbook.provider", key);
  localStorage.removeItem("logbook.cache");
  providerKey = key;
  backend = new PROVIDERS[key].cls();
  return backend;
}

// ------------------------------------------------------------------ data layer
export const data = { activities: [], ideas: [], etags: {} };

function sortActs() { data.activities.sort((a, b) => (a.date < b.date ? 1 : -1)); }

export function loadCached() {
  try {
    const c = JSON.parse(localStorage.getItem(isDemo ? "x" : "logbook.cache") || "null");
    if (c) { data.activities = c.activities || []; data.ideas = c.ideas || []; sortActs(); return true; }
  } catch {}
  return false;
}
function saveCache() {
  if (isDemo) return;
  try { localStorage.setItem("logbook.cache", JSON.stringify({ activities: data.activities, ideas: data.ideas })); } catch {}
}

export async function refresh() {
  const [a, i] = await Promise.all([backend.readJSON("logbook.json"), backend.readJSON("ideas.json")]);
  data.activities = a.data?.activities || [];
  data.ideas = i.data?.ideas || [];
  for (const x of [...data.activities, ...data.ideas]) if (!x.id) x.id = crypto.randomUUID().toUpperCase();
  for (const x of [...data.activities, ...data.ideas]) if (x.kind === "alpineClimb") x.kind = "mountaineering";
  data.etags = { "logbook.json": a.etag, "ideas.json": i.etag };
  sortActs();
  saveCache();
}

/** Read-modify-write with retry, so edits from the Mac app are never overwritten. */
async function mutate(name, key, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await backend.readJSON(name);
    const doc = cur.data || { version: 1, [key]: [] };
    doc[key] = doc[key] || [];
    fn(doc[key]);
    const ok = await backend.writeJSON(name, doc, cur.etag);
    if (ok) {
      data.etags[name] = ok;
      if (key === "activities") { data.activities = doc[key]; sortActs(); } else data.ideas = doc[key];
      saveCache();
      return;
    }
  }
  throw new Error("The logbook changed elsewhere while saving — please try again.");
}

const upsertIn = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); };
export const saveActivity = (a) => mutate("logbook.json", "activities", (l) => upsertIn(l, a));
export const deleteActivity = (id) => mutate("logbook.json", "activities", (l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); });
export const saveIdea = (x) => mutate("ideas.json", "ideas", (l) => upsertIn(l, x));
export const deleteIdea = (id) => mutate("ideas.json", "ideas", (l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); });
