// Dropbox and Google Drive storage. Same interface as the OneDrive backend in store.js:
// init() signIn() signOut() user readJSON() writeJSON() readText() downloadURL() thumb() upload() remove()
import { CONFIG } from "../config.js";

const here = () => location.origin + location.pathname;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const real = (v) => !!v && !String(v).startsWith("PASTE");

// ------------------------------------------------------------------ Dropbox (app folder, PKCE, refresh token)
const DBX_API = "https://api.dropboxapi.com/2", DBX_CONTENT = "https://content.dropboxapi.com/2";
// Dropbox-API-Arg must be ASCII: escape everything else
const dbxArg = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export class Dropbox {
  constructor() { this.key = CONFIG.dropboxAppKey; this.root = "Dropbox app folder"; this.urls = new Map(); }
  static get configured() { return real(CONFIG.dropboxAppKey); }
  get user() { return localStorage.getItem("dbx.user") || "Dropbox"; }

  async init() {
    if (!Dropbox.configured) throw new Error("not-configured");
    const q = new URLSearchParams(location.search);
    if (q.get("code") && q.get("state") === "dbx") {
      const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ code: q.get("code"), grant_type: "authorization_code", client_id: this.key,
          code_verifier: sessionStorage.getItem("dbx.verifier") || "", redirect_uri: here() }),
      });
      const j = await r.json();
      history.replaceState(null, "", location.pathname + (sessionStorage.getItem("dbx.return") || "#/log"));
      if (!j.access_token) throw new Error("Dropbox sign-in failed: " + (j.error_description || j.error || r.status));
      this.save(j);
      try {
        const u = await this.rpc("/users/get_current_account", null);
        localStorage.setItem("dbx.user", u.email || u.name?.display_name || "Dropbox");
      } catch {}
    }
    return !!localStorage.getItem("dbx.refresh");
  }

  save(j) {
    localStorage.setItem("dbx.access", j.access_token);
    localStorage.setItem("dbx.expires", String(Date.now() + (j.expires_in || 14400) * 1000 - 60000));
    if (j.refresh_token) localStorage.setItem("dbx.refresh", j.refresh_token);
  }

  async signIn() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    sessionStorage.setItem("dbx.verifier", verifier);
    sessionStorage.setItem("dbx.return", location.hash || "#/log");
    location.href = "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({
      client_id: this.key, response_type: "code", code_challenge: challenge, code_challenge_method: "S256",
      redirect_uri: here(), token_access_type: "offline", state: "dbx",
    });
  }

  signOut() {
    ["dbx.access", "dbx.expires", "dbx.refresh", "dbx.user", "logbook.cache", "logbook.provider"].forEach((k) => localStorage.removeItem(k));
    location.replace(location.pathname);
  }

  async token() {
    if (Date.now() < +(localStorage.getItem("dbx.expires") || 0)) return localStorage.getItem("dbx.access");
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: localStorage.getItem("dbx.refresh") || "", client_id: this.key }),
    });
    const j = await r.json();
    if (!j.access_token) { localStorage.removeItem("dbx.refresh"); await this.signIn(); throw new Error("redirecting"); }
    this.save(j);
    return j.access_token;
  }

  p(path) { return "/" + path.split("/").filter(Boolean).join("/"); }

  async rpc(ep, body) {
    const r = await fetch(DBX_API + ep, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body === null ? {} : { "Content-Type": "application/json" }) },
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (!r.ok) { const e = new Error(`Dropbox error ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }

  async download(path) {
    return fetch(DBX_CONTENT + "/files/download", {
      method: "POST", headers: { Authorization: `Bearer ${await this.token()}`, "Dropbox-API-Arg": dbxArg({ path: this.p(path) }) },
    });
  }

  async readJSON(name) {
    const r = await this.download(name);
    if (r.status === 409) return { data: null, etag: null };            // not found
    if (!r.ok) throw new Error(`Couldn't read ${name} (${r.status})`);
    const meta = JSON.parse(r.headers.get("dropbox-api-result") || "{}");
    return { data: await r.json(), etag: meta.rev || null };
  }

  async writeJSON(name, data, etag) {
    const mode = etag ? { ".tag": "update", update: etag } : { ".tag": "add" };
    const r = await fetch(DBX_CONTENT + "/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dbxArg({ path: this.p(name), mode, autorename: false, mute: true }) },
      body: JSON.stringify(data, null, 2),
    });
    if (r.status === 409) return false;                                   // changed elsewhere: retry
    if (!r.ok) throw new Error(`Couldn't save ${name} (${r.status})`);
    return (await r.json()).rev || true;
  }

  async readText(path) {
    const r = await this.download(path);
    if (!r.ok) throw new Error(`Couldn't read ${path} (${r.status})`);
    return r.text();
  }

  async downloadURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    try {
      const { link } = await this.rpc("/files/get_temporary_link", { path: this.p(path) });
      this.urls.set(path, link);
      return link;
    } catch { return null; }
  }

  async thumb(path, size = "medium") {
    const key = path + "@" + size;
    if (this.urls.has(key)) return this.urls.get(key);
    try {
      const r = await fetch(DBX_CONTENT + "/files/get_thumbnail_v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.token()}`,
          "Dropbox-API-Arg": dbxArg({ resource: { ".tag": "path", path: this.p(path) }, format: "jpeg",
            size: size === "large" ? "w1024h768" : "w256h256", mode: "bestfit" }) },
      });
      if (!r.ok) return this.downloadURL(path);
      const u = URL.createObjectURL(await r.blob());
      this.urls.set(key, u);
      return u;
    } catch { return null; }
  }

  async upload(path, blob) {
    const r = await fetch(DBX_CONTENT + "/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": dbxArg({ path: this.p(path), mode: "add", autorename: true, mute: true }) },
      body: blob,
    });
    if (!r.ok) throw new Error(`Upload failed (${r.status})`);
    return (await r.json()).path_display.replace(/^\//, "");
  }

  async remove(path) { try { await this.rpc("/files/delete_v2", { path: this.p(path) }); } catch {} }
}

