// pressio — staff-admin
// Lets the OWNER add team members and reset their passwords from the admin panel.
// The secret key never leaves the server; every action also needs a fresh
// confirmation code that Supabase emails to the owner.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORIGINS = ["https://pressio.ae", "https://www.pressio.ae", "https://pressioae.github.io"];
const ROLES = ["staff", "accountant", "manager", "admin"];
const PERMS = ["view_all", "site", "stock", "inv_upload", "inv_review", "reports", "backups"];

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || o.startsWith("http://localhost") ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

async function j(r: Response) { try { return await r.json(); } catch { return {}; } }

Deno.serve(async (req) => {
  const h = cors(req);
  const out = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return out(405, { error: "POST only" });

  try {
    // 1) who is calling?
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return out(401, { error: "سجّل دخول أول" });
    const ur = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
    if (!ur.ok) return out(401, { error: "انتهت الجلسة — سجّل دخول مرة ثانية" });
    const caller = await ur.json();
    const sr = await fetch(`${URL_}/rest/v1/staff?select=role,active&id=eq.${caller.id}`, { headers: svc });
    const me = (await j(sr))[0];
    if (!me || !me.active || me.role !== "admin") return out(403, { error: "هذي الخدمة للمالك بس" });

    const b = await req.json().catch(() => ({}));

    // 2) the emailed confirmation code must be valid (one use, expires)
    const code = String(b.code || "").replace(/\D/g, "");
    if (code.length < 6) return out(400, { error: "اكتب رمز التأكيد اللي وصلك على الإيميل" });
    const vr = await fetch(`${URL_}/auth/v1/verify`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email: caller.email, token: code }),
    });
    if (!vr.ok) return out(400, { error: "رمز التأكيد غلط أو انتهى — اطلب رمز جديد" });

    // 3) the action
    if (b.action === "create") {
      const email = String(b.email || "").trim().toLowerCase();
      const full_name = String(b.full_name || "").trim() || email.split("@")[0];
      const password = String(b.password || "");
      const role = ROLES.includes(b.role) ? b.role : "staff";
      const perms = (Array.isArray(b.perms) ? b.perms : []).filter((p: string) => PERMS.includes(p));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out(400, { error: "الإيميل غير صحيح" });
      if (password.length < 8) return out(400, { error: "كلمة السر لازم ٨ أحرف أو أكثر" });

      const cr = await fetch(`${URL_}/auth/v1/admin/users`, {
        method: "POST", headers: svc,
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }),
      });
      const cu = await j(cr);
      if (!cr.ok) {
        const m = String(cu.msg || cu.message || cu.error_description || "");
        return out(400, { error: /already|exists|registered/i.test(m) ? "هذا الإيميل عنده حساب من قبل" : "تعذّر إنشاء الحساب: " + m });
      }
      const id = cu.id || (cu.user && cu.user.id);
      const pr = await fetch(`${URL_}/rest/v1/staff?id=eq.${id}`, {
        method: "PATCH", headers: { ...svc, Prefer: "return=representation" },
        body: JSON.stringify({ full_name, email, role, perms, active: true }),
      });
      if (!pr.ok) return out(500, { error: "انعمل الحساب بس ما انحفظت الصلاحيات — عدّلها من الجدول" });
      return out(200, { ok: true, id });
    }

    if (b.action === "password") {
      const password = String(b.password || "");
      if (password.length < 8) return out(400, { error: "كلمة السر لازم ٨ أحرف أو أكثر" });
      const tr = await fetch(`${URL_}/rest/v1/staff?select=id&id=eq.${encodeURIComponent(String(b.user_id || ""))}`, { headers: svc });
      if (!(await j(tr))[0]) return out(404, { error: "الشخص مب موجود" });
      const rr = await fetch(`${URL_}/auth/v1/admin/users/${b.user_id}`, { method: "PUT", headers: svc, body: JSON.stringify({ password }) });
      if (!rr.ok) return out(400, { error: "تعذّر تغيير كلمة السر" });
      return out(200, { ok: true });
    }

    return out(400, { error: "unknown action" });
  } catch (e) {
    return out(500, { error: "خطأ في السيرفر: " + (e instanceof Error ? e.message : String(e)) });
  }
});
