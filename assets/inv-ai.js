/* pressio — invoice auto-fill.
   Reads an invoice photo or PDF right here in the browser and guesses the supplier,
   invoice number, date, total and category. Nothing is sent anywhere:
   · PDFs with real text are read directly (pdf.js).
   · Photos / scanned PDFs are read with Tesseract.js — a free, open-source
     text-recognition AI that runs on this device (Arabic + English).
   The person uploading always checks the fields before sending. */
(function () {
  "use strict";
  var TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFW = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  function load(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]') && (src === TESS ? window.Tesseract : window.pdfjsLib)) return res();
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error("load")); };
      document.head.appendChild(s);
    });
  }

  /* ---------- text normalising ---------- */
  var AR_DIG = "٠١٢٣٤٥٦٧٨٩", FA_DIG = "۰۱۲۳۴۵۶۷۸۹";
  function normDigits(s) {
    return String(s || "").replace(/[٠-٩]/g, function (d) { return AR_DIG.indexOf(d); })
      .replace(/[۰-۹]/g, function (d) { return FA_DIG.indexOf(d); })
      .replace(/٫/g, ".").replace(/٬/g, ",").replace(/‏|‎|؜/g, "");
  }
  function normAr(s) { return normDigits(s).replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي"); }
  function low(s) { return normDigits(s).toLowerCase().replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim(); }

  /* ---------- amounts ---------- */
  function amounts(line) {
    var out = [], m, re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,3}))?/g, s = normDigits(line);
    while ((m = re.exec(s))) {
      var whole = m[1].replace(/,/g, ""), dec = m[2] || "";
      if (whole.length > 7) continue;                       // phone numbers, TRNs …
      var v = Number(whole + (dec ? "." + dec : ""));
      if (isFinite(v)) out.push({ v: v, dec: !!dec, i: m.index });
    }
    return out;
  }

  var BAD_TOTAL = /sub\s*-?\s*total|excl|before|w\/o|without|discount|qty|quantity|no\.? of|items?\b|units?\b|paid|cash|change|tender|rounding|قبل|خصم|كميه|الكميه|عدد|المدفوع|الباقي|نقدا/;
  var TAX_WORD = /\bvat\b|\btax\b|ضريبه|القيمه المضافه/;
  var TAX_OK = /incl|including|inc\.|with vat|شامل|مع الضريبه|بعد الضريبه/;
  var STRONG = /grand\s*total|total\s*amount|net\s*(amount|total|payable)|amount\s*(due|payable)|total\s*(due|payable)|balance\s*due|invoice\s*total|total\s*\(?aed|total\s*incl|الاجمالي|المجموع الكلي|المبلغ الاجمالي|اجمالي المبلغ|الصافي|صافي|المبلغ المستحق|المستحق|الاجمالي شامل/;
  var WEAK = /\btotal\b|المجموع|مجموع|اجمالي/;

  function findTotal(lines) {
    var best = null;
    lines.forEach(function (raw, k) {
      var l = low(raw), score = 0;
      if (STRONG.test(l)) score = 3; else if (WEAK.test(l)) score = 2; else return;
      if (BAD_TOTAL.test(l) && !/grand|الاجمالي|net/.test(l)) return;
      if (TAX_WORD.test(l) && !TAX_OK.test(l) && !/grand|net|الصافي|المستحق/.test(l)) return;
      var a = amounts(raw).filter(function (x) { return x.v > 0 && !(x.v <= 100 && /%/.test(raw.slice(x.i, x.i + 8))); });
      if (!a.length && lines[k + 1]) a = amounts(lines[k + 1]);
      if (!a.length) return;
      var pick = a.filter(function (x) { return x.dec; }); pick = (pick.length ? pick : a)[(pick.length ? pick : a).length - 1];
      if (TAX_OK.test(l)) score += .5;
      if (!best || score > best.score || (score === best.score && pick.v > best.v)) best = { v: pick.v, score: score, line: raw };
    });
    if (best) return best;
    // fallback: the biggest money-looking number next to AED / درهم
    lines.forEach(function (raw) {
      if (!/aed|dhs?\b|درهم|د\.?\s?ا/i.test(low(raw))) return;
      amounts(raw).forEach(function (x) { if (x.dec && x.v < 1e6 && (!best || x.v > best.v)) best = { v: x.v, score: 1, line: raw }; });
    });
    return best;
  }

  /* ---------- dates ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7, "اغسطس": 8, "سبتمبر": 9, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12 };
  function mk(y, m, d) {
    y = +y; m = +m; d = +d; if (y < 100) y += 2000;
    var now = new Date();
    if (y < 2015 || y > now.getFullYear() + 1 || m < 1 || m > 12 || d < 1 || d > 31) return "";
    var dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return "";
    return dt.toISOString().slice(0, 10);
  }
  function datesIn(line) {
    var s = low(line), out = [], m, re;
    re = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g;
    while ((m = re.exec(s))) out.push(mk(m[1], m[2], m[3]));
    re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/g;
    while ((m = re.exec(s))) {
      var a = +m[1], b = +m[2];
      out.push(b > 12 && a <= 12 ? mk(m[3], a, b) : mk(m[3], b, a));   // UAE: day / month / year
    }
    re = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.,]*([a-z]{3,9}|[؀-ۿ]{4,7})[\s\-\/.,]*(\d{4})\b/g;
    while ((m = re.exec(s))) { var k = MON[m[2]] || MON[m[2].slice(0, 3)]; if (k) out.push(mk(m[3], k, m[1])); }
    re = /\b([a-z]{3,9})[\s.]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
    while ((m = re.exec(s))) { var k2 = MON[m[1]] || MON[m[1].slice(0, 3)]; if (k2) out.push(mk(m[3], k2, m[2])); }
    return out.filter(Boolean);
  }
  function findDate(lines) {
    var tagged = null, first = null;
    var SKIP = /due|expir|valid|استحقاق|انتهاء|delivery date|تاريخ التسليم/;
    lines.forEach(function (raw, k) {
      var l = low(raw), cut = l.search(SKIP);
      if (cut === 0) return;
      if (cut > 0) { l = l.slice(0, cut); raw = l; }       // "Bill date 01/09 · Due date 21/09" → keep the first part
      var ds = datesIn(raw);
      if (!ds.length && /date|تاريخ/.test(l) && lines[k + 1]) ds = datesIn(lines[k + 1]);
      if (!ds.length) return;
      if (!tagged && /date|dated|تاريخ/.test(l)) tagged = ds[0];
      if (!first) first = ds[0];
    });
    return tagged || first || "";
  }

  /* ---------- invoice number ---------- */
  var NO_KEY = /(?:tax\s*)?(?:invoice|inv|bill|receipt|voucher|document|doc|order|ref)\s*(?:no|number|num|#|n°)?\.?\s*[:#\-]?\s*|رقم\s*(?:الفاتوره|الايصال|السند|المستند|الطلب)?\s*[:#\-]?\s*|فاتوره\s*(?:رقم|ضريبيه\s*رقم)\s*[:#\-]?\s*/i;
  function cleanNo(tok) { return tok.replace(/^[#:.\-\s]+|[.,:;\s]+$/g, ""); }
  function goodNo(tok) {
    if (!tok || tok.length < 2 || tok.length > 24 || !/\d/.test(tok)) return false;
    if (/^100\d{12}$/.test(tok)) return false;                          // TRN
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(tok)) return false; // a date
    if (/^(05|\+?971)\d{7,}/.test(tok)) return false;                    // phone
    return true;
  }
  function findNo(lines) {
    for (var k = 0; k < lines.length; k++) {
      var raw = normAr(lines[k]), l = low(raw);
      if (!/(invoice|inv\b|inv\.|bill|receipt|voucher|document|doc\b|ref)\s*(no|number|num|#|n°)|رقم الفاتوره|رقم الايصال|فاتوره رقم|رقم السند|invoice\s*#|^\s*no\.?\s*[:#]/.test(l)) continue;
      if (/trn|tax registration|الرقم الضريبي|تسجيل ضريبي|p\.?o\.?\s*box|ص\.?\s*ب|tel|phone|mobile|هاتف/.test(l)) continue;
      var after = raw.replace(new RegExp("^[\\s\\S]*?(?:" + NO_KEY.source + ")", "i"), "");
      var toks = (after.match(/[A-Za-z0-9][A-Za-z0-9\-\/]{1,23}/g) || []).map(cleanNo).filter(goodNo);
      if (!toks.length && lines[k + 1]) toks = (normDigits(lines[k + 1]).match(/[A-Za-z0-9][A-Za-z0-9\-\/]{1,23}/g) || []).map(cleanNo).filter(goodNo);
      if (toks.length) return toks[0];
    }
    return "";
  }

  /* ---------- supplier ---------- */
  var ME = /pressio|بريسيو|بريسو/;
  var CO = /l\.?\s?l\.?\s?c\b|trading|\best\b|establishment|foodstuff|food\s*stuff|company|\bco\.|\bfze\b|fzco|fz-llc|group|bakery|bakeries|dairy|roaster|supplies|supply|industries|factory|ذ\.?\s?م\.?\s?م|شركه|مؤسسه|تجاره|للتجاره|مصنع|مخبز|مخابز|للمواد|مجموعه/;
  var NOT_NAME = /invoice|فاتوره|receipt|ايصال|\btax\b|ضريبي|date|تاريخ|\btrn\b|tel\b|phone|mobile|fax|هاتف|جوال|www\.|@|p\.?o\.?\s*box|ص\.?\s*ب|bill to|sold to|ship to|customer|client|العميل|المشتري|السيد|page\s*\d|original|copy|نسخه|cashier|table/;
  function tidyName(s) {
    return normDigits(s).replace(/[|_*=~"“”<>]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–—:.,]+|[\s\-–—:.,]+$/g, "").slice(0, 70);
  }
  function findSupplier(lines, known) {
    var text = " " + low(lines.join(" ")).replace(/[.\-_,]/g, " ").replace(/\s+/g, " ") + " ", best = "";
    (known || []).forEach(function (name) {
      var n = low(name).replace(/[.\-_,]/g, " ").replace(/\s+/g, " ").trim();
      if (n.length >= 3 && text.indexOf(" " + n + " ") >= 0 && n.length > low(best).length) best = name;
    });
    if (best) return { name: best, known: true };
    var head = lines.slice(0, 14);
    for (var i = 0; i < head.length; i++) {
      var l = low(head[i]);
      if (ME.test(l) || NOT_NAME.test(l)) continue;
      if (CO.test(l) && (l.match(/[a-z؀-ۿ]/g) || []).length >= 4) return { name: tidyName(head[i]), known: false };
    }
    for (var j = 0; j < Math.min(6, head.length); j++) {
      var t = low(head[j]), letters = (t.match(/[a-z؀-ۿ]/g) || []).length;
      if (letters >= 4 && letters / Math.max(1, t.replace(/\s/g, "").length) > .6 && !ME.test(t) && !NOT_NAME.test(t)) return { name: tidyName(head[j]), known: false };
    }
    return { name: "", known: false };
  }

  /* ---------- category ---------- */
  var CATS = [
    ["ops", /dewa|etisalat|\bdu\b|electric|internet|rent|cleaning|laundry|gas\b|pest|salik|كهرباء|انترنت|ايجار|تنظيف|غاز|اتصالات/],
    ["drinks", /milk|dairy|laban|juice|water|soda|syrup|monin|oat|almond|حليب|البان|لبن|عصير|مياه|شراب|سيرب/],
    ["raw", /coffee|beans|roast|espresso|arabica|cocoa|matcha|tea\b|sugar|flour|cream|قهوه|بن\b|حبوب|محمص|كاكاو|ماتشا|شاي|سكر|طحين|كريمه/],
    ["bakery", /bakery|bakeries|bread|croissant|pastry|cake|cookies|مخبز|مخابز|خبز|كرواسون|معجنات|كيك|حلويات/],
    ["packaging", /cups?\b|lids?\b|straw|sleeve|packaging|napkin|tissue|bags?\b|box(es)?\b|container|اكواب|كاسات|اغطيه|تغليف|مناديل|اكياس|علب/],
    ["maint", /repair|maintenance|service call|spare|technician|machine service|صيانه|تصليح|قطع غيار|فني/]
  ];
  function guessCat(text) { var l = low(text); for (var i = 0; i < CATS.length; i++) if (CATS[i][1].test(l)) return CATS[i][0]; return ""; }

  function findTRN(text) { var m = normDigits(text).replace(/[\s\-]/g, "").match(/100\d{12}/); return m ? m[0] : ""; }

  /* ---------- everything together ---------- */
  function parse(text, known) {
    var lines = normDigits(text).split(/\r?\n/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(function (s) { return s.length > 1; });
    var sup = findSupplier(lines, known && known.names), tot = findTotal(lines);
    var cat = sup.known && known.catOf ? known.catOf[sup.name] || "" : "";
    return {
      supplier: sup.name, supplierKnown: sup.known,
      invoice_no: findNo(lines),
      invoice_date: findDate(lines),
      total: tot ? Math.round(tot.v * 100) / 100 : null,
      category: cat || guessCat(text),
      trn: findTRN(text),
      lines: lines.length
    };
  }

  /* ---------- reading the file ---------- */
  function fileToCanvas(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var max = 2400, sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        if (Math.max(im.naturalWidth, im.naturalHeight) < 1200) sc = Math.min(2, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(clean(c));
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("image")); };
      im.src = url;
    });
  }
  // greyscale + stretch the contrast: phone photos of paper read much better
  function clean(c) {
    try {
      var x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height), p = d.data, lo = 255, hi = 0, i, g, hist = new Array(256).fill(0);
      for (i = 0; i < p.length; i += 4) { g = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = g; hist[g]++; }
      var n = p.length / 4, acc = 0; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * .01) { lo = i; break; } }
      acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * .05) { hi = i; break; } }
      var span = Math.max(40, hi - lo);
      for (i = 0; i < p.length; i += 4) { g = Math.max(0, Math.min(255, (p[i] - lo) * 255 / span)); p[i] = p[i + 1] = p[i + 2] = g; }
      x.putImageData(d, 0, 0);
    } catch (e) { /* tainted or huge — use as is */ }
    return c;
  }
  function pdfLines(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5], x = it.transform[4], r = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) < 3) { r = rows[i]; break; }
      if (!r) { r = { y: y, parts: [] }; rows.push(r); }
      r.parts.push({ x: x, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) { return r.parts.sort(function (a, b) { return a.x - b.x; }).map(function (p) { return p.s; }).join(" "); }).join("\n");
  }
  async function pdfToTextOrCanvas(file, step) {
    step("pdf", 0);
    await load(PDFJS); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFW;
    var pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, page = await pdf.getPage(1);
    var tc = await page.getTextContent(), text = pdfLines(tc.items);
    if (text.replace(/\s/g, "").length > 40) return { text: text };
    var vp = page.getViewport({ scale: 2.4 }), c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    return { canvas: clean(c) };
  }
  async function ocr(canvas, step) {
    step("engine", 0);
    await load(TESS);
    var worker = await window.Tesseract.createWorker(["eng", "ara"], 1, {
      logger: function (m) {
        if (m.status === "recognizing text") step("read", m.progress || 0);
        else if (/load|initializ/.test(m.status || "")) step("engine", m.progress || 0);
      }
    });
    try {
      var r = await worker.recognize(canvas);
      return r.data.text || "";
    } finally { worker.terminate(); }
  }
  /* read(file, known, step) → {fields, text}
     step(stage, 0..1) reports progress: "pdf" | "engine" | "read" | "parse" */
  async function read(file, known, step) {
    step = step || function () {};
    var text = "";
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name || "")) {
      var r = await pdfToTextOrCanvas(file, step);
      text = r.text != null ? r.text : await ocr(r.canvas, step);
    } else {
      text = await ocr(await fileToCanvas(file), step);
    }
    step("parse", 1);
    return { fields: parse(text, known), text: text };
  }

  /* prepare(file) → {mime, data(base64)} small enough to send to the server reader.
     Photos are shrunk to ~1800px JPEG (keeps handwriting sharp, ~300 KB). */
  function b64(buf) {
    var bin = "", bytes = new Uint8Array(buf), i, step = 0x8000;
    for (i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }
  async function prepare(file) {
    var isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || "");
    if (isPdf) {
      if (file.size > 6.4e6) throw new Error("size");
      return { mime: "application/pdf", data: b64(await file.arrayBuffer()) };
    }
    try {
      var c = await new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () {
          var sc = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
          var cv = document.createElement("canvas"); cv.width = Math.round(im.naturalWidth * sc); cv.height = Math.round(im.naturalHeight * sc);
          var x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url); res(cv);
        };
        im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("image")); };
        im.src = url;
      });
      var url = c.toDataURL("image/jpeg", 0.86);
      return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
    } catch (e) {
      // e.g. iPhone HEIC the browser can't draw: send it as it is
      if (file.size > 6.4e6) throw new Error("size");
      var m = (file.type || "").toLowerCase();
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(m)) throw new Error("type");
      return { mime: m, data: b64(await file.arrayBuffer()) };
    }
  }

  window.PressioInvoiceAI = { read: read, parse: parse, prepare: prepare, _t: { amounts: amounts, datesIn: datesIn, findNo: findNo, findTotal: findTotal, findSupplier: findSupplier, guessCat: guessCat } };
})();