// ------------------------------------------------------------------ Google Drive (drive.file scope: only files this app created)
const GD = "https://www.googleapis.com/drive/v3", GDUP = "https://www.googleapis.com/upload/drive/v3";
const q1 = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class GoogleDrive {
  constructor() { this.cid = CONFIG.googleClientId; this.root = localStorage.getItem("logbook.folder") || CONFIG.folder || "Logbook"; this.ids = new Map(); this.urls = new Map(); }
  static get configured() { return real(CONFIG.googleClientId); }
  get user() { return localStorage.getItem("gd.user") || "Google Drive"; }

  async init() {
    if (!GoogleDrive.configured) throw new Error("not-configured");
    if (location.hash.includes("access_token=")) {
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get("state") === "gd") {
        localStorage.setItem("gd.token", h.get("access_token"));
        localStorage.setItem("gd.expires", String(Date.now() + (+h.get("expires_in") || 3600) * 1000 - 60000));
        localStorage.setItem("gd.signedin", "1");
        history.replaceState(null, "", location.pathname + location.search + (sessionStorage.getItem("gd.return") || "#/log"));
        try { const a = await this.api("/about?fields=user"); localStorage.setItem("gd.user", a.user.emailAddress || a.user.displayName); } catch {}
      }
    } else if (location.hash.includes("error=") && location.hash.includes("state=gd")) {
      history.replaceState(null, "", location.pathname);
    }
    return !!localStorage.getItem("gd.signedin");
  }

  signIn(again = false) {
    if (!again) sessionStorage.setItem("gd.return", location.hash || "#/log");
    else sessionStorage.setItem("gd.return", location.hash && !location.hash.includes("access_token") ? location.hash : "#/log");
    const hint = localStorage.getItem("gd.user");
    location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: this.cid, redirect_uri: here(), response_type: "token", state: "gd", include_granted_scopes: "true",
      scope: "https://www.googleapis.com/auth/drive.file",
      ...(again && hint ? { login_hint: hint } : { prompt: "select_account" }),
    });
  }

  signOut() {
    ["gd.token", "gd.expires", "gd.signedin", "gd.user", "logbook.cache", "logbook.provider"].forEach((k) => localStorage.removeItem(k));
    location.replace(location.pathname);
  }

  /** Google gives browser apps 1-hour tokens: when it runs out, a quick redirect fetches a new one. */
  async token() {
    if (Date.now() < +(localStorage.getItem("gd.expires") || 0)) return localStorage.getItem("gd.token");
    this.signIn(true);
    throw new Error("redirecting");
  }

  async api(ep, opts = {}) {
    const r = await fetch(ep.startsWith("http") ? ep : GD + ep, { ...opts, headers: { Authorization: `Bearer ${await this.token()}`, ...(opts.headers || {}) } });
    if (r.status === 401) { localStorage.removeItem("gd.expires"); await this.token(); }
    if (!r.ok) { const e = new Error(`Google Drive error ${r.status}`); e.status = r.status; throw e; }
    return opts.raw ? r : r.json();
  }

  split(path) {
    const parts = [this.root, ...path.split("/").filter(Boolean)];
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
  }

  async folderId(dirs, create) {
    let parent = "root", key = "";
    for (const name of dirs) {
      key += "/" + name;
      if (this.ids.has(key)) { parent = this.ids.get(key); continue; }
      const q = `name='${q1(name)}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
      const res = await this.api("/files?" + new URLSearchParams({ q, fields: "files(id)", spaces: "drive" }));
      let id = res.files[0]?.id;
      if (!id) {
        if (!create) return null;
        id = (await this.api("/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).id;
      }
      this.ids.set(key, id);
      parent = id;
    }
    return parent;
  }

  async meta(path) {
    const { dirs, name } = this.split(path);
    const dir = await this.folderId(dirs, false);
    if (!dir) return null;
    const q = `name='${q1(name)}' and '${dir}' in parents and trashed=false`;
    const res = await this.api("/files?" + new URLSearchParams({ q, fields: "files(id,version)", spaces: "drive" }));
    return res.files[0] || null;
  }

  async create(dir, name, blob) {
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify({ name, parents: [dir] })], { type: "application/json" }));
    fd.append("file", blob);
    return this.api(`${GDUP}/files?uploadType=multipart&fields=id,version,name`, { method: "POST", body: fd });
  }

  async readJSON(name) {
    const m = await this.meta(name);
    if (!m) return { data: null, etag: null };
    const r = await this.api(`/files/${m.id}?alt=media`, { raw: true });
    return { data: await r.json(), etag: m.version };
  }

  async writeJSON(name, data, etag) {
    const m = await this.meta(name);
    if (m && String(m.version) !== String(etag)) return false;          // changed elsewhere: retry
    const body = JSON.stringify(data, null, 2);
    if (m) {
      const r = await this.api(`${GDUP}/files/${m.id}?uploadType=media&fields=version`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
      return r.version || true;
    }
    const { dirs, name: file } = this.split(name);
    return (await this.create(await this.folderId(dirs, true), file, new Blob([body], { type: "application/json" }))).version || true;
  }

  async blobURL(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const m = await this.meta(path);
    if (!m) return null;
    const r = await this.api(`/files/${m.id}?alt=media`, { raw: true });
    const u = URL.createObjectURL(await r.blob());
    this.urls.set(path, u);
    return u;
  }

  async readText(path) {
    const m = await this.meta(path);
    if (!m) throw new Error(`Couldn't read ${path}`);
    return (await this.api(`/files/${m.id}?alt=media`, { raw: true })).text();
  }

  downloadURL(path) { return this.blobURL(path).catch(() => null); }
  thumb(path) { return this.blobURL(path).catch(() => null); }

  async upload(path, blob) {
    const { dirs, name } = this.split(path);
    await this.create(await this.folderId(dirs, true), name, blob);
    return path;
  }

  async remove(path) {
    const m = await this.meta(path).catch(() => null);
    if (m) await this.api(`/files/${m.id}`, { method: "DELETE", raw: true }).catch(() => {});
  }
}
