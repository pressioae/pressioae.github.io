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
    ar:{sections:"أقسام الصفحة",tryCard:"اضغط على البطاقة وجرّب",free:"مجاناً",won:"السادس علينا!",home:"الرئيسية",delivery:"التوصيل",stampsOf:"من",menu:"المنيو",about:"عن pressio",space:"المكان",loyalty:"الولاء",visit:"زورونا",order:"اطلب توصيل",
        seeMenu:"شوف المنيو",search:"دوّر في المنيو…",all:"الكل",signature:"المفضّلة عندنا",signatureK:"اختياراتنا",
        menuK:"المنيو",menuT:"كل شي نحضّره",aboutK:"عن pressio",spaceK:"المكان",spaceT:"مساحة تريّحك",
        galK:"من البار",galT:"لقطات من يومنا",loyK:"برنامج الولاء",dlvK:"التوصيل",dlvT:"اطلبنا لين عندك",
        visitK:"زورونا",visitT:"نشوفك في",hours:"الأوقات",addr:"الموقع",phone:"الهاتف",ig:"إنستغرام",
        map:"افتح الخريطة",soon:"قريباً",orderOn:"اطلب من",out:"غير متوفر",back:"يرجع",served:"يُقدّم",
        openNow:"مفتوح الحين",closedNow:"مسكّر الحين — نفتح",until:"لين",nores:"ما لقينا شي بهالاسم",
        staff:"دخول الموظفين",zoom:"تكبير الصورة",close:"إغلاق",prev:"السابقة",next:"التالية",rights:"جميع الحقوق محفوظة",skip:"تخطّى إلى المحتوى",preview:"معاينة — الموقع تحت الصيانة للزوار",
        exitPreview:"خروج",cur:"د.إ",am:"ص",pm:"م",noon:"ظ",midnight:"منتصف الليل",daily:"يومياً",closed:"مسكّر",today:"اليوم",features:"الخدمات",rating:"على Google",reviews:"تقييم",
        days:["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]},
    en:{sections:"Page sections",tryCard:"Tap the card to try it",free:"Free",won:"The 6th is on us!",home:"Home",delivery:"Delivery",stampsOf:"of",menu:"Menu",about:"About",space:"The space",loyalty:"Loyalty",visit:"Visit",order:"Order delivery",
        seeMenu:"See the menu",search:"Search the menu…",all:"All",signature:"House favourites",signatureK:"Our picks",
        menuK:"Menu",menuT:"Everything we make",aboutK:"About pressio",spaceK:"The space",spaceT:"A room that works",
        galK:"From the bar",galT:"Moments from our day",loyK:"Loyalty",dlvK:"Delivery",dlvT:"Have it brought to you",
        visitK:"Visit",visitT:"See you in",hours:"Hours",addr:"Location",phone:"Phone",ig:"Instagram",
        map:"Open the map",soon:"Soon",orderOn:"Order on",out:"Sold out",back:"Back",served:"Served",
        openNow:"Open now",closedNow:"Closed — opens",until:"until",nores:"Nothing matches that",
        staff:"Staff sign in",zoom:"View photo",close:"Close",prev:"Previous",next:"Next",rights:"All rights reserved",skip:"Skip to content",preview:"Preview — visitors see the maintenance page",
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
        $("#app").innerHTML = '<div class="wrap empty">pressio — 050 394 2292 · @pressio.ae</div>';
      });
    });
    // if the network is slow on a first visit, draw the saved copy after a moment
    setTimeout(function(){ if(!shown) snapshot().then(function(d){ if(!shown) show(d); }).catch(function(){}); }, 1500);
  }

  /* ---------------- logo: tap = back to top; 5 quick taps = staff sign-in ---------------- */
  var taps = 0, lastTap = 0;
  document.addEventListener("click", function(e){
    var lg = e.target.closest && e.target.closest(".brand, #maint .logo, .foot .logo");
    if(!lg) return;
    var now = Date.now();
    taps = (now - lastTap <= 2000) ? taps + 1 : 1;
    lastTap = now;
    if(taps >= 5){ taps = 0; e.preventDefault(); location.href = "admin.html"; return; }
    if(lg.classList.contains("brand")){
      e.preventDefault();
      try{ history.replaceState(null, "", location.pathname + location.search); }catch(x){}
      window.scrollTo({top: 0, behavior: "smooth"});
      var bu = $("#burger"); if(bu && bu.getAttribute("aria-expanded") === "true") bu.click();
    }
  });

  /* ---------------- photo viewer ----------------
     tap a photo → full screen. Above the photo: small photos of the same section
     (swipe them, tap one to open it). Below: the section names to jump between them.
     Swipe the big photo (it follows your finger) or use the arrows / keyboard. */
  var LB = null;
  function priceTxt(p){ return p ? numAr(Number(p) % 1 ? Number(p).toFixed(2) : String(p)) + " " + t("cur") : ""; }
  function lbGroups(el){
    var g = el.getAttribute("data-lb"), groups = [], pos = {g: 0, i: 0};
    if(g === "menu"){
      var wantId = el.getAttribute("data-id");
      (S.categories || []).forEach(function(c){
        var slides = [];
        (S.items || []).forEach(function(it){
          if(it.c !== c.id) return;
          (it.images || []).filter(src).forEach(function(id, k){
            if(it.id === wantId && k === 0){ pos = {g: groups.length, i: slides.length}; }
            slides.push({u: src(id), cap: L(it, "name"), sub: priceTxt(it.price)});
          });
        });
        if(slides.length) groups.push({name: L(c, "name"), slides: slides});
      });
    } else {
      var slides = [];
      $$('[data-lb="' + g + '"]').forEach(function(n){
        var im = n.querySelector("img"); if(!im) return;
        if(n === el) pos = {g: 0, i: slides.length};
        slides.push({u: im.currentSrc || im.src, cap: n.getAttribute("data-cap") || "", sub: ""});
      });
      if(slides.length) groups.push({name: "", slides: slides});
    }
    return {groups: groups, g: pos.g, i: pos.i};
  }
  function lbCur(){ return LB.groups[LB.g].slides[LB.i]; }
  function lbThumbs(){
    var box = LB.el.querySelector(".lb__thumbs"), s = LB.groups[LB.g].slides;
    box.innerHTML = s.map(function(x, k){
      return '<button type="button" class="lb__th" data-k="' + k + '" aria-label="' + esc(x.cap) + '"><img src="' + esc(x.u) + '" alt="" loading="lazy" decoding="async"></button>';
    }).join("");
    box.hidden = s.length < 2;
  }
  function lbChips(){
    var box = LB.el.querySelector(".lb__groups");
    box.hidden = LB.groups.length < 2;
    box.innerHTML = LB.groups.map(function(gr, k){ return '<button type="button" class="lb__g" data-g="' + k + '">' + esc(gr.name) + '</button>'; }).join("");
  }
  function lbMark(smooth){
    var el = LB.el;
    $$(".lb__th", el).forEach(function(b){ b.classList.toggle("is-on", +b.getAttribute("data-k") === LB.i); });
    $$(".lb__g", el).forEach(function(b){ b.classList.toggle("is-on", +b.getAttribute("data-g") === LB.g); });
    var th = el.querySelector(".lb__th.is-on"), gc = el.querySelector(".lb__g.is-on");
    [th && [th, el.querySelector(".lb__thumbs")], gc && [gc, el.querySelector(".lb__groups")]].forEach(function(p){
      if(!p) return;
      var b = p[0], strip = p[1], br = b.getBoundingClientRect(), sr = strip.getBoundingClientRect();
      var delta = (br.left + br.width / 2) - (sr.left + sr.width / 2);
      try{ strip.scrollBy({left: delta, behavior: smooth ? "smooth" : "auto"}); }catch(x){ strip.scrollLeft += delta; }
    });
    if(LB.paintStrip) requestAnimationFrame(LB.paintStrip);
  }
  function lbText(){
    var s = lbCur(), el = LB.el, n = LB.groups[LB.g].slides.length;
    el.querySelector(".lb__cap b").textContent = s.cap;
    el.querySelector(".lb__cap span").textContent = s.sub;
    el.querySelector(".lb__n").textContent = n > 1 ? numAr((LB.i + 1) + " / " + n) : "";
    var total = LB.groups.reduce(function(a, g){ return a + g.slides.length; }, 0);
    el.classList.toggle("is-single", total < 2);
  }
  function lbPreload(){
    var gr = LB.groups[LB.g].slides;
    [LB.i + 1, LB.i - 1].forEach(function(k){ var x = gr[k]; if(x){ var p = new Image(); p.src = x.u; } });
  }
  // dir: +1 = came from "next", -1 = from "previous", 0 = no slide
  function lbShow(dir, groupChanged){
    var el = LB.el, im = el.querySelector(".lb__img"), s = lbCur(), rtl = lang === "ar";
    el.classList.remove("is-zoom");
    if(groupChanged){ lbThumbs(); }
    lbText(); lbMark(true); lbPreload();
    var off = (dir > 0) !== rtl ? 1 : -1;   // screen side the new photo comes in from
    if(!dir || window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      im.style.transition = "none"; im.style.transform = ""; im.style.opacity = ""; im.src = s.u; im.alt = s.cap; return;
    }
    var token = (LB.tok = (LB.tok || 0) + 1);
    im.style.transition = "transform .18s ease-in, opacity .18s ease-in";
    im.style.transform = "translateX(" + (-off * 40) + "%)"; im.style.opacity = "0";
    setTimeout(function(){
      if(!LB || token !== LB.tok) return;
      im.style.transition = "none"; im.style.transform = "translateX(" + (off * 40) + "%)";
      im.src = s.u; im.alt = s.cap;
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        im.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s ease-out";
        im.style.transform = ""; im.style.opacity = "";
      }); });
    }, 170);
  }
  function lbGo(d){
    if(!LB) return;
    var gr = LB.groups[LB.g].slides, changed = false;
    if(LB.i + d >= 0 && LB.i + d < gr.length) LB.i += d;
    else if(LB.groups.length > 1){ LB.g = (LB.g + d + LB.groups.length) % LB.groups.length; LB.i = d > 0 ? 0 : LB.groups[LB.g].slides.length - 1; changed = true; }
    else if(gr.length > 1) LB.i = (LB.i + d + gr.length) % gr.length;
    else return;
    lbShow(d, changed);
  }
  function lbJump(g, i){
    if(!LB) return;
    var d = g === LB.g ? (i > LB.i ? 1 : -1) : (g > LB.g ? 1 : -1);
    if(g === LB.g && i === LB.i) return;
    var changed = g !== LB.g; LB.g = g; LB.i = i; lbShow(d, changed);
  }
  function lbClose(fromHistory){
    if(!LB) return;
    LB.el.remove(); document.documentElement.style.overflow = "";
    var back = LB.focus; LB = null;
    if(!fromHistory && history.state && history.state.lb) history.back();
    if(back && back.focus) back.focus({preventScroll: true});
  }
  function lbOpen(el){
    var d = lbGroups(el); if(!d.groups.length) return;
    var rtl = lang === "ar";
    var box = document.createElement("div");
    box.className = "lb"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.dir = rtl ? "rtl" : "ltr";
    box.innerHTML = '<div class="lb__top"><div class="lb__thumbs"></div><button type="button" class="lb__btn lb__x" aria-label="' + esc(t("close")) + '">×</button></div>'
      + '<div class="lb__stage"><img class="lb__img" alt="" draggable="false">'
      + '<button type="button" class="lb__btn lb__prev" aria-label="' + esc(t("prev")) + '">' + (rtl ? "›" : "‹") + '</button>'
      + '<button type="button" class="lb__btn lb__next" aria-label="' + esc(t("next")) + '">' + (rtl ? "‹" : "›") + '</button></div>'
      + '<div class="lb__cap"><b></b><span></span><i class="lb__n"></i></div>'
      + '<div class="lb__groups"></div>';
    document.body.appendChild(box);
    LB = {el: box, groups: d.groups, g: d.g, i: d.i, focus: el};
    document.documentElement.style.overflow = "hidden";
    try{ history.pushState({lb: 1}, ""); }catch(x){}
    lbThumbs(); lbChips(); lbShow(0); requestAnimationFrame(function(){ lbMark(false); });

    box.querySelector(".lb__x").onclick = function(){ lbClose(); };
    box.querySelector(".lb__prev").onclick = function(){ lbGo(-1); };
    box.querySelector(".lb__next").onclick = function(){ lbGo(1); };
    var strip = box.querySelector(".lb__thumbs"), raf = 0, endT = 0, userScroll = false;
    strip.addEventListener("click", function(e){ var b = e.target.closest(".lb__th"); if(b) lbJump(LB.g, +b.getAttribute("data-k")); });
    // flick the strip: it glides, the photos grow as they reach the middle, and the one that stops in the middle opens
    function nearest(){
      var sr = strip.getBoundingClientRect(), mid = sr.left + sr.width / 2, best = null, bd = 1e9;
      $$(".lb__th", strip).forEach(function(b){ var r = b.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if(d < bd){ bd = d; best = b; } });
      return best;
    }
    LB.paintStrip = function(){
      var sr = strip.getBoundingClientRect(), mid = sr.left + sr.width / 2;
      $$(".lb__th", strip).forEach(function(b){
        var r = b.getBoundingClientRect(), d = Math.min(1, Math.abs(r.left + r.width / 2 - mid) / (sr.width / 2));
        b.style.transform = "translateY(" + (-8 * (1 - d) * (1 - d)) + "px) scale(" + (0.82 + 0.34 * (1 - d) * (1 - d)) + ")";
        b.style.opacity = String(0.4 + 0.6 * (1 - d));
      });
    };
    strip.addEventListener("scroll", function(){
      cancelAnimationFrame(raf); raf = requestAnimationFrame(LB.paintStrip);
      clearTimeout(endT);
      endT = setTimeout(function(){
        if(!LB || !userScroll) return;
        userScroll = false;
        var b = nearest(); if(b && +b.getAttribute("data-k") !== LB.i) lbJump(LB.g, +b.getAttribute("data-k"));
      }, 140);
    }, {passive: true});
    ["touchstart", "wheel", "mousedown"].forEach(function(ev){ strip.addEventListener(ev, function(){ userScroll = true; }, {passive: true}); });
    // mouse: drag the strip on a computer too
    var md = false, mx = 0, ms = 0, moved = false;
    strip.addEventListener("mousedown", function(e){ md = true; moved = false; mx = e.clientX; ms = strip.scrollLeft; strip.classList.add("is-drag"); });
    window.addEventListener("mousemove", function(e){ if(!md) return; if(Math.abs(e.clientX - mx) > 4) moved = true; strip.scrollLeft = ms - (e.clientX - mx); });
    window.addEventListener("mouseup", function(){ if(!md) return; md = false; strip.classList.remove("is-drag");
      if(moved){ var b = nearest(); if(b){ var r = b.getBoundingClientRect(), sr = strip.getBoundingClientRect(); strip.scrollBy({left: r.left + r.width / 2 - (sr.left + sr.width / 2), behavior: "smooth"}); } } });
    strip.addEventListener("click", function(e){ if(moved){ e.stopImmediatePropagation(); moved = false; } }, true);
    box.querySelector(".lb__groups").addEventListener("click", function(e){ var b = e.target.closest(".lb__g"); if(b) lbJump(+b.getAttribute("data-g"), 0); });
    var im = box.querySelector(".lb__img"), stage = box.querySelector(".lb__stage");
    stage.addEventListener("click", function(e){ if(e.target === stage) lbClose(); });
    im.addEventListener("dblclick", function(){ box.classList.toggle("is-zoom"); });

    // the big photo follows the finger, then slides to the next / previous one
    var sx = 0, sy = 0, st = 0, dx = 0, dy = 0, drag = false, lastTap = 0, multi = false;
    stage.addEventListener("touchstart", function(e){
      multi = e.touches.length > 1; var p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); dx = dy = 0; drag = false;
    }, {passive: true});
    stage.addEventListener("touchmove", function(e){
      if(multi || box.classList.contains("is-zoom") || e.touches.length > 1) return;
      var p = e.touches[0]; dx = p.clientX - sx; dy = p.clientY - sy;
      if(!drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) drag = true;
      if(drag){ im.style.transition = "none"; im.style.transform = "translateX(" + dx + "px)"; im.style.opacity = String(Math.max(.35, 1 - Math.abs(dx) / 600)); }
      else if(dy > 0 && Math.abs(dy) > Math.abs(dx)){ im.style.transition = "none"; im.style.transform = "translateY(" + dy + "px)"; im.style.opacity = String(Math.max(.3, 1 - dy / 400)); }
    }, {passive: true});
    stage.addEventListener("touchend", function(){
      if(multi || box.classList.contains("is-zoom")){
        var n0 = Date.now(); if(!multi && n0 - lastTap < 300){ box.classList.remove("is-zoom"); lastTap = 0; } else lastTap = n0; return;
      }
      var now = Date.now();
      if(drag){
        if(Math.abs(dx) > 60 || (Math.abs(dx) > 25 && now - st < 250)){ lbGo((dx < 0) !== rtl ? 1 : -1); }
        else { im.style.transition = "transform .25s ease-out, opacity .25s"; im.style.transform = ""; im.style.opacity = ""; }
        return;
      }
      if(dy > 110 && Math.abs(dy) > Math.abs(dx)){ lbClose(); return; }
      if(dy > 0){ im.style.transition = "transform .25s ease-out, opacity .25s"; im.style.transform = ""; im.style.opacity = ""; }
      if(Math.abs(dx) < 10 && Math.abs(dy) < 10){
        if(now - lastTap < 300){ box.classList.toggle("is-zoom"); lastTap = 0; } else lastTap = now;
      }
    }, {passive: true});
    box.querySelector(".lb__x").focus({preventScroll: true});
  }
  document.addEventListener("click", function(e){
    var el = e.target.closest && e.target.closest("[data-lb]"); if(!el) return;
    e.preventDefault(); lbOpen(el);
  });
  document.addEventListener("keydown", function(e){
    if(!LB){ if((e.key === "Enter" || e.key === " ") && e.target.getAttribute && e.target.getAttribute("data-lb")){ e.preventDefault(); lbOpen(e.target); } return; }
    var rtl = lang === "ar";
    if(e.key === "Escape") lbClose();
    else if(e.key === "ArrowRight") lbGo(rtl ? -1 : 1);
    else if(e.key === "ArrowLeft") lbGo(rtl ? 1 : -1);
    else if(e.key === "ArrowDown" && LB.groups.length > 1) lbJump((LB.g + 1) % LB.groups.length, 0);
    else if(e.key === "ArrowUp" && LB.groups.length > 1) lbJump((LB.g - 1 + LB.groups.length) % LB.groups.length, 0);
  });
  window.addEventListener("popstate", function(){ if(LB) lbClose(true); });

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
    renderNav();
    bindMenu();
    bindLoyalty();
    paintMenu();
    reveal();
    if(location.hash && !render.jumped){ render.jumped = true; var el = document.getElementById(location.hash.slice(1)); if(el) el.scrollIntoView(); }
  }

  /* ---------------- floating bar ----------------
     One glass bar, as wide as the screen, that follows you down the page.
     · Outside the menu it lists the page sections (Home, About, Menu …).
     · Inside the menu it turns into the menu's own sections (drinks, bakery …)
       with a 🏠 button first — tap it and the page sections come back.
     A soft pill glides under whichever item you're on. */
  var NAV = [["top","home"],["about","about"],["menu","menu"],["space","space"],["loyalty","loyalty"],["delivery","delivery"],["visit","visit"]];
  var ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.8 9v10.2h12.4V9"/><path d="M10 19.2v-5.4h4v5.4"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>';
  var NB = {mode: "sec", force: false, forceY: 0, sec: "", cat: "", lock: 0};
  function renderNav(){
    var bar = $("#secbar");
    var have = NAV.filter(function(n){ return n[0] === "top" || document.getElementById(n[0]); });
    $("#secchips").innerHTML = have.map(function(n){
      return '<a class="chip" href="#' + (n[0] === "top" ? "" : n[0]) + '" data-sec="' + n[0] + '">' + esc(t(n[1])) + '</a>';
    }).join("");
    $("#chips").innerHTML = (S.categories || []).filter(function(c){ return (S.items || []).some(function(i){ return i.c === c.id; }); })
      .map(function(c){ return '<a class="chip" href="#c-' + esc(c.id) + '" data-cat="' + esc(c.id) + '">' + esc(L(c, "name")) + '</a>'; }).join("");
    var hb = $("#sbhome"); hb.innerHTML = ICON_HOME; hb.setAttribute("aria-label", t("sections")); hb.title = t("sections");
    var sb = $("#sbsearch"); sb.innerHTML = ICON_SEARCH; sb.setAttribute("aria-label", t("search")); sb.title = t("search");
    bar.setAttribute("aria-label", lang === "ar" ? "التنقل في الصفحة" : "Page navigation");
    $("#nav").innerHTML = ""; $("#drawer").innerHTML = "";
    NB.sec = NB.cat = ""; navSpy(true);
  }
  function track(){ return NB.mode === "menu" ? $("#chips") : $("#secchips"); }
  function glide(instant){
    var bar = $("#secbar"), g = $("#sbglide"), tr = track(), on = tr && tr.querySelector(".chip.is-on");
    if(!g) return;
    if(!on){ g.style.opacity = "0"; return; }
    var inr = $(".secbar__in").getBoundingClientRect(), r = on.getBoundingClientRect(), tb = tr.getBoundingClientRect();
    var l = Math.max(r.left, tb.left - 6), w = Math.min(r.right, tb.right + 6) - l;
    if(w < 8){ g.style.opacity = "0"; return; }
    if(instant) g.style.transition = "none";
    g.style.opacity = "1"; g.style.width = w + "px"; g.style.transform = "translateX(" + (l - inr.left) + "px)";
    if(instant){ void g.offsetWidth; g.style.transition = ""; }
  }
  function centre(tr, el, smooth){
    var r = el.getBoundingClientRect(), br = tr.getBoundingClientRect();
    var d = r.left + r.width / 2 - (br.left + br.width / 2);
    if(Math.abs(d) > 2){ try{ tr.scrollBy({left: d, behavior: smooth ? "smooth" : "auto"}); }catch(x){ tr.scrollLeft += d; } }
  }
  function mark(tr, attr, id, smooth){
    var on = null;
    $$(".chip", tr).forEach(function(c){ var m = c.getAttribute(attr) === id; c.classList.toggle("is-on", m); if(m){ on = c; c.setAttribute("aria-current", "true"); } else c.removeAttribute("aria-current"); });
    if(on) centre(tr, on, smooth);
  }
  function setMode(m){
    if(NB.mode === m) return; NB.mode = m;
    var bar = $("#secbar"); bar.classList.toggle("is-menu", m === "menu");
    requestAnimationFrame(function(){ glide(true); });
    clearTimeout(setMode.t); setMode.t = setTimeout(function(){ glide(); }, 430);   // after the 🏠 button finishes growing / shrinking
  }
  function navSpy(now){
    var bar = $("#secbar"); if(!bar || !S) return;
    var topH = $("#top").offsetHeight, bh = bar.offsetHeight || 64, line = topH + bh + 28;
    var menu = $("#menu"), inMenu = false;
    if(menu){ var r = menu.getBoundingClientRect(); inMenu = r.top <= topH + bh + 8 && r.bottom > line + 60; }
    if(!inMenu) NB.force = false;
    if(NB.force && Math.abs(scrollY - NB.forceY) > 700) NB.force = false;
    setMode(inMenu && !NB.force ? "menu" : "sec");
    // page section under the bar
    var cur = "top";
    NAV.forEach(function(n){ var el = n[0] !== "top" && document.getElementById(n[0]); if(el && el.getBoundingClientRect().top <= line) cur = n[0]; });
    if(innerHeight + scrollY >= document.documentElement.scrollHeight - 4 && document.getElementById("visit")) cur = "visit";
    if(cur !== NB.sec){ NB.sec = cur; mark($("#secchips"), "data-sec", cur, !now); }
    // menu section under the bar
    if(Date.now() > NB.lock){
      var cat = "";
      $$("#menu-list .mcat").forEach(function(el){ if(el.getBoundingClientRect().top <= line + 10) cat = el.id.slice(2); });
      if(!cat){ var f = $("#menu-list .mcat"); if(f) cat = f.id.slice(2); }
      if(cat !== NB.cat){ NB.cat = cat; mark($("#chips"), "data-cat", cat, !now); }
    }
    glide(now);
  }
  function goCat(id){
    var el = document.getElementById("c-" + id); if(!el) return;
    NB.cat = id; NB.lock = Date.now() + 900; NB.force = false;
    mark($("#chips"), "data-cat", id, true); setMode("menu"); glide();
    var bar = $("#secbar"), off = $("#top").offsetHeight + (bar.offsetHeight || 64) + 14;
    scrollTo({top: el.getBoundingClientRect().top + scrollY - off, behavior: "smooth"});
  }
  var spyRaf = 0;
  addEventListener("scroll", function(){
    if(document.hidden){ navSpy(); return; }
    if(!spyRaf) spyRaf = requestAnimationFrame(function(){ spyRaf = 0; navSpy(); });
  }, {passive: true});
  addEventListener("resize", function(){ navSpy(true); });
  function wireBar(){
    ["#secchips", "#chips"].forEach(function(sel){ $(sel).addEventListener("scroll", function(){ glide(true); }, {passive: true}); });
    $("#sbhome").addEventListener("click", function(){ NB.force = true; NB.forceY = scrollY; setMode("sec"); var on = $("#secchips .chip.is-on"); if(on) centre($("#secchips"), on, false); glide(true); });
    $("#sbsearch").addEventListener("click", function(){
      var box = $("#menu .search"), input = $("#q"); if(!box) return;
      var off = $("#top").offsetHeight + ($("#secbar").offsetHeight || 64) + 20;
      scrollTo({top: box.getBoundingClientRect().top + scrollY - off, behavior: "smooth"});
      setTimeout(function(){ try{ input.focus({preventScroll: true}); }catch(x){ input.focus(); } }, 450);
    });
    $("#secbar").addEventListener("click", function(e){
      var a = e.target.closest(".chip"); if(!a) return;
      var sec = a.getAttribute("data-sec"), cat = a.getAttribute("data-cat");
      if(cat){ e.preventDefault(); goCat(cat); return; }
      if(sec === "top"){ e.preventDefault(); scrollTo({top: 0, behavior: "smooth"}); try{ history.replaceState(null, "", location.pathname + location.search); }catch(x){} return; }
      if(sec === "menu"){
        var m = $("#menu").getBoundingClientRect(), topH = $("#top").offsetHeight;
        if(m.top <= topH + 90 && m.bottom > innerHeight / 2){ e.preventDefault(); NB.force = false; setMode("menu"); glide(true); return; }
      }
    });
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
    return '<section class="sec" id="menu" style="padding-top:clamp(56px,8vw,100px)"><div class="wrap">'
      + head(t("menuK"), t("menuT"))
      + '<div class="menu-bar"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      + '<input id="q" type="search" autocomplete="off" placeholder="' + esc(t("search")) + '" aria-label="' + esc(t("search")) + '" value="' + esc(q) + '"></label></div></div>'
      + '<div class="wrap" id="menu-list"></div></section>';
  }

  function paintMenu(){
    var box = $("#menu-list"); if(!box) return;
    var nq = norm(q), out = "";
    (S.categories || []).forEach(function(c){
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
          + (pic ? '<div class="mi__img" data-lb="menu" data-id="' + esc(i.id) + '" role="button" tabindex="0" aria-label="' + esc(t("zoom") + " — " + L(i, "name")) + '">' + img(i.images[0], L(i, "name")) + (i.images.filter(src).length > 1 ? '<span class="mi__more">' + numAr(i.images.filter(src).length) + '</span>' : "") + '</div>' : "")
          + '<div class="mi__name">' + esc(L(i, "name")) + (a.ok ? "" : '<span class="mi__note">' + esc(a.note) + '</span>') + '</div>'
          + money(i.price)
          + (L(i, "desc") ? '<p class="mi__desc">' + esc(L(i, "desc")) + '</p>' : "")
          + '</div>';
      });
      out += '</div></div>';
    });
    box.innerHTML = out || '<p class="empty">' + esc(t("nores")) + '</p>';
    $$("#chips .chip").forEach(function(c){ c.hidden = !document.getElementById("c-" + c.getAttribute("data-cat")); });
    NB.cat = ""; if(S) navSpy(true);
  }

  function bindMenu(){
    var input = $("#q");
    if(input) input.addEventListener("input", function(){ q = input.value; paintMenu(); });
    $$("[data-jump]").forEach(function(a){
      a.addEventListener("click", function(e){ var id = a.getAttribute("data-jump"); if(document.getElementById("c-" + id)){ e.preventDefault(); goCat(id); } });
    });
  }

  function secSpace(home){
    var sp = home.space || []; if(!sp.length) return "";
    return '<section class="sec sec--paper" id="space"><div class="wrap reveal">' + head(t("spaceK"), t("spaceT"))
      + '<div class="space">' + sp.map(function(s){
          return '<figure data-lb="space" data-cap="' + esc(L(s)) + '" role="button" tabindex="0">' + img(s.img, L(s)) + '<figcaption>' + esc(L(s)) + '</figcaption></figure>'; }).join("")
      + '</div></div></section>';
  }

  function secGallery(home){
    var g = (home.gallery || []).filter(function(x){ return src(x.img); }); if(!g.length) return "";
    return '<section class="sec"><div class="wrap reveal">' + head(t("galK"), t("galT"))
      + '<div class="gal">' + g.map(function(x){
          return '<figure><div class="ph" data-lb="gal" data-cap="' + esc(L(x)) + '" role="button" tabindex="0">' + img(x.img, L(x)) + '</div><figcaption>' + esc(L(x)) + '</figcaption></figure>'; }).join("")
      + '</div></div></section>';
  }

  /* ---------------- loyalty ----------------
     The pressio stamp card (same layout as the real wallet card) in frosted glass
     over soft glowing light. When it scrolls into view the cups are "stamped" one
     by one; tap the card to add a stamp yourself — the fifth unlocks the free drink. */
  function secLoyalty(loy){
    if(!loy || !loy.title) return "";
    var full = loy.stamp_full || "stamp-full", empty = loy.stamp_empty || "stamp-empty", stamps = "";
    for(var i = 0; i < 5; i++) stamps += '<span class="lst" data-n="' + (i + 1) + '">' + img(empty, "", "lst__e") + img(full, "", "lst__f") + '</span>';
    var steps = (loy.steps || []).map(function(s, n){
      return '<div class="step"><i>' + numAr(n + 1) + '</i><div><b>' + esc(L(s)) + '</b><span>' + esc(s["d" + lang] || s.den || "") + '</span></div></div>';
    }).join("");
    var cta = loy.url ? '<a class="btn btn--light" href="' + esc(loy.url) + '" target="_blank" rel="noopener">' + esc(L(loy.cta)) + '<span aria-hidden="true">' + (lang === "ar" ? "←" : "→") + '</span></a>' : "";
    var qr = loy.qr ? '<span class="loy__qr"><img class="qr" src="' + esc(loy.qr) + '" alt="QR" width="72" height="72" loading="lazy"></span>' : "";
    return '<section class="sec sec--ink loy-sec" id="loyalty"><div class="loy__lights" aria-hidden="true"><i></i><i></i><i></i></div><div class="wrap loy reveal">'
      + '<div class="loy__copy"><p class="kicker">' + esc(t("loyK")) + '</p><h2 class="h2">' + esc(L(loy.title)) + '</h2>'
      + '<p class="lede">' + esc(L(loy.body)) + '</p>'
      + '<div class="steps">' + steps + '</div></div>'
      + '<div class="loy__side">'
      +   '<div class="lcard" id="lcard" role="button" tabindex="0" aria-label="' + esc(t("tryCard")) + '">'
      +     '<i class="lcard__shine" aria-hidden="true"></i>'
      +     '<span class="logo" aria-hidden="true"></span>'
      +     '<div class="lcard__stamps">' + stamps + '</div>'
      +     '<small class="lcard__cap" data-cap="' + esc(L(loy.scan)) + '">' + esc(L(loy.scan)) + '</small>'
      +   '</div>'
      +   '<p class="lcard__try"><span class="dot"></span>' + esc(t("tryCard")) + '</p>'
      +   '<div class="loy__cta">' + cta + qr + '</div>'
      + '</div></div></section>';
  }
  function bindLoyalty(){
    var card = $("#lcard"); if(!card) return;
    var n = 0, busy = 0, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function paint(){
      $$(".lst[data-n]", card).forEach(function(el){ el.classList.toggle("is-full", +el.getAttribute("data-n") <= n); });
      card.classList.toggle("is-won", n >= 5);
      var cap = $(".lcard__cap", card); cap.textContent = n >= 5 ? t("won") : cap.getAttribute("data-cap");
    }
    function fillTo(k, step){
      clearInterval(busy); busy = setInterval(function(){ if(n >= k){ clearInterval(busy); return; } n++; paint(); }, step || 260);
    }
    paint();
    if(reduce || !("IntersectionObserver" in window)){ n = 3; paint(); }
    else {
      var io = new IntersectionObserver(function(en){ if(en[0].isIntersecting){ io.disconnect(); setTimeout(function(){ fillTo(3, 320); }, 350); } }, {threshold: .55});
      io.observe(card);
    }
    function tap(){ clearInterval(busy); if(n >= 5){ n = 0; paint(); setTimeout(function(){ n = 1; paint(); }, 180); } else { n++; paint(); } }
    card.addEventListener("click", tap);
    card.addEventListener("keydown", function(e){ if(e.key === "Enter" || e.key === " "){ e.preventDefault(); tap(); } });
    // gentle 3D tilt + light that follows the pointer (mouse / pen only)
    card.addEventListener("pointermove", function(e){
      if(e.pointerType === "touch" || reduce) return;
      var r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", (x * 100) + "%"); card.style.setProperty("--my", (y * 100) + "%");
      card.style.transform = "perspective(900px) rotateX(" + ((.5 - y) * 8).toFixed(2) + "deg) rotateY(" + ((x - .5) * 10).toFixed(2) + "deg)";
    });
    card.addEventListener("pointerleave", function(){ card.style.transform = ""; });
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
    wireBar();
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
