/* =========================================================
   Sevgilimin Kitaplığı
   - Giriş ekranı -> kitap atlası (kapak) -> pdf.js okuyucu
   - Okuma konumu localStorage'a otomatik kaydedilir
   ========================================================= */

import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import {
  readLocal,
  writeLocal,
  pageFromHash,
  writeHash,
  resumeLink,
  savePage,
  pullPage,
  flush,
  clearPosition,
  cloudEnabled,
} from "./sync.js";

/* ---------- AYARLAR (kitap değiştirmek istersen burayı düzenle) ---------- */
const CONFIG = {
  pdfUrl: "./ecinniler.pdf",
  title: "Ecinniler",
  author: "Fyodor Mihayloviç Dostoyevski",
  storageKey: "sevgilimin-kitabi:v1",
  cacheSize: 6,
  zoomSteps: [1, 1.25, 1.5, 1.75, 2, 2.5, 3],
  endText:
    "Kitabın sonuna geldin. Umarım bu satırlar seni biraz güldürmüş, biraz da düşündürmüştür. " +
    "Seninle birlikte okuduğumuz her sayfayı sakladım.",
};
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const el = {
  screens: {
    gate: $("screen-gate"),
    cover: $("screen-cover"),
    reader: $("screen-reader"),
    end: $("screen-end"),
  },
  gateBtn: $("gateBtn"),
  book: $("book"),
  btnStart: $("btnStart"),
  btnRestart: $("btnRestart"),
  coverAsk: $("coverAsk"),
  coverProgress: $("coverProgress"),
  topbarSub: $("topbarSub"),
  savedPill: $("savedPill"),
  savedPillText: $("savedPillText"),
  progressBar: $("progressBar"),
  viewer: $("viewer"),
  viewerLoading: $("viewerLoading"),
  loadLabel: $("loadLabel"),
  loadPct: $("loadPct"),
  loadBar: $("loadBar"),
  pageWrap: $("pageWrap"),
  canvas: $("pageCanvas"),
  viewerEmpty: $("viewerEmpty"),
  pageInput: $("pageInput"),
  pageTotal: $("pageTotal"),
  btnPrev: $("btnPrev"),
  btnNext: $("btnNext"),
  btnZoomIn: $("btnZoomIn"),
  btnZoomOut: $("btnZoomOut"),
  btnFit: $("btnFit"),
  zoomVal: $("zoomVal"),
  btnShelf: $("btnShelf"),
  btnInfo: $("btnInfo"),
  edgePrev: $("edgePrev"),
  edgeNext: $("edgeNext"),
  infoSheet: $("infoSheet"),
  infoNote: $("infoNote"),
  syncLink: $("syncLink"),
  syncCloud: $("syncCloud"),
  btnCopyLink: $("btnCopyLink"),
  btnForget: $("btnForget"),
  endText: $("endText"),
  btnAgain: $("btnAgain"),
  btnBackToRead: $("btnBackToRead"),
  toast: $("toast"),
};

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../vendor/pdfjs/pdf.worker.min.mjs",
  import.meta.url
).href;

/* ---------- durum ---------- */
const state = {
  doc: null,
  numPages: 0,
  page: 1,
  startPage: 1,    // bu açılışta nereden başlanacak
  cloudPage: 0,    // buluttan gelen kayıt (0 = henüz gelmedi)
  zoom: 1,         // 1 = sayfaya sığdır
  zoomIndex: 0,
  renderTask: null,
  sessionActive: false, // bu oturumda okuyucu açıldı mı?
  firstOpen: true,
};

const cache = new Map(); // pageNumber -> canvas

/* ---------- yardımcılar ---------- */
function showScreen(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.toggle("is-active", key === name);
  }
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ms = 2200) {
  el.toast.textContent = msg;
  el.toast.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("is-show"), ms);
}

const nf = new Intl.NumberFormat("tr-TR");
const pageLabel = (n) => nf.format(n);

