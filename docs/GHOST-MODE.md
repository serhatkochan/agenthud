# Hayalet modu · Tauri 0.7.0

Rust `ghost.rs` yalnızca etkileşim durumunu yönetir. `app.rs` Windows giriş bilgisini ve Tauri pencere işlemlerini bağlar.

- Ayarlardan açılınca 48 piksel çubuğa geçilir. Kota alanı tıklamaları arkaya iletir; maskotun alanı etkileşime açıktır. Panel açıkken tıklama geçişi kapalıdır.
- Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar. Alt bırakılınca önceki çubuk konumuna dönülür. Ctrl + Alt, AltGr olabileceği için tetiklemez.
- Normal görünüm, tepsi veya geri çağırma kısayolu hayalet modunu kapatır. Açılışta kapalıdır. Kısayol kaydedilemezse etkinleştirilemez.
- Gizli veya küçültülmüş pencerede giriş konumu okunmaz. Açık modda 40 ms kontrol yapılır; diğer durumlarda hızlı döngü yalnızca kapalı ayarı kontrol eder. Yazılan karakterler izlenmez veya saklanmaz.
- Rust, maskotun bildirdiği sonlu dikdörtgeni en fazla 80 × 48 piksel ve ilk 100 piksel içinde doğrular. Windows fiziksel koordinatları pencere ölçeğiyle arayüz koordinatlarına çevrilir.
- Windows bilgisi veya pencere işlemi başarısız olursa etkileşim açılır ve panel geri çağrılır.

Pencere özellikleri okunurken Ghost kilidi tutulmaz: Tauri ana iş parçacığına dönen çağrı, aynı kilidi isteyen IPC'yi bekletmemelidir. Gerçek WebView2 testinde yakalanan eşzamanlı kilitlenme bu sınırla düzeltildi.

Kanıt: `ghost.rs` durum/konum testleri, `scripts/verify-tauri.mjs` ile gerçek `WS_EX_TRANSPARENT`, sabitleme, görünüm ve geri çağırma kontrolleri. Alt basılı tutma geçişi mantık testlerinde kapsanır; fiziksel klavyede basılı tutma kabulü ayrıca yapılmalıdır. Önceki Electron fiziksel testleri yeni Tauri sürümüne kanıt sayılmaz.

Kaynaklar: [Tauri Window API](https://docs.rs/tauri/latest/tauri/window/struct.Window.html), [GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate), [GetCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorpos).
