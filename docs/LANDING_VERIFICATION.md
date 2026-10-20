# Tanıtım sayfası kontrolü

20 Ekim 2026. Kapsam: `site/` ve `README.md`. Windows uygulamasının kaynak kodu ve bağımlılıkları değiştirilmedi.

## Gerçek veriler

- GitHub son sürümü: **v0.9.0**. `AgentHUD.exe`: **5.205.504 bayt**.
- İndirme bağlantısı yönlendirmeleriyle birlikte **HTTP 200**, `application/octet-stream` döndürdü.
- Kaynak kodu, sürümler ve geliştirici bağlantıları **HTTP 200** döndürdü.
- Çalışan uygulamanın ilk ölçümü: **21,8 MB çalışma kümesi**, **5,0 MB özel bellek**. Sayfa ve README yaklaşık 22 MB / 5 MB olarak, tarih ve ölçüm türüyle belirtir. Bu bir üst sınır değildir.

## Tarayıcı kontrolleri

Chrome, gerçek yerel sayfa:

| Kontrol | Sonuç |
| --- | --- |
| 320, 375, 768, 1024, 1440 px | Yatay taşma yok; ada önizlemesi kapsayıcısında kalıyor. |
| Açık / koyu masaüstü | Zemin ve `aria-pressed` birlikte değişiyor. |
| Ada taşıma | Fareyle sürükleme ve ok tuşları çalışıyor. Konum önizleme alanıyla sınırlı. |
| Dört soru-cevap | Tıklamayla açılıyor; Enter ile kapanıyor. |
| Bölüm bağlantısı | `Neler gösterir?` mevcut `#limitler` bölümüne gidiyor. |
| Mobil görünüm | Başlık, önizleme ve açılmış bellek açıklaması görsel olarak kontrol edildi. |
| Tarayıcı hataları | Kontrol edilen yerel oturumda hata / uyarı yok. |
| JavaScript sözdizimi | `node --check site/site.js` başarılı. |
| Yama biçimi | `git diff --check` başarılı. |

Önizleme değerleri açıkça örnek olarak etiketlidir. Görseller gerçek tarayıcıda çalışan bu web önizlemesinden kaydedildi; Windows uygulamasının ekran görüntüsü olarak sunulmaz.

- `site/assets/preview.jpg`: README görseli.
- `site/assets/social.jpg`: 1200 × 630 bağlantı paylaşım görseli.

Sayfa statik HTML / CSS ve küçük bir JavaScript dosyasıdır. Harici yazı tipi, analiz betiği veya yeni paket bağımlılığı eklenmedi.