/* ---------- metin kopyalama (paylaşım için) ---------- */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* aşağıdaki yedek yola düş */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** bilgi panelini aç: bağlantı + senkron durumu hazırla */
function openInfoSheet() {
  el.syncLink.value = resumeLink(state.page);

  if (cloudEnabled()) {
    el.syncCloud.hidden = false;
    el.syncCloud.classList.add("is-on");
    el.syncCloud.textContent = "Bulut senkronu açık — okuduğun sayfa tüm cihazlarında otomatik hatırlanır.";
  } else {
    el.syncCloud.hidden = false;
    el.syncCloud.classList.remove("is-on");
    el.syncCloud.textContent = "Otomatik bulut senkronu kapalı. Şimdilik yukarıdaki bağlantıyı kullanabilirsin.";
  }
  el.infoSheet.hidden = false;
}

/* ---------- uçan kalpler ---------- */
function spawnHearts(container, count = 16) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const h = document.createElement("i");
    const size = 8 + Math.random() * 18;
    h.style.left = Math.random() * 100 + "%";
    h.style.fontSize = size + "px";
    h.style.animationDuration = 9 + Math.random() * 12 + "s";
    h.style.animationDelay = -Math.random() * 16 + "s";
    h.style.color = Math.random() > 0.55 ? "#d8b978" : "#c85a70";
    frag.appendChild(h);
  }
  container.appendChild(frag);
}

/* =========================================================
   1) GİRİŞ EKRANI — sadece tıkla
   ========================================================= */
function initGate() {
  const enter = () => {
    writeLocal({ lastEntry: Date.now() });
    openCover();
  };

  el.gateBtn.addEventListener("click", enter);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && el.screens.gate.classList.contains("is-active")) enter();
  });

  spawnHearts($("hearts"), 18);
}

/* =========================================================
   2) ATLAS / KAPAK — "baştan mı, kaldığı yerden mi?"
   ========================================================= */
function refreshCoverMeta() {
  const { page, from } = resolveResumePage();
  const hasProgress = page > 1;

  el.coverAsk.hidden = !hasProgress;
  el.btnRestart.hidden = !hasProgress;

  if (hasProgress) {
    const kaynak =
      from === "cloud" ? "Bulutta kayıtlı yerin" : from === "link" ? "Bağlantıdaki yerin" : "Son bıraktığın yer";
    el.coverProgress.innerHTML = `${kaynak} <b>${pageLabel(page)}. sayfa</b>.`;
    el.btnStart.textContent = "Kaldığın Yerden Devam Et";
  } else {
    el.coverProgress.textContent = "";
    el.btnStart.textContent = "Okumaya Başla";
  }
}

function openCover() {
  refreshCoverMeta();
  showScreen("cover");
  el.book.focus({ preventScroll: true });
}

/** @param {number|null} page  null = kayıtlı yerden (link > bulut > yerel) */
function openBook(page = null) {
  state.startPage = Math.max(1, page ?? resolveResumePage().page);

  const stage = el.book.closest(".cover-stage");
  stage.classList.add("is-opening");
  el.book.classList.add("is-opening");
  el.screens.cover.classList.add("is-opening");

  setTimeout(() => {
    stage.classList.remove("is-opening");
    el.book.classList.remove("is-opening");
    el.screens.cover.classList.remove("is-opening");
    enterReader();
  }, 620);
}

function initCover() {
  // kitaba tıklamak / Enter -> kayıtlı yerden
  el.book.addEventListener("click", () => openBook());
  el.book.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openBook();
    }
  });

  el.btnStart.addEventListener("click", () => openBook());
  el.btnRestart.addEventListener("click", () => openBook(1));
}

/* =========================================================
   3) PDF YÜKLEME
   ------------------------------------------------------------
   PDF'i kendimiz fetch ile indiriyoruz ki yüzde GERÇEK olsun.
   (pdf.js aralık istekleri kullandığı için kendi onProgress'i
    belge hazır olunca 100'e atlamıyor, 30-40%'de takılı kalıyordu.)
   Aynı anda tek indirme: arka plan ön yüklemesi + okuyucu aynı isteği paylaşır.
   ========================================================= */
let docPromise = null;

