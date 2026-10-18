# Rust + Tauri geçişi

18 Ekim 2026. Kullanıcının son yönlendirmesi: Claude entegrasyonu şimdilik iptal; masaüstü çekirdeği Rust ve Tauri olacak. Antigravity'nin kendi yanıtındaki Claude/GPT model grubu, Antigravity kotası olarak korunur.

## Sıra ve kabul

1. React arayüzünü Tauri IPC'ye bağla; bağımsız Claude kartını, girişini ve durum bağlantısını kaldır.
2. Cursor, Antigravity ve Codex okuyucularını Rust'a taşı. Gerçek hesap yanıtlarını karşılaştır; sıfır ve eksik ölçümleri koru.
3. Rust tarafında Windows süreç/port, oturum, Cursor gözlemcisi ve native odaklanmayı bağla. Komut/cwd ve PID kimliği sınırlarını koru.
4. Tauri pencere, tepsi, kısayol, sabitleme, hayalet modu ve ayarları bağla. Mevcut ayarları oku; kullanıcı oturum dosyalarına ve açık uygulamalara müdahale etme.
5. Rust testleri, üretim derlemesi, gerçek WebView2 ekran/tıklama kontrolleri ve Windows paketi. Yeni sürüm Electron veya Node yan süreç çalıştırmayacak.

Geri dönüş: önceki Electron 0.6.0 sürümü Git'te `091173b` ve `release/` altında korunur. Yeni sürüm ayrı dalda geliştirilir. Hesap verileri taşınmaz; mevcut araçların yerel girişleri salt okunur kullanılır. Hayalet modu açılışta kapalıdır.

## Modül sınırları

- `providers.rs`: HTTP, SQLite ve kota ayrıştırma. `read_provider(id, &Inventory) -> Value`; `read_antigravity_sessions(&Inventory) -> Vec<Value>`.
- `system.rs`, `ports.rs`, `sessions.rs`, `cursor_tracker.rs`: yerel keşif ve gözlem. `Inventory`, `ProcessInfo`, `Listener` ortak modellerdir.
- `focus.rs`: Windows pencere kimliği ve seçim. `FocusService::request(&Value, Option<&str>, &[ProcessInfo]) -> Value`.
- Uygulama kabuğu: sadece doğrulanmış komutlar; renderer'a token, çerez, süreç komutu veya HWND gönderilmez.

Resmî başlangıç kaynakları: [Tauri + Vite](https://v2.tauri.app/start/frontend/vite/), [kısayollar](https://v2.tauri.app/plugin/global-shortcut/), [sistem tepsisi](https://v2.tauri.app/learn/system-tray/).

## Son inceleme

Bağımsız incelemede eski uygulamanın tek örnek davranışının eksik olduğu bulundu. Resmî [Tauri single-instance eklentisi](https://v2.tauri.app/plugin/single-instance/) ilk eklenti olarak eklendi; tekrar açılış mevcut paneli geri çağırır. Ayrı profil verilmiş testlerde uygulama kimliği mutlak profil yolunun SHA256 özetiyle ayrılır; normal kimlik korunur. Düzeltmeden önce gerçek ikinci açılış testi başarısız oldu. Son kontrol kaydı `VERIFICATION.md` içindedir.
