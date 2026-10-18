# Hayalet modu

0.3.0, Windows. `GhostMode` yalnızca etkileşim durumunu yönetir; kota ve oturum bağlantılarına erişmez.

## Davranış

- Ayarlardan açıldığında küçük çubuğa geçer. Kota alanı tıklamaları arkaya iletir. Maskotun en az 44 × 44 piksel alanı etkileşime açık kalır.
- Maskot paneli kalıcı açar; panel küçültülünce tıklama geçişi sürer. Panel içindeki Kapat, normal görünüm, tepsi veya geri çağırma kısayolu hayalet modunu kapatır.
- Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar. Alt bırakıldığında çubuk önceki konumuna döner; ekran kenarındaki panel sınırlandırması çubuğun konumunu kaydırmaz.
- Ctrl + Alt, AltGr olabileceği için geçici panel sayılmaz. Yalnızca Alt ve Ctrl değiştirici durumları okunur; yazılan karakterler izlenmez veya kaydedilmez.
- Gizli veya küçültülmüş pencerede klavye/fare konumu okunmaz. Hayalet modu kapalıyken hızlı kontrol zamanlayıcısı çalışmaz. Windows giriş bilgisi okunamazsa hayalet modu kapanır ve pencere etkileşime döner.

## Sınırlar

Renderer, maskotun pencere içindeki dikdörtgenini dar bir IPC ile bildirir. Ana süreç sayısal değerleri ve en büyük alanı doğrular; tüm çubuğun tıklanabilir bölge olarak bildirilmesine izin vermez. Windows ekran noktası ve pencere sınırları Electron'ın aynı DIP koordinat sistemindedir. Tarayıcı önizlemesinde yerel giriş desteği yoktur.

`Ctrl + Shift + H` doluysa `Ctrl + Alt + H`, sonra `Ctrl + Shift + G` denenir. Hiçbiri kaydedilemezse hayalet modu etkinleştirilmez. Kullanılan kısayol arayüzde görünür; açılışta hayalet modu kapalıdır.

## Windows sabitlemesi

Electron 44.9.0 bağlamasında `setAlwaysOnTop` için varsayılan seviye `floating` olarak tanımlanır. Windows uygulaması bu ve bazı diğer seviyelerde pencereyi görev çubuğunun arkasına taşıyan yolu çalıştırır. Bu bilgisayarda görünüm değişiminden sonra `isAlwaysOnTop()` false döndü ve fiziksel araç pencere yerine Chrome'u gördü. `pop-up-menu` seviyesiyle bu yol devre dışı kaldı; gerçek pencere kontrolü ve sonraki fare denemesi geçti. Önceki sadece ayarı açma/kapama kontrolü bu geçişi kapsamıyordu.

Kaynaklar: [Electron 44.9.0 bağlaması](https://github.com/electron/electron/blob/v44.9.0/shell/browser/api/electron_api_base_window.cc), [Windows pencere uygulaması](https://github.com/electron/electron/blob/v44.9.0/shell/browser/native_window_views.cc), [tıklama geçişi API'si](https://github.com/electron/electron/blob/main/docs/tutorial/custom-window-interactions.md), [GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate), [Koffi Windows bağlaması](https://koffi.dev/start).

## Kanıt

`tests/ghost.test.mjs` durum geçişleri ve konum dönüşünü sınar. `scripts/verify-ghost.mjs` gerçek Windows pencere stilindeki tıklama geçişini, maskot bölgesini, ilk girdi öncesinde görünürlüğü ve görünüm değişiminden sonra sabitlemeyi kontrol eder. Fiziksel Windows aracıyla hayalet modu açıkken maskota tıklandı ve panel açıldı; Ctrl + Alt + H ile hayalet modunun kapandığı ana süreç güncellemesinde görüldü.

Fiziksel araç yalnızca kısa Alt basıp bırakma sunuyor. Bu denemede geçici panel gözlenmedi; basılı tutma davranışının fiziksel kabulü doğrulanmış sayılmıyor. Basılı tutma ve bırakma geçişleri mantık testleriyle, Windows tuş okuyucusunun yüklenmesi gerçek Electron sürecinde doğrulandı.
