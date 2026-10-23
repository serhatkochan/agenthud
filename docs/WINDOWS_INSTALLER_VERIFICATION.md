# Windows kurulum paketi, v0.10.1

23 Ekim 2026.

- `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml`: 33 test başarılı.
- `cargo build --release --offline --locked --manifest-path src-tauri/Cargo.toml`: başarılı.
- Yeni Win32 testi gerçek, görünmez bir pencere oluşturur; görev çubuğu stilini, × alanını, pencerenin yok edilmesini ve kapanış mesajını doğrular. Eski görev çubuğu stili ve eski kapatma davranışı ayrı ayrı geri konduğunda testin başarısız olduğu görüldü.
- NSIS 3.13, UTF-8 kaynakla kurulumu oluşturdu. Yönetici yetkisi istemeyen mevcut kullanıcı kurulumu; masaüstü / Başlat menüsü kısayolları ve Windows kaldırma kaydı içerir.
- `scripts/test-installer.ps1`: payload SHA-256 eşleşmesi, iki kısayolun hedefi ve çalışma klasörü, sürüm / kaldırma kayıtları, açık uygulamanın üzerine kurulum ve kaldırma koruması, kaldırma temizliği başarılı. Test kısayolları çalışma alanına, kayıtlar geçici bir anahtara yönlendirildi; kullanıcının masaüstüne kurulum yapılmadı.
- Kurulum: 2.093.282 bayt. Uygulama: 5.227.008 bayt. SHA-256 değerleri sürümdeki `SHA256SUMS.txt` dosyasında.
- Son çalışan uygulama ölçümleri: üç örnekte 27,4 MB çalışma kümesi, 5,4 MB özel bellek. Başlangıçtaki yalıtılmış testte 17,7 MB / 4,4 MB ölçüldü. Bu değerler sabit üst sınır değildir.
- Canlı kota kontrolü: Cursor 2 ve Codex 1 ölçümle bağlı; Antigravity bu cihazda `error` döndürdü. Sağlayıcı okuma kodu bu sürümde değiştirilmedi.

Pencere stili [Windows dokümantasyonundaki WS_EX_TOOLWINDOW](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles) davranışını kullanır. Kurulum kısayolları [NSIS CreateShortCut](https://nsis.sourceforge.io/Reference/CreateShortCut) ile oluşturulur.
