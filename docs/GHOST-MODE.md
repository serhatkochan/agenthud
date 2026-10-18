# Hayalet modu · Rust + Tauri

Rust `ghost.rs` yalnızca etkileşim durumunu yönetir. `app.rs` Windows giriş bilgisini ve Tauri pencere işlemlerini bağlar.

- Ayarlardan açılınca 48 piksel çubuğa geçilir. Kota alanı tıklamaları arkaya iletir; maskotun alanı etkileşime açıktır. Panel açıkken tıklama geçişi kapalıdır.
- Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar. Alt bırakılınca önceki çubuk konumuna dönülür. Ctrl + Alt, AltGr olabileceği için tetiklemez.
- Normal görünüm, tepsi veya geri çağırma kısayolu hayalet modunu kapatır. Açılışta kapalıdır. Kısayol kaydedilemezse etkinleştirilemez.
- Gizli veya küçültülmüş pencerede giriş konumu okunmaz. Açık modda 40 ms kontrol yapılır; diğer durumlarda hızlı döngü yalnızca kapalı ayarı kontrol eder. Yazılan karakterler izlenmez veya saklanmaz.
- Rust, maskotun bildirdiği sonlu dikdörtgeni en fazla 80 × 48 piksel ve ilk 100 piksel içinde doğrular. Windows fiziksel koordinatları pencere ölçeğiyle arayüz koordinatlarına çevrilir.
- Windows bilgisi veya pencere işlemi başarısız olursa etkileşim açılır ve panel geri çağrılır.

Pencere özellikleri okunurken Ghost kilidi tutulmaz: Tauri ana iş parçacığına dönen çağrı, aynı kilidi isteyen IPC'yi bekletmemelidir. Gerçek WebView2 testinde yakalanan eşzamanlı kilitlenme bu sınırla düzeltildi.

Kanıt: `ghost.rs` durum/konum testleri, `scripts/verify-tauri.mjs` ile gerçek `WS_EX_TRANSPARENT`, sabitleme, görünüm ve geri çağırma kontrolleri. 18 Ekim'de kullanıcı çalışan Tauri penceresinde Alt basılıyken panelin açıldığını ve bırakınca çubuğa döndüğünü doğruladı. Ctrl + Shift + H gerçek Windows girdisiyle hayalet modunu kapatıp paneli geri çağırdı. Fare aracının ilk maskot tıklaması hedef doğrulamasında alttaki Chrome'u gördüğü için uygulanmadı; bu deneme başarılı maskot tıklaması olarak kaydedilmez. Önceki Electron fiziksel testleri Tauri sürümüne kanıt sayılmaz.

Kaynaklar: [Tauri Window API](https://docs.rs/tauri/latest/tauri/window/struct.Window.html), [GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate), [GetCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorpos).
