/* =========================================================
   pressio — public site
   All content comes from the database. This file is code only:
   updating it never touches the menu, photos or settings.
   ========================================================= */
(function(){
  "use strict";

  var CFG = window.PRESSIO || {};
  var CACHE_KEY = "pressio_site_v2";
  var LANG_KEY = "pressio_lang";

  var T = {
    ar:{menu:"المنيو",about:"عن pressio",space:"المكان",loyalty:"الولاء",visit:"زورونا",order:"اطلب توصيل",
        seeMenu:"شوف المنيو",search:"دوّر في المنيو…",all:"الكل",signature:"المفضّلة عندنا",signatureK:"اختياراتنا",
        menuK:"المنيو",menuT:"كل شي نحضّره",aboutK:"عن pressio",spaceK:"المكان",spaceT:"مساحة تريّحك",
        galK:"من البار",galT:"لقطات من يومنا",loyK:"برنامج الولاء",dlvK:"التوصيل",dlvT:"اطلبنا لين عندك",
        visitK:"زورونا",visitT:"نشوفك في",hours:"الأوقات",addr:"الموقع",phone:"الهاتف",ig:"إنستغرام",
        map:"افتح الخريطة",soon:"قريباً",orderOn:"اطلب من",out:"غير متوفر",back:"يرجع",served:"يُقدّم",
        openNow:"مفتوح الحين",closedNow:"مسكّر الحين — نفتح",until:"لين",nores:"ما لقينا شي بهالاسم",
        staff:"دخول الموظفين",rights:"جميع الحقوق محفوظة",skip:"تخطّى إلى المحتوى",preview:"معاينة — الموقع تحت الصيانة للزوار",
        exitPreview:"خروج",cur:"د.إ",am:"ص",pm:"م",noon:"ظ",midnight:"منتصف الليل",daily:"يومياً",closed:"مسكّر",today:"اليوم",features:"الخدمات",rating:"على Google",reviews:"تقييم",
        days:["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]},
    en:{menu:"Menu",about:"About",space:"The space",loyalty:"Loyalty",visit:"Visit",order:"Order delivery",
        seeMenu:"See the menu",search:"Search the menu…",all:"All",signature:"House favourites",signatureK:"Our picks",
        menuK:"Menu",menuT:"Everything we make",aboutK:"About pressio",spaceK:"The space",spaceT:"A room that works",
        galK:"From the bar",galT:"Moments from our day",loyK:"Loyalty",dlvK:"Delivery",dlvT:"Have it brought to you",
        visitK:"Visit",visitT:"See you in",hours:"Hours",addr:"Location",phone:"Phone",ig:"Instagram",
        map:"Open the map",soon:"Soon",orderOn:"Order on",out:"Sold out",back:"Back",served:"Served",
        openNow:"Open now",closedNow:"Closed — opens",until:"until",nores:"Nothing matches that",
        staff:"Staff sign in",rights:"All rights reserved",skip:"Skip to content",preview:"Preview — visitors see the maintenance page",
        exitPreview:"Exit",cur:"AED",am:"AM",pm:"PM",noon:"PM",midnight:"midnight",daily:"Daily",closed:"Closed",today:"Today",features:"Services",rating:"on Google",reviews:"reviews",
        days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]}
  };

  var S = null;          // site data
  var lang = pickLang();
  var q = "";            // menu search
  var activeCat = "all";

  /* ---------------- utils ---------------- */
  function $(s, r){ return (r || document).querySelector(s); }
  function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v){ return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function t(k){ return (T[lang] && T[lang][k]) || T.en[k] || k; }
  function L(o, base){ // bilingual field: {ar,en} or name_ar/name_en
    if(!o) return "";
    if(base) return o[base + "_" + lang] || o[base + "_" + (lang === "ar" ? "en" : "ar")] || "";
    return o[lang] || o[lang === "ar" ? "en" : "ar"] || "";
  }
  function store(k, v){ try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){} }
  function read(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function pickLang(){
    var m = /[?&]lang=(ar|en)/.exec(location.search);
    if(m) return m[1];
    var s = read(LANG_KEY); if(s === "ar" || s === "en") return s;
    return "ar";
  }
  function numAr(s){ return lang === "ar" ? String(s).replace(/\d/g, function(d){ return "٠١٢٣٤٥٦٧٨٩"[d]; }) : String(s); }
  function money(n){
    var v = Number(n || 0), s = (v % 1 ? v.toFixed(2) : String(v));
    return '<span class="price">' + esc(numAr(s)) + '<small>' + esc(t("cur")) + '</small></span>';
  }
  function norm(s){
    return String(s || "").toLowerCase()
      .replace(/[ً-ٰٟ]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function dubaiNow(){
    try{
      var p = new Intl.DateTimeFormat("en-GB", {timeZone: CFG.tz || "Asia/Dubai", hour:"2-digit", minute:"2-digit", hour12:false})
        .formatToParts(new Date());
      var h = +p.find(function(x){ return x.type === "hour"; }).value % 24;
      var m = +p.find(function(x){ return x.type === "minute"; }).value;
      return h + m / 60;
    }catch(e){ var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  }
  function dubaiDay(){
    try{
      var w = new Intl.DateTimeFormat("en-US", {timeZone: CFG.tz || "Asia/Dubai", weekday:"short"}).format(new Date());
      return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(w);
    }catch(e){ return new Date().getDay(); }
  }
  function toMin(v){ var m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function timeLabel(v){
    var mm = toMin(v); if(mm == null) return "";
    mm = mm % 1440; var h = Math.floor(mm / 60), m = mm % 60;
    if(h === 0 && m === 0) return t("midnight");
    var hh = h % 12 || 12, suf = h < 12 ? t("am") : t("pm");
    return numAr(hh + (m ? ":" + (m < 10 ? "0" : "") + m : "")) + " " + suf;
  }
  function daySpan(d){ // [start,end] minutes from that day's midnight, end may pass 1440
    if(!d || d.closed) return null;
    var f = toMin(d.from), e = toMin(d.to); if(f == null || e == null) return null;
    if(e <= f) e += 1440; return [f, e];
  }
  function hasWeek(info){ return !!(info && info.week && [0,1,2,3,4,5,6].some(function(d){ return daySpan(info.week[d]); })); }
  function openState(info){ // {open, label} from the weekly table
    var wk = info.week, day = dubaiDay(), m = Math.round(dubaiNow() * 60);
    var y = daySpan(wk[(day + 6) % 7]), td = daySpan(wk[day]);
    if(y && y[1] > 1440 && m < y[1] - 1440) return {open:true, label: t("until") + " " + timeLabel(wk[(day + 6) % 7].to)};
    if(td && m >= td[0] && m < td[1]) return {open:true, label: t("until") + " " + timeLabel(wk[day].to)};
    if(td && m < td[0]) return {open:false, label: timeLabel(wk[day].from)};
    for(var k = 1; k <= 7; k++){
      var n = (day + k) % 7, sp = daySpan(wk[n]);
      if(sp) return {open:false, label: (k === 1 ? "" : t("days")[n] + " ") + timeLabel(wk[n].from)};
    }
    return {open:false, label:""};
  }
  function weekRows(info){ // Monday-first, consecutive equal days grouped
    var order = [1,2,3,4,5,6,0], rows = [], today = dubaiDay();
    order.forEach(function(d){
      var x = info.week[d] || {}, key = x.closed || !daySpan(x) ? "c" : x.from + "-" + x.to, last = rows[rows.length - 1];
      if(last && last.key === key){ last.days.push(d); } else rows.push({key:key, days:[d], x:x});
    });
    return rows.map(function(r){
      var nm = t("days"), lbl = nm[r.days[0]] + (r.days.length > 1 ? " – " + nm[r.days[r.days.length - 1]] : "");
      var val = r.key === "c" ? t("closed") : timeLabel(r.x.from) + " – " + timeLabel(r.x.to);
      return '<li' + (r.days.indexOf(today) > -1 ? ' class="is-today"' : '') + '><span>' + esc(lbl) + '</span><span>' + esc(val) + '</span></li>';
    }).join("");
  }
  function area(info){ return L(info.area) || L(info.addr).split(/[،,]/).slice(-2).join("،").trim(); }

  function hourLabel(h){
    h = Number(h);
    if(h === 24 || h === 0) return t("midnight");
    var hh = h % 12 || 12, suf = h < 12 ? t("am") : (h === 12 ? t("noon") : t("pm"));
    return numAr(hh) + (lang === "ar" ? " " : " ") + suf;
  }

  /* media: id → url (relative files live in /images, uploads live in Supabase) */
  function media(id){ return (S && S.media && S.media[id]) || null; }
  function src(id){
    if(!id) return "";
    if(/^https?:|^images\//.test(id)) return id;
    var m = media(id); return m ? m.url : "";
  }
  function img(id, alt, cls, sizes){
    var u = src(id); if(!u) return "";
    var m = media(id) || {};
    return '<img src="' + esc(u) + '" alt="' + esc(alt || L(m, "alt")) + '" loading="lazy" decoding="async"'
      + (m.w ? ' width="' + m.w + '" height="' + m.h + '"' : "") + (cls ? ' class="' + cls + '"' : "")
      + (sizes ? ' sizes="' + sizes + '"' : "") + '>';
  }

  /* ---------------- data ---------------- */
  function fromCache(){ try{ return JSON.parse(read(CACHE_KEY) || "null"); }catch(e){ return null; } }
  function live(){
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 6000);
    return fetch(CFG.url + "/rest/v1/rpc/get_site", {
      method: "POST", signal: ctrl && ctrl.signal,
      headers: {"apikey": CFG.key, "Content-Type": "application/json"}, body: "{}"
    }).then(function(r){ clearTimeout(timer); if(!r.ok) throw new Error(r.status); return r.json(); });
  }
  function snapshot(){ return fetch("data/site.json", {cache: "no-cache"}).then(function(r){ if(!r.ok) throw 0; return r.json(); }); }
  function valid(d){ return d && d.settings && Array.isArray(d.items); }

  function boot(){
    var cached = fromCache(), shown = false;
    function show(d){ if(!valid(d)) return; S = d; shown = true; render(); }
    if(valid(cached)) show(cached);

    live().then(function(d){
      if(!valid(d)) throw 0;
      store(CACHE_KEY, JSON.stringify(d));
      if(!shown || !S || S.updated_at !== d.updated_at) show(d);
    }).catch(function(){
      if(!shown) snapshot().then(show).catch(function(){
        $("#app").innerHTML = '<div class="wrap empty">pressio — 050 344 4335 · @pressio.ae</div>';
      });
    });
    // if the network is slow on a first visit, draw the saved copy after a moment
    setTimeout(function(){ if(!shown) snapshot().then(function(d){ if(!shown) show(d); }).catch(function(){}); }, 1500);
  }

  /* ---------------- render ---------------- */
  try{ if(/[?&]preview=1/.test(location.search)) sessionStorage.setItem("pressio_preview", "1"); }catch(e){}
  function isPreview(){ try{ return sessionStorage.getItem("pressio_preview") === "1"; }catch(e){ return false; } }

  function render(){
    var st = S.settings || {}, home = st.home || {};
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $("#lang").textContent = lang === "ar" ? "EN" : "ع";
    $("#lang").setAttribute("aria-label", lang === "ar" ? "English" : "العربية");
    $(".skip").textContent = t("skip");
    $$("[data-i18n]").forEach(function(el){ el.textContent = t(el.getAttribute("data-i18n")); });

    // maintenance
    var maint = st.maint || {};
    if(maint.on && !isPreview()){ renderMaint(maint, home); return; }
    document.body.classList.remove("is-maint");
    var mEl = $("#maint"); if(mEl) mEl.remove();
    renderPreviewBar(maint.on);

    renderNav();
    renderHero(st, home);
    var html = "";
    html += secAbout(home);
    html += secSignature();
    html += secMenu();
    html += secSpace(home);
    html += secGallery(home);
    html += secLoyalty(st.loyalty || {});
    html += secDelivery(home);
    html += secVisit(home);
    $("#app").innerHTML = html;
    renderFooter(st, home);
    bindMenu();
    paintMenu();
    reveal();
    if(location.hash && !render.jumped){ render.jumped = true; var el = document.getElementById(location.hash.slice(1)); if(el) el.scrollIntoView(); }
  }

  var NAV = [["menu","menu"],["about","about"],["space","space"],["loyalty","loyalty"],["visit","visit"]];
  function renderNav(){
    var links = NAV.map(function(n){ return '<a href="#' + n[0] + '">' + esc(t(n[1])) + '</a>'; }).join("");
    $("#nav").innerHTML = links;
    $("#nav").setAttribute("aria-label", lang === "ar" ? "القائمة الرئيسية" : "Main");
    $("#drawer").innerHTML = links + '<a class="btn btn--ink" href="#delivery">' + esc(t("order")) + '</a>';
  }

  function renderHero(st, home){
    var h = home.hero || {};
    $("#hero-eyebrow").textContent = ((st.brand || {}).tagline || "Speciality Coffee") + " · " + area(home.info || {});
    $("#hero-title").textContent = h["title_" + lang] || h.title_en || "Pause. Sip. Pressio.";
    $("#hero-sub").textContent = h["sub_" + lang] || h.sub_en || "";
    var hi = $("#hero-img"), want = h.image && h.image !== "hero" ? src(h.image) : "";
    if(want && hi.getAttribute("src") !== want){ hi.removeAttribute("srcset"); hi.src = want; }
    hi.alt = L(media(h.image || "hero") || {}, "alt") || "pressio";
    var info = home.info || {}, s = $("#status");
    if(hasWeek(info)){
      var os = openState(info);
      s.hidden = false; s.className = "status" + (os.open ? " is-open" : "");
      s.textContent = os.open ? (t("openNow") + " · " + os.label) : (t("closedNow") + " " + os.label);
    } else if(info.open_from != null && info.open_to != null){
      var now = dubaiNow(), from = +info.open_from, to = +info.open_to;
      var open = to > from ? (now >= from && now < to) : (now >= from || now < to);
      s.hidden = false; s.className = "status" + (open ? " is-open" : "");
      s.textContent = open ? (t("openNow") + " · " + t("until") + " " + hourLabel(to)) : (t("closedNow") + " " + hourLabel(from));
    }
  }

  function head(k, title, extra){
    return '<div class="sec__head"><div><p class="kicker">' + esc(k) + '</p><h2 class="h2">' + esc(title) + '</h2></div>' + (extra || "") + '</div>';
  }

  function secAbout(home){
    var pts = (home.points || []).map(function(p){
      return '<div class="point"><div><h3>' + esc(L(p)) + '</h3><p>' + esc(p["d" + lang] || p.den || "") + '</p></div></div>';
    }).join("");
    return '<section class="sec" id="about"><div class="wrap about reveal">'
      + '<div><p class="kicker">' + esc(t("aboutK")) + '</p><p class="about__text">' + esc(L(home.about)) + '</p></div>'
      + '<div class="points">' + pts + '</div></div></section>';
  }

  function available(it){
    if(it.available === false) return {ok:false, note:t("out")};
    if(it.snooze_until && new Date(it.snooze_until) > new Date()){
      var d = new Date(it.snooze_until);
      var when = new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {hour:"numeric", minute:"2-digit", timeZone: CFG.tz || "Asia/Dubai"}).format(d);
      return {ok:false, note:t("back") + " " + when};
    }
    return {ok:true};
  }

  function secSignature(){
    var list = (S.items || []).filter(function(i){ return i.featured && i.images && i.images.length && src(i.images[0]); });
    if(!list.length) return "";
    var cards = list.map(function(i){
      return '<a class="sig" href="#menu" data-jump="' + esc(i.c) + '"><div class="sig__img">' + img(i.images[0], L(i, "name")) + '</div>'
        + '<div class="sig__row"><b>' + esc(L(i, "name")) + '</b>' + money(i.price) + '</div></a>';
    }).join("");
    return '<section class="sec sec--paper"><div class="wrap reveal">' + head(t("signatureK"), t("signature"))
      + '<div class="rail">' + cards + '</div></div></section>';
  }

  function secMenu(){
    var cats = S.categories || [];
    var chips = '<button class="chip is-on" data-cat="all">' + esc(t("all")) + '</button>'
      + cats.map(function(c){ return '<button class="chip" data-cat="' + esc(c.id) + '">' + esc(L(c, "name")) + '</button>'; }).join("");
    return '<section class="sec" id="menu" style="padding-top:clamp(56px,8vw,100px)"><div class="wrap">'
      + head(t("menuK"), t("menuT")) + '</div>'
      + '<div class="menu-bar"><div class="wrap menu-bar__in"><div class="chips" id="chips">' + chips + '</div>'
      + '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      + '<input id="q" type="search" autocomplete="off" placeholder="' + esc(t("search")) + '" aria-label="' + esc(t("search")) + '" value="' + esc(q) + '"></label></div></div>'
      + '<div class="wrap" id="menu-list"></div></section>';
  }

  function paintMenu(){
    var box = $("#menu-list"); if(!box) return;
    var nq = norm(q), out = "";
    (S.categories || []).forEach(function(c){
      if(activeCat !== "all" && activeCat !== c.id) return;
      var items = (S.items || []).filter(function(i){
        if(i.c !== c.id) return false;
        if(!nq) return true;
        return norm(i.name_ar + " " + i.name_en + " " + i.desc_ar + " " + i.desc_en).indexOf(nq) >= 0;
      });
      if(!items.length) return;
      var hrs = (c.hours_from != null && c.hours_to != null)
        ? '<span class="tag">' + esc(t("served") + " " + hourLabel(c.hours_from) + " – " + hourLabel(c.hours_to)) + '</span>' : "";
      out += '<div class="mcat" id="c-' + esc(c.id) + '"><div class="mcat__head"><h3>' + esc(L(c, "name")) + '</h3>' + hrs + '</div><div class="mitems">';
      items.forEach(function(i){
        var a = available(i), pic = i.images && i.images[0] && src(i.images[0]);
        out += '<div class="mi' + (pic ? " has-img" : "") + (a.ok ? "" : " is-off") + '">'
          + (pic ? '<div class="mi__img">' + img(i.images[0], L(i, "name")) + '</div>' : "")
          + '<div class="mi__name">' + esc(L(i, "name")) + (a.ok ? "" : '<span class="mi__note">' + esc(a.note) + '</span>') + '</div>'
          + money(i.price)
          + (L(i, "desc") ? '<p class="mi__desc">' + esc(L(i, "desc")) + '</p>' : "")
          + '</div>';
      });
      out += '</div></div>';
    });
    box.innerHTML = out || '<p class="empty">' + esc(t("nores")) + '</p>';
  }

  function bindMenu(){
    var input = $("#q");
    if(input) input.addEventListener("input", function(){ q = input.value; activeCat = "all"; setChip("all"); paintMenu(); });
    $$(".chip").forEach(function(ch){
      ch.addEventListener("click", function(){
        activeCat = ch.getAttribute("data-cat"); q = ""; if(input) input.value = "";
        setChip(activeCat); paintMenu();
        var top = $("#menu-list").getBoundingClientRect().top + scrollY - 150;
        if(scrollY > top) scrollTo({top: top, behavior: "smooth"});
      });
    });
    $$("[data-jump]").forEach(function(a){
      a.addEventListener("click", function(){ activeCat = a.getAttribute("data-jump"); setChip(activeCat); paintMenu(); });
    });
  }
  function setChip(id){
    $$(".chip").forEach(function(c){
      var on = c.getAttribute("data-cat") === id; c.classList.toggle("is-on", on);
      if(on && c.scrollIntoView) c.scrollIntoView({block:"nearest", inline:"center"});
    });
  }

  function secSpace(home){
    var sp = home.space || []; if(!sp.length) return "";
    return '<section class="sec sec--paper" id="space"><div class="wrap reveal">' + head(t("spaceK"), t("spaceT"))
      + '<div class="space">' + sp.map(function(s){
          return '<figure>' + img(s.img, L(s)) + '<figcaption>' + esc(L(s)) + '</figcaption></figure>'; }).join("")
      + '</div></div></section>';
  }

  function secGallery(home){
    var g = (home.gallery || []).filter(function(x){ return src(x.img); }); if(!g.length) return "";
    return '<section class="sec"><div class="wrap reveal">' + head(t("galK"), t("galT"))
      + '<div class="gal">' + g.map(function(x){
          return '<figure><div class="ph">' + img(x.img, L(x)) + '</div><figcaption>' + esc(L(x)) + '</figcaption></figure>'; }).join("")
      + '</div></div></section>';
  }

  function secLoyalty(loy){
    if(!loy || !loy.title) return "";
    var stamps = ""; for(var i = 0; i < 5; i++) stamps += img(i < 3 ? (loy.stamp_full || "stamp-full") : (loy.stamp_empty || "stamp-empty"), "");
    var steps = (loy.steps || []).map(function(s, n){
      return '<div class="step"><i>0' + (n + 1) + '</i><b>' + esc(L(s)) + '</b><span>' + esc(s["d" + lang] || s.den || "") + '</span></div>';
    }).join("");
    var cta = loy.url ? '<a class="btn btn--ink" href="' + esc(loy.url) + '" target="_blank" rel="noopener">' + esc(L(loy.cta)) + '</a>' : "";
    var qr = loy.qr ? '<img class="qr" src="' + esc(loy.qr) + '" alt="QR" width="92" height="92" loading="lazy">' : "";
    return '<section class="sec sec--ink" id="loyalty"><div class="wrap loy reveal">'
      + '<div><p class="kicker">' + esc(t("loyK")) + '</p><h2 class="h2">' + esc(L(loy.title)) + '</h2>'
      + '<p class="lede" style="margin-top:18px">' + esc(L(loy.body)) + '</p>'
      + '<div class="steps">' + steps + '</div><div class="loy__cta">' + cta + qr + '</div></div>'
      + '<div><div class="card"><span class="logo" aria-hidden="true"></span><div class="stamps">' + stamps + '</div>'
      + '<small>' + esc(L(loy.scan)) + '</small></div></div>'
      + '</div></section>';
  }

  function secDelivery(home){
    var d = home.delivery || []; if(!d.length) return "";
    return '<section class="sec" id="delivery"><div class="wrap reveal">' + head(t("dlvK"), t("dlvT"))
      + '<div class="dlv">' + d.map(function(x){
          var inner = '<b>' + esc(L(x)) + '</b><span>' + esc(x["d" + lang] || x.den || "") + '</span>'
            + '<em>' + esc(x.url ? (t("orderOn") + " " + L(x) + (lang === "ar" ? " ←" : " →")) : t("soon")) + '</em>';
          return x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<div>' + inner + '</div>';
        }).join("") + '</div></div></section>';
  }

  function telHref(p){ var d = String(p || "").replace(/\D/g, ""); if(d.charAt(0) === "0") d = "971" + d.slice(1); return "tel:+" + d; }
  function igHref(h){ return "https://www.instagram.com/" + String(h || "").replace(/^@/, "") + "/"; }
  function mapHref(info){ return info.map || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("pressio " + (info.addr && info.addr.en || "Dubai"))); }

  function secVisit(home){
    var i = home.info || {};
    var hrs = hasWeek(i) ? '<ul class="hours">' + weekRows(i) + '</ul>' + (L(i.hours_note) ? '<p class="note">' + esc(L(i.hours_note)) + '</p>' : "") : esc(L(i.hours));
    var rt = i.rating && +i.rating.value ? '<a class="rating" href="' + esc(i.rating.url || mapHref(i)) + '" target="_blank" rel="noopener"><b>★ ' + esc(numAr((+i.rating.value).toFixed(1))) + '</b> '
      + esc(t("rating")) + (i.rating.count ? ' · ' + esc(numAr(i.rating.count)) + ' ' + esc(t("reviews")) : "") + '</a>' : "";
    var ft = (i.features || []).filter(function(f){ return L(f); });
    return '<section class="sec sec--paper" id="visit"><div class="wrap reveal">' + head(t("visitK"), t("visitT") + " " + area(i),
        '<a class="btn btn--ghost" href="' + esc(mapHref(i)) + '" target="_blank" rel="noopener">' + esc(t("map")) + '</a>')
      + '<dl class="visit">'
      + '<div class="visit__hours"><dt>' + esc(t("hours")) + '</dt><dd>' + hrs + '</dd></div>'
      + '<div><dt>' + esc(t("addr")) + '</dt><dd><a href="' + esc(mapHref(i)) + '" target="_blank" rel="noopener">' + esc(L(i.addr)) + '</a>' + (rt ? '<div>' + rt + '</div>' : "") + '</dd></div>'
      + (i.phone ? '<div><dt>' + esc(t("phone")) + '</dt><dd><a href="' + esc(telHref(i.phone)) + '" dir="ltr">' + esc(i.phone) + '</a></dd></div>' : "")
      + (i.ig ? '<div><dt>' + esc(t("ig")) + '</dt><dd><a href="' + esc(igHref(i.ig)) + '" target="_blank" rel="noopener" dir="ltr">' + esc(i.ig) + '</a></dd></div>' : "")
      + '</dl>'
      + (ft.length ? '<div class="feats"><p class="kicker">' + esc(t("features")) + '</p><ul>' + ft.map(function(f){ return '<li>' + esc(L(f)) + '</li>'; }).join("") + '</ul></div>' : "")
      + '</div></section>';
  }

  function renderFooter(st, home){
    var links = NAV.map(function(n){ return '<a href="#' + n[0] + '">' + esc(t(n[1])) + '</a>'; }).join("");
    $("#foot").innerHTML = '<div class="wrap"><div class="foot__grid"><div><span class="logo" aria-hidden="true"></span>'
      + '<p class="foot__line">' + esc((st.brand || {}).foot || "Pause. Sip. Pressio") + '</p></div><nav aria-label="footer">' + links + '</nav></div>'
      + '<div class="foot__base"><span>© ' + new Date().getFullYear() + ' pressio · ' + esc(t("rights")) + '</span>'
      + '<a href="admin.html" rel="nofollow">' + esc(t("staff")) + '</a></div></div>';
  }

  function renderMaint(m, home){
    document.body.classList.add("is-maint");
    var el = $("#maint");
    if(!el){ el = document.createElement("section"); el.id = "maint"; el.className = "maint"; document.body.insertBefore(el, document.body.firstChild); }
    var d = (home.delivery || []).filter(function(x){ return x.url; });
    el.innerHTML = '<div class="maint__in"><span class="logo" role="img" aria-label="pressio"></span>'
      + '<h1>' + esc(L(m.title)) + '</h1><p>' + esc(L(m.body)) + '</p>'
      + '<div class="maint__links">' + d.map(function(x){ return '<a class="btn btn--ghost btn--sm" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(L(x)) + '</a>'; }).join("")
      + ((home.info || {}).ig ? '<a class="btn btn--ghost btn--sm" href="' + esc(igHref(home.info.ig)) + '" target="_blank" rel="noopener" dir="ltr">' + esc(home.info.ig) + '</a>' : "")
      + '</div><div class="maint__lang"><button class="lang" type="button" id="mlang">' + (lang === "ar" ? "English" : "العربية") + '</button></div></div>';
    $("#mlang").addEventListener("click", toggleLang);
    document.title = "pressio — " + L(m.title);
  }

  function renderPreviewBar(maintOn){
    var bar = $("#pbar");
    if(!maintOn || !isPreview()){ if(bar) bar.remove(); return; }
    if(!bar){ bar = document.createElement("div"); bar.id = "pbar"; bar.className = "preview-bar"; document.body.appendChild(bar); }
    bar.innerHTML = '<span>' + esc(t("preview")) + '</span><button type="button">' + esc(t("exitPreview")) + '</button>';
    bar.querySelector("button").onclick = function(){ try{ sessionStorage.removeItem("pressio_preview"); }catch(e){} render(); };
  }

  function reveal(){
    var els = $$(".reveal");
    if(!("IntersectionObserver" in window)){ els.forEach(function(e){ e.classList.add("in"); }); return; }
    var io = new IntersectionObserver(function(en){ en.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } }); }, {rootMargin:"0px 0px -8% 0px"});
    els.forEach(function(e){ io.observe(e); });
  }

  /* ---------------- chrome ---------------- */
  function toggleLang(){
    lang = lang === "ar" ? "en" : "ar"; store(LANG_KEY, lang);
    if(S) render();
  }
  function wire(){
    $("#lang").addEventListener("click", toggleLang);
    var burger = $("#burger"), drawer = $("#drawer");
    function close(){ burger.setAttribute("aria-expanded", "false"); drawer.hidden = true; document.body.style.overflow = ""; }
    burger.addEventListener("click", function(){
      var open = burger.getAttribute("aria-expanded") !== "true";
      burger.setAttribute("aria-expanded", String(open)); drawer.hidden = !open; document.body.style.overflow = open ? "hidden" : "";
    });
    drawer.addEventListener("click", function(e){ if(e.target.closest("a")) close(); });
    var top = $("#top");
    function onScroll(){ top.classList.toggle("is-solid", scrollY > 8); }
    addEventListener("scroll", onScroll, {passive:true}); onScroll();
  }

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  wire();
  boot();
})();
