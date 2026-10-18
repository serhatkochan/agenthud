# AgentHUD 0.8.0 · Doğrulama

18 Ekim 2026. Güncel kapsam yalnızca Kota radarı ve Yerel portlar. Ajan takibi ve bağımsız Claude entegrasyonu kullanıcının açık isteğiyle çıkarıldı.

## Güncel kaynak ve test

- `cargo test --manifest-path src-tauri/Cargo.toml`: **38 başarılı, 0 başarısız, 0 atlanan**. Derleme uyarısı yok.
- Ajan alanlarını içermeyen snapshot testi önce eski uygulamada `Removed agent field: sessions` ile başarısız oldu; kaldırma sonrası geçti.
- Oturum okuyucuları, Cursor gözlemcisi, pencereye odaklanma modülü, bunların IPC komutları, Antigravity trajectory isteği ve beş saniyelik tarama döngüsü silindi. İlgili React bileşenleri, stiller, test yardımcıları ve belgeler kaldırıldı.
- Cursor gözlemcisi silinmeden önce eski `CursorTracker::set_enabled(false)` ile kaldırıldı. Mevcut kancalar korunarak yedek alındı. Gerçek `~/.cursor/hooks.json` kontrolünde **AgentHUD gözlemci komutu 0**; dosyadaki diğer olay alanları korundu. Gizli komutlar rapora yazılmadı.
- Güncel Windows testinde yalnızca kendi TCP sunucusu kullanıldı: yanlış süreç oluşturulma kimliği durdurmayı reddetti; doğru kimlikle durdurma ve aynı komut/argüman/Unicode-apostrof çalışma klasörüyle yeniden başlatma geçti. Kullanıcının sunucularına dokunulmadı.
- Kota testleri bağımsız havuzlar, sıfır/eksik/geçersiz limitler, tüm model grupları, kapatılmış pencereler, hesap değişimi, eski ölçüm, HTTP süre/boyut sınırı ve yönlendirmeyi kapsar. Cursor SQLite verisi salt okunur açılır.

## Güncel arayüz

`pnpm test:preview` üretim arayüzünü ayrı, görünmeyen Edge tarayıcısında çalıştırdı:

- Yalnızca iki gezinme sekmesi; üç sağlayıcı kartı. Ajanlar ve bağımsız Claude kartı yok.
- Kota önizlemesi gerçek olmayan sayı üretmez; portların boş durumu açıklanır.
- Ayar seçimi, Escape ile kapatma, kompakt çubuk ve yüzen panel geçişleri geçti.
- 1120, 420 ve 380 pikselde yatay taşma yok. Ayarlar dar görünümde de taşmıyor.
- Renderer sayfa hatası yok. Ekran görüntüleri ve sonuç `.cache/preview-*` dosyalarında yeniden üretilebilir; kişisel veriler içerebilecek test çıktıları Git dışında tutulur.

`scripts/verify-tauri.mjs` iki sekmeli kapsam için güncellendi. Bu sürümde native pencere otomasyonu yeniden çalıştırılmadı; kullanıcı masaüstü kontrolünü fiziksel Escape ile durdurdu. Bu bir uygulama hatası olarak kaydedilmez.

## Korunan Windows davranışı

Tauri 0.7.0 üretim EXE'sinde daha önce gerçek WebView2/pencere kontrolleriyle sabitleme, küçültme, tepsi, tek örnek geri çağırma, 48 px çubuk ve click-through doğrulandı. Kullanıcı gerçek klavyede Alt basılıyken panelin açıldığını, bırakınca çubuğa döndüğünü doğruladı. Ctrl + Shift + H gerçek Windows girdisiyle geçti. İlgili pencere/hayalet modu kodu 0.8.0'da değişmedi; bu geçmiş kanıt, yeni bir native test çalıştırması olarak sunulmaz.

## Dağıtım

`pnpm package` başarılı: TypeScript/Vite üretim derlemesi (20 modül), optimize Rust EXE ve x64 NSIS yükleyicisi üretildi.

Kopyalanan `release/AgentHUD-0.8.0-Windows.exe` üzerinde `--live-check` sonucu: **Cursor bağlı / 2 ölçüm; Antigravity bağlı / 5 ölçüm; Codex bağlı / 1 ölçüm**. Ham kimlik bilgileri veya kullanım yanıtları yazdırılmadı.

| Dosya                        | Boyut           | SHA256                                                             |
| ---------------------------- | --------------- | ------------------------------------------------------------------ |
| `AgentHUD-0.8.0-Setup.exe`   | 4.032.014 bayt  | `921ca14ad2eea6a737f1a28180a68b52d6671bf734010db8db416276ad80ffa6` |
| `AgentHUD-0.8.0-Windows.exe` | 14.665.728 bayt | `c40e5a67d87644be402a8b823d3ff466d41f855a4568df7033e3d339e31d86ec` |

İki dosyanın imzası `NotSigned`; doğrulama değerleri `release/SHA256SUMS.txt` içindedir. Ara 0.7.1 paketleri kaldırıldı. Kullanıcının açık eski 0.7.0 uygulaması otomatik kapatılmadı: yeni sürümü kullanmak için eskisinden tepsi üzerinden çıkıp 0.8.0 açılmalı.

NSIS paketinin kullanıcı hesabına kurulması ayrıca denenmedi. Windows WebView2 gerekir; kurulum bunu eksikse sağlar. Native 0.8.0 pencere testi yerine güncel arayüzün başsız kontrolü ve üretim EXE'sinin gerçek sağlayıcı kontrolü yapıldı. Pencere kodunun önceki kanıtı yukarıda ayrıca belirtilir.