/** content-length bilinen tek seferlik indirme, gerçek yüzde bildirir */
async function downloadPdf(onProgress) {
  const res = await fetch(CONFIG.pdfUrl);
  if (!res.ok) throw new Error(`PDF indirilemedi (${res.status})`);

  const total = Number(res.headers.get("content-length")) || 0;
  const chunks = [];
  let loaded = 0;

  if (res.body && total > 0) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(Math.round((loaded / total) * 100));
    }
  } else {
    // stream yoksa (eski tarayıcı) tek parça al
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    loaded = buf.length;
  }

  onProgress(100);

  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

async function loadDocument() {
  if (state.doc) return state.doc;
  if (docPromise) return docPromise;

  docPromise = (async () => {
    const data = await downloadPdf(setLoadPercent);
    const doc = await pdfjsLib.getDocument({
      data,
      cMapUrl: "vendor/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "vendor/pdfjs/standard_fonts/",
    }).promise;

    state.doc = doc;
    state.numPages = doc.numPages;
    return doc;
  })();

  try {
    return await docPromise;
  } catch (err) {
    docPromise = null; // başarısız: tekrar denenebilsin
    throw err;
  }
}

async function preloadInBackground() {
  try {
    await loadDocument();
    toast("Kitap hazır");
  } catch (err) {
    console.error(err);
    toast("Kitap yüklenemedi. İnternet bağlantını kontrol et.");
  }
}

/* =========================================================
   OKUMA KONUMU KAYDI
   ------------------------------------------------------------
   Yazarken: link (#s=) + yerel + bulut
   Girişte: öncelik sırası  link > bulut > yerel
   ========================================================= */
function savePosition(page) {
  state.sessionActive = true;
  savePage(page);
}
function savePositionNow(page) {
  savePage(page);
}

/** girişte nereden devam edilecek sayfa */
function resolveResumePage() {
  const fromLink = pageFromHash();
  if (fromLink) return { page: fromLink, from: "link" };

  const local = Number(readLocal().page) || 0;
  if (state.cloudPage) {
    // bulut ile yerel çelişirse en büyüğünü al (kitabın ileriye gitmiş hali)
    return { page: Math.max(state.cloudPage, local) || state.cloudPage, from: "cloud" };
  }
  return { page: local || 1, from: "local" };
}

/* =========================================================
   4) SAYFA ÇİZİMİ
   ========================================================= */
function baseScale(page) {
  const vp0 = page.getViewport({ scale: 1 });
  const box = el.viewer.getBoundingClientRect();
  const padX = window.innerWidth <= 560 ? 16 : 28;
  const padY = 24;
  const availW = Math.max(120, box.width - padX);
  const availH = Math.max(120, box.height - padY);
  return Math.min(availW / vp0.width, availH / vp0.height);
}

function canvasSize(page) {
  const vp0 = page.getViewport({ scale: 1 });
  const scale = baseScale(page) * state.zoom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  return {
    scale: scale * dpr,
    cssWidth: Math.floor(vp0.width * scale),
    cssHeight: Math.floor(vp0.height * scale),
    dpr,
  };
}

function cachePut(pageNum, canvas, styleW, styleH) {
  canvas.styleW = styleW;
  canvas.styleH = styleH;
  cache.set(pageNum, canvas);
  while (cache.size > CONFIG.cacheSize) {
    cache.delete(cache.keys().next().value);
  }
}

/** önbellekteki sayfayı "en yeni" konuma taşı (LRU) */
function cacheTouch(pageNum) {
  const c = cache.get(pageNum);
  if (c) {
    cache.delete(pageNum);
    cache.set(pageNum, c);
  }
}

