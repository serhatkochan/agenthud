# Tanıtım sayfası kontrolü

20 Ekim 2026. Kapsam: güncel ada arayüzüne göre `site/`, `README.md`, görseller ve v0.10.0 sürüm bilgisi. Yeni uygulama bağımlılığı eklenmedi.

## Gerçek veriler

- Hazırlanan v0.10.0 `AgentHUD.exe`: **5.224.960 bayt**. Dosya boyutu 5,2 MB olarak gösterilir.
- SHA-256: `16ddd041a81f263bb2a62b1914e2424bc5c26bc9cfd4f88d52e67966fdd5ad9d`.
- Yeni derlemenin çalışan yatay görünümünde ilk ölçüm **19,3 MiB çalışma kümesi**, **4,4 MiB özel bellek**; sonraki ölçüm ondalık birimle **23,3 MB çalışma kümesi**, **5,3 MB özel bellek**. Sayfa ve README çalışma kümesini **20 ila 24 MB**, özel belleği yaklaşık **5 MB** olarak, tarih ve ölçüm türüyle belirtir. Bu bir üst sınır değildir.
- Yeni EXE’nin `--live-check` kontrolünde Cursor **2**, Antigravity **5**, Codex **1** kota ölçümü döndürdü. Üç bağlantı da `connected`; çıkış kodu 0.
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: **32 başarılı test**.
- `cargo build --release --offline --manifest-path src-tauri/Cargo.toml`: başarılı.

## Tarayıcı kontrolleri

Chrome, gerçek yerel sayfa:

| Kontrol | Sonuç |
| --- | --- |
| 320, 375, 768, 1024, 1440 px | Yatay taşma yok; ada önizlemesi kapsayıcısında kalıyor. |
| Açık / koyu masaüstü | Zemin ve `aria-pressed` birlikte değişiyor. |
| + / − | Yatay özet ve bütün limitler arasında geçiş yapıyor; başlıkta C/A harf kutuları bulunmuyor. |
| Yatay özet | Codex haftalık %54, Cursor Models %21, Gemini 5 saatlik %91, Argon haftalık %8, Other Models %0 örneği. Son grupta haftalık tükenme kuralı gösteriliyor. |
| Dar ekranda özet | Sayfa taşmıyor; yalnız özetin kendi içinde yatay kaydırma var. Yardım metni kaydırmayı açıklıyor. |
| Önizlemeyi kapat / aç | × adayı gizliyor, “Önizlemeyi aç” geri getiriyor. Odak görünür düğmeye taşınıyor. |
| Klavye | Space / Enter görünümü değiştiriyor; Escape bütün limitleri açıyor. Özet bölümü klavyeyle odaklanabiliyor. |
| Ada taşıma | Fareyle sürükleme ve ok tuşları çalışıyor. Konum önizleme alanıyla sınırlı. |
| Altı soru-cevap | Her biri tıklamayla açıldı; Enter ile kapandı. Claude hesabı ve Antigravity havuzu arasındaki ayrım açıklanıyor. |
| Bölüm bağlantısı | `Neler gösterir?` mevcut `#limitler` bölümüne gidiyor. |
| Mobil görünüm | Başlık, önizleme ve açılmış bellek açıklaması görsel olarak kontrol edildi. |
| Tarayıcı hataları | Kontrol edilen yerel oturumda hata / uyarı yok. |
| JavaScript sözdizimi | `node --check site/site.js` başarılı. |
| Yama biçimi | `git diff --check` başarılı. |

Önizleme değerleri açıkça örnek olarak etiketlidir. Görseller gerçek tarayıcıda çalışan bu web önizlemesinden kaydedildi; Windows uygulamasının ekran görüntüsü olarak sunulmaz.

- `site/assets/preview.jpg`: README görseli.
- `site/assets/compact.jpg`: beş ayrı grubun göründüğü yatay özet.
- `site/assets/social.jpg`: 1200 × 630 bağlantı paylaşım görseli.

Sayfa statik HTML / CSS ve küçük bir JavaScript dosyasıdır. Harici yazı tipi, analiz betiği veya yeni paket bağımlılığı eklenmedi.

## Teslim kontrolü

- İçerik PASS: seçim kuralları `quota_view.rs` ile karşılaştırıldı; yüzdeler örnek olarak etiketlendi. Gerçek hesap değerleri görsellere konmadı.
- Etkileşim PASS: iki görünüm, iki masaüstü rengi, taşıma, kapatıp açma, klavye ve altı soru-cevap gerçek Chrome oturumunda denendi.
- Yerleşim PASS: 320, 375, 768, 1024 ve 1440 pikselde iki görünüm de kapsayıcı içinde kaldı; sayfa yatay taşmadı.
- Görsel yön PASS: mevcut açık zemin, yeşil vurgu ve şeffaf ada korundu. Hareket yalnız taşıma, görünüm ve zemin seçimine bağlı. Yeni görseller çalışan web önizlemesinden alındı.
