/* =========================================================
   Firebase yapılandırması
   ------------------------------------------------------------
   Bu dosya boş bırakılırsa cihazlar arası senkron KAPALI kalır.
   Uygulama yine tam çalışır: kayıt tarayıcıda tutulur ve
   "başka cihazda devam et" linki ile paylaşılabilir.

   Bulut senkronunu açmak için:
   1) https://console.firebase.google.com adresine gir, yeni proje oluştur
   2) Sol menü -> Build -> Firestore Database -> Create database
      (Production mode, istediğin yeri seç, Start)
   3) Proje ayarları (⚙) -> "Your apps" -> Web simgesi (</>) -> app kaydet
   4) Aşağıdaki `config` nesnesini kopyalayıp aşağıya yapıştır
   ========================================================== */

export const FIREBASE_CONFIG = null;

/* Örnek (yukarıdaki satırı yorumdan çıkarıp bununla değiştir):
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "sevgilimin-kitabi.firebaseapp.com",
  projectId: "sevgilimin-kitabi",
  storageBucket: "sevgilimin-kitabi.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456",
};
*/