async function renderPage(pageNum, { direction = 0, silent = false } = {}) {
  if (!state.doc) return;

  const num = Math.min(Math.max(1, pageNum), state.numPages);
  state.page = num;

  if (state.renderTask) {
    try {
      state.renderTask.cancel();
    } catch {}
    state.renderTask = null;
  }

  const page = await state.doc.getPage(num);
  const { scale, cssWidth, cssHeight } = canvasSize(page);
  const viewport = page.getViewport({ scale });

  // çevirme efekti: canvas'a DOKUNMADAN önce yapılır, yoksa
  // canvas temizlendiği için animasyon boyunca siyah dikdörtgen görünür
  if (!silent && direction !== 0) await turnEffect(direction);

  // çizim başlayana kadar canvas'ı gizle (yeniden boyutlandırmak siyaha temizler)
  el.pageWrap.classList.remove("is-ready");
  el.pageWrap.classList.add("is-loading");

  const canvas = el.canvas;
  if (canvas.width !== Math.round(viewport.width) || canvas.height !== Math.round(viewport.height)) {
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
  }
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";

  const task = page.render({
    canvasContext: canvas.getContext("2d", { alpha: false }),
    viewport,
  });
  state.renderTask = task;

  try {
    await task.promise;
  } catch (err) {
    if (err?.name === "RenderingCancelledException") return;
    console.error(err);
    if (!silent) {
      toast("Sayfa çizilemedi, tekrar deneniyor…");
      await sleep(400);
      return renderPage(num, { direction: 0, silent: true });
    }
    return;
  } finally {
    if (state.renderTask === task) state.renderTask = null;
  }

  el.pageWrap.classList.remove("is-loading");
  el.pageWrap.classList.add("is-ready");
  el.viewerEmpty.hidden = true;
  el.viewerLoading.hidden = true;
  el.viewer.scrollTop = 0;

  // hizalama kontrol: canvas yüksekliği scorrerin yüksekliğinden büyükse aşağıdan başlasın
  const viewer = el.viewer;
  const wrap = el.pageWrap;
  if (wrap.clientHeight > viewer.clientHeight) {
    viewer.style.alignItems = "flex-start";
  } else {
    viewer.style.alignItems = "center";
  }

  updateChrome();
  savePosition(num);

  // bir sonraki sayfayı ısıt (geçiş anında donanım seferi azalır)
  if (num < state.numPages) {
    idle(() => {
      state.doc
        .getPage(num + 1)
        .then((p) => {
          const s = canvasSize(p);
          const vpNext = p.getViewport({ scale: s.scale });
          const off = document.createElement("canvas");
          off.width = Math.round(vpNext.width);
          off.height = Math.round(vpNext.height);
          return p
            .render({
              canvasContext: off.getContext("2d", { alpha: false }),
              viewport: vpNext,
            })
            .promise.then(() => cachePut(num + 1, off, s.cssWidth, s.cssHeight))
            .catch(() => {});
        })
        .catch(() => {});
    });
  }

  if (num === state.numPages && !state.firstOpen) {
    celebrate();
  }
  state.firstOpen = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** sayfa çevirme efekti — class her zaman kaldırılır, sayfa asla görünmez kalmaz */
async function turnEffect(direction) {
  el.pageWrap.style.setProperty("--turn", direction > 0 ? "18px" : "-18px");
  el.pageWrap.classList.add("is-turning");
  await sleep(150);
  el.pageWrap.classList.remove("is-turning");
}

function idle(fn) {
  if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 250);
}

/* ---------- arayüz güncelleme ---------- */
function updateChrome() {
  const { page, numPages } = state;
  el.pageInput.value = String(page);
  el.pageInput.max = String(numPages);
  el.pageTotal.textContent = numPages ? pageLabel(numPages) : "?";
  el.btnPrev.disabled = page <= 1;
  el.btnNext.disabled = page >= numPages;
  el.progressBar.style.width = numPages ? ((page / numPages) * 100).toFixed(2) + "%" : "0%";
  el.zoomVal.textContent = Math.round(state.zoom * 100) + "%";
  document.body.classList.toggle("is-zoomed", state.zoom > 1.01);

  el.savedPillText.textContent = `Sayfa ${pageLabel(page)}`;
  el.savedPill.classList.remove("is-flash");
  void el.savedPill.offsetWidth;
  el.savedPill.classList.add("is-flash");

  el.topbarSub.textContent = numPages ? `%${Math.round((page / numPages) * 100)} okundu` : "";
}

/* ---------- gezinme ---------- */

