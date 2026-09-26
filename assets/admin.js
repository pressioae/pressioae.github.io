/* =========================================================
   pressio — admin & staff panel
   Everything here writes to the database (Supabase). Nothing is
   saved into the website files, so publishing new code can never
   erase the menu, photos or settings.
   ========================================================= */
(() => {
"use strict";

const C = window.PRESSIO;
const SESSION_KEY = "pressio_admin_v2";

/* ------------------------------------------------------------------
   Small helpers
------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const raw = s => ({ __raw: String(s) });
const out = v => v == null || v === false ? "" : Array.isArray(v) ? v.map(out).join("") : (v.__raw != null ? v.__raw : esc(v));
const html = (s, ...v) => raw(s.reduce((a, str, i) => a + str + (i < v.length ? out(v[i]) : ""), ""));
const put = (el, h) => { el.innerHTML = out(h); return el; };
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: C.tz });
const fmtMoney = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(d).toLocaleString("ar-AE", { timeZone: C.tz, dateStyle: "medium", timeStyle: "short" }) : "—";
const fmtDay = d => d ? new Date(d + (String(d).length === 10 ? "T00:00:00" : "")).toLocaleDateString("ar-AE", { timeZone: C.tz, dateStyle: "medium" }) : "—";
const kb = b => b == null ? "" : b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const getPath = (o, p) => p.split(".").reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const k = p.split("."); let a = o; k.slice(0, -1).forEach((x, i) => { if (a[x] == null) a[x] = /^\d+$/.test(k[i + 1]) ? [] : {}; a = a[x]; }); a[k[k.length - 1]] = v; };
const slug = s => String(s || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);

const I = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  content: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  inv: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  rep: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  backup: '<path d="M12 8v4l3 2"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 4v7h7"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M19 14v6H4V5h6"/>', dl: '<path d="M12 4v11m0 0-4-4m4 4 4-4M4 20h16"/>',
  upl: '<path d="M12 20V9m0 0-4 4m4-4 4 4M4 4h16"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16.5a3.6 3.6 0 0 1 7 0M14 9.5h4M14 13h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'
};
const ico = n => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ""}</svg>`);

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "bad" ? 6500 : 3200);
}

async function busy(btn, fn) {
  if (btn) { btn.classList.add("busy"); btn.disabled = true; }
  try { return await fn(); }
  catch (e) { toast(errText(e), "bad"); console.error(e); return undefined; }
  finally { if (btn) { btn.classList.remove("busy"); btn.disabled = false; } }
}

function errText(e) {
  const m = String((e && (e.message || e.msg || e.error_description)) || e || "");
  if (/42501|row-level security|permission denied|not allowed|Unauthorized/i.test(m)) return "ما عندك صلاحية لهذا الإجراء";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "ما فيه اتصال بالسيرفر — تأكد من الإنترنت وحاول مرة ثانية";
  if (/violates foreign key|23503/i.test(m)) return "ما ينفع — فيه أصناف مرتبطة بهذا القسم. انقلها أو احذفها أول";
  if (/duplicate key|23505/i.test(m)) return "هذا المعرّف مستخدم من قبل";
  if (/payload too large|413|exceeded the maximum/i.test(m)) return "الملف كبير — أقصى حجم ٥٠ ميغا للوسائط و٢٠ للمستندات";
  if (/mime type|invalid_mime/i.test(m)) return "نوع الملف غير مدعوم";
  return m.replace(/^\(\d+\)\s*/, "") || "صار خطأ — حاول مرة ثانية";
}

