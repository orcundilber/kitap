/* =========================================================
   Kaldığı yer kaydı — 3 katman
   ------------------------------------------------------------
   1) LINK  : adres çubuğundaki #s=420  -> her cihazda çalışır, kurulum yok
   2) BULUT : Firebase Firestore       -> otomatik, cihazlar arası (opsiyonel)
   3) YEREL : localStorage            -> her zaman açık, offline çalışır
   ========================================================= */

import { FIREBASE_CONFIG } from "./firebase-config.js";

const KEY = "sevgilimin-kitabi:v1";
const CDOC = "position"; // Firestore belgesi adı

/* ---------- 1) YEREL ---------- */
export function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function writeLocal(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readLocal(), ...patch }));
    return true;
  } catch {
    return false;
  }
}

/* ---------- 2) LINK (#s=420) ---------- */
export function pageFromHash() {
  const m = /(?:^|[#&?])s=(\d{1,4})/.exec(location.hash + location.search);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/** adres çubuğu her zaman okunan sayfayı göstersin (kopyalanabilir olsun) */
export function writeHash(page) {
  const h = `#s=${page}`;
  if (location.hash === h) return;
  history.replaceState(null, "", location.pathname + location.search + h);
}

export function resumeLink(page = readLocal().page || 1) {
  return `${location.origin}${location.pathname}#s=${page}`;
}

/** bilinçli sıfırlama: yerel + link + bulut birlikte temizlenir */
export async function clearPosition() {
  writeLocal({ page: 1, updatedAt: Date.now() });
  history.replaceState(null, "", location.pathname + location.search);
  if (cloudEnabled()) await pushPage(1);
}

/* ---------- 3) BULUT (Firebase) ---------- */
const cloud = {
  enabled: false,
  ready: false,
  loading: null,
  lastError: "",
  lastSync: 0,
};

export function cloudEnabled() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.projectId);
}

async function initCloud() {
  if (!cloudEnabled()) return null;
  if (cloud.loading) return cloud.loading;

  cloud.loading = (async () => {
    try {
      const [appMod, fsMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      cloud.db = fsMod.getFirestore(app);
      cloud.fs = fsMod;
      cloud.ready = true;
      return cloud.db;
    } catch (err) {
      cloud.lastError = "buluta bağlanılamadı";
      console.warn("[sync] Firebase yüklenemedi:", err);
      return null;
    }
  })();

  return cloud.loading;
}

/** buluttan kayıtlı sayfayı getir; yoksa null */
export async function pullPage() {
  const db = await initCloud();
  if (!db) return null;
  try {
    const snap = await cloud.fs.getDoc(cloud.fs.doc(db, CDOC));
    cloud.lastSync = Date.now();
    if (!snap.exists()) return null;
    const page = Number(snap.data()?.page);
    return page > 0 ? page : null;
  } catch (err) {
    cloud.lastError = "bulut okunamadı";
    console.warn("[sync] okuma hatası:", err);
    return null;
  }
}

export async function pushPage(page) {
  const db = await initCloud();
  if (!db) return false;
  try {
    await cloud.fs.setDoc(
      cloud.fs.doc(db, CDOC),
      { page, at: Date.now() },
      { merge: true }
    );
    cloud.lastSync = Date.now();
    cloud.lastError = "";
    return true;
  } catch (err) {
    cloud.lastError = "buluta yazılamadı";
    console.warn("[sync] yazma hatası:", err);
    return false;
  }
}

/* ---------- birleştirilmiş arayüz ---------- */
/**
 * Kaydedilecek sayfa: yerel + link + (varsa) bulut
 * Bulut yazımı geciktirilir (frekans sınırı + yazma gecikmesi)
 */
export function savePage(page, { cloud: useCloud = true } = {}) {
  writeLocal({ page, updatedAt: Date.now() });
  writeHash(page);
  if (useCloud && cloudEnabled()) queueCloud(page);
}

let cloudTimer = null;
let cloudLastAt = 0;
let pending = null;

function queueCloud(page) {
  pending = page;
  const since = Date.now() - cloudLastAt;
  const wait = since > 5000 ? 0 : Math.max(0, 5000 - since); // en fazla ~5 sn'de bir yaz
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const p = pending;
    pending = null;
    cloudLastAt = Date.now();
    pushPage(p);
  }, wait);
}

/** sayfa kapanırken bekleyen bulut yazımını hemen gönder */
export function flush() {
  if (pending == null) return;
  clearTimeout(cloudTimer);
  const p = pending;
  pending = null;
  pushPage(p);
}