/** hazır önbellekten sayfayı ekrana bas; başarısızsa false döner */
function paintFromCache(target) {
  const cached = cache.get(target);
  if (!cached || !cached.width || !cached.styleW) return false;

  el.canvas.width = cached.width;
  el.canvas.height = cached.height;
  el.canvas.style.width = cached.styleW;
  el.canvas.style.height = cached.styleH;

  // canvas.width ataması içeriği temizler -> önbellekteki resmi gerçekten çiz
  el.canvas
    .getContext("2d", { alpha: false })
    .drawImage(cached, 0, 0, cached.width, cached.height);

  cacheTouch(target);
  state.page = target;
  el.pageWrap.classList.remove("is-loading");
  el.pageWrap.classList.add("is-ready");
  el.viewerEmpty.hidden = true;
  el.viewerLoading.hidden = true;
  el.viewer.scrollTop = 0;
  updateChrome();
  savePosition(target);
  return true;
}

async function goTo(pageNum, opts) {
  if (!state.doc) return;
  const target = Math.min(Math.max(1, pageNum), state.numPages);
  const direction = opts?.direction ?? (target > state.page ? 1 : target < state.page ? -1 : 0);

  if (cache.has(target)) {
    if (direction !== 0) await turnEffect(direction);
    if (paintFromCache(target)) return;
  }
  await renderPage(target, { direction });
}

const next = () => goTo(state.page + 1);
const prev = () => goTo(state.page - 1);

/* =========================================================
   5) OKUYUCU EKRANI
   ========================================================= */

/** yükleme yüzdesini güncelle (0-100) */
let lastPct = -1;
function setLoadPercent(pct) {
  if (!Number.isFinite(pct)) return;
  const p = Math.max(0, Math.min(100, pct));
  if (p === lastPct) return;
  lastPct = p;
  el.loadPct.textContent = `%${p}`;
  el.loadBar.style.width = p + "%";
}

function showLoading(text) {
  el.loadLabel.textContent = text;
  el.viewerLoading.hidden = false;
  el.viewerEmpty.hidden = false;
}

async function enterReader() {
  showScreen("reader");

  // kitap zaten ön yüklendiyse sahte yüzde gösterme, direkt sayfaya geç
  const wasReady = !!state.doc;
  if (!wasReady) {
    showLoading("Kitap açılıyor");
    setLoadPercent(0);
  }

  try {
    await loadDocument();
  } catch (err) {
    console.error(err);
    el.viewerLoading.hidden = true;
    el.viewerEmpty.hidden = false;
    el.loadLabel.textContent = "Kitap yüklenemedi. Sayfayı yenilemeyi dene.";
    el.loadPct.textContent = "";
    toast("Kitap yüklenemedi");
    return;
  }

  if (!wasReady) {
    // PDF bitti, şimdi ilk sayfa çiziliyor
    showLoading("Sayfa hazırlanıyor");
    setLoadPercent(100);
  }

  const start = Math.min(Math.max(1, state.startPage || 1), state.numPages);
  state.firstOpen = true;
  await goTo(start, { direction: 0 });
  if (start > 1) toast(`${pageLabel(start)}. sayfadan devam ediyorsun`);
}

