# Değişiklikler

## 0.10.1 · 23 Ekim 2026

- Windows kurulum EXE’si eklendi. Kurulum mevcut kullanıcıya yapılır; masaüstü ve Başlat menüsü kısayolları ile Windows uygulama kaldırma kaydı oluşturur.
- Ada görev çubuğunda ve Alt+Tab listesinde yer kaplamaz. × pencereyi yok eder ve uygulamayı tamamen kapatır; kapanış, arka plandaki kota sorgusunu beklemez.
- Site ve README indirme düğmeleri doğrudan kurulum EXE’sini indirir. Taşınabilir EXE ayrıca sürüm dosyalarında bulunur.
- Paketleme, kısayol hedefleri, dosya bütünlüğü ve kaldırma temizliği için yalıtılmış kurulum testi eklendi.

## 0.10.0 · 20 Ekim 2026

- Uygulama yatay özetle açılır. AgentHUD başlığındaki + bütün limitleri gösterir; − yeniden küçültür. Sağlayıcı başlıklarındaki C/A harf kutuları kaldırıldı.
- Codex varsa 5 saatlik, yoksa haftalık limiti gösterir. Cursor özeti Cursor Models havuzunu kullanır. Antigravity’de Gemini, Argon ve Other Models ayrı kalır.
- Bir grubun haftalık hakkı bitmişse, yatay özette o grubun kalan hakkı %0 görünür. Devre dışı veya eksik ölçümler kullanılabilir hak olarak sunulmaz.
- Saydam ada, pencere boyutlandırma, ekran sınırları ve yazı çizimi güncellendi. Space / Enter görünümü değiştirir; Escape bütün limitleri açar.
- Web önizlemesi ve README iki görünümü, seçim kurallarını ve güncel boyut / bellek ölçümlerini açıklar.

## 0.9.0 · 20 Ekim 2026

- Arayüz doğrudan Rust ve Windows API ile çizilen şeffaf bir kota adasına taşındı. Çalışma sırasında WebView2, Electron veya Node gerekmez.
- Codex, Cursor ve Antigravity’nin ayrı kullanım havuzları masaüstünde gösterilir; ölçümler 60 saniyede bir yenilenir.
- Windows 10 / 11 x64 için kurulum gerektirmeyen tek EXE yayınlandı.

## 0.8.0 · 18 Ekim 2026

- Kullanıcı isteğiyle Ajanlar sekmesi, oturum durumu taraması, Cursor gözlemcisi ve pencereye odaklanma kaldırıldı. Kota radarı ve Yerel portlar kaldı.
- Önceden etkinleştirilen AgentHUD Cursor gözlemcisi, diğer kancalar korunarak kaldırıldı.
- Kullanılmayan Rust/React modülleri, test yardımcıları ve belgeler temizlendi. Portların IDE/proje ilişkisi korundu.
- İki sekmeli arayüz ve ajan alanlarını taşımayan veri sözleşmesi için doğrulamalar güncellendi. Bağımsız Claude entegrasyonu kapalı kalır.

## 0.7.0 · 18 Ekim 2026

- Masaüstü çekirdeği Rust + Tauri 2'ye taşındı. Electron, Node çalışma ortamı ve Koffi bağımlılıkları kaldırıldı; React arayüzü Windows WebView2 kullanıyor.
- Bağımsız Claude kotası, giriş ve durum takibi kaldırıldı. Cursor, Antigravity ve Codex gerçek yerel oturumlarla çalışıyor; Antigravity'nin kendi Claude/GPT grubu korunuyor.
- Kota okuyucuları, süreç kimliğiyle güvenli port yönetimi, Cursor gözlemcisi, yerel oturumlar ve pencereye odaklanma Rust modüllerine taşındı.
- Tepsi, geri çağırma kısayolu, 48 piksel çubuk, sabitleme, hayalet modu ve ayarlar Tauri'ye bağlandı. Pencere geçişindeki eşzamanlı kilitlenme gerçek Windows testinde bulunup düzeltildi.
- Tek örnek koruması eklendi; ikinci açılış gizli mevcut paneli geri getirir. Ayrı test profilleri normal uygulamadan ayrılır.
- Windows NSIS yükleyicisi ve doğrudan çalıştırılabilir EXE üretimi eklendi. Son doğrulama kapsamı `docs/VERIFICATION.md` içinde.
