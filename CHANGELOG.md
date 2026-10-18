# Değişiklikler

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