function initReader() {
  el.btnPrev.addEventListener("click", prev);
  el.btnNext.addEventListener("click", next);
  el.edgePrev.addEventListener("click", prev);
  el.edgeNext.addEventListener("click", next);

  el.pageInput.addEventListener("change", () => {
    const n = parseInt(el.pageInput.value, 10);
    if (Number.isFinite(n)) goTo(n);
    else el.pageInput.value = String(state.page);
  });
  el.pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.pageInput.blur();
  });

  el.btnZoomIn.addEventListener("click", () => setZoom(state.zoomIndex + 1));
  el.btnZoomOut.addEventListener("click", () => setZoom(state.zoomIndex - 1));
  el.btnFit.addEventListener("click", () => setZoom(0));

  el.btnShelf.addEventListener("click", () => {
    savePositionNow(state.page);
    refreshCoverMeta();
    showScreen("cover");
  });

  el.btnInfo.addEventListener("click", () => {
    el.infoNote.textContent = `Kitap: ${CONFIG.title} — ${state.numPages} sayfa.`;
    openInfoSheet();
  });
  el.infoSheet.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) el.infoSheet.hidden = true;
  });

  // --- başka cihaza taşı ---
  el.btnCopyLink.addEventListener("click", async () => {
    const link = resumeLink(state.page);
    el.syncLink.value = link;
    const ok = await copyText(link);
    toast(ok ? "Bağlantı kopyalandı" : "Bağlantı kopyalanamadı — elle seçebilirsin");
  });
  el.syncLink.addEventListener("click", (e) => e.target.select());

  el.btnForget.addEventListener("click", async () => {
    await clearPosition();
    state.cloudPage = 0;
    toast("Okuma yeri sıfırlandı");
    el.infoSheet.hidden = true;
    goTo(1, { direction: 0 });
  });

  el.btnAgain.addEventListener("click", async () => {
    await clearPosition();
    state.cloudPage = 0;
    showScreen("reader");
    goTo(1, { direction: 0 });
  });
  el.btnBackToRead.addEventListener("click", () => {
    showScreen("reader");
    goTo(state.numPages - 1, { direction: -1 });
  });

  // klavye
  document.addEventListener("keydown", (e) => {
    if (!el.screens.reader.classList.contains("is-active")) return;
    if (e.target.matches("input, textarea")) return;
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ":
        e.preventDefault(); next(); break;
      case "ArrowLeft": case "PageUp":
        e.preventDefault(); prev(); break;
      case "Home": e.preventDefault(); goTo(1, { direction: -1 }); break;
      case "End": e.preventDefault(); goTo(state.numPages, { direction: 1 }); break;
      case "+": case "=": setZoom(state.zoomIndex + 1); break;
      case "-": case "_": setZoom(state.zoomIndex - 1); break;
      case "0": setZoom(0); break;
      case "Escape": el.infoSheet.hidden = true; break;
    }
  });

  // dokunmatik kaydırma
  let tx = 0, ty = 0, tt = 0;
  el.viewer.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    tx = t.clientX; ty = t.clientY; tt = Date.now();
  }, { passive: true });
  el.viewer.addEventListener("touchend", (e) => {
    if (!el.screens.reader.classList.contains("is-active")) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tx;
    const dy = t.clientY - ty;
    const dt = Date.now() - tt;
    if (dt < 700 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      dx < 0 ? next() : prev();
    }
  }, { passive: true });

  // boyut değişimi
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (el.screens.reader.classList.contains("is-active")) {
        cache.clear();
        renderPage(state.page, { silent: true });
      }
    }, 220);
  });

  // sekme kapanırken / arka plana geçerken kaydet
  // (okuyucu hiç açılmadıysa kaydı bozma)
  const persist = () => {
    if (state.sessionActive) savePositionNow(state.page);
    flush();
  };
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persist();
  });
  window.addEventListener("beforeunload", persist);
}

/* ---------- yakınlaştırma ---------- */
async function setZoom(index) {
  state.zoomIndex = Math.min(Math.max(0, index), CONFIG.zoomSteps.length - 1);
  state.zoom = CONFIG.zoomSteps[state.zoomIndex];
  if (!state.doc) return;
  cache.clear();
  await renderPage(state.page, { silent: true });
  el.zoomVal.textContent = Math.round(state.zoom * 100) + "%";
}

/* ---------- final ---------- */
function celebrate() {
  showScreen("end");
  el.endText.textContent = CONFIG.endText;
  const box = $("heartsEnd");
  box.replaceChildren();
  spawnHearts(box, 22);
  writeLocal({ page: state.numPages, finishedAt: Date.now() });
}

/* =========================================================
   BAŞLAT
   ========================================================= */
function boot() {
  document.title = `${CONFIG.title} — Sevgilimin Kitaplığı`;

  // tarayıcı konsolundan incelemek için (üretimde zararsız)
  window.__kit = { state, cache, CONFIG, goTo, pdfjsLib, renderPage, loadDocument };

  initGate();
  initCover();
  initReader();

  // kapak görseli yoksa yedek tasarıma düş
  const img = $("coverImg");
  img.addEventListener("error", () => {
    img.closest(".book-front")?.classList.add("is-blank");
  });

  // pdf'i giriş ekranında önden yükle
  preloadInBackground();

  // buluttaki kaydı çek; gelince kapak ekranını tazele
  if (cloudEnabled()) {
    pullPage()
      .then((page) => {
        if (page) {
          state.cloudPage = page;
          if (!pageFromHash()) refreshCoverMeta();
        }
      })
      .catch(() => {});
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