/* ------------------------------------------------------------------
   Supabase client (auth, REST, RPC, storage) — no external library
------------------------------------------------------------------ */
const api = {
  sess: null,
  remember: true,
  // "remember me" keeps the session on this device; otherwise it ends when the browser closes.
  // The password itself is never stored by the site (the browser's own password manager can save it).
  load() {
    try {
      const l = localStorage.getItem(SESSION_KEY), s = sessionStorage.getItem(SESSION_KEY);
      this.remember = !!l || !s; this.sess = JSON.parse(l || s || "null");
    } catch (e) { this.sess = null; }
  },
  save() {
    try {
      localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY);
      if (this.sess) (this.remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(this.sess));
    } catch (e) {}
  },
  keep(j) {
    this.sess = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, email: j.user && j.user.email };
    this.save();
  },
  async signIn(email, password) {
    const r = await fetch(`${C.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: C.key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(/invalid/i.test(j.error_code || j.msg || j.error_description || "") ? "الإيميل أو كلمة السر غلط" : (j.msg || j.error_description || "تعذّر الدخول"));
    this.keep(j);
  },
  async token() {
    if (!this.sess) throw new Error("انتهت الجلسة");
    if (Date.now() < this.sess.exp - 60000) return this.sess.access;
    const r = await fetch(`${C.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: C.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: this.sess.refresh }) });
    if (!r.ok) { this.sess = null; this.save(); location.reload(); throw new Error("انتهت الجلسة — سجّل دخول مرة ثانية"); }
    this.keep(await r.json());
    return this.sess.access;
  },
  async signOut() {
    try { await fetch(`${C.url}/auth/v1/logout`, { method: "POST", headers: { apikey: C.key, Authorization: `Bearer ${this.sess && this.sess.access}` } }); } catch (e) {}
    this.sess = null; this.save();
  },
  async req(path, { method = "GET", body, headers = {}, raw: rawBody = false, prefer } = {}) {
    const h = { apikey: C.key, Authorization: `Bearer ${await this.token()}`, ...headers };
    if (body !== undefined && !rawBody) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    const r = await fetch(C.url + path, { method, headers: h, body: body === undefined ? undefined : (rawBody ? body : JSON.stringify(body)) });
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = text; }
    if (!r.ok) throw new Error(`(${r.status}) ` + ((j && (j.message || j.msg || j.error || j.hint)) || text || r.statusText));
    return j;
  },
  select: (t, q = "") => api.req(`/rest/v1/${t}?${q}`),
  insert: (t, row) => api.req(`/rest/v1/${t}`, { method: "POST", body: row, prefer: "return=representation" }).then(r => Array.isArray(r) ? r[0] : r),
  update: (t, match, patch) => api.req(`/rest/v1/${t}?${match}`, { method: "PATCH", body: patch, prefer: "return=representation" }).then(r => {
    if (Array.isArray(r) && !r.length) throw new Error("ما عندك صلاحية لهذا الإجراء");
    return Array.isArray(r) ? r[0] : r;
  }),
  remove: (t, match) => api.req(`/rest/v1/${t}?${match}`, { method: "DELETE", prefer: "return=representation" }).then(r => {
    if (Array.isArray(r) && !r.length) throw new Error("ما عندك صلاحية لهذا الإجراء");
    return r;
  }),
  rpc: (fn, args = {}) => api.req(`/rest/v1/rpc/${fn}`, { method: "POST", body: args }),
  upload: (bucket, path, blob) => api.req(`/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", body: blob, raw: true, headers: { "Content-Type": blob.type || "application/octet-stream", "cache-control": "31536000", "x-upsert": "false" }
  }),
  removeObj: (bucket, path) => api.req(`/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" }),
  async signed(bucket, path, secs = 300) {
    const j = await api.req(`/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", body: { expiresIn: secs } });
    return `${C.url}/storage/v1${j.signedURL || j.signedUrl}`;
  },
  publicUrl: path => `${C.url}/storage/v1/object/public/media/${path.split("/").map(encodeURIComponent).join("/")}`
};

/* ------------------------------------------------------------------
   State
------------------------------------------------------------------ */
const S = { me: null, settings: null, cats: [], items: [], media: [], loaded: false };
const role = () => S.me && S.me.active ? S.me.role : null;
const isAdmin = () => role() === "admin";
const can = p => isAdmin() || (!!role() && (S.me.perms || []).includes(p));
const isEditor = () => can("site");
const ROLE_AR = { admin: "المالك", manager: "مدير المشروع", accountant: "المحاسب", staff: "موظف" };
const PERMS = [
  ["view_all", "اطلاع على كل شي", "يشوف المنيو والفواتير والتقارير والسجل — بدون تعديل"],
  ["inv_upload", "رفع الفواتير والتقرير اليومي", "يرفع فاتورة أو تقرير، ويشوف اللي رفعه هو"],
  ["inv_review", "مراجعة الفواتير واعتمادها", "يشوف كل الفواتير ويقبلها أو يرفضها"],
  ["reports", "كل التقارير اليومية", "يشوف تقارير كل الفريق"],
  ["stock", "إخفاء صنف خلص", "يوقف صنف أو يخفيه لمدة ويرجع تلقائياً"],
  ["site", "تعديل المنيو والصور والمحتوى", "أسعار، أصناف، صور، نصوص الموقع، وضع الصيانة"],
  ["backups", "النسخ الاحتياطية", "يحفظ نسخة، يسترجع، ويتراجع عن تعديل"],
  ["hr", "الموظفين والرواتب", "ملفات الموظفين، إيصالات الرواتب، شهادات الراتب"]
];
const PERM_AR = Object.fromEntries(PERMS.map(p => [p[0], p[1]]));
const ROLE_PRESET = {
  manager: ["view_all", "reports", "hr"],
  accountant: ["inv_review", "reports", "inv_upload"],
  staff: ["inv_upload", "stock"],
  admin: []
};

async function loadMe() {
  const rows = await api.select("staff", `select=id,full_name,role,active,email,perms&id=eq.${api.sess.uid}`);
  S.me = rows[0] || null;
}
async function loadSettings() {
  const r = await api.select("settings", "select=data,updated_at&id=eq.1");
  S.settings = (r[0] && r[0].data) || {};
}
async function loadContent() {
  const [cats, items, media] = await Promise.all([
    api.select("categories", "select=*&order=sort.asc,name_en.asc"),
    api.select("items", "select=*&order=sort.asc,name_en.asc"),
    api.select("media", "select=*&order=created_at.desc")
  ]);
  S.cats = cats; S.items = items; S.media = media;
}
const mediaById = id => S.media.find(m => m.id === id);
const mediaUrl = id => {
  if (!id) return "";
  if (/^https?:|^images\//.test(id)) return id;
  const m = mediaById(id); if (!m || m.kind === "docs") return "";
  return m.url;
};
const thumb = (id, alt = "") => { const u = mediaUrl(id); return u ? html`<img src="${u}" alt="${alt}" loading="lazy">` : ""; };

async function saveSettingsPart(paths, draft) {
  // re-read the latest copy first so two people editing different sections never overwrite each other
  await loadSettings();
  const next = clone(S.settings);
  paths.forEach(p => setPath(next, p, clone(getPath(draft, p))));
  const r = await api.update("settings", "id=eq.1", { data: next });
  S.settings = r.data;
}

/* image compression before upload — keeps the site fast and storage small */
function compress(file, maxW = 1600, q = 0.82) {
  return new Promise(resolve => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return resolve({ blob: file });
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => {
        if (b && b.type === "image/webp") return resolve({ blob: b, w, h });
        c.toBlob(j => resolve(j ? { blob: j, w, h } : { blob: file }), "image/jpeg", 0.86);
      }, "image/webp", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file }); };
    img.src = url;
  });
}
const extOf = blob => ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "application/pdf": "pdf", "image/heic": "heic" }[blob.type] || "bin");

async function uploadMedia(file, kind, folder) {
  if (kind === "docs") return uploadDoc(file, `library/${slug(folder) || "general"}`, folder || "", file.name);
  const isVid = /^video\//.test(file.type);
  if (!isVid && !/^image\//.test(file.type)) throw new Error("نوع الملف غير مدعوم: " + file.name);
  if (isVid && file.size > 50 * 1048576) throw new Error("الفيديو أكبر من ٥٠ ميغا: " + file.name);
  const { blob, w, h } = isVid ? { blob: file } : await compress(file, kind === "venue" ? 2000 : 1600);
  const path = `${kind}/${slug(folder) || "general"}/${uid()}.${extOf(blob)}`;
  await api.upload("media", path, blob);
  const base = file.name.replace(/\.[^.]+$/, "");
  const row = await api.insert("media", { kind, folder: folder || "", url: api.publicUrl(path), bucket: "media", path, mime: blob.type, width: w || null, height: h || null, bytes: blob.size, alt_ar: base, alt_en: base });
  S.media.unshift(row);
  return row;
}
async function uploadDoc(file, sub, folder, label) {
  if (file.size > 20 * 1048576) throw new Error("المستند أكبر من ٢٠ ميغا");
  const { blob } = /^image\//.test(file.type) ? await compress(file, 2200, 0.85) : { blob: file };
  const path = `${api.sess.uid}/${sub}/${uid()}.${extOf(blob)}`;
  await api.upload("docs", path, blob);
  const row = await api.insert("media", { kind: "docs", folder: folder || "", url: path, bucket: "docs", path, mime: blob.type, bytes: blob.size, alt_ar: label || file.name, alt_en: label || file.name });
  if (S.loaded) S.media.unshift(row);
  return row;
}
async function openDoc(path, btn) {
  const w = window.open("about:blank", "_blank");
  await busy(btn, async () => { const u = await api.signed("docs", path, 300); if (w) w.location = u; else location.href = u; });
}
function download(name, data) {
  const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ------------------------------------------------------------------
   Modal helpers
------------------------------------------------------------------ */
const dlg = () => $("#modal");
function modal(title, body, { wide = false, submit = "حفظ", onSubmit, extra = "", cancel = "إلغاء", layer = "#modal" } = {}) {
  const d = $(layer); d.className = wide ? "wide" : "";
  put(d, html`<form method="dialog" novalidate>
      <div class="mh"><h2>${title}</h2><button type="button" class="btn icon" data-x aria-label="إغلاق">✕</button></div>
      <div class="mb">${body}</div>
      <div class="mf">${raw(extra)}<span class="sp"></span><button type="button" class="btn" data-x>${cancel}</button>${submit ? html`<button type="submit" class="btn primary">${submit}</button>` : ""}</div>
    </form>`);
  const f = $("form", d);
  $$("[data-x]", d).forEach(b => b.onclick = () => d.close());
  f.onsubmit = async e => {
    e.preventDefault();
    if (!onSubmit) return d.close();
    const btn = $('button[type=submit]', f);
    const ok = await busy(btn, () => onSubmit(f));
    if (ok !== false && ok !== undefined) d.close();
  };
  if (!d.open) d.showModal();
  return d;
}
function confirmBox(title, msg, { danger = true, typed = null, yes = "تأكيد" } = {}) {
  return new Promise(res => {
    const d = modal(title, html`<p>${msg}</p>${typed ? html`<div class="f"><label>اكتب «${typed}» للتأكيد</label><input type="text" name="typed" autocomplete="off"></div>` : ""}`,
      { submit: yes, layer: "#modal2", onSubmit: async f => { if (typed && f.typed.value.trim() !== typed) { toast("الكلمة غير مطابقة", "bad"); return false; } res(true); return true; } });
    if (danger) $('button[type=submit]', d).classList.replace("primary", "danger");
    d.addEventListener("close", () => res(false), { once: true });
  });
}

/* media picker: returns a media id (or null) */
function pickMedia({ kinds = ["menu", "venue", "brand"], title = "اختر صورة" } = {}) {
  return new Promise(res => {
    let kind = kinds[0], q = "", chosen = null;
    const d = modal(title, html`<div class="row"><div class="chips" id="pk-k"></div><span class="sp"></span>
        <label class="btn sm">${ico("upl")} رفع جديد<input type="file" id="pk-up" accept="image/*" multiple hidden></label></div>
        <input type="search" id="pk-q" placeholder="ابحث بالاسم…"><div class="mgrid" id="pk-g"></div>`,
      { wide: true, layer: "#modal2", submit: "استخدم الصورة", onSubmit: async () => { if (!chosen) { toast("اختر صورة أول", "bad"); return false; } res(chosen); return true; } });
    d.addEventListener("close", () => res(chosen), { once: true });
    const paint = () => {
      put($("#pk-k", d), kinds.map(k => html`<button type="button" class="chip ${k === kind ? "on" : ""}" data-k="${k}">${KIND_AR[k]}</button>`));
      const list = S.media.filter(m => m.kind === kind && (!q || (m.alt_ar + " " + m.alt_en + " " + m.id + " " + m.folder).toLowerCase().includes(q)));
      put($("#pk-g", d), list.length ? list.map(m => html`<div class="mcard pick ${chosen === m.id ? "sel" : ""}" data-id="${m.id}"><div class="mthumb">${thumb(m.id)}</div><div class="mmeta"><b>${m.alt_ar || m.id}</b><span>${m.folder || "—"}</span></div></div>`) : html`<p class="empty">ما فيه صور هنا بعد — ارفع من الزر فوق</p>`);
    };
    d.onclick = e => {
      const k = e.target.closest("[data-k]"); if (k) { kind = k.dataset.k; paint(); }
      const c = e.target.closest(".mcard.pick"); if (c) { chosen = c.dataset.id; paint(); }
    };
    d.ondblclick = e => { const c = e.target.closest(".mcard.pick"); if (c) { chosen = c.dataset.id; res(chosen); d.close(); } };
    $("#pk-q", d).oninput = e => { q = e.target.value.toLowerCase(); paint(); };
    $("#pk-up", d).onchange = async e => {
      const files = Array.from(e.target.files || []); if (!files.length) return;
      toast("يرفع " + files.length + " ملف…");
      for (const f of files) { try { const r = await uploadMedia(f, kind, ""); chosen = r.id; } catch (err) { toast(errText(err), "bad"); } }
      paint(); toast("انرفعت", "ok");
    };
    paint();
  });
}
const KIND_AR = { menu: "صور المنيو", venue: "صور المكان", brand: "الهوية", video: "فيديو", docs: "مستندات وفواتير" };

/* ------------------------------------------------------------------
   Layout, routing, login
------------------------------------------------------------------ */
const PAGES = [
  { id: "home", t: "الرئيسية", i: "home", ok: () => true },
  { id: "menu", t: "المنيو", i: "menu", ok: () => can("site") || can("stock") || can("view_all") },
  { id: "media", t: "المكتبة", i: "media", ok: () => can("site") },
  { id: "content", t: "محتوى الموقع", i: "content", ok: () => can("site") },
  { id: "invoices", t: "الفواتير", i: "inv", ok: () => can("inv_upload") || can("inv_review") || can("view_all") },
  { id: "reports", t: "التقرير اليومي", i: "rep", ok: () => can("inv_upload") || can("reports") || can("view_all") },
  { id: "backups", t: "النسخ والسجل", i: "backup", ok: () => can("site") || can("backups") || can("view_all") },
  { id: "hr", t: "الموظفين", i: "id", ok: () => can("hr") },
  { id: "team", t: "الفريق", i: "team", ok: () => isAdmin() }
];
const allowed = () => PAGES.filter(p => p.ok());
const seesMenu = () => can("site") || can("stock") || can("view_all");
const current = () => { const id = (location.hash.replace(/^#\/?/, "") || "home").split("?")[0]; return allowed().find(p => p.id === id) || allowed()[0]; };

function shell() {
  const pages = allowed();
  put($("#root"), html`<div class="app">
    <aside class="side"><span class="logo" aria-label="pressio"></span>
      <nav>${pages.map(p => html`<a href="#/${p.id}" data-p="${p.id}">${ico(p.i)}<span>${p.t}</span></a>`)}</nav>
      <div class="side__me"><b>${S.me.full_name}</b>${ROLE_AR[S.me.role]} · <span class="ltr">${S.me.email || api.sess.email || ""}</span><br>
        <a href="index.html" target="_blank" style="color:#D9CABC;padding:0;display:inline">فتح الموقع ↗</a><br><button type="button" data-out>خروج</button></div>
    </aside>
    <div class="mbar"><span class="logo"></span><span class="sp"></span><a href="index.html" target="_blank" style="color:#F8F3EC;font-size:12.5px">الموقع ↗</a><button type="button" data-out>خروج</button></div>
    <main class="main" id="page"></main>
    <nav class="tabs-m">${pages.map(p => html`<a href="#/${p.id}" data-p="${p.id}">${ico(p.i)}<span>${p.t}</span></a>`)}</nav>
  </div>`);
  $$("[data-out]").forEach(b => b.onclick = async () => { window.onhashchange = null; await api.signOut(); history.replaceState(null, "", location.pathname); location.reload(); });
}

let navToken = 0;
async function route() {
  const p = current(); if (!p) return;
  $$("[data-p]").forEach(a => a.classList.toggle("on", a.dataset.p === p.id));
  const el = $("#page"), my = ++navToken;
  put(el, html`<div class="empty">لحظة…</div>`);
  try {
    if (["menu", "media", "content", "backups", "home"].includes(p.id) && seesMenu() && !S.loaded) { await Promise.all([loadContent(), loadSettings()]); S.loaded = true; }
    if (!S.settings) await loadSettings();
    if (my !== navToken) return;
    await VIEWS[p.id](el);
    scrollTo(0, 0);
  } catch (e) { console.error(e); put(el, html`<div class="banner bad">${errText(e)}</div>`); }
}

function loginView(msg = "") {
  put($("#root"), html`<div class="login"><form class="login__box" id="lf" novalidate>
      <span class="logo" aria-label="pressio"></span>
      <h1>لوحة pressio</h1><p class="sub">للمالك والموظفين — ادخل بإيميلك</p>
      <div class="f"><label for="em">الإيميل</label><input id="em" name="email" type="email" autocomplete="username" inputmode="email" dir="ltr" required></div>
      <div class="f" style="margin-top:12px"><label for="pw">كلمة السر</label><div class="pwbox"><input id="pw" name="password" type="password" autocomplete="current-password" dir="ltr" required>
        <button type="button" class="btn icon" id="pwv" aria-label="إظهار كلمة السر">${ico("eye")}</button></div></div>
      <label class="check" style="margin-top:12px"><input type="checkbox" id="rm" checked> تذكّرني على هذا الجهاز</label>
      <p class="hint" id="lmsg" style="min-height:22px;margin-top:10px;color:var(--bad)">${msg}</p>
      <button class="btn primary wide" type="submit">دخول</button>
      <p class="hint" style="margin-top:16px;text-align:center">كلمة السر تنفحص على السيرفر، والموقع ما يحفظها — متصفحك يقدر يحفظها لك بأمان.</p>
    </form></div>`);
  $("#lf").onsubmit = async e => {
    e.preventDefault();
    const em = $("#em").value.trim(), pw = $("#pw").value;
    if (!em || !pw) { $("#lmsg").textContent = "اكتب الإيميل وكلمة السر"; return; }
    await busy($('#lf button[type=submit]'), async () => {
      try {
        api.remember = $("#rm").checked;
        await api.signIn(em, pw);
        try { api.remember ? localStorage.setItem("pressio_last_email", em) : localStorage.removeItem("pressio_last_email"); } catch (x) {}
        // ask the browser to save the password in its own secure password manager
        if (api.remember && window.PasswordCredential && navigator.credentials) {
          try { await navigator.credentials.store(new PasswordCredential({ id: em, password: pw, name: em })); } catch (x) {}
        }
        await start();
      }
      catch (err) { $("#lmsg").textContent = errText(err); }
    });
  };
  let last = ""; try { last = localStorage.getItem("pressio_last_email") || ""; } catch (x) {}
  if (last) $("#em").value = last;
  $("#pwv").onclick = () => { const p = $("#pw"); p.type = p.type === "password" ? "text" : "password"; p.focus(); };
  setTimeout(() => { const f = last ? $("#pw") : $("#em"); if (f) f.focus(); }, 50);
}

function pendingView() {
  put($("#root"), html`<div class="login"><div class="login__box" style="text-align:center">
    <span class="logo"></span><h1>حسابك بانتظار الموافقة</h1>
    <p class="sub" style="margin-top:8px">المالك لازم يفعّل حسابك من تبويب «الفريق» قبل ما تقدر تستخدم اللوحة.</p>
    <button class="btn wide" id="lo">خروج</button></div></div>`);
  $("#lo").onclick = async () => { await api.signOut(); location.reload(); };
}

async function start() {
  api.load();
  if (!api.sess) return loginView();
  try { await loadMe(); }
  catch (e) { api.sess = null; api.save(); return loginView(errText(e)); }
  if (!S.me || !S.me.active) return pendingView();
  shell();
  window.onhashchange = route;
  route();
}

/* ------------------------------------------------------------------
   Views
------------------------------------------------------------------ */
const VIEWS = {};
const head = (t, sub, actions = "") => html`<div class="pagehead"><div><h1>${t}</h1>${sub ? html`<p>${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;

/* ---------- dashboard ---------- */
VIEWS.home = async el => {
  const name = (S.me.full_name || "").split(" ")[0];
  if (!can("site") && !can("view_all")) {
    const pend = can("inv_review") ? await api.select("invoices", "select=id&status=eq.pending") : null;
    const card = (href, i, t, sub) => html`<a class="card" href="${href}" style="text-decoration:none;color:inherit"><h2>${ico(i)} ${t}</h2><p class="hint">${sub}</p></a>`;
    const cards = [
      can("inv_review") ? card("#/invoices", "inv", `مراجعة الفواتير (${pend ? pend.length : 0})`, "الفواتير اللي بانتظار القبول أو الرفض.") : "",
      can("inv_upload") ? card("#/invoices", "upl", "ارفع فاتورة", "صوّر الفاتورة أو ارفع PDF — توصل للمراجعة فوراً.") : "",
      can("inv_upload") ? card("#/reports", "rep", "التقرير اليومي", "سجّل مبيعات اليوم وعدّة الدرج قبل ما تسكّر.") : "",
      can("reports") && !can("inv_upload") ? card("#/reports", "rep", "التقارير اليومية", "تقارير كل الفريق.") : "",
      can("stock") ? card("#/menu", "clock", "صنف خلص؟", "أوقفه أو أخفه لمدة — يرجع للمنيو تلقائياً.") : ""
    ].filter(Boolean);
    put(el, html`${head("أهلاً " + name, ROLE_AR[S.me.role] + " · اختر وش تبي تسوي")}
      <div class="grid g2">${cards.length ? cards : html`<p class="empty">ما عندك صلاحيات بعد — كلّم المالك.</p>`}</div>`);
    return;
  }
  const st = S.settings, m = st.maint || {};
  const off = S.items.filter(i => !i.available || (i.snooze_until && new Date(i.snooze_until) > new Date())).length;
  const [snaps, pend] = await Promise.all([
    api.select("snapshots", "select=created_at,kind&order=created_at.desc&limit=1"),
    can("inv_review") || can("view_all") ? api.select("invoices", "select=id&status=eq.pending") : Promise.resolve(null)
  ]);
  const checks = [];
  (st.home?.delivery || []).forEach(d => { if (!d.url) checks.push(`رابط ${d.ar || d.en} فاضي — الزوار يشوفون «قريباً»`); });
  if (!st.home?.info?.map) checks.push("رابط الخريطة غير محدد — الموقع يستخدم بحث جوجل ماب تلقائياً");
  put(el, html`${head("أهلاً " + name, ROLE_AR[S.me.role] + " · كل تعديل ينحفظ في قاعدة البيانات مباشرة")}
    <div class="card"><div class="row between">
      <div><h2>حالة الموقع</h2>
        <p class="hint">${m.on ? "الموقع مقفول للزوار — يشوفون شاشة الصيانة" : "الموقع شغّال ومفتوح للزوار"}</p></div>
      <div class="row">
        <span class="pill ${m.on ? "warn" : "ok"}">${m.on ? "صيانة" : "شغّال"}</span>
        <a class="btn sm" href="index.html?preview=1" target="_blank">${ico("eye")} معاينة</a>
        ${can("site") ? html`<button class="btn sm ${m.on ? "ok" : "danger"}" id="mt">${m.on ? "افتح الموقع للزوار" : "شغّل وضع الصيانة"}</button>` : ""}
      </div></div></div>
    <div class="grid g4" style="margin-top:16px">
      <div class="stat"><b>${S.items.length}</b><span>صنف في المنيو</span></div>
      <div class="stat"><b>${off}</b><span>غير متوفر أو مخفي مؤقتاً</span></div>
      <div class="stat"><b>${S.media.filter(x => x.kind !== "docs").length}</b><span>صورة وفيديو</span></div>
      ${can("inv_review") || can("view_all") ? html`<a class="stat" href="#/invoices" style="text-decoration:none;color:inherit"><b>${pend ? pend.length : 0}</b><span>فاتورة بانتظار المراجعة</span></a>`
                  : html`<div class="stat"><b>${S.cats.length}</b><span>قسم</span></div>`}
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><div><h2>النسخ الاحتياطية</h2>
      <p class="hint">آخر نسخة: ${snaps[0] ? fmtDate(snaps[0].created_at) : "ما فيه بعد"} · تنحفظ نسخة تلقائية كل يوم على السيرفر، وكل تعديل مسجّل في السجل.</p></div>
      <a class="btn sm" href="#/backups">${ico("backup")} فتح</a></div></div>
    ${checks.length && can("site") ? html`<div class="card"><h2>قبل ما تفتح الموقع</h2><ul class="hint" style="margin:6px 0 0;padding-inline-start:18px">${checks.map(c => html`<li>${c}</li>`)}</ul>
      <a class="btn sm" href="#/content" style="margin-top:10px">${ico("edit")} عدّل المحتوى</a></div>` : ""}`);
  if ($("#mt")) $("#mt").onclick = async e => {
    const turnOn = !m.on;
    if (!(await confirmBox(turnOn ? "تشغيل وضع الصيانة" : "فتح الموقع للزوار",
      turnOn ? "الزوار بيشوفون شاشة الصيانة بدل الموقع. تبي تكمل؟" : "الموقع بيصير مفتوح لكل الزوار خلال ثواني. متأكد إن كل شي جاهز؟", { danger: turnOn }))) return;
    await busy(e.target, async () => {
      const draft = clone(S.settings); draft.maint = { ...(draft.maint || {}), on: turnOn };
      await saveSettingsPart(["maint.on"], draft);
      toast(turnOn ? "وضع الصيانة اشتغل" : "الموقع مفتوح للزوار", "ok");
      VIEWS.home(el);
    });
  };
};

/* ---------- menu ---------- */
let selCat = null;
VIEWS.menu = async el => {
  if (!selCat || !S.cats.find(c => c.id === selCat)) selCat = S.cats[0] && S.cats[0].id;
  const cat = S.cats.find(c => c.id === selCat);
  const items = S.items.filter(i => i.category_id === selCat).sort((a, b) => a.sort - b.sort);
  const snoozed = i => i.snooze_until && new Date(i.snooze_until) > new Date();
  const ed = can("site"), st = can("stock") || ed;
  put(el, html`${head("المنيو", ed ? "التعديلات تظهر للزوار خلال ثواني — وكل تغيير ينحفظ في السجل وتقدر تتراجع عنه"
      : st ? "صنف خلص؟ طفّي «متوفر» أو اضغط ⏱ عشان تخفيه لمدة ويرجع تلقائياً" : "عرض فقط",
      ed ? html`<button class="btn" id="add-cat">${ico("plus")} قسم جديد</button><button class="btn primary" id="add-it" ${cat ? "" : "disabled"}>${ico("plus")} صنف جديد</button>` : "")}
    <div class="menu-ed">
      <div class="card" style="padding:10px"><div class="cats">${S.cats.map(c => html`<div class="cat ${c.id === selCat ? "on" : ""} ${c.visible ? "" : "hid"}" data-c="${c.id}">
          <b>${c.name_ar || c.name_en}</b><small class="num">${S.items.filter(i => i.category_id === c.id).length}</small></div>`)}</div></div>
      <div class="card">${cat ? html`
        <div class="row between" style="margin-bottom:10px"><div><h2>${cat.name_ar} <span class="muted" style="font-weight:400">· ${cat.name_en}</span></h2>
          <p class="hint">${cat.hours_from != null ? `يُقدّم من ${cat.hours_from}:00 إلى ${cat.hours_to}:00 · ` : ""}${cat.visible ? "ظاهر للزوار" : "مخفي عن الزوار"}</p></div>
          ${ed ? html`<div class="row"><button class="btn icon" data-cm="up" title="تحريك لفوق">${ico("up")}</button><button class="btn icon" data-cm="down" title="تحريك لتحت">${ico("down")}</button>
          <button class="btn sm" data-cm="edit">${ico("edit")} تعديل القسم</button></div>` : ""}</div>
        <div class="items">${items.length ? items.map((i, n) => html`<div class="it ${i.available && !snoozed(i) ? "" : "off"}" data-i="${i.id}">
            <div class="it__img">${thumb(i.images && i.images[0], i.name_ar)}</div>
            <div class="it__t"><b>${i.name_ar || i.name_en}${i.featured ? " ★" : ""}${i.hidden ? " · مخفي" : ""}</b>
              <span>${i.name_en}${snoozed(i) ? " · يرجع " + fmtDate(i.snooze_until) : !i.available ? " · غير متوفر" : ""}</span></div>
            <input class="price-in num" type="number" min="0" step="0.5" value="${i.price}" data-price aria-label="السعر" ${ed ? "" : "disabled"}>
            <div class="it__acts"><label class="switch" title="متوفر"><input type="checkbox" data-av ${i.available ? "checked" : ""} ${st ? "" : "disabled"}></label>
              ${st ? html`<button class="btn icon" data-snz title="إخفاء لمدة">${ico("clock")}</button>` : ""}
              ${ed ? html`<button class="btn icon" data-im="up" ${n ? "" : "disabled"}>${ico("up")}</button>
              <button class="btn icon" data-im="down" ${n < items.length - 1 ? "" : "disabled"}>${ico("down")}</button>
              <button class="btn icon" data-im="edit" title="تعديل">${ico("edit")}</button>` : ""}</div>
          </div>`) : html`<p class="empty">ما فيه أصناف في هذا القسم بعد</p>`}</div>` : html`<p class="empty">أضف أول قسم</p>`}
      </div>
    </div>`);

  el.onclick = async e => {
    const c = e.target.closest("[data-c]"); if (c) { selCat = c.dataset.c; return VIEWS.menu(el); }
    const cm = e.target.closest("[data-cm]");
    if (cm) {
      if (cm.dataset.cm === "edit") return editCat(cat, el);
      const sorted = S.cats.slice().sort((a, b) => a.sort - b.sort);
      return busy(cm, async () => { await reorder("categories", sorted, sorted.findIndex(x => x.id === cat.id), cm.dataset.cm === "up" ? -1 : 1); VIEWS.menu(el); });
    }
    const row = e.target.closest("[data-i]"); const im = e.target.closest("[data-im]");
    const sz = e.target.closest("[data-snz]");
    if (row && sz) return snoozeItem(S.items.find(x => x.id === row.dataset.i), el);
    if (row && im) {
      const it = S.items.find(x => x.id === row.dataset.i);
      if (im.dataset.im === "edit") return editItem(it, el);
      return busy(im, async () => { await reorder("items", items, items.indexOf(it), im.dataset.im === "up" ? -1 : 1); VIEWS.menu(el); });
    }
  };
  el.onchange = async e => {
    const row = e.target.closest("[data-i]"); if (!row) return;
    const it = S.items.find(x => x.id === row.dataset.i);
    if (e.target.matches("[data-av]")) {
      await busy(null, async () => { Object.assign(it, await api.rpc("set_item_stock", { p_id: it.id, p_available: e.target.checked, p_until: null })); toast(e.target.checked ? "صار متوفر" : "صار غير متوفر", "ok"); });
      VIEWS.menu(el);
    }
    if (e.target.matches("[data-price]")) {
      const v = Number(e.target.value); if (!(v >= 0)) return toast("سعر غير صحيح", "bad");
      await busy(null, async () => { Object.assign(it, await api.update("items", `id=eq.${enc(it.id)}`, { price: v })); toast("انحفظ السعر", "ok"); });
    }
  };
  const ac = $("#add-cat"); if (ac) ac.onclick = () => editCat(null, el);
  const ai = $("#add-it"); if (ai) ai.onclick = () => editItem(null, el);
};
const enc = encodeURIComponent;

async function reorder(table, list, idx, dir) {
  const j = idx + dir; if (j < 0 || j >= list.length) return;
  const arr = list.slice(); [arr[idx], arr[j]] = [arr[j], arr[idx]];
  const jobs = [];
  arr.forEach((row, n) => { const s = n * 10; if (row.sort !== s) { row.sort = s; jobs.push(api.update(table, `id=eq.${enc(row.id)}`, { sort: s })); } });
  await Promise.all(jobs);
}

function editCat(cat, el) {
  const isNew = !cat; const c = cat || { name_ar: "", name_en: "", visible: true, hours_from: null, hours_to: null };
  const count = cat ? S.items.filter(i => i.category_id === cat.id).length : 0;
  modal(isNew ? "قسم جديد" : "تعديل القسم", html`
    <div class="bi"><div class="f"><label>الاسم بالعربي</label><input type="text" name="name_ar" value="${c.name_ar}" required></div>
      <div class="f"><label>الاسم بالإنجليزي</label><input type="text" name="name_en" value="${c.name_en}" dir="ltr"></div></div>
    <div class="bi"><div class="f"><label>يُقدّم من الساعة (اختياري)</label><input type="number" name="hours_from" min="0" max="24" value="${c.hours_from ?? ""}" placeholder="مثلاً 7"></div>
      <div class="f"><label>إلى الساعة</label><input type="number" name="hours_to" min="0" max="24" value="${c.hours_to ?? ""}" placeholder="مثلاً 12"></div></div>
    <label class="check"><input type="checkbox" name="visible" ${c.visible ? "checked" : ""}> ظاهر للزوار</label>`,
    { extra: isNew ? "" : `<button type="button" class="btn danger" id="del-cat">${ico("trash").__raw} حذف القسم</button>`,
      onSubmit: async f => {
        const row = { name_ar: f.name_ar.value.trim(), name_en: f.name_en.value.trim(), visible: f.visible.checked,
          hours_from: f.hours_from.value === "" ? null : +f.hours_from.value, hours_to: f.hours_to.value === "" ? null : +f.hours_to.value };
        if (!row.name_ar && !row.name_en) { toast("اكتب اسم القسم", "bad"); return false; }
        if (isNew) {
          row.sort = (Math.max(0, ...S.cats.map(x => x.sort)) || 0) + 10; row.id = "c" + uid();
          const r = await api.insert("categories", row); S.cats.push(r); selCat = r.id;
        } else Object.assign(cat, await api.update("categories", `id=eq.${enc(cat.id)}`, row));
        toast("انحفظ", "ok"); VIEWS.menu(el); return true;
      } });
  const del = $("#del-cat");
  if (del) del.onclick = async () => {
    if (count) return toast(`القسم فيه ${count} صنف — انقلهم أو احذفهم أول`, "bad");
    if (!(await confirmBox("حذف القسم", `تحذف «${cat.name_ar}»؟ تقدر ترجعه من السجل.`))) return;
    await busy(null, async () => { await api.remove("categories", `id=eq.${enc(cat.id)}`); S.cats = S.cats.filter(x => x.id !== cat.id); selCat = null; toast("انحذف", "ok"); VIEWS.menu(el); });
  };
}

function snoozeUntil(v) {
  if (!v) return null;
  const t = new Date();
  if (v === "eod") { const dd = new Date(new Date().toLocaleString("en-US", { timeZone: C.tz })); t.setTime(t.getTime() + ((24 - dd.getHours()) * 60 - dd.getMinutes()) * 60000); }
  else if (v === "tmr") { const dd = new Date(new Date().toLocaleString("en-US", { timeZone: C.tz })); t.setTime(t.getTime() + ((24 - dd.getHours() + 7) * 60 - dd.getMinutes()) * 60000); }
  else t.setTime(t.getTime() + Number(v) * 3600000);
  return t.toISOString();
}
function snoozeItem(it, el) {
  const on = it.snooze_until && new Date(it.snooze_until) > new Date();
  modal("إخفاء «" + (it.name_ar || it.name_en) + "» لمدة", html`
    ${on ? html`<p class="banner warn">مخفي حالياً لين ${fmtDate(it.snooze_until)}</p>` : ""}
    <p class="hint">الصنف يختفي من المنيو للزوار، ويرجع لحاله بعد المدة — ما يحتاج أحد يرجعه.</p>
    <div class="f"><label>المدة</label><select name="d">
      <option value="2">ساعتين</option><option value="4">٤ ساعات</option><option value="eod" selected>لين آخر اليوم</option>
      <option value="tmr">لين بكرة ٧ الصبح</option><option value="24">٢٤ ساعة</option><option value="48">يومين</option><option value="168">أسبوع</option>
      ${on ? html`<option value="">رجّعه الحين</option>` : ""}</select></div>`,
    { submit: "تطبيق", onSubmit: async f => {
        const until = snoozeUntil(f.d.value);
        Object.assign(it, await api.rpc("set_item_stock", { p_id: it.id, p_available: true, p_until: until }));
        toast(until ? "انخفى لين " + fmtDate(until) : "رجع للمنيو", "ok"); VIEWS.menu(el); return true; } });
}

function editItem(item, el) {
  const isNew = !item;
  const it = item ? clone(item) : { name_ar: "", name_en: "", desc_ar: "", desc_en: "", price: 0, available: true, hidden: false, featured: false, images: [], category_id: selCat, snooze_until: null };
  const d = modal(isNew ? "صنف جديد" : "تعديل الصنف", html`
    <div class="bi"><div class="f"><label>الاسم بالعربي</label><input type="text" name="name_ar" value="${it.name_ar}"></div>
      <div class="f"><label>الاسم بالإنجليزي</label><input type="text" name="name_en" value="${it.name_en}" dir="ltr"></div></div>
    <div class="bi"><div class="f"><label>الوصف بالعربي</label><textarea name="desc_ar">${it.desc_ar}</textarea></div>
      <div class="f"><label>الوصف بالإنجليزي</label><textarea name="desc_en" dir="ltr">${it.desc_en}</textarea></div></div>
    <div class="bi"><div class="f"><label>السعر (${S.settings.cur?.ar || "درهم"})</label><input type="number" name="price" min="0" step="0.5" value="${it.price}" class="num"></div>
      <div class="f"><label>القسم</label><select name="category_id">${S.cats.map(c => html`<option value="${c.id}" ${c.id === it.category_id ? "selected" : ""}>${c.name_ar}</option>`)}</select></div></div>
    <div class="f"><span class="lbl">الصور — الأولى هي الرئيسية</span><div class="thumbs" id="thumbs"></div></div>
    <div class="row"><label class="check"><input type="checkbox" name="available" ${it.available ? "checked" : ""}> متوفر</label>
      <label class="check"><input type="checkbox" name="featured" ${it.featured ? "checked" : ""}> ضمن «المفضّلة عندنا»</label>
      <label class="check"><input type="checkbox" name="hidden" ${it.hidden ? "checked" : ""}> مخفي نهائياً</label></div>
    <div class="f"><label>إخفاء مؤقت (يرجع تلقائياً)</label><select name="snooze">
      <option value="">— بدون —</option><option value="2">ساعتين</option><option value="4">٤ ساعات</option><option value="eod">لين آخر اليوم</option><option value="24">٢٤ ساعة</option><option value="48">٤٨ ساعة</option>
      ${it.snooze_until && new Date(it.snooze_until) > new Date() ? html`<option value="keep" selected>مخفي لين ${fmtDate(it.snooze_until)}</option>` : ""}</select></div>`,
    { wide: true, extra: isNew ? "" : `<button type="button" class="btn danger" id="del-it">${ico("trash").__raw} حذف</button>`,
      onSubmit: async f => {
        const row = { name_ar: f.name_ar.value.trim(), name_en: f.name_en.value.trim(), desc_ar: f.desc_ar.value.trim(), desc_en: f.desc_en.value.trim(),
          price: Number(f.price.value || 0), category_id: f.category_id.value, available: f.available.checked, featured: f.featured.checked, hidden: f.hidden.checked, images: it.images };
        if (!row.name_ar && !row.name_en) { toast("اكتب اسم الصنف", "bad"); return false; }
        const sz = f.snooze.value;
        if (sz === "") row.snooze_until = null;
        else if (sz !== "keep") {
          const t = new Date();
          if (sz === "eod") { const dd = new Date(new Date().toLocaleString("en-US", { timeZone: C.tz })); t.setTime(t.getTime() + ((24 - dd.getHours()) * 60 - dd.getMinutes()) * 60000); }
          else t.setTime(t.getTime() + Number(sz) * 3600000);
          row.snooze_until = t.toISOString();
        }
        if (isNew) {
          row.id = "i" + uid(); row.sort = Math.max(0, ...S.items.filter(x => x.category_id === row.category_id).map(x => x.sort)) + 10;
          S.items.push(await api.insert("items", row));
        } else Object.assign(item, await api.update("items", `id=eq.${enc(item.id)}`, row));
        selCat = row.category_id; toast("انحفظ", "ok"); VIEWS.menu(el); return true;
      } });
  const paintThumbs = () => put($("#thumbs", d), html`${it.images.map((m, n) => html`<div class="t" data-n="${n}">${thumb(m)}${n === 0 ? html`<span class="main">رئيسية</span>` : ""}<button type="button" data-rm="${n}" aria-label="شيل">×</button></div>`)}
      <button type="button" class="btn" id="add-img" style="height:72px;border-radius:12px">${ico("plus")} صورة</button>`);
  paintThumbs();
  $("#thumbs", d).onclick = async e => {
    const rm = e.target.closest("[data-rm]"); if (rm) { it.images.splice(+rm.dataset.rm, 1); return paintThumbs(); }
    const t = e.target.closest(".t"); if (t && +t.dataset.n > 0) { const [x] = it.images.splice(+t.dataset.n, 1); it.images.unshift(x); return paintThumbs(); }
    if (e.target.closest("#add-img")) {
      const id = await pickMedia({ kinds: ["menu", "venue", "brand"] });
      if (id && !it.images.includes(id)) { it.images.push(id); paintThumbs(); }
    }
  };
  const del = $("#del-it");
  if (del) del.onclick = async () => {
    if (!(await confirmBox("حذف الصنف", `تحذف «${item.name_ar || item.name_en}»؟ تقدر ترجعه من السجل.`))) return;
    await busy(null, async () => { await api.remove("items", `id=eq.${enc(item.id)}`); S.items = S.items.filter(x => x.id !== item.id); toast("انحذف", "ok"); dlg().close(); VIEWS.menu(el); });
  };
}

/* ---------- media library ---------- */
let mKind = "menu", mFolder = "*", mQ = "";
VIEWS.media = async el => {
  if (mKind === "docs" && !S.media.some(m => m.kind === "docs") && isAdmin()) {
    // documents are private; the owner loads them on demand
  }
  const usage = usageMap();
  const inKind = S.media.filter(m => m.kind === mKind);
  const folders = Array.from(new Set(inKind.map(m => m.folder || ""))).sort();
  const list = inKind.filter(m => (mFolder === "*" || (m.folder || "") === mFolder) && (!mQ || (m.alt_ar + " " + m.alt_en + " " + m.id).toLowerCase().includes(mQ)));
  const kinds = ["menu", "venue", "brand", "video", "docs"];
  put(el, html`${head("المكتبة", "كل الصور والفيديو والمستندات في مكان واحد — مرتّبة حسب النوع والمجلد")}
    <div class="row" style="margin-bottom:12px"><div class="chips">${kinds.map(k => html`<button class="chip ${k === mKind ? "on" : ""}" data-k="${k}">${KIND_AR[k]} <span class="num muted">${S.media.filter(m => m.kind === k).length}</span></button>`)}</div></div>
    <div class="card">
      <div class="row" style="margin-bottom:12px"><div class="chips">
        <button class="chip ${mFolder === "*" ? "on" : ""}" data-f="*">كل المجلدات</button>
        ${folders.map(f => html`<button class="chip ${f === mFolder ? "on" : ""}" data-f="${f}">${f || "عام"}</button>`)}
        <button class="chip" id="new-f">${ico("plus")} مجلد</button></div><span class="sp"></span>
        <input type="search" id="mq" placeholder="ابحث…" value="${mQ}" style="max-width:220px"></div>
      <label class="drop" id="drop"><input type="file" id="mup" multiple hidden accept="${mKind === "video" ? "video/*" : mKind === "docs" ? "image/*,application/pdf" : "image/*"}">
        <b>${ico("upl")} اسحب الملفات هنا أو اضغط للرفع</b><br><span class="hint">تنرفع إلى «${KIND_AR[mKind]}» · المجلد: ${mFolder === "*" || !mFolder ? "عام" : mFolder}${mKind === "menu" || mKind === "venue" ? " · الصور تنضغط تلقائياً للسرعة" : ""}</span>
        <div class="progress" hidden><i></i></div></label>
      <div class="mgrid" style="margin-top:16px">${list.length ? list.map(m => html`<div class="mcard" data-m="${m.id}">
          <div class="mthumb">${m.kind === "docs" ? html`<div class="doc">${/pdf/.test(m.mime || "") ? "PDF" : "صورة"}<br>${kb(m.bytes)}</div>` : m.kind === "video" ? html`<video src="${m.url}" muted preload="metadata"></video>` : thumb(m.id)}</div>
          <div class="mmeta"><b>${m.alt_ar || m.id}</b><span>${m.folder || "عام"} · ${usage[m.id] ? "مستخدمة " + usage[m.id] : "غير مستخدمة"}</span></div>
          <div class="acts"><button class="btn icon" data-ma="edit" title="تعديل">${ico("edit")}</button>
            ${m.kind === "docs" ? html`<button class="btn icon" data-ma="open" title="فتح">${ico("eye")}</button>` : html`<button class="btn icon" data-ma="copy" title="نسخ الرابط">${ico("link")}</button>`}
            <button class="btn icon" data-ma="del" title="حذف">${ico("trash")}</button></div></div>`) : html`<p class="empty" style="grid-column:1/-1">ما فيه ملفات هنا</p>`}</div>
    </div>`);

  el.onclick = async e => {
    const k = e.target.closest("[data-k]"); if (k) { mKind = k.dataset.k; mFolder = "*"; return VIEWS.media(el); }
    const f = e.target.closest("[data-f]"); if (f) { mFolder = f.dataset.f; return VIEWS.media(el); }
    if (e.target.closest("#new-f")) {
      return modal("مجلد جديد", html`<div class="f"><label>اسم المجلد</label><input type="text" name="n" required placeholder="مثلاً: عروض رمضان"></div><p class="hint">المجلد يظهر أول ما ترفع فيه ملف.</p>`,
        { submit: "إنشاء", onSubmit: async fm => { const n = fm.n.value.trim(); if (!n) return false; mFolder = n; VIEWS.media(el); return true; } });
    }
    const card = e.target.closest("[data-m]"), a = e.target.closest("[data-ma]"); if (!card || !a) return;
    const m = S.media.find(x => x.id === card.dataset.m);
    if (a.dataset.ma === "open") return openDoc(m.path, a);
    if (a.dataset.ma === "copy") { const u = new URL(m.url, location.href).href; navigator.clipboard?.writeText(u); return toast("انتسخ الرابط", "ok"); }
    if (a.dataset.ma === "edit") return editMedia(m, el);
    if (a.dataset.ma === "del") {
      if (usage[m.id]) return toast(`الملف مستخدم في ${usage[m.id]} مكان — شيله منها أول`, "bad");
      if (!(await confirmBox("حذف الملف", "يحذف من المكتبة ومن التخزين نهائياً."))) return;
      await busy(a, async () => {
        await api.remove("media", `id=eq.${enc(m.id)}`);
        if (m.bucket && m.path) { try { await api.removeObj(m.bucket, m.path); } catch (err) { /* row is gone; storage cleanup is best effort */ } }
        S.media = S.media.filter(x => x.id !== m.id); toast("انحذف", "ok"); VIEWS.media(el);
      });
    }
  };
  $("#mq").oninput = e => { mQ = e.target.value.toLowerCase(); clearTimeout(VIEWS.media.t); VIEWS.media.t = setTimeout(() => { VIEWS.media(el); const q = $("#mq"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => doUploads(Array.from(e.dataTransfer.files || []), el));
  $("#mup").onchange = e => doUploads(Array.from(e.target.files || []), el);
};
async function doUploads(files, el) {
  if (!files.length) return;
  const bar = $("#drop .progress"), fill = $("#drop .progress i"); bar.hidden = false;
  let done = 0, failed = 0;
  for (const f of files) {
    try { await uploadMedia(f, mKind, mFolder === "*" ? "" : mFolder); } catch (e) { failed++; toast(errText(e), "bad"); }
    done++; fill.style.width = (done / files.length * 100) + "%";
  }
  toast(`انرفع ${done - failed} من ${files.length}`, failed ? "bad" : "ok");
  VIEWS.media(el);
}
function usageMap() {
  const u = {};
  const add = id => { if (id) u[id] = (u[id] || 0) + 1; };
  S.items.forEach(i => (i.images || []).forEach(add));
  const st = S.settings || {}, h = st.home || {};
  add(h.hero && h.hero.image); (h.space || []).forEach(x => add(x.img)); (h.gallery || []).forEach(x => add(x.img));
  add(st.loyalty && st.loyalty.stamp_full); add(st.loyalty && st.loyalty.stamp_empty);
  ["logo", "og", "hero-800"].forEach(add);
  return u;
}
function editMedia(m, el) {
  const kinds = m.kind === "docs" ? ["docs"] : ["menu", "venue", "brand", "video"].filter(k => m.kind === "video" ? k === "video" : k !== "video");
  modal("تعديل الملف", html`
    ${m.kind !== "docs" && m.kind !== "video" ? html`<div style="max-width:220px;border-radius:14px;overflow:hidden">${thumb(m.id)}</div>` : ""}
    <div class="bi"><div class="f"><label>الاسم / الوصف بالعربي</label><input type="text" name="alt_ar" value="${m.alt_ar}"></div>
      <div class="f"><label>بالإنجليزي</label><input type="text" name="alt_en" value="${m.alt_en}" dir="ltr"></div></div>
    <div class="bi"><div class="f"><label>المجلد</label><input type="text" name="folder" value="${m.folder}" list="fl"><datalist id="fl">${Array.from(new Set(S.media.map(x => x.folder).filter(Boolean))).map(f => html`<option value="${f}">`)}</datalist></div>
      <div class="f"><label>النوع</label><select name="kind">${kinds.map(k => html`<option value="${k}" ${k === m.kind ? "selected" : ""}>${KIND_AR[k]}</option>`)}</select></div></div>
    <p class="hint">المعرّف: <span class="ltr">${m.id}</span> · ${kb(m.bytes)}${m.width ? ` · ${m.width}×${m.height}` : ""} · ${fmtDate(m.created_at)}${m.created_by_name ? " · " + m.created_by_name : ""}</p>`,
    { onSubmit: async f => {
      Object.assign(m, await api.update("media", `id=eq.${enc(m.id)}`, { alt_ar: f.alt_ar.value.trim(), alt_en: f.alt_en.value.trim(), folder: f.folder.value.trim(), kind: f.kind.value }));
      toast("انحفظ", "ok"); VIEWS.media(el); return true;
    } });
}

/* ---------- site content ---------- */
let draft = null;
const SECTIONS = [
  { id: "maint", t: "وضع الصيانة", paths: ["maint"], render: d => html`
      <label class="check"><span class="switch"><input type="checkbox" data-p="maint.on" data-t="bool" ${d.maint?.on ? "checked" : ""}></span> الموقع تحت الصيانة (الزوار يشوفون هذي الشاشة)</label>
      ${bi("maint.title", "العنوان", d)}${bi("maint.body", "النص", d, true)}` },
  { id: "hero", t: "الواجهة الرئيسية", paths: ["home.hero"], render: d => html`
      ${biK("home.hero", "title", "العنوان الكبير", d)}${biK("home.hero", "sub", "السطر التعريفي", d, true)}
      ${imgField("home.hero.image", "صورة الواجهة", d)}` },
  { id: "about", t: "عن pressio", paths: ["home.about", "home.points"], render: d => html`
      ${bi("home.about", "النبذة", d, true)}
      ${listEd("home.points", "النقاط", d, (p, n) => html`${bi(`home.points.${n}`, "العنوان", d)}${biD(`home.points.${n}`, "الوصف", d)}`, { ar: "", en: "", dar: "", den: "" })}` },
  { id: "space", t: "المكان", paths: ["home.space"], render: d => listEd("home.space", "صور المكان", d, (p, n) => html`${imgField(`home.space.${n}.img`, "الصورة", d)}${bi(`home.space.${n}`, "التعليق", d)}`, { img: "", ar: "", en: "" }) },
  { id: "gallery", t: "لقطات من يومنا", paths: ["home.gallery"], render: d => listEd("home.gallery", "الصور", d, (p, n) => html`${imgField(`home.gallery.${n}.img`, "الصورة", d)}${bi(`home.gallery.${n}`, "التعليق", d)}`, { img: "", ar: "", en: "" }) },
  { id: "delivery", t: "التوصيل", paths: ["home.delivery"], render: d => listEd("home.delivery", "منصات التوصيل", d, (p, n) => html`${bi(`home.delivery.${n}`, "الاسم", d)}${biD(`home.delivery.${n}`, "وصف قصير", d)}
      ${txt(`home.delivery.${n}.url`, "رابط صفحتكم في المنصة", d, "url", "https://…")}`, { ar: "", en: "", dar: "", den: "", url: "" }) },
  { id: "info", t: "معلومات الزيارة", paths: ["home.info"], render: d => html`
      ${bi("home.info.area", "المنطقة (تطلع في الواجهة: نشوفك في …)", d)}
      ${bi("home.info.addr", "العنوان الكامل", d)}
      <div class="f"><span class="lbl">أوقات الدوام لكل يوم</span>
        <p class="hint">إذا وقت السكّر بعد منتصف الليل (مثلاً ١ الفجر) اكتبه عادي 01:00 — الموقع يفهم إنه اليوم الثاني. الموقع يحسب «مفتوح الحين» من هذا الجدول.</p>
        <div class="wk">${[1, 2, 3, 4, 5, 6, 0].map(n => html`<div class="wk__row"><b>${DAYS_AR[n]}</b>
          <input type="time" data-p="home.info.week.${n}.from" value="${getPath(d, `home.info.week.${n}.from`) ?? ""}" dir="ltr" aria-label="${DAYS_AR[n]} من">
          <span>–</span>
          <input type="time" data-p="home.info.week.${n}.to" value="${getPath(d, `home.info.week.${n}.to`) ?? ""}" dir="ltr" aria-label="${DAYS_AR[n]} إلى">
          ${chk(`home.info.week.${n}.closed`, "مسكّر", d)}</div>`)}</div></div>
      ${bi("home.info.hours_note", "ملاحظة تحت الأوقات (اختياري)", d)}
      ${bi("home.info.hours", "الأوقات كنص (تُستخدم بس إذا الجدول فاضي)", d)}
      <div class="bi">${txt("home.info.phone", "الهاتف", d, "tel")}${txt("home.info.ig", "إنستغرام", d, "text", "@pressio.ae")}</div>
      <div class="bi">${txt("home.info.map", "رابط Google Maps", d, "url", "https://maps.app.goo.gl/…")}${txt("home.info.whatsapp", "واتساب (اختياري)", d, "tel")}</div>
      <div class="bi">${num("home.info.rating.value", "تقييم Google (مثلاً 5.0)", d)}${num("home.info.rating.count", "عدد التقييمات", d)}</div>
      ${txt("home.info.rating.url", "رابط التقييمات (اختياري — الافتراضي رابط الخريطة)", d, "url")}
      ${listEd("home.info.features", "الخدمات (جلسات داخلية، درايف ثرو، مواقف…)", d, (p, n) => bi(`home.info.features.${n}`, "الخدمة", d), { ar: "", en: "" })}` },
  { id: "loyalty", t: "برنامج الولاء", paths: ["loyalty"], render: d => html`
      ${txt("loyalty.url", "رابط الانضمام", d, "url")}${bi("loyalty.title", "العنوان", d)}${bi("loyalty.body", "الشرح", d, true)}
      ${bi("loyalty.cta", "نص الزر", d)}${bi("loyalty.scan", "تحت البطاقة", d)}
      ${listEd("loyalty.steps", "الخطوات", d, (p, n) => html`${bi(`loyalty.steps.${n}`, "الخطوة", d)}${biD(`loyalty.steps.${n}`, "الشرح", d)}`, { ar: "", en: "", dar: "", den: "" })}` },
  { id: "brand", t: "الهوية والعملة", paths: ["brand", "cur"], render: d => html`
      <div class="bi">${txt("brand.tagline", "السطر تحت الشعار", d)}${txt("brand.foot", "جملة الفوتر", d)}</div>
      ${bi("cur", "العملة", d)}` },
  { id: "rf", t: "خانات التقرير اليومي", paths: ["report_fields"], render: d => html`
      <p class="hint">الخانات الإضافية اللي يعبّيها الموظف كل يوم (طرق دفع، منصات توصيل…). الخانة الموقوفة تختفي من الفورم الجديد بس تبقى في التقارير القديمة.</p>
      ${listEd("report_fields", "الخانات", d, (p, n) => html`
        <div class="bi">${txt(`report_fields.${n}.ar`, "الاسم بالعربي", d)}${txt(`report_fields.${n}.en`, "بالإنجليزي", d)}</div>
        <div class="bi">${sel(`report_fields.${n}.kind`, "النوع", d, [["amount", "مبلغ"], ["number", "رقم"], ["text", "نص"], ["bool", "نعم / لا"]])}
          ${sel(`report_fields.${n}.group`, "المجموعة", d, [["card", "دفع بالبطاقة"], ["delivery", "منصة توصيل"], ["other", "أخرى"]])}</div>
        <div class="row">${chk(`report_fields.${n}.in_sales`, "يدخل في إجمالي المبيعات", d)}${chk(`report_fields.${n}.active`, "فعّالة", d)}</div>`,
        { key: "", ar: "", en: "", kind: "amount", group: "other", in_sales: true, active: true })}` }
];
const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const bi = (p, label, d, area = false) => html`<div class="bi">${field(p + ".ar", label + " — عربي", d, area)}${field(p + ".en", label + " — English", d, area, "ltr")}</div>`;
const biK = (p, k, label, d, area = false) => html`<div class="bi">${field(`${p}.${k}_ar`, label + " — عربي", d, area)}${field(`${p}.${k}_en`, label + " — English", d, area, "ltr")}</div>`;
const biD = (p, label, d) => html`<div class="bi">${field(p + ".dar", label + " — عربي", d, true)}${field(p + ".den", label + " — English", d, true, "ltr")}</div>`;
const field = (p, label, d, area, dir) => html`<div class="f"><label>${label}</label>${area
  ? html`<textarea data-p="${p}" ${dir ? raw(`dir="${dir}"`) : ""}>${getPath(d, p) ?? ""}</textarea>`
  : html`<input type="text" data-p="${p}" value="${getPath(d, p) ?? ""}" ${dir ? raw(`dir="${dir}"`) : ""}>`}</div>`;
const txt = (p, label, d, type = "text", ph = "") => html`<div class="f"><label>${label}</label><input type="${type}" data-p="${p}" value="${getPath(d, p) ?? ""}" placeholder="${ph}" ${["url", "tel"].includes(type) ? raw('dir="ltr"') : ""}></div>`;
const num = (p, label, d) => html`<div class="f"><label>${label}</label><input type="number" data-p="${p}" data-t="num" value="${getPath(d, p) ?? ""}" class="num"></div>`;
const chk = (p, label, d) => html`<label class="check"><input type="checkbox" data-p="${p}" data-t="bool" ${getPath(d, p) ? "checked" : ""}> ${label}</label>`;
const sel = (p, label, d, opts) => html`<div class="f"><label>${label}</label><select data-p="${p}">${opts.map(([v, t]) => html`<option value="${v}" ${getPath(d, p) === v ? "selected" : ""}>${t}</option>`)}</select></div>`;
const imgField = (p, label, d) => html`<div class="f"><label>${label}</label><div class="imgpick"><div class="th">${thumb(getPath(d, p))}</div>
  <button type="button" class="btn sm" data-pick="${p}">${ico("media")} اختر من المكتبة</button><span class="hint ltr">${getPath(d, p) || ""}</span></div></div>`;
function listEd(p, label, d, rowFn, blank) {
  const arr = getPath(d, p) || [];
  return html`<div class="f"><span class="lbl">${label}</span><div class="lst">${arr.map((x, n) => html`<div class="lst__row">
      <div class="lst__bar"><span class="n">#${n + 1}</span>
        <button type="button" class="btn icon" data-lm="up" data-l="${p}" data-n="${n}" ${n ? "" : "disabled"}>${ico("up")}</button>
        <button type="button" class="btn icon" data-lm="down" data-l="${p}" data-n="${n}" ${n < arr.length - 1 ? "" : "disabled"}>${ico("down")}</button>
        <button type="button" class="btn icon" data-lm="del" data-l="${p}" data-n="${n}">${ico("trash")}</button></div>
      ${rowFn(x, n)}</div>`)}
    <button type="button" class="btn sm" data-lm="add" data-l="${p}" data-blank='${raw(esc(JSON.stringify(blank)))}'>${ico("plus")} إضافة</button></div></div>`;
}

VIEWS.content = async el => {
  draft = clone(S.settings);
  put(el, html`${head("محتوى الموقع", "كل نص وصورة في الموقع — احفظ كل قسم لحاله")}
    <div class="grid" style="grid-template-columns:minmax(0,1fr)">${SECTIONS.map(s => html`<section class="card" data-s="${s.id}"></section>`)}</div>`);
  SECTIONS.forEach(s => paintSection(s, el));
  el.oninput = el.onchange = e => {
    const x = e.target.closest("[data-p]"); if (!x) return;
    let v = x.type === "checkbox" ? x.checked : x.value;
    if (x.dataset.t === "num") v = x.value === "" ? null : Number(x.value);
    setPath(draft, x.dataset.p, v);
    const sec = x.closest("[data-s]"); if (sec) sec.querySelector("[data-save]").classList.add("primary");
  };
  el.onclick = async e => {
    const sec = e.target.closest("[data-s]"); if (!sec) return;
    const s = SECTIONS.find(x => x.id === sec.dataset.s);
    const lm = e.target.closest("[data-lm]");
    if (lm) {
      const arr = getPath(draft, lm.dataset.l) || []; const n = +lm.dataset.n;
      if (lm.dataset.lm === "add") arr.push(JSON.parse(lm.dataset.blank));
      if (lm.dataset.lm === "del") arr.splice(n, 1);
      if (lm.dataset.lm === "up" && n > 0) [arr[n - 1], arr[n]] = [arr[n], arr[n - 1]];
      if (lm.dataset.lm === "down" && n < arr.length - 1) [arr[n + 1], arr[n]] = [arr[n], arr[n + 1]];
      setPath(draft, lm.dataset.l, arr); paintSection(s, el, true); return;
    }
    const pk = e.target.closest("[data-pick]");
    if (pk) { const id = await pickMedia(); if (id) { setPath(draft, pk.dataset.pick, id); paintSection(s, el, true); } return; }
    const sv = e.target.closest("[data-save]");
    if (sv) {
      if (s.id === "rf") (getPath(draft, "report_fields") || []).forEach(f => { if (!f.key) f.key = slug(f.en || f.ar) || "f" + uid(); });
      await busy(sv, async () => { await saveSettingsPart(s.paths, draft); draft = Object.assign(clone(S.settings), draft); toast("انحفظ «" + s.t + "»", "ok"); paintSection(s, el); });
    }
  };
};
function paintSection(s, el, dirty = false) {
  const box = $(`[data-s="${s.id}"]`, el);
  put(box, html`<div class="row between" style="margin-bottom:12px"><h2>${s.t}</h2><button class="btn sm ${dirty ? "primary" : ""}" data-save>حفظ</button></div><div class="grid">${s.render(draft)}</div>`);
}

/* ---------- invoices ---------- */
const INV_CATS = [["raw", "مواد خام"], ["drinks", "مشروبات وحليب"], ["bakery", "مخبوزات وحلا"], ["packaging", "تغليف"], ["ops", "تشغيل وخدمات"], ["maint", "صيانة"], ["other", "أخرى"]];
const INV_CAT_AR = Object.fromEntries(INV_CATS);
const ST_AR = { pending: ["بانتظار المراجعة", "warn"], approved: ["مقبولة", "ok"], rejected: ["مرفوضة", "bad"] };
let invF = { status: "", from: "", to: "", q: "" };
VIEWS.invoices = async el => {
  let qs = "select=*&order=created_at.desc&limit=300";
  if (invF.status) qs += `&status=eq.${invF.status}`;
  if (invF.from) qs += `&invoice_date=gte.${invF.from}`;
  if (invF.to) qs += `&invoice_date=lte.${invF.to}`;
  if (invF.q) qs += `&supplier=ilike.*${enc(invF.q)}*`;
  const rows = await api.select("invoices", qs);
  const sum = rows.reduce((a, r) => a + Number(r.total || 0), 0);
  const all = can("inv_review") || can("view_all"), rev = can("inv_review"), up = can("inv_upload");
  put(el, html`${head("الفواتير", rev ? "كل فواتير الفريق — راجع واقبل أو ارفض" : all ? "كل فواتير الفريق — عرض فقط" : "الفواتير اللي رفعتها — بعد الإرسال ما تنعدّل")}
    ${up ? html`<details class="card" ${rows.length ? "" : "open"} id="newinv"><summary style="cursor:pointer;font-weight:600">${ico("plus")} فاتورة جديدة</summary>
      <form id="invf" class="grid" style="margin-top:14px" novalidate>
        <div class="f"><label>صورة الفاتورة أو PDF *</label><input type="file" name="file" accept="image/*,application/pdf" capture="environment" required></div>
        <div class="bi"><div class="f"><label>المورّد</label><input type="text" name="supplier" list="sup"></div>
          <div class="f"><label>رقم الفاتورة</label><input type="text" name="invoice_no" dir="ltr"></div></div>
        <div class="bi"><div class="f"><label>تاريخ الفاتورة</label><input type="date" name="invoice_date" value="${today()}"></div>
          <div class="f"><label>المبلغ الإجمالي (مع الضريبة)</label><input type="number" name="total" step="0.01" min="0" class="num"></div></div>
        <div class="bi"><div class="f"><label>التصنيف</label><select name="category">${INV_CATS.map(([v, t]) => html`<option value="${v}">${t}</option>`)}</select></div>
          <div class="f"><label>ملاحظات</label><input type="text" name="notes"></div></div>
        <datalist id="sup">${Array.from(new Set(rows.map(r => r.supplier).filter(Boolean))).map(s => html`<option value="${s}">`)}</datalist>
        <div class="row end"><button class="btn primary" type="submit">${ico("upl")} إرسال الفاتورة</button></div>
      </form></details>` : ""}
    <div class="card"><div class="row" style="margin-bottom:12px">
      <select id="fs" style="max-width:180px"><option value="">كل الحالات</option>${Object.entries(ST_AR).map(([k, v]) => html`<option value="${k}" ${invF.status === k ? "selected" : ""}>${v[0]}</option>`)}</select>
      <input type="date" id="ff" value="${invF.from}" style="max-width:170px" title="من"><input type="date" id="ft" value="${invF.to}" style="max-width:170px" title="إلى">
      <input type="search" id="fq" value="${invF.q}" placeholder="المورّد…" style="max-width:180px"><button class="btn sm" id="fgo">تطبيق</button>
      <span class="sp"></span><span class="hint">${rows.length} فاتورة · المجموع <b class="num">${fmtMoney(sum)}</b></span></div>
      ${rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>المورّد</th><th>الرقم</th><th>التصنيف</th><th>المبلغ</th>${all ? html`<th>رفعها</th>` : ""}<th>الحالة</th><th></th></tr></thead>
        <tbody>${rows.map(r => html`<tr data-r="${r.id}"><td>${fmtDay(r.invoice_date || r.created_at.slice(0, 10))}</td><td class="wrap">${r.supplier || "—"}${r.notes ? html`<br><span class="hint">${r.notes}</span>` : ""}</td>
          <td class="num">${r.invoice_no || "—"}</td><td>${INV_CAT_AR[r.category] || "—"}</td><td class="num">${fmtMoney(r.total)}</td>
          ${all ? html`<td>${r.created_by_name || "—"}</td>` : ""}<td><span class="pill ${ST_AR[r.status][1]}" title="${r.reviewed_by_name ? "بواسطة " + r.reviewed_by_name + " · " + fmtDate(r.reviewed_at) : ""}">${ST_AR[r.status][0]}</span>${r.reviewed_by_name ? html`<br><span class="hint">${r.reviewed_by_name}</span>` : ""}</td>
          <td><div class="row" style="flex-wrap:nowrap">${r.file_path ? html`<button class="btn sm" data-open="${r.file_path}">${ico("eye")} الملف</button>` : ""}
            ${rev && r.status !== "approved" ? html`<button class="btn sm ok" data-st="approved">قبول</button>` : ""}
            ${rev && r.status !== "rejected" ? html`<button class="btn sm danger" data-st="rejected">رفض</button>` : ""}</div></td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">ما فيه فواتير${invF.status || invF.from || invF.to || invF.q ? " بهذي الفلاتر" : " بعد"}</p>`}</div>`);

  $("#fgo").onclick = () => { invF = { status: $("#fs").value, from: $("#ff").value, to: $("#ft").value, q: $("#fq").value.trim() }; VIEWS.invoices(el); };
  el.onclick = async e => {
    const o = e.target.closest("[data-open]"); if (o) return openDoc(o.dataset.open, o);
    const st = e.target.closest("[data-st]");
    if (st) {
      const id = st.closest("[data-r]").dataset.r, ok = st.dataset.st === "approved";
      if (ok) return busy(st, async () => { await api.rpc("review_invoice", { p_id: id, p_status: "approved" }); toast("انقبلت", "ok"); VIEWS.invoices(el); });
      modal("رفض الفاتورة", html`<div class="f"><label>السبب (يوصل للي رفعها)</label><input type="text" name="n" placeholder="مثلاً: الصورة مب واضحة"></div>`,
        { submit: "رفض", onSubmit: async f => { await api.rpc("review_invoice", { p_id: id, p_status: "rejected", p_note: f.n.value.trim() ? "سبب الرفض: " + f.n.value.trim() : null }); toast("انرفضت", "ok"); VIEWS.invoices(el); return true; } });
    }
  };
  if ($("#invf")) $("#invf").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const file = f.file.files[0]; if (!file) return toast("أرفق صورة الفاتورة أو PDF", "bad");
    await busy($('button[type=submit]', f), async () => {
      const month = (f.invoice_date.value || today()).slice(0, 7);
      const doc = await uploadDoc(file, `invoices/${month}`, `invoices/${month}`, (f.supplier.value.trim() || "فاتورة") + " " + (f.invoice_no.value.trim() || ""));
      await api.insert("invoices", { created_by: api.sess.uid, supplier: f.supplier.value.trim() || null, invoice_no: f.invoice_no.value.trim() || null,
        invoice_date: f.invoice_date.value || null, total: f.total.value === "" ? null : Number(f.total.value), category: f.category.value, notes: f.notes.value.trim() || null, file_path: doc.path });
      toast("انرسلت الفاتورة", "ok"); VIEWS.invoices(el);
    });
  };
};

/* ---------- daily report ---------- */
VIEWS.reports = async el => {
  const fields = (S.settings.report_fields || []).filter(f => f.active !== false);
  const rows = await api.select("reports", "select=*&order=report_date.desc,created_at.desc&limit=120");
  const state = { expenses: [], waste: [] };
  const up = can("inv_upload"), all = can("reports") || can("view_all");
  put(el, html`${head("التقرير اليومي", all ? (up ? "تقارير الفريق — والفورم لتقرير اليوم" : "تقارير الفريق") : "اكتبه قبل ما تسكّر — بعد الإرسال ما ينعدّل")}
    ${up ? html`<details class="card" id="newrep" ${rows.some(r => r.report_date === today() && r.created_by === api.sess.uid) ? "" : "open"}><summary style="cursor:pointer;font-weight:600">${ico("plus")} تقرير جديد</summary>
    <form id="rf" class="grid" style="margin-top:14px" novalidate>
      <div class="bi"><div class="f"><label>اليوم</label><input type="date" name="report_date" value="${today()}" required></div>
        <div class="f"><label>عدد الطلبات</label><input type="number" name="orders_count" min="0" class="num"></div></div>
      <h3 class="lbl" style="font-size:14px">المبيعات</h3>
      <div class="grid g3"><div class="f"><label>كاش</label><input type="number" name="cash" step="0.01" min="0" class="num" data-c></div>
        ${fields.map(f => html`<div class="f"><label>${f.ar}</label>${f.kind === "bool" ? html`<select name="x_${f.key}" data-c><option value="">—</option><option value="1">نعم</option><option value="0">لا</option></select>`
          : html`<input type="${f.kind === "text" ? "text" : "number"}" name="x_${f.key}" step="0.01" min="0" class="${f.kind === "text" ? "" : "num"}" data-c>`}</div>`)}</div>
      <h3 class="lbl" style="font-size:14px">الدرج</h3>
      <div class="bi"><div class="f"><label>رصيد الافتتاح</label><input type="number" name="open_float" step="0.01" min="0" class="num" data-c></div>
        <div class="f"><label>الكاش الموجود في الدرج عند الإغلاق</label><input type="number" name="drawer_count" step="0.01" min="0" class="num" data-c></div></div>
      <div class="f"><span class="lbl">مصاريف اليوم</span><div class="rows" id="exp"></div><button type="button" class="btn sm" data-add="expenses" style="width:max-content">${ico("plus")} مصروف</button></div>
      <div class="f"><span class="lbl">الهالك</span><div class="rows" id="wst"></div><button type="button" class="btn sm" data-add="waste" style="width:max-content">${ico("plus")} هالك</button></div>
      <div class="calc" id="calc"></div>
      <div class="bi"><div class="f"><label>ملاحظات</label><textarea name="notes"></textarea></div>
        <div class="f"><label>صورة ورقة التقرير (اختياري)</label><input type="file" name="file" accept="image/*,application/pdf" capture="environment"></div></div>
      <div class="row end"><button class="btn primary" type="submit">إرسال التقرير</button></div>
    </form></details>` : ""}
    <div class="card"><h2 style="margin-bottom:12px">التقارير</h2>${rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>اليوم</th><th>المبيعات</th><th>كاش</th><th>بطاقة</th><th>توصيل</th><th>فرق الدرج</th><th>كتبه</th><th></th></tr></thead>
      <tbody>${rows.map(r => { const c = repCalc(r, fields); return html`<tr data-rp="${r.id}"><td>${fmtDay(r.report_date)}</td><td class="num"><b>${fmtMoney(c.sales)}</b></td><td class="num">${fmtMoney(r.cash)}</td><td class="num">${fmtMoney(c.card)}</td><td class="num">${fmtMoney(c.delivery)}</td>
        <td>${r.drawer_count == null ? "—" : html`<span class="pill ${c.verdict[1]}"><span class="num">${fmtMoney(c.variance)}</span></span>`}</td><td>${r.created_by_name || "—"}</td>
        <td><button class="btn sm" data-view>${ico("eye")} تفاصيل</button></td></tr>`; })}</tbody></table></div>` : html`<p class="empty">ما فيه تقارير بعد</p>`}</div>`);

  const f = $("#rf");
  if (f) {
  const rowsUi = () => {
    put($("#exp"), state.expenses.map((x, n) => html`<div class="r"><input type="text" placeholder="البند" value="${x.desc}" data-e="expenses.${n}.desc"><input type="number" step="0.01" placeholder="المبلغ" value="${x.amount}" class="num" data-e="expenses.${n}.amount">
      <label class="check"><input type="checkbox" data-e="expenses.${n}.cash" ${x.cash ? "checked" : ""}> من الدرج</label><button type="button" class="btn icon" data-rm="expenses.${n}">×</button></div>`));
    put($("#wst"), state.waste.map((x, n) => html`<div class="r"><input type="text" placeholder="الصنف" value="${x.item}" data-e="waste.${n}.item"><input type="number" step="1" placeholder="الكمية" value="${x.qty}" class="num" data-e="waste.${n}.qty">
      <input type="text" placeholder="السبب" value="${x.reason}" data-e="waste.${n}.reason"><button type="button" class="btn icon" data-rm="waste.${n}">×</button></div>`));
  };
  const collect = () => {
    const extras = {};
    fields.forEach(fd => { const v = f["x_" + fd.key].value; extras[fd.key] = v === "" ? null : fd.kind === "text" ? v : fd.kind === "bool" ? v === "1" : Number(v); });
    const card = fields.filter(x => x.group === "card" && x.kind === "amount").reduce((a, x) => a + Number(extras[x.key] || 0), 0);
    const n = name => f[name].value === "" ? null : Number(f[name].value);
    return { report_date: f.report_date.value, cash: n("cash") || 0, card, orders_count: n("orders_count"), open_float: n("open_float") || 0, drawer_count: n("drawer_count"),
      extras, expenses: state.expenses.filter(x => x.desc || x.amount).map(x => ({ desc: x.desc, amount: Number(x.amount || 0), cash: !!x.cash })),
      waste: state.waste.filter(x => x.item).map(x => ({ item: x.item, qty: Number(x.qty || 0), reason: x.reason })), notes: f.notes.value.trim() || null };
  };
  const paintCalc = () => {
    const c = repCalc(collect(), fields);
    put($("#calc"), html`<div><span>إجمالي المبيعات</span><b class="num">${fmtMoney(c.sales)}</b></div><div><span>المتوقع في الدرج</span><b class="num">${fmtMoney(c.expected)}</b></div>
      <div><span>مصاريف من الدرج</span><b class="num">${fmtMoney(c.cashExp)}</b></div><div><span>الفرق</span><b class="num">${f.drawer_count.value === "" ? "—" : fmtMoney(c.variance)}</b>${f.drawer_count.value === "" ? "" : html`<span class="pill ${c.verdict[1]}">${c.verdict[0]}</span>`}</div>`);
  };
  rowsUi(); paintCalc();
  f.oninput = e => { const x = e.target.closest("[data-e]"); if (x) setPath(state, x.dataset.e, x.type === "checkbox" ? x.checked : x.value); paintCalc(); };
  f.onclick = e => {
    const a = e.target.closest("[data-add]"); if (a) { state[a.dataset.add].push(a.dataset.add === "expenses" ? { desc: "", amount: "", cash: true } : { item: "", qty: "", reason: "" }); rowsUi(); }
    const rm = e.target.closest("[data-rm]"); if (rm) { const [k, n] = rm.dataset.rm.split("."); state[k].splice(+n, 1); rowsUi(); paintCalc(); }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const row = collect(); if (!row.report_date) return toast("اختر اليوم", "bad");
    await busy($('button[type=submit]', f), async () => {
      const file = f.file.files[0];
      if (file) row.file_path = (await uploadDoc(file, `reports/${row.report_date.slice(0, 7)}`, `reports/${row.report_date.slice(0, 7)}`, "تقرير " + row.report_date)).path;
      row.created_by = api.sess.uid;
      await api.insert("reports", row); toast("انرسل التقرير", "ok"); VIEWS.reports(el);
    });
  };
  }
  el.onclick = e => {
    const v = e.target.closest("[data-view]"); if (!v) return;
    const r = rows.find(x => x.id === v.closest("[data-rp]").dataset.rp), c = repCalc(r, fields);
    modal("تقرير " + fmtDay(r.report_date), html`
      <div class="calc"><div><span>المبيعات</span><b class="num">${fmtMoney(c.sales)}</b></div><div><span>المتوقع في الدرج</span><b class="num">${fmtMoney(c.expected)}</b></div>
        <div><span>الموجود</span><b class="num">${r.drawer_count == null ? "—" : fmtMoney(r.drawer_count)}</b></div><div><span>الفرق</span><b class="num">${fmtMoney(c.variance)}</b><span class="pill ${c.verdict[1]}">${c.verdict[0]}</span></div></div>
      <div class="tbl-wrap"><table><tbody><tr><td>كاش</td><td class="num">${fmtMoney(r.cash)}</td></tr>
        ${(S.settings.report_fields || []).filter(fd => r.extras && r.extras[fd.key] != null).map(fd => html`<tr><td>${fd.ar}</td><td class="num">${typeof r.extras[fd.key] === "number" ? fmtMoney(r.extras[fd.key]) : String(r.extras[fd.key])}</td></tr>`)}
        <tr><td>رصيد الافتتاح</td><td class="num">${fmtMoney(r.open_float)}</td></tr><tr><td>عدد الطلبات</td><td class="num">${r.orders_count ?? "—"}</td></tr></tbody></table></div>
      ${(r.expenses || []).length ? html`<h3 class="lbl">المصاريف</h3><div class="tbl-wrap"><table><tbody>${r.expenses.map(x => html`<tr><td>${x.desc}</td><td class="num">${fmtMoney(x.amount)}</td><td>${x.cash ? "من الدرج" : ""}</td></tr>`)}</tbody></table></div>` : ""}
      ${(r.waste || []).length ? html`<h3 class="lbl">الهالك</h3><div class="tbl-wrap"><table><tbody>${r.waste.map(x => html`<tr><td>${x.item}</td><td class="num">${x.qty}</td><td>${x.reason || ""}</td></tr>`)}</tbody></table></div>` : ""}
      ${r.notes ? html`<p>${r.notes}</p>` : ""}<p class="hint">كتبه ${r.created_by_name || "—"} · ${fmtDate(r.created_at)}</p>`,
      { submit: "", cancel: "إغلاق", extra: r.file_path ? `<button type="button" class="btn" id="rfile">الورقة المرفقة</button>` : "" });
    const rb = $("#rfile"); if (rb) rb.onclick = () => openDoc(r.file_path, rb);
  };
  if (can("hr")) {
    const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
    const ps = await api.select("payslips", `select=month,total&status=eq.issued&month=gte.${from}`).catch(() => []);
    const by = {}; ps.forEach(p => { const k = p.month.slice(0, 7); by[k] = (by[k] || 0) + Number(p.total); });
    const card = document.createElement("div"); card.className = "card";
    put(card, html`<div class="row between"><h2>الرواتب المصروفة — آخر ٦ شهور</h2><a class="btn sm" href="#/hr">${ico("id")} الموظفين والرواتب</a></div>
      ${Object.keys(by).length ? html`<div class="tbl-wrap"><table><tbody>${Object.keys(by).sort().reverse().map(k => html`<tr><td>${monthLabel(k, "ar")}</td><td class="num">${fmtMoney(by[k])}</td></tr>`)}</tbody></table></div>` : html`<p class="hint">ما انصرفت رواتب من النظام بعد</p>`}`);
    el.appendChild(card);
  }
};
function repCalc(r, fields) {
  const ex = r.extras || {};
  const inSales = (fields || []).filter(f => f.in_sales && f.kind === "amount").reduce((a, f) => a + Number(ex[f.key] || 0), 0);
  const card = (fields || []).filter(f => f.group === "card" && f.kind === "amount").reduce((a, f) => a + Number(ex[f.key] || 0), 0) || Number(r.card || 0);
  const delivery = (fields || []).filter(f => f.group === "delivery" && f.kind === "amount").reduce((a, f) => a + Number(ex[f.key] || 0), 0);
  const cashExp = (r.expenses || []).filter(x => x.cash).reduce((a, x) => a + Number(x.amount || 0), 0);
  const expected = Number(r.open_float || 0) + Number(r.cash || 0) - cashExp;
  const variance = r.drawer_count == null ? 0 : Number(r.drawer_count) - expected;
  const av = Math.abs(variance);
  const verdict = r.drawer_count == null ? ["ما انعدّ", ""] : av < 1 ? ["مضبوط", "ok"] : av <= 20 ? ["فرق بسيط", "warn"] : ["يحتاج تحقيق", "bad"];
  return { sales: Number(r.cash || 0) + inSales, card, delivery, cashExp, expected, variance, verdict };
}

/* ---------- backups & history ---------- */
const KIND_SNAP = { auto: ["تلقائية", ""], manual: ["يدوية", "ink"], "pre-restore": ["قبل استرجاع", "warn"], import: ["مستوردة", "ok"] };
VIEWS.backups = async el => {
  const [snaps, hist] = await Promise.all([
    api.select("snapshots", "select=id,label,kind,bytes,created_at,created_by_name&order=created_at.desc&limit=200"),
    api.select("content_history", "select=id,table_name,row_id,action,old_data,new_data,changed_by_name,changed_at&order=changed_at.desc&limit=150")
  ]);
  const TBL = { items: "صنف", categories: "قسم", settings: "محتوى الموقع", media: "ملف", staff: "الفريق", invoices: "فاتورة", reports: "تقرير", snapshots: "نسخة" };
  const ACT = { INSERT: ["إضافة", "ok"], UPDATE: ["تعديل", ""], DELETE: ["حذف", "bad"], RESTORE: ["استرجاع", "warn"] };
  const label = h => { const d = h.new_data || h.old_data || {}; return d.name_ar || d.name_en || d.full_name || d.alt_ar || d.supplier || (d.report_date ? "يوم " + d.report_date : "") || d.note || (h.table_name === "settings" ? "" : h.row_id); };
  put(el, html`${head("النسخ الاحتياطية والسجل", "نسخة تلقائية كل يوم على السيرفر (تنحفظ ٦٠ يوم)، وتقدر تحفظ نسخة يدوية قبل أي تعديل كبير. تحتاج بس متصفح — ما يحتاج جهازك.")}
    <div class="card"><div class="row">
      ${can("backups") || can("site") ? html`<button class="btn primary" id="snap">${ico("backup")} احفظ نسخة الآن</button>` : html`<span class="hint">عرض فقط</span>`}
      ${isAdmin() ? html`<label class="btn">${ico("upl")} استيراد نسخة من ملف<input type="file" id="imp" accept="application/json,.json" hidden></label>
        <button class="btn" id="expall">${ico("dl")} تصدير كل البيانات</button>` : ""}
      <span class="sp"></span><span class="hint">المنيو والمحتوى والصور محفوظة. الفواتير والتقارير ما تنمسح أصلاً — محد يقدر يحذفها من الموقع.</span></div></div>
    <div class="card"><h2 style="margin-bottom:12px">النسخ المحفوظة (${snaps.length})</h2>${snaps.length ? html`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>التاريخ</th><th>الوصف</th><th>النوع</th><th>الحجم</th><th>بواسطة</th><th></th></tr></thead>
      <tbody>${snaps.map(s => html`<tr data-sn="${s.id}"><td class="num">${s.id}</td><td>${fmtDate(s.created_at)}</td><td class="wrap">${s.label}</td><td><span class="pill ${KIND_SNAP[s.kind][1]}">${KIND_SNAP[s.kind][0]}</span></td>
        <td class="num">${kb(s.bytes)}</td><td>${s.created_by_name || "النظام"}</td><td><div class="row" style="flex-wrap:nowrap">
        <button class="btn sm" data-sa="dl">${ico("dl")} تنزيل</button>${isAdmin() || can("backups") ? html`<button class="btn sm" data-sa="restore">${ico("undo")} استرجاع</button>` : ""}${isAdmin() ? html`<button class="btn icon" data-sa="del" title="حذف">${ico("trash")}</button>` : ""}</div></td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">ما فيه نسخ بعد</p>`}</div>
    <div class="card"><h2 style="margin-bottom:4px">سجل التعديلات</h2><p class="hint">كل تعديل على المنيو والمحتوى والصور مسجّل هنا باسم اللي سوّاه. «تراجع» يرجّع العنصر لحالته قبل التعديل.</p>
      ${hist.length ? html`<div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>بواسطة</th><th>العملية</th><th>العنصر</th><th></th></tr></thead>
      <tbody>${hist.map(h => html`<tr data-h="${h.id}"><td>${fmtDate(h.changed_at)}</td><td>${h.changed_by_name || "النظام"}</td><td><span class="pill ${(ACT[h.action] || ["", ""])[1]}">${(ACT[h.action] || [h.action])[0]}</span></td>
        <td class="wrap">${TBL[h.table_name] || h.table_name}${label(h) ? " · " + label(h) : ""}</td>
        <td>${(can("site") || can("backups")) && ["items", "categories", "settings", "media"].includes(h.table_name) && h.action !== "RESTORE" ? html`<button class="btn sm" data-undo>${ico("undo")} تراجع</button>` : ""}</td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">ما فيه تعديلات بعد</p>`}</div>`);

  if ($("#snap")) $("#snap").onclick = e => modal("حفظ نسخة", html`<div class="f"><label>وصف قصير (اختياري)</label><input type="text" name="l" placeholder="مثلاً: قبل تحديث أسعار الشتاء"></div>`,
    { submit: "حفظ", onSubmit: async f => { await api.rpc("save_snapshot", { p_label: f.l.value.trim() || "نسخة يدوية" }); toast("انحفظت النسخة", "ok"); VIEWS.backups(el); return true; } });
  const imp = $("#imp");
  if (imp) imp.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch (err) { return toast("الملف مب JSON صحيح", "bad"); }
    if (data.format !== "pressio-backup") return toast("هذا الملف مب نسخة pressio", "bad");
    const n = (data.items || []).length;
    if (!(await confirmBox("استيراد نسخة", `الملف فيه ${n} صنف و${(data.categories || []).length} قسم (${fmtDate(data.taken_at)}). بيستبدل المنيو والمحتوى الحالي — وبنحفظ نسخة من الوضع الحالي قبلها تلقائياً.`, { typed: "استيراد" }))) return;
    await busy(null, async () => { await api.rpc("import_snapshot", { p_data: data, p_label: file.name }); S.loaded = false; await Promise.all([loadContent(), loadSettings()]); S.loaded = true; toast("تم الاستيراد", "ok"); VIEWS.backups(el); });
  };
  const ex = $("#expall");
  if (ex) ex.onclick = () => busy(ex, async () => {
    const [inv, rep, staff, hr] = await Promise.all([api.select("invoices", "select=*&order=created_at"), api.select("reports", "select=*&order=report_date"), api.select("staff", "select=*"),
      Promise.all(["employees", "payslips", "certificates", "doc_templates"].map(t => api.select(t, "select=*").catch(() => [])))]);
    await Promise.all([loadContent(), loadSettings()]);
    download(`pressio-full-export-${today()}.json`, { format: "pressio-backup", version: 2, taken_at: new Date().toISOString(), settings: S.settings,
      categories: S.cats, items: S.items, media: S.media.filter(m => m.kind !== "docs"), documents: S.media.filter(m => m.kind === "docs"), invoices: inv, reports: rep, staff,
      employees: hr[0], payslips: hr[1], certificates: hr[2], doc_templates: hr[3] });
    toast("انحفظ الملف", "ok");
  });
  el.onclick = async e => {
    const sa = e.target.closest("[data-sa]");
    if (sa) {
      const id = +sa.closest("[data-sn]").dataset.sn, s = snaps.find(x => x.id === id);
      if (sa.dataset.sa === "dl") return busy(sa, async () => { const r = await api.select("snapshots", `select=data&id=eq.${id}`); download(`pressio-backup-${s.created_at.slice(0, 10)}-${id}.json`, r[0].data); });
      if (sa.dataset.sa === "restore") {
        if (!(await confirmBox("استرجاع نسخة", `بيرجع المنيو والمحتوى لحالته في ${fmtDate(s.created_at)} (${s.label}). الوضع الحالي ينحفظ كنسخة قبلها، فتقدر ترجع له.`, { typed: "استرجاع" }))) return;
        return busy(sa, async () => { await api.rpc("restore_snapshot", { p_id: id }); await Promise.all([loadContent(), loadSettings()]); S.loaded = true; toast("تم الاسترجاع", "ok"); VIEWS.backups(el); });
      }
      if (sa.dataset.sa === "del") {
        if (!(await confirmBox("حذف النسخة", "تحذف هذي النسخة نهائياً؟"))) return;
        return busy(sa, async () => { await api.remove("snapshots", `id=eq.${id}`); toast("انحذفت", "ok"); VIEWS.backups(el); });
      }
    }
    const u = e.target.closest("[data-undo]");
    if (u) {
      const id = +u.closest("[data-h]").dataset.h;
      if (!(await confirmBox("تراجع عن التعديل", "يرجّع العنصر لحالته قبل هذا التعديل.", { danger: false, yes: "تراجع" }))) return;
      await busy(u, async () => { await api.rpc("revert_change", { p_history_id: id }); await Promise.all([loadContent(), loadSettings()]); toast("تم التراجع", "ok"); VIEWS.backups(el); });
    }
  };
};

/* ---------- team ---------- */
const ROLE_OPTS = [["staff", "موظف"], ["accountant", "المحاسب"], ["manager", "مدير المشروع"], ["admin", "مالك — كل شي"]];
const permBoxes = (sel, name = "pm") => html`<div class="perms">${PERMS.map(([k, t, d]) => html`<label class="check perm"><input type="checkbox" name="${name}" value="${k}" ${sel.includes(k) ? "checked" : ""}>
  <span><b>${t}</b><small>${d}</small></span></label>`)}</div>`;
const permList = (r) => r.role === "admin" ? html`<span class="pill ok">كل شي</span>` : (r.perms || []).length
  ? html`${(r.perms || []).map(k => html`<span class="pill">${PERM_AR[k] || k}</span> `)}` : html`<span class="hint">بدون صلاحيات</span>`;

async function staffAdmin(body) {
  const r = await fetch(`${C.url}/functions/v1/staff-admin`, { method: "POST",
    headers: { apikey: C.key, Authorization: `Bearer ${await api.token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || (r.status === 404 ? "خدمة إضافة المستخدمين مب مفعّلة بعد على السيرفر" : "تعذّر التنفيذ"));
  return j;
}
const codeField = () => html`<div class="codebox"><div class="f"><label>كلمة سرك أنت (للتأكيد)</label>
  <input type="password" name="confirm" autocomplete="current-password" dir="ltr"></div>
  <p class="hint" style="flex-basis:100%;margin:0">للأمان: أي إضافة أو تغيير كلمة سر يحتاج كلمة سر المالك. ما تنحفظ في أي مكان.</p></div>`;
const genPass = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const a = new Uint32Array(12); crypto.getRandomValues(a); return Array.from(a, x => c[x % c.length]).join(""); };

VIEWS.team = async el => {
  const rows = await api.select("staff", "select=*&order=created_at.asc");
  put(el, html`${head("الفريق", "أضف الأشخاص وحدد وش يقدر يسوي كل واحد", html`<button class="btn primary" id="add-u">${ico("plus")} إضافة شخص</button>`)}
    <div class="tbl-wrap card" style="padding:0"><table><thead><tr><th>الاسم</th><th>الإيميل</th><th>الدور</th><th>الصلاحيات</th><th>مفعّل</th><th></th></tr></thead>
    <tbody>${rows.map(r => { const me = r.id === S.me.id; return html`<tr data-u="${r.id}"><td><input type="text" value="${r.full_name}" data-n style="min-width:150px"></td><td class="ltr">${r.email || "—"}</td>
      <td><select data-r ${me ? "disabled" : ""}>${ROLE_OPTS.map(([v, t]) => html`<option value="${v}" ${r.role === v ? "selected" : ""}>${t}</option>`)}</select></td>
      <td class="wrap" data-pl>${permList(r)} ${r.role !== "admin" ? html`<button class="btn sm" data-perm>${ico("edit")} تعديل</button>` : ""}</td>
      <td><label class="switch"><input type="checkbox" data-a ${r.active ? "checked" : ""} ${me ? "disabled" : ""}></label></td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-save>حفظ</button>${me ? "" : html`<button class="btn icon" data-pw title="كلمة سر جديدة">${ico("key")}</button>`}</div></td></tr>`; })}</tbody></table></div>
    <div class="card" style="margin-top:16px"><h2>الأدوار الجاهزة</h2><ul class="hint" style="margin:6px 0 0;padding-inline-start:18px">
      <li><b>مدير المشروع:</b> يطّلع على كل شي (المنيو، الفواتير، التقارير، السجل) بدون تعديل، ويدير ملفات الموظفين والرواتب والشهادات.</li>
      <li><b>المحاسب:</b> يشوف كل الفواتير ويعتمدها أو يرفضها، ويشوف التقارير اليومية.</li>
      <li><b>موظف:</b> يرفع الفواتير والتقرير اليومي، ويخفي الصنف اللي خلص لمدة ويرجع تلقائياً.</li>
      <li><b>المالك:</b> كل شي + إدارة الفريق.</li></ul>
      <p class="hint" style="margin-top:8px">الدور يعبّي الصلاحيات تلقائياً، وتقدر تزيد أو تنقص لكل شخص من «تعديل». الإيقاف يمنع الدخول فوراً، وكل شي رفعه الشخص يبقى محفوظ.</p></div>`);
  const state = Object.fromEntries(rows.map(r => [r.id, { role: r.role, perms: (r.perms || []).slice() }]));
  const paint = tr => { const st = state[tr.dataset.u]; put($("[data-pl]", tr), html`${permList(st)} ${st.role !== "admin" ? html`<button class="btn sm" data-perm>${ico("edit")} تعديل</button>` : ""}`); $("[data-save]", tr).classList.add("primary"); };

  el.onchange = e => {
    const tr = e.target.closest("[data-u]"); if (!tr) return;
    if (e.target.matches("[data-r]")) { const st = state[tr.dataset.u]; st.role = e.target.value; st.perms = (ROLE_PRESET[st.role] || []).slice(); paint(tr); }
    else $("[data-save]", tr).classList.add("primary");
  };
  el.onclick = async e => {
    if (e.target.closest("#add-u")) return addUser(el);
    const tr = e.target.closest("[data-u]"); if (!tr) return;
    const st = state[tr.dataset.u], r = rows.find(x => x.id === tr.dataset.u);
    if (e.target.closest("[data-perm]")) {
      return modal("صلاحيات " + r.full_name, permBoxes(st.perms), { submit: "تم", onSubmit: async f => {
        st.perms = $$("input[name=pm]:checked", f).map(x => x.value); paint(tr); toast("اضغط «حفظ» في الصف عشان تنحفظ", ""); return true; } });
    }
    if (e.target.closest("[data-pw]")) {
      const d = modal("كلمة سر جديدة — " + r.full_name, html`<div class="f"><label>كلمة السر الجديدة</label><div class="row" style="flex-wrap:nowrap">
          <input type="text" name="pw" dir="ltr" value="${genPass()}" minlength="8" autocomplete="off"></div><p class="hint">انسخها وأرسلها له — يقدر يدخل فيها على طول.</p></div>${codeField()}`,
        { submit: "تغيير", onSubmit: async f => { await staffAdmin({ action: "password", user_id: r.id, password: f.pw.value, confirm: f.confirm.value }); toast("تغيّرت كلمة السر", "ok"); return true; } });
      return;
    }
    const b = e.target.closest("[data-save]"); if (!b) return;
    const patch = { full_name: $("[data-n]", tr).value.trim() };
    if (tr.dataset.u !== S.me.id) { patch.role = st.role; patch.perms = st.role === "admin" ? [] : st.perms; patch.active = $("[data-a]", tr).checked; }
    await busy(b, async () => { await api.update("staff", `id=eq.${tr.dataset.u}`, patch); b.classList.remove("primary"); toast("انحفظ", "ok"); if (tr.dataset.u === S.me.id) await loadMe(); });
  };
};

function addUser(el) {
  const d = modal("إضافة شخص للفريق", html`
    <div class="bi"><div class="f"><label>الاسم</label><input type="text" name="full_name" required></div>
      <div class="f"><label>الإيميل (يدخل فيه)</label><input type="email" name="email" dir="ltr" required></div></div>
    <div class="bi"><div class="f"><label>كلمة السر (انسخها وأرسلها له)</label><input type="text" name="password" dir="ltr" value="${genPass()}" autocomplete="off"></div>
      <div class="f"><label>الدور</label><select name="role">${ROLE_OPTS.map(([v, t]) => html`<option value="${v}" ${v === "staff" ? "selected" : ""}>${t}</option>`)}</select></div></div>
    <div class="f" id="pmw"><span class="lbl">الصلاحيات</span>${permBoxes(ROLE_PRESET.staff)}</div>
    ${codeField()}`,
    { wide: true, submit: "إضافة", onSubmit: async f => {
      const body = { action: "create", full_name: f.full_name.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value,
        perms: $$("input[name=pm]:checked", f).map(x => x.value), confirm: f.confirm.value };
      if (!body.email) { toast("اكتب الإيميل", "bad"); return false; }
      if (!body.confirm) { toast("اكتب كلمة سرك للتأكيد", "bad"); return false; }
      await staffAdmin(body);
      toast("انضاف " + (body.full_name || body.email) + " — أرسل له الإيميل وكلمة السر", "ok");
      VIEWS.team(el); return true; } });
  const f = $("form", d);
  f.role.onchange = () => { put($("#pmw", d), html`<span class="lbl">الصلاحيات</span>${f.role.value === "admin" ? html`<p class="hint">المالك يقدر يسوي كل شي.</p>` : permBoxes(ROLE_PRESET[f.role.value] || [])}`); };
}

/* ------------------------------------------------------------------
   People & payroll: employee files, salary receipts, salary certificates
------------------------------------------------------------------ */
const HR = { emps: [], tpls: [], settings: {}, loaded: false };
const EMP_FIELDS = ["full_name_ar", "full_name_en", "gender", "birth_date", "nationality_ar", "nationality_en", "passport_no", "passport_expiry", "id_no",
  "job_title_ar", "job_title_en", "department", "join_date", "phone", "email", "basic_salary", "housing_allowance", "transport_allowance", "other_allowance",
  "status", "leave_date", "notes", "user_id"];
const SAL_PARTS = [["basic_salary", "الراتب الأساسي", "Basic salary"], ["housing_allowance", "بدل السكن", "Housing allowance"],
  ["transport_allowance", "بدل المواصلات", "Transport allowance"], ["other_allowance", "بدلات أخرى", "Other allowance"]];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const empName = (e, lang = "ar") => (lang === "en" ? (e.full_name_en || e.full_name_ar) : (e.full_name_ar || e.full_name_en)) || "—";
const gross = e => SAL_PARTS.reduce((a, [k]) => a + Number(e[k] || 0), 0);
const dmy = d => d ? String(d).slice(0, 10).split("-").reverse().join("/") : "";
const monthKey = d => String(d || today()).slice(0, 7);
const monthLabel = (ym, lang) => { const [y, m] = String(ym).slice(0, 7).split("-").map(Number); return (lang === "en" ? MONTHS_EN : MONTHS_AR)[m - 1] + " " + y; };
const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/* amounts in words (UAE dirhams) */
function wordsEn(n) {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const t = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const h = x => { let s = ""; if (x >= 100) { s += a[Math.floor(x / 100)] + " Hundred"; x %= 100; if (x) s += " "; }
    if (x >= 20) { s += t[Math.floor(x / 10)]; if (x % 10) s += "-" + a[x % 10]; } else if (x) s += a[x]; return s; };
  const int = x => { if (!x) return "Zero"; const parts = []; [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]].forEach(([v, w]) => {
      const q = Math.floor(x / v); if (q) { parts.push(h(q) + (w ? " " + w : "")); x -= q * v; } }); return parts.join(" "); };
  n = Math.round(Number(n || 0) * 100) / 100;
  const d = Math.floor(n), f = Math.round((n - d) * 100);
  return int(d) + " UAE Dirhams" + (f ? " and " + int(f) + " Fils" : "") + " Only";
}
function wordsAr(n) {
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const hund = ["", "مائة", "مئتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const h = x => { const p = []; if (x >= 100) { p.push(hund[Math.floor(x / 100)]); x %= 100; }
    if (x >= 20) p.push(x % 10 ? ones[x % 10] + " و" + tens[Math.floor(x / 10)] : tens[Math.floor(x / 10)]); else if (x) p.push(ones[x]); return p.join(" و"); };
  const scale = (q, one, two, few, many) => q === 1 ? one : q === 2 ? two : q <= 10 ? h(q) + " " + few : h(q) + " " + many;
  const int = x => { if (!x) return "صفر"; const p = [];
    const m = Math.floor(x / 1e6); if (m) { p.push(scale(m, "مليون", "مليونان", "ملايين", "مليون")); x %= 1e6; }
    const k = Math.floor(x / 1e3); if (k) { p.push(scale(k, "ألف", "ألفان", "آلاف", "ألف")); x %= 1e3; }
    if (x) p.push(h(x)); return p.join(" و"); };
  n = Math.round(Number(n || 0) * 100) / 100;
  const d = Math.floor(n), f = Math.round((n - d) * 100);
  return "فقط " + int(d) + " درهم إماراتي" + (f ? " و" + int(f) + " فلس" : "") + " لا غير";
}

async function hrLoad(force = false) {
  if (HR.loaded && !force) return;
  const [emps, tpls, hs] = await Promise.all([
    api.select("employees", "select=*&order=emp_no.asc"),
    api.select("doc_templates", "select=*&order=kind.asc,lang.asc,created_at.asc"),
    api.select("hr_settings", "select=data&id=eq.1")
  ]);
  HR.emps = emps; HR.tpls = tpls; HR.settings = (hs[0] && hs[0].data) || {}; HR.loaded = true;
}
const tplFor = (kind, lang) => HR.tpls.filter(t => t.kind === kind && t.active && (!lang || t.lang === lang)).sort((a, b) => (b.is_default - a.is_default))[0];

/* ---------- document rendering (same code for screen, print and re-print) ---------- */
function payslipValues(p) {
  const e = p.emp || {}, adds = (p.lines || []).filter(l => l.type !== "deduct"), deds = (p.lines || []).filter(l => l.type === "deduct");
  const part = l => `${l.label} ${fmtMoney(l.amount)}`;
  return {
    receipt_no: p.receipt_no || "—", receipt_date: dmy(p.receipt_date), employee_name: empName(e, "en") + (e.code ? `  (${e.code})` : ""),
    salary_month: monthLabel(p.month, "en"), id_passport: e.passport_no || e.id_no || "", period_from: dmy(p.period_from), period_to: dmy(p.period_to),
    job_title: e.job_title_en || e.job_title_ar || "", department: e.department || "", amount_aed: fmtMoney(p.total), amount_in_words: p.words_en || wordsEn(p.total),
    being_for: p.being_for || ("Salary for " + monthLabel(p.month, "en") + ": " + adds.map(part).join(" + ") + (deds.length ? " − " + deds.map(part).join(" − ") : ""))
  };
}
function certValues(e, lang, f) {
  const en = lang === "en";
  const total = gross(e);
  return {
    cert_no: (en ? "Ref: " : "رقم: ") + (f.cert_no || "—"), certificate_date: dmy(f.cert_date || today()),
    recipient_name: f.recipient_name || "", recipient_entity: f.recipient_entity || "", employee_name: empName(e, lang),
    nationality: en ? (e.nationality_en || e.nationality_ar) : (e.nationality_ar || e.nationality_en), passport_id: e.passport_no || e.id_no || "",
    job_title: en ? (e.job_title_en || e.job_title_ar) : (e.job_title_ar || e.job_title_en), employment_start_date: dmy(e.join_date),
    basic_salary: fmtMoney(e.basic_salary), housing_allowance: fmtMoney(e.housing_allowance), transport_allowance: fmtMoney(e.transport_allowance),
    other_allowance: fmtMoney(e.other_allowance), total_salary: fmtMoney(total), salary_in_words: en ? wordsEn(total) : wordsAr(total),
    certificate_purpose: f.purpose || ""
  };
}
function docPage(tpl, vals) {
  const pg = tpl.page || { w: 595.28, h: 841.89 };
  const fill = s => String(s || "").replace(/\{\{(\w+)\}\}/g, (m, k) => esc(HR.settings[k] ?? ""));
  const bg = tpl.bg_html ? fill(tpl.bg_html) : tpl.bg_url ? `<img class="bg" src="${esc(tpl.bg_url)}" alt="">` : "";
  const fields = Object.entries(tpl.fields || {}).map(([k, f]) => {
    const v = vals[k]; if (v == null || v === "") return "";
    const st = `left:${f.x}pt;top:${f.y}pt;width:${f.w}pt;height:${f.h}pt;font-size:${f.size || 10}pt;` + (f.color ? `color:${f.color};` : "") + (f.bold ? "font-weight:600;" : "")
      + `text-align:${f.align || (f.dir === "rtl" ? "right" : "left")};justify-content:${(f.align || (f.dir === "rtl" ? "right" : "left")) === "right" ? "flex-end" : (f.align === "center" ? "center" : "flex-start")}`;
    return `<div class="df${f.multi ? " ml" : ""}" dir="${f.dir || "auto"}" style="${st}"><span>${esc(v)}</span></div>`;
  }).join("");
  return `<div class="docpage" style="width:${pg.w}pt;height:${pg.h}pt">${bg}${fields}</div>`;
}
const DOC_CSS = `.docpage{position:relative;overflow:hidden;background:#fff;color:#241814;font-family:'IBM Plex Sans Arabic','Jost',Helvetica,Arial,sans-serif}
.docpage .bg{position:absolute;inset:0;width:100%;height:100%}
.docpage .df{position:absolute;display:flex;align-items:center;white-space:nowrap;overflow:hidden;line-height:1.15;padding:0 3pt;box-sizing:border-box}
.docpage .df.ml{white-space:normal;align-items:flex-start;line-height:1.3}
.docpage .df span{unicode-bidi:plaintext}`;
function fitFields(root) {
  root.querySelectorAll(".df").forEach(el => {
    let s = parseFloat(el.style.fontSize); const min = s * 0.55;
    while (s > min && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) { s -= 0.25; el.style.fontSize = s + "pt"; }
  });
}
function printDocs(pages, title) {
  // print.html (same site) picks the documents up from this window, lays them out and opens the print dialog
  window.__pressioPrint = { title, page: pages[0].tpl.page, css: DOC_CSS, html: pages.map(p => docPage(p.tpl, p.vals)).join("") };
  const w = window.open("print.html?v=1", "_blank");
  if (!w) toast("المتصفح منع النافذة — اسمح بالنوافذ المنبثقة لهذا الموقع", "bad");
}

/* ---------- the page ---------- */
let hrTab = "emps", hrQ = "", hrMonth = monthKey();
VIEWS.hr = async el => {
  await hrLoad(true);
  const tabs = [["emps", "الموظفين"], ["pay", "الرواتب"], ["certs", "الشهادات"], ["tpl", "القوالب والإعدادات"]];
  put(el, html`${head("الموظفين والرواتب", "ملفات الموظفين، إيصالات الرواتب وشهادات الراتب — كل مستند ينحفظ ويقدر ينطبع مرة ثانية بنفس الشكل")}
    <div class="chips" style="margin-bottom:14px">${tabs.map(([k, t]) => html`<button class="chip ${hrTab === k ? "on" : ""}" data-tab="${k}">${t}</button>`)}</div>
    <div id="hrbody"><div class="empty">لحظة…</div></div>`);
  $$("[data-tab]", el).forEach(b => b.onclick = () => { hrTab = b.dataset.tab; VIEWS.hr(el); });
  const body = $("#hrbody", el);
  if (hrTab === "emps") return hrEmployees(body, el);
  if (hrTab === "pay") return hrPayroll(body, el);
  if (hrTab === "certs") return hrCerts(body, el);
  return hrTemplates(body, el);
};

function hrEmployees(body, el) {
  const q = hrQ.trim().toLowerCase();
  const list = HR.emps.filter(e => !q || [e.code, e.full_name_ar, e.full_name_en, e.passport_no, e.job_title_ar, e.job_title_en, e.department].join(" ").toLowerCase().includes(q));
  const active = HR.emps.filter(e => e.status === "active");
  put(body, html`<div class="card"><div class="row" style="margin-bottom:12px">
      <input type="search" id="hq" value="${hrQ}" placeholder="بحث بالاسم أو الرقم أو الجواز…" style="max-width:280px">
      <span class="sp"></span><span class="hint">${active.length} موظف فعّال · إجمالي الرواتب الشهرية <b class="num">${fmtMoney(active.reduce((a, e) => a + gross(e), 0))}</b></span>
      <button class="btn primary" id="add-emp">${ico("plus")} موظف جديد</button></div>
    ${list.length ? html`<div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>المسمى</th><th>القسم</th><th>الالتحاق</th><th>الراتب الإجمالي</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${list.map(e => html`<tr data-e="${e.id}"><td class="num">${e.code}</td><td class="wrap"><b>${empName(e)}</b>${e.full_name_en && e.full_name_ar ? html`<br><span class="hint ltr">${e.full_name_en}</span>` : ""}</td>
        <td>${e.job_title_ar || e.job_title_en || "—"}</td><td>${e.department || "—"}</td><td>${e.join_date ? fmtDay(e.join_date) : "—"}</td>
        <td class="num">${fmtMoney(gross(e))}</td><td><span class="pill ${e.status === "active" ? "ok" : ""}">${e.status === "active" ? "على رأس العمل" : "غادر"}</span></td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-ea="view">${ico("eye")} الملف</button><button class="btn sm" data-ea="slip">${ico("inv")} إيصال</button><button class="btn sm" data-ea="cert">${ico("content")} شهادة</button></div></td></tr>`)}</tbody></table></div>`
      : html`<p class="empty">${HR.emps.length ? "ما فيه نتائج" : "أضف أول موظف"}</p>`}</div>`);
  $("#hq", body).oninput = e => { hrQ = e.target.value; clearTimeout(hrEmployees.t); hrEmployees.t = setTimeout(() => { hrEmployees(body, el); const i = $("#hq", body); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $("#add-emp", body).onclick = () => editEmployee(null, el);
  body.onclick = e => {
    const b = e.target.closest("[data-ea]"); if (!b) return;
    const emp = HR.emps.find(x => x.id === b.closest("[data-e]").dataset.e);
    if (b.dataset.ea === "view") return viewEmployee(emp, el);
    if (b.dataset.ea === "slip") return newPayslip(emp, el);
    if (b.dataset.ea === "cert") return newCertificate(emp, el);
  };
}

async function editEmployee(emp, el) {
  const e = emp ? clone(emp) : { gender: "male", status: "active", basic_salary: 0, housing_allowance: 0, transport_allowance: 0, other_allowance: 0, join_date: today() };
  let accounts = []; try { accounts = await api.rpc("staff_accounts"); } catch (x) {}
  const deps = HR.settings.departments || [];
  const t = (k, label, type = "text", attrs = "") => html`<div class="f"><label>${label}</label><input type="${type}" name="${k}" value="${e[k] ?? ""}" ${raw(attrs)}></div>`;
  modal(emp ? `ملف ${emp.code} — ${empName(emp)}` : "موظف جديد", html`
    <h3 class="lbl">البيانات الشخصية</h3>
    <div class="bi">${t("full_name_ar", "الاسم بالعربي *")}${t("full_name_en", "الاسم بالإنجليزي (كما في الجواز)", "text", 'dir="ltr"')}</div>
    <div class="bi"><div class="f"><label>الجنس</label><select name="gender"><option value="male" ${e.gender === "male" ? "selected" : ""}>ذكر</option><option value="female" ${e.gender === "female" ? "selected" : ""}>أنثى</option></select></div>
      ${t("birth_date", "تاريخ الميلاد", "date")}</div>
    <div class="bi">${t("nationality_ar", "الجنسية بالعربي")}${t("nationality_en", "الجنسية بالإنجليزي", "text", 'dir="ltr"')}</div>
    <div class="bi">${t("passport_no", "رقم الجواز", "text", 'dir="ltr"')}${t("passport_expiry", "انتهاء الجواز", "date")}</div>
    <div class="bi">${t("id_no", "رقم الهوية (اختياري)", "text", 'dir="ltr"')}${t("phone", "الجوال", "tel", 'dir="ltr"')}</div>
    <h3 class="lbl">العمل</h3>
    <div class="bi">${t("job_title_ar", "المسمى الوظيفي بالعربي")}${t("job_title_en", "المسمى الوظيفي بالإنجليزي", "text", 'dir="ltr"')}</div>
    <div class="bi"><div class="f"><label>القسم</label><input type="text" name="department" list="deps" value="${e.department || ""}"><datalist id="deps">${deps.map(d => html`<option value="${d}">`)}</datalist></div>
      ${t("join_date", "تاريخ الالتحاق", "date")}</div>
    <div class="bi"><div class="f"><label>الحالة</label><select name="status"><option value="active" ${e.status === "active" ? "selected" : ""}>على رأس العمل</option><option value="left" ${e.status === "left" ? "selected" : ""}>غادر</option></select></div>
      ${t("leave_date", "تاريخ المغادرة (إذا غادر)", "date")}</div>
    <h3 class="lbl">الراتب الشهري (درهم)</h3>
    <div class="grid g4">${SAL_PARTS.map(([k, ar]) => html`<div class="f"><label>${ar}</label><input type="number" name="${k}" min="0" step="0.01" class="num" value="${e[k] ?? 0}"></div>`)}</div>
    <p class="hint">الإجمالي: <b class="num" id="gtot">${fmtMoney(gross(e))}</b></p>
    <h3 class="lbl">أخرى</h3>
    <div class="bi">${t("email", "الإيميل", "email", 'dir="ltr"')}
      <div class="f"><label>ربط بحساب دخول (عشان يشوف ملفه لاحقاً)</label><select name="user_id"><option value="">— بدون —</option>
        ${accounts.map(a => html`<option value="${a.id}" ${e.user_id === a.id ? "selected" : ""}>${a.full_name} · ${a.email || ""}</option>`)}</select></div></div>
    <div class="f"><label>ملاحظات</label><textarea name="notes">${e.notes || ""}</textarea></div>`,
    { wide: true, onSubmit: async f => {
      const row = {};
      EMP_FIELDS.forEach(k => { if (!f[k]) return; let v = f[k].value; if (f[k].type === "number") v = Number(v || 0); else if (f[k].type === "date" || k === "user_id" || k === "gender") v = v || null; else v = v.trim(); row[k] = v; });
      if (!row.full_name_ar && !row.full_name_en) { toast("اكتب اسم الموظف", "bad"); return false; }
      if (emp) Object.assign(emp, await api.update("employees", `id=eq.${emp.id}`, row));
      else { const n = await api.insert("employees", row); HR.emps.push(n); toast("انضاف برقم " + n.code, "ok"); }
      if (emp) toast("انحفظ", "ok");
      VIEWS.hr(el); return true;
    } });
  const f = $("#modal form");
  f.oninput = () => { $("#gtot").textContent = fmtMoney(SAL_PARTS.reduce((a, [k]) => a + Number(f[k].value || 0), 0)); };
}

async function viewEmployee(emp, el) {
  const [slips, certs] = await Promise.all([
    api.select("payslips", `select=*&employee_id=eq.${emp.id}&order=month.desc,seq.desc`),
    api.select("certificates", `select=*&employee_id=eq.${emp.id}&order=seq.desc`)
  ]);
  const row = (a, b) => b ? html`<tr><td class="hint">${a}</td><td>${b}</td></tr>` : "";
  modal(`${emp.code} — ${empName(emp)}`, html`
    <div class="grid g2"><div class="tbl-wrap"><table><tbody>
      ${row("الاسم بالإنجليزي", emp.full_name_en)}${row("الجنس", emp.gender === "female" ? "أنثى" : emp.gender === "male" ? "ذكر" : "")}
      ${row("تاريخ الميلاد", emp.birth_date && fmtDay(emp.birth_date))}${row("الجنسية", emp.nationality_ar || emp.nationality_en)}
      ${row("رقم الجواز", emp.passport_no)}${row("انتهاء الجواز", emp.passport_expiry && fmtDay(emp.passport_expiry))}${row("رقم الهوية", emp.id_no)}
      ${row("المسمى", emp.job_title_ar || emp.job_title_en)}${row("القسم", emp.department)}${row("الالتحاق", emp.join_date && fmtDay(emp.join_date))}
      ${row("الجوال", emp.phone)}${row("الإيميل", emp.email)}</tbody></table></div>
      <div class="tbl-wrap"><table><tbody>${SAL_PARTS.map(([k, ar]) => html`<tr><td class="hint">${ar}</td><td class="num">${fmtMoney(emp[k])}</td></tr>`)}
        <tr><td><b>الإجمالي</b></td><td class="num"><b>${fmtMoney(gross(emp))}</b></td></tr></tbody></table>
        ${emp.notes ? html`<p class="hint" style="margin-top:8px">${emp.notes}</p>` : ""}</div></div>
    <h3 class="lbl" style="margin-top:14px">إيصالات الرواتب (${slips.length})</h3>
    ${slips.length ? html`<div class="tbl-wrap"><table><tbody>${slips.map(p => html`<tr data-p="${p.id}" class="${p.status === "void" ? "void" : ""}"><td class="num">${p.receipt_no}</td><td>${monthLabel(p.month, "ar")}</td><td class="num">${fmtMoney(p.total)}</td>
      <td>${p.status === "void" ? html`<span class="pill bad" title="${p.void_reason || ""}">ملغي</span>` : ""}</td><td><button class="btn sm" data-pp>${ico("dl")} طباعة</button></td></tr>`)}</tbody></table></div>` : html`<p class="hint">ما فيه إيصالات بعد</p>`}
    <h3 class="lbl" style="margin-top:14px">شهادات الراتب (${certs.length})</h3>
    ${certs.length ? html`<div class="tbl-wrap"><table><tbody>${certs.map(c => html`<tr data-c="${c.id}" class="${c.status === "void" ? "void" : ""}"><td class="num">${c.cert_no}</td><td>${fmtDay(c.cert_date)}</td><td class="wrap">${c.recipient_entity || c.recipient_name || "—"}</td><td>${c.lang === "ar" ? "عربي" : "English"}</td>
      <td>${c.status === "void" ? html`<span class="pill bad">ملغية</span>` : ""}</td><td><button class="btn sm" data-cp>${ico("dl")} طباعة</button></td></tr>`)}</tbody></table></div>` : html`<p class="hint">ما فيه شهادات بعد</p>`}`,
    { wide: true, submit: "", cancel: "إغلاق",
      extra: `<button type="button" class="btn" id="ve-edit">${ico("edit").__raw} تعديل الملف</button><button type="button" class="btn" id="ve-slip">${ico("inv").__raw} إيصال راتب</button><button type="button" class="btn" id="ve-cert">${ico("content").__raw} شهادة راتب</button>` });
  const d = $("#modal");
  $("#ve-edit").onclick = () => editEmployee(emp, el);
  $("#ve-slip").onclick = () => newPayslip(emp, el);
  $("#ve-cert").onclick = () => newCertificate(emp, el);
  d.querySelector(".mb").onclick = e => {
    const pp = e.target.closest("[data-pp]"); if (pp) return printPayslips([slips.find(x => x.id === pp.closest("[data-p]").dataset.p)]);
    const cp = e.target.closest("[data-cp]"); if (cp) return printCert(certs.find(x => x.id === cp.closest("[data-c]").dataset.c));
  };
}

function printPayslips(list) {
  const pages = list.map(p => { const tpl = HR.tpls.find(t => t.id === p.template_id) || tplFor("receipt"); return tpl && { tpl, vals: payslipValues(p) }; }).filter(Boolean);
  if (!pages.length) return toast("ما فيه قالب إيصال فعّال", "bad");
  printDocs(pages, list.length === 1 ? list[0].receipt_no : "إيصالات الرواتب");
}
function printCert(c) {
  const tpl = HR.tpls.find(t => t.id === c.template_id) || tplFor("certificate", c.lang);
  if (!tpl) return toast("ما فيه قالب شهادة فعّال", "bad");
  printDocs([{ tpl, vals: c.data || {} }], c.cert_no);
}

async function newPayslip(emp, el, preMonth) {
  const ym = preMonth || monthKey();
  const lines = SAL_PARTS.filter(([k]) => Number(emp[k]) > 0).map(([k, ar]) => ({ label: ar, en: SAL_PARTS.find(s => s[0] === k)[2], amount: Number(emp[k]), type: "add" }));
  if (!lines.length) lines.push({ label: "الراتب", en: "Salary", amount: 0, type: "add" });
  const tpls = HR.tpls.filter(t => t.kind === "receipt" && t.active);
  if (!tpls.length) return toast("ما فيه قالب إيصال فعّال — أضفه من «القوالب والإعدادات»", "bad");
  const st = { lines, beingTouched: false };
  const d = modal(`إيصال راتب — ${emp.code} ${empName(emp)}`, html`
    <div class="grid g3"><div class="f"><label>شهر الراتب</label><input type="month" name="month" value="${ym}"></div>
      <div class="f"><label>الفترة من</label><input type="date" name="period_from" value="${ym}-01"></div>
      <div class="f"><label>إلى</label><input type="date" name="period_to" value="${lastDay(ym)}"></div></div>
    <div class="bi"><div class="f"><label>تاريخ الإيصال</label><input type="date" name="receipt_date" value="${today()}"></div>
      <div class="f"><label>القالب</label><select name="tpl">${tpls.map(t => html`<option value="${t.id}" ${t.is_default ? "selected" : ""}>${t.name}</option>`)}</select></div></div>
    <p id="dup" class="banner warn" hidden></p>
    <div class="f"><span class="lbl">المبالغ — عدّل أو أضف أو اخصم هالمرة بس (ملف الموظف ما يتغيّر)</span><div class="rows" id="pl"></div>
      <div class="row"><button type="button" class="btn sm" data-add="add">${ico("plus")} إضافة مبلغ</button><button type="button" class="btn sm" data-add="deduct">− خصم</button></div></div>
    <div class="calc"><div><span>الصافي</span><b class="num" id="ptot"></b></div><div style="grid-column:span 3"><span>كتابةً</span><b id="pw" style="font-size:13px;font-weight:500"></b></div></div>
    <div class="f"><label>البيان (يطلع في الإيصال) — يتعبّى تلقائياً</label><textarea name="being_for" dir="ltr" rows="2"></textarea></div>
    <div class="f"><label>ملاحظة داخلية (ما تنطبع)</label><input type="text" name="notes"></div>`,
    { wide: true, submit: "إصدار وطباعة", onSubmit: async f => {
      const clean = st.lines.filter(l => (l.label || "").trim() && Number(l.amount) > 0).map(l => ({ label: l.label.trim(), en: l.en || "", amount: Number(l.amount), type: l.type }));
      if (!clean.length) { toast("أضف مبلغ واحد على الأقل", "bad"); return false; }
      const total = calc();
      if (total < 0) { toast("الصافي بالسالب — راجع الخصومات", "bad"); return false; }
      const row = { employee_id: emp.id, month: f.month.value + "-01", period_from: f.period_from.value || null, period_to: f.period_to.value || null, receipt_date: f.receipt_date.value || today(),
        lines: clean, words_en: wordsEn(total), words_ar: wordsAr(total), being_for: f.being_for.value.trim(), notes: f.notes.value.trim(), template_id: f.tpl.value };
      const saved = await api.insert("payslips", row);
      toast(`انحفظ الإيصال ${saved.receipt_no}`, "ok");
      printPayslips([saved]);
      if (hrTab === "pay") VIEWS.hr(el);
      return true;
    } });
  const f = $("form", d);
  const lineEn = l => l.en || l.label;
  const calc = () => st.lines.reduce((a, l) => a + (l.type === "deduct" ? -1 : 1) * Number(l.amount || 0), 0);
  const autoBeing = () => { const m = f.month.value; const adds = st.lines.filter(l => l.type !== "deduct" && Number(l.amount) > 0), deds = st.lines.filter(l => l.type === "deduct" && Number(l.amount) > 0);
    return "Salary for " + monthLabel(m, "en") + ": " + adds.map(l => `${lineEn(l)} ${fmtMoney(l.amount)}`).join(" + ") + (deds.length ? " − " + deds.map(l => `${lineEn(l)} ${fmtMoney(l.amount)}`).join(" − ") : ""); };
  const paint = () => {
    put($("#pl", d), st.lines.map((l, n) => html`<div class="r pline ${l.type}"><span class="pill ${l.type === "deduct" ? "bad" : "ok"}">${l.type === "deduct" ? "خصم" : "إضافة"}</span>
      <input type="text" placeholder="البند (مثلاً: ساعات إضافية، سلفة، غياب)" value="${l.label}" data-l="${n}.label">
      <input type="text" placeholder="بالإنجليزي للإيصال (اختياري)" value="${l.en || ""}" data-l="${n}.en" dir="ltr">
      <input type="number" min="0" step="0.01" class="num" value="${l.amount}" data-l="${n}.amount">
      <button type="button" class="btn icon" data-rm="${n}">×</button></div>`));
    sums();
  };
  const sums = () => { const t = calc(); $("#ptot", d).textContent = fmtMoney(t); $("#pw", d).textContent = wordsAr(t);
    if (!st.beingTouched) f.being_for.value = autoBeing(); };
  const dupCheck = async () => { const r = await api.select("payslips", `select=receipt_no&employee_id=eq.${emp.id}&month=eq.${f.month.value}-01&status=eq.issued`).catch(() => []);
    const b = $("#dup", d); b.hidden = !r.length; b.textContent = r.length ? `تنبيه: فيه إيصال لنفس الشهر من قبل (${r.map(x => x.receipt_no).join("، ")}). تقدر تكمل لو هذا دفعة ثانية.` : ""; };
  f.oninput = e => {
    const x = e.target.closest("[data-l]");
    if (x) { const [n, k] = x.dataset.l.split("."); st.lines[+n][k] = k === "amount" ? x.value : x.value; sums(); return; }
    if (e.target.name === "being_for") st.beingTouched = true;
    if (e.target.name === "month" && f.month.value) { f.period_from.value = f.month.value + "-01"; f.period_to.value = lastDay(f.month.value); sums(); dupCheck(); }
  };
  f.onclick = e => {
    const a = e.target.closest("[data-add]"); if (a) { st.lines.push({ label: "", en: "", amount: "", type: a.dataset.add }); paint(); $$("#pl input[type=text]", d).slice(-2)[0].focus(); }
    const r = e.target.closest("[data-rm]"); if (r) { st.lines.splice(+r.dataset.rm, 1); paint(); }
  };
  paint(); dupCheck();
}

function newCertificate(emp, el) {
  const langs = ["ar", "en"].filter(l => tplFor("certificate", l));
  if (!langs.length) return toast("ما فيه قالب شهادة فعّال", "bad");
  const d = modal(`شهادة راتب — ${emp.code} ${empName(emp)}`, html`
    <div class="bi"><div class="f"><label>اللغة</label><select name="lang">${langs.map(l => html`<option value="${l}">${l === "ar" ? "عربي" : "English"}</option>`)}</select></div>
      <div class="f"><label>تاريخ الشهادة</label><input type="date" name="cert_date" value="${today()}"></div></div>
    <div class="bi"><div class="f"><label>موجّهة إلى (التحية)</label><input type="text" name="recipient_name"></div>
      <div class="f"><label>الجهة (بنك، سفارة، …)</label><input type="text" name="recipient_entity"></div></div>
    <div class="f"><label>الغرض من الشهادة</label><input type="text" name="purpose"></div>
    <div class="f"><label>القالب</label><select name="tpl"></select></div>
    <p class="hint">الاسم والجنسية والجواز والمسمى وتاريخ الالتحاق والراتب تنسحب تلقائياً من ملف الموظف. ${gross(emp) ? "" : html`<b style="color:var(--bad)">تنبيه: الراتب في الملف صفر.</b>`}</p>`,
    { submit: "إصدار وطباعة", onSubmit: async f => {
      const lang = f.lang.value, tpl = HR.tpls.find(t => t.id === f.tpl.value);
      const form = { cert_date: f.cert_date.value || today(), recipient_name: f.recipient_name.value.trim(), recipient_entity: f.recipient_entity.value.trim(), purpose: f.purpose.value.trim() };
      // the database writes the final certificate number into the stored copy
      const saved = await api.insert("certificates", { employee_id: emp.id, lang, template_id: tpl.id, ...form, data: certValues(emp, lang, form) });
      toast(`انحفظت الشهادة ${saved.cert_no}`, "ok");
      printDocs([{ tpl, vals: saved.data }], saved.cert_no);
      if (hrTab === "certs") VIEWS.hr(el);
      return true;
    } });
  const f = $("form", d);
  const sync = () => {
    const l = f.lang.value;
    put(f.tpl, HR.tpls.filter(t => t.kind === "certificate" && t.active && t.lang === l).map(t => html`<option value="${t.id}" ${t.is_default ? "selected" : ""}>${t.name}</option>`));
    if (!f.recipient_name.dataset.touched) f.recipient_name.value = l === "ar" ? "إلى من يهمه الأمر" : "To Whom It May Concern";
  };
  f.lang.onchange = sync; f.recipient_name.oninput = () => f.recipient_name.dataset.touched = "1"; f.purpose.oninput = () => f.purpose.dataset.touched = "1";
  sync();
}

async function hrPayroll(body, el) {
  const rows = await api.select("payslips", `select=*&month=eq.${hrMonth}-01&order=seq.asc`);
  const issued = rows.filter(r => r.status === "issued");
  const done = new Set(issued.map(r => r.employee_id));
  const missing = HR.emps.filter(e => e.status === "active" && !done.has(e.id));
  const [y, m] = hrMonth.split("-").map(Number);
  const hist = await api.select("payslips", `select=month,total,status&month=gte.${new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10)}&status=eq.issued`).catch(() => []);
  const byMonth = {}; hist.forEach(r => { const k = r.month.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + Number(r.total); });
  put(body, html`<div class="card"><div class="row" style="margin-bottom:12px">
      <input type="month" id="pm" value="${hrMonth}" style="max-width:200px"><span class="hint">${monthLabel(hrMonth, "ar")}</span>
      <span class="sp"></span><span class="hint">${issued.length} إيصال · المجموع <b class="num">${fmtMoney(issued.reduce((a, r) => a + Number(r.total), 0))}</b></span>
      ${issued.length ? html`<button class="btn" id="pall">${ico("dl")} طباعة الكل</button><button class="btn" id="pcsv">${ico("dl")} Excel (CSV)</button>` : ""}</div>
    ${rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>الإيصال</th><th>الموظف</th><th>الإضافات</th><th>الخصومات</th><th>الصافي</th><th>أصدره</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${rows.map(r => { const a = r.lines.filter(l => l.type !== "deduct").reduce((s, l) => s + Number(l.amount), 0), dd = r.lines.filter(l => l.type === "deduct").reduce((s, l) => s + Number(l.amount), 0);
        return html`<tr data-p="${r.id}" class="${r.status === "void" ? "void" : ""}"><td class="num">${r.receipt_no}</td><td class="wrap">${(r.emp && r.emp.code) || ""} ${empName(r.emp || {})}</td>
        <td class="num">${fmtMoney(a)}</td><td class="num">${dd ? fmtMoney(dd) : "—"}</td><td class="num"><b>${fmtMoney(r.total)}</b></td><td>${r.created_by_name || "—"}<br><span class="hint">${fmtDate(r.created_at)}</span></td>
        <td>${r.status === "void" ? html`<span class="pill bad" title="${r.void_reason || ""}">ملغي — ${r.void_reason || ""}</span>` : html`<span class="pill ok">صادر</span>`}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-pa="print">${ico("dl")} طباعة</button>${r.status === "issued" ? html`<button class="btn sm danger" data-pa="void">إلغاء</button>` : ""}</div></td></tr>`; })}</tbody></table></div>`
      : html`<p class="empty">ما فيه إيصالات لهذا الشهر بعد</p>`}
    ${missing.length ? html`<div class="banner warn" style="margin-top:12px">ما انصرف لهم إيصال هذا الشهر: ${missing.map(e => html`<button class="btn sm" data-miss="${e.id}" style="margin:2px">${e.code} ${empName(e)}</button>`)}</div>` : ""}</div>
    <div class="card"><h2>الرواتب آخر ١٢ شهر</h2>${Object.keys(byMonth).length ? html`<div class="tbl-wrap"><table><tbody>${Object.keys(byMonth).sort().reverse().map(k => html`<tr><td>${monthLabel(k, "ar")}</td><td class="num">${fmtMoney(byMonth[k])}</td></tr>`)}</tbody></table></div>` : html`<p class="hint">ما فيه بيانات بعد</p>`}</div>`);
  $("#pm", body).onchange = e => { if (e.target.value) { hrMonth = e.target.value; VIEWS.hr(el); } };
  const pa = $("#pall", body); if (pa) pa.onclick = () => printPayslips(issued);
  const pc = $("#pcsv", body); if (pc) pc.onclick = () => {
    const lines = [["Receipt", "Code", "Name", "Month", "Additions", "Deductions", "Net", "Status", "Issued by", "Issued at"]].concat(rows.map(r => {
      const a = r.lines.filter(l => l.type !== "deduct").reduce((s, l) => s + Number(l.amount), 0), dd = r.lines.filter(l => l.type === "deduct").reduce((s, l) => s + Number(l.amount), 0);
      return [r.receipt_no, (r.emp || {}).code, empName(r.emp || {}), hrMonth, a, dd, r.total, r.status, r.created_by_name || "", r.created_at]; }));
    const csv = "﻿" + lines.map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `pressio-payroll-${hrMonth}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
  };
  body.onclick = async e => {
    const ms = e.target.closest("[data-miss]"); if (ms) return newPayslip(HR.emps.find(x => x.id === ms.dataset.miss), el, hrMonth);
    const b = e.target.closest("[data-pa]"); if (!b) return;
    const r = rows.find(x => x.id === b.closest("[data-p]").dataset.p);
    if (b.dataset.pa === "print") return printPayslips([r]);
    modal("إلغاء الإيصال " + r.receipt_no, html`<p class="hint">الإيصال يبقى محفوظ في السجل ومكتوب عليه «ملغي» مع السبب — ما ينحذف.</p><div class="f"><label>السبب *</label><input type="text" name="why" required></div>`,
      { submit: "إلغاء الإيصال", layer: "#modal", onSubmit: async f => { if (!f.why.value.trim()) { toast("اكتب السبب", "bad"); return false; }
        await api.rpc("void_hr_doc", { p_kind: "payslip", p_id: r.id, p_reason: f.why.value.trim() }); toast("انلغى", "ok"); VIEWS.hr(el); return true; } });
  };
}

async function hrCerts(body, el) {
  const rows = await api.select("certificates", "select=*&order=seq.desc&limit=300");
  put(body, html`<div class="card">${rows.length ? html`<div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الموظف</th><th>الجهة / الغرض</th><th>اللغة</th><th>أصدرها</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${rows.map(c => { const e = HR.emps.find(x => x.id === c.employee_id) || {}; return html`<tr data-c="${c.id}" class="${c.status === "void" ? "void" : ""}"><td class="num">${c.cert_no}</td><td>${fmtDay(c.cert_date)}</td>
        <td class="wrap">${e.code || ""} ${empName(e)}</td><td class="wrap">${c.recipient_entity || c.recipient_name || "—"}${c.purpose ? html`<br><span class="hint">${c.purpose}</span>` : ""}</td><td>${c.lang === "ar" ? "عربي" : "English"}</td>
        <td>${c.created_by_name || "—"}</td><td>${c.status === "void" ? html`<span class="pill bad">ملغية — ${c.void_reason || ""}</span>` : html`<span class="pill ok">صادرة</span>`}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-ca="print">${ico("dl")} طباعة</button>${c.status === "issued" ? html`<button class="btn sm danger" data-ca="void">إلغاء</button>` : ""}</div></td></tr>`; })}</tbody></table></div>`
    : html`<p class="empty">ما فيه شهادات بعد — افتح ملف الموظف واضغط «شهادة»</p>`}</div>`);
  body.onclick = e => {
    const b = e.target.closest("[data-ca]"); if (!b) return;
    const c = rows.find(x => x.id === b.closest("[data-c]").dataset.c);
    if (b.dataset.ca === "print") return printCert(c);
    modal("إلغاء الشهادة " + c.cert_no, html`<p class="hint">تبقى محفوظة في السجل ومكتوب عليها «ملغية» مع السبب.</p><div class="f"><label>السبب *</label><input type="text" name="why"></div>`,
      { submit: "إلغاء الشهادة", onSubmit: async f => { if (!f.why.value.trim()) { toast("اكتب السبب", "bad"); return false; }
        await api.rpc("void_hr_doc", { p_kind: "certificate", p_id: c.id, p_reason: f.why.value.trim() }); toast("انلغت", "ok"); VIEWS.hr(el); return true; } });
  };
}

const TPL_KEYS = {
  receipt: [["receipt_no", "رقم الإيصال"], ["receipt_date", "التاريخ"], ["employee_name", "اسم الموظف"], ["salary_month", "شهر الراتب"], ["id_passport", "الجواز / الهوية"],
    ["period_from", "الفترة من"], ["period_to", "إلى"], ["job_title", "المسمى"], ["department", "القسم"], ["amount_aed", "المبلغ"], ["amount_in_words", "المبلغ كتابةً"], ["being_for", "البيان"]],
  certificate: [["cert_no", "رقم الشهادة"], ["certificate_date", "التاريخ"], ["recipient_name", "التحية"], ["recipient_entity", "الجهة"], ["employee_name", "اسم الموظف"], ["nationality", "الجنسية"],
    ["passport_id", "الجواز"], ["job_title", "المسمى"], ["employment_start_date", "تاريخ الالتحاق"], ["basic_salary", "الأساسي"], ["housing_allowance", "السكن"],
    ["transport_allowance", "المواصلات"], ["other_allowance", "أخرى"], ["total_salary", "الإجمالي"], ["salary_in_words", "الإجمالي كتابةً"], ["certificate_purpose", "الغرض"]]
};
function sampleValues(kind, lang) {
  const e = { code: "PR-000", full_name_ar: "اسم الموظف", full_name_en: "Employee Name", nationality_ar: "الجنسية", nationality_en: "Nationality", passport_no: "A1234567",
    job_title_ar: "باريستا", job_title_en: "Barista", department: "البار", join_date: "2025-01-01", basic_salary: 2500, housing_allowance: 500, transport_allowance: 200, other_allowance: 0 };
  if (kind === "receipt") return payslipValues({ receipt_no: "SR-00000", receipt_date: today(), month: monthKey() + "-01", period_from: monthKey() + "-01", period_to: lastDay(monthKey()), emp: e,
    lines: [{ label: "Basic", en: "Basic", amount: 2500, type: "add" }, { label: "Housing", en: "Housing", amount: 500, type: "add" }, { label: "Advance", en: "Advance", amount: 100, type: "deduct" }], total: 2900 });
  return certValues(e, lang, { cert_no: "SC-00000", recipient_name: lang === "ar" ? "إلى من يهمه الأمر" : "To Whom It May Concern", recipient_entity: lang === "ar" ? "البنك" : "Bank", purpose: lang === "ar" ? "فتح حساب" : "Opening a bank account" });
}

async function hrTemplates(body, el) {
  const hs = HR.settings;
  put(body, html`<div class="card"><h2 style="margin-bottom:10px">القوالب</h2>
      <div class="tbl-wrap"><table><thead><tr><th>القالب</th><th>النوع</th><th>اللغة</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${HR.tpls.map(t => html`<tr data-t="${t.id}"><td>${t.name}${t.is_default ? html` <span class="pill ok">الأساسي</span>` : ""}</td><td>${t.kind === "receipt" ? "إيصال راتب" : "شهادة راتب"}</td><td>${t.lang === "ar" ? "عربي" : "English"}</td>
        <td>${t.active ? "فعّال" : html`<span class="hint">موقوف</span>`}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-ta="preview">${ico("eye")} معاينة</button>
        ${isAdmin() ? html`${t.is_default ? "" : html`<button class="btn sm" data-ta="default">اجعله الأساسي</button>`}<button class="btn sm" data-ta="toggle">${t.active ? "إيقاف" : "تفعيل"}</button>` : ""}</div></td></tr>`)}</tbody></table></div>
      ${isAdmin() ? html`<div class="banner" style="margin-top:12px"><b>رفع قالب جديد:</b> صمّم القالب (Canva / Word / Acrobat) واحفظه PDF <b>قابل للتعبئة</b>، وسمِّ الخانات بنفس أسماء الخانات تحت. الموقع يقرأ مكان كل خانة ويعبّيها تلقائياً.
        <div class="row" style="margin-top:10px"><select id="nk" style="max-width:160px"><option value="receipt">إيصال راتب</option><option value="certificate">شهادة راتب</option></select>
        <select id="nl" style="max-width:120px"><option value="en">English</option><option value="ar">عربي</option></select>
        <label class="btn primary">${ico("upl")} اختر ملف PDF<input type="file" id="npdf" accept="application/pdf" hidden></label></div>
        <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">أسماء الخانات</summary><p class="hint ltr" style="direction:ltr;text-align:left">
          receipt: ${TPL_KEYS.receipt.map(k => k[0]).join(", ")}<br>certificate: ${TPL_KEYS.certificate.map(k => k[0]).join(", ")}</p></details></div>` : ""}</div>
    <div class="card"><h2>بيانات الشركة في المستندات</h2>
      <form id="hsf" class="grid" novalidate>
        <div class="bi"><div class="f"><label>اسم الشركة بالعربي</label><input name="company_ar" value="${hs.company_ar || ""}"></div><div class="f"><label>Company name (English)</label><input name="company_en" dir="ltr" value="${hs.company_en || ""}"></div></div>
        <div class="bi"><div class="f"><label>العنوان بالعربي</label><input name="address_ar" value="${hs.address_ar || ""}"></div><div class="f"><label>الهاتف</label><input name="phone" dir="ltr" value="${hs.phone || ""}"></div></div>
        <div class="bi"><div class="f"><label>اسم المفوّض بالتوقيع (عربي)</label><input name="signatory_ar" value="${hs.signatory_ar || ""}"></div><div class="f"><label>المنصب (عربي)</label><input name="signatory_title_ar" value="${hs.signatory_title_ar || ""}"></div></div>
        <div class="f"><label>الأقسام (افصل بفاصلة)</label><input name="departments" value="${(hs.departments || []).join("، ")}"></div>
        <div class="row end"><button class="btn primary" type="submit">حفظ</button></div></form>
      <p class="hint">القالب الإنجليزي الحالي مطبوع فيه اسم الشركة والتوقيع كما هي في ملف الـ PDF.</p></div>
    ${isAdmin() ? html`<div class="card"><div class="row between"><div><h2>نسخة احتياطية لبيانات الموظفين</h2><p class="hint">تنحفظ نسخة تلقائية كل يوم على السيرفر (٩٠ يوم). هنا تقدر تنزّل نسخة على جهازك.</p></div>
      <button class="btn" id="hrbk">${ico("dl")} تنزيل نسخة الآن</button></div></div>` : ""}`);
  $("#hsf", body).onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const data = { ...HR.settings }; ["company_ar", "company_en", "address_ar", "phone", "signatory_ar", "signatory_title_ar"].forEach(k => data[k] = f[k].value.trim());
    data.departments = f.departments.value.split(/[،,]/).map(s => s.trim()).filter(Boolean);
    await busy($("button[type=submit]", f), async () => { await api.update("hr_settings", "id=eq.1", { data }); HR.settings = data; toast("انحفظ", "ok"); });
  };
  const bk = $("#hrbk", body); if (bk) bk.onclick = () => busy(bk, async () => {
    const id = await api.rpc("save_hr_backup"); const r = await api.select("hr_backups", `select=data&id=eq.${id}`);
    download(`pressio-hr-backup-${today()}.json`, r[0].data); toast("انحفظ الملف", "ok"); });
  const np = $("#npdf", body); if (np) np.onchange = e => { const file = e.target.files[0]; e.target.value = ""; if (file) uploadTemplate(file, $("#nk", body).value, $("#nl", body).value, el); };
  body.onclick = async e => {
    const b = e.target.closest("[data-ta]"); if (!b) return;
    const t = HR.tpls.find(x => x.id === b.closest("[data-t]").dataset.t);
    if (b.dataset.ta === "preview") return printDocs([{ tpl: t, vals: sampleValues(t.kind, t.lang) }], "معاينة — " + t.name);
    if (b.dataset.ta === "toggle") return busy(b, async () => { await api.update("doc_templates", `id=eq.${enc(t.id)}`, { active: !t.active }); VIEWS.hr(el); });
    if (b.dataset.ta === "default") return busy(b, async () => {
      for (const o of HR.tpls.filter(x => x.kind === t.kind && x.lang === t.lang && x.is_default)) await api.update("doc_templates", `id=eq.${enc(o.id)}`, { is_default: false });
      await api.update("doc_templates", `id=eq.${enc(t.id)}`, { is_default: true, active: true }); VIEWS.hr(el); });
  };
}

/* a new fillable PDF becomes a template: page 1 is drawn as the background, each form field's box becomes a slot */
async function uploadTemplate(file, kind, lang, el) {
  await busy(null, async () => {
    if (!window.pdfjsLib) {
      await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload = res; s.onerror = () => rej(new Error("تعذّر تحميل قارئ PDF")); document.head.appendChild(s); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const annots = await page.getAnnotations();
    const known = new Set(TPL_KEYS[kind].map(k => k[0]));
    const fields = {}, unknown = [];
    annots.filter(a => a.subtype === "Widget" && a.fieldName).forEach(a => {
      const name = a.fieldName.split(".").pop();
      const [x1, y1, x2, y2] = a.rect;
      const size = Number((String(a.defaultAppearanceData && a.defaultAppearanceData.fontSize) || "").trim()) || Math.min(11, (y2 - y1) * 0.6);
      if (known.has(name)) fields[name] = { x: +x1.toFixed(1), y: +(vp1.height - y2).toFixed(1), w: +(x2 - x1).toFixed(1), h: +(y2 - y1).toFixed(1), size: +size.toFixed(1), ...(lang === "ar" ? { dir: "rtl" } : {}), ...(a.multiLine ? { multi: true } : {}) };
      else unknown.push(name);
    });
    if (!Object.keys(fields).length) throw new Error("ما لقيت خانات بأسماء معروفة في الملف — تأكد إنه PDF قابل للتعبئة وأسماء الخانات صحيحة");
    const scale = 200 / 72, vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas"); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, annotationMode: window.pdfjsLib.AnnotationMode ? window.pdfjsLib.AnnotationMode.DISABLE : 0 }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    const path = `templates/${kind}-${lang}-${uid()}.png`;
    await api.upload("media", path, blob);
    const missing = TPL_KEYS[kind].filter(k => !fields[k[0]]).map(k => k[1]);
    const t = await api.insert("doc_templates", { kind, lang, name: file.name.replace(/\.pdf$/i, ""), page: { w: +vp1.width.toFixed(2), h: +vp1.height.toFixed(2) }, bg_url: api.publicUrl(path), fields, active: true, is_default: false });
    toast(`انضاف القالب (${Object.keys(fields).length} خانة)` + (missing.length ? ` — خانات ناقصة: ${missing.join("، ")}` : "") + (unknown.length ? ` — تم تجاهل: ${unknown.join(", ")}` : ""), "ok");
    await hrLoad(true); VIEWS.hr(el);
    printDocs([{ tpl: t, vals: sampleValues(kind, lang) }], "معاينة القالب الجديد");
  });
}

start();
})();
