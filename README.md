# AgentHUD

Cursor, Antigravity ve Codex için kalan abonelik haklarını tek yerde gösteren **Rust + Tauri 2** Windows uygulaması. React arayüzü Windows WebView2 içinde çalışır.

## Kullanım

`release/AgentHUD-0.8.0-Setup.exe` ile kur veya `release/AgentHUD-0.8.0-Windows.exe` dosyasını doğrudan aç. Önceki AgentHUD açıksa tepsi menüsünden Çıkış'ı seç. Uygulama çalışmak için Node veya Electron istemez. Windows WebView2 gerekir; kurulum eksikse yükleyici bunu kurar. Geliştirme paketi imzasızdır; Windows yayıncı uyarısı gösterebilir. Dosya doğrulaması `release/SHA256SUMS.txt` içindedir.

Başlıktaki çubuk düğmesi 48 piksel yüksekliğinde kompakt görünüme geçirir; maskot yüzen paneli açar. Sabitleme düğmesi her zaman üstte kalmayı değiştirir. X tepsiye gizler; tamamen kapatmak için Ayarlar > Uygulamadan çık veya tepsi menüsünü kullan.

Uygulamayı tekrar açmak ikinci bir kopya başlatmaz; mevcut paneli geri getirir. Ayrı test profilleri bu davranıştan bağımsızdır.

`Ctrl + Shift + H` paneli geri çağırır ve hayalet modunu kapatır. Doluysa `Ctrl + Alt + H`, ardından `Ctrl + Shift + G` denenir. Etkin kısayol ayarlarda görünür. Hiçbiri kaydedilemezse hayalet modu açılamaz.

Hayalet modunda kota alanının tıklamaları arkadaki uygulamaya gider; maskot tıklanabilir kalır. Maskot paneli açar. Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar; bırakınca çubuğa döner. AltGr tetiklemez. Panel açıkken normal şekilde etkileşirsin. Hayalet modu açılışta kendiliğinden etkinleşmez.

## Gerçek veri kaynakları

| Araç        | Gösterilen bilgi                                                         | Yerel bağlantı                       |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Cursor      | Cursor Models, Other Models, fatura dönemi                               | Cursor'ın salt okunur SQLite oturumu |
| Antigravity | Dönen bütün ölçülebilir model grupları, haftalık ve 5 saatlik pencereler | Açık Antigravity'nin yerel servisi   |
| Codex       | Hesabın döndürdüğü gerçek plan pencereleri                               | Yerel ChatGPT oturumu                |

Bağımsız Claude entegrasyonu kullanıcı isteğiyle kaldırıldı. Antigravity'nin kendi yanıtında dönen Claude/GPT grubu Antigravity kartında gösterilir.

Yüzdeler **kalan** hakkı gösterir. Eksik limit sıfır veya yüzde yüz sayılmaz. Sağlayıcının kapattığı pencere açıklanır. Geçici ağ hatasında aynı hesabın önceki ölçümü, tarihi ve eski veri uyarısıyla korunur. Hesap değişiminde veya giriş hatasında eski ölçümler temizlenir. Abonelik hakkı API kredisine veya tahmini mesaj sayısına dönüştürülmez.

Giriş gerektiğinde ilgili uygulamada hesabına girip AgentHUD'u yenile. Sağlayıcı oturumları Rust tarafında kalır; arayüze token, çerez veya ham süreç komutu gönderilmez. Mevcut kimlik dosyaları değiştirilmez, kişisel tarayıcı profilleri taranmaz. Antigravity istekleri yalnızca `127.0.0.1` üzerindeki bulunan servise gider. Uzak HTTP istekleri TLS doğrulaması, süre ve yanıt boyutu sınırı kullanır; yönlendirmeler izlenmez.

## Portlar

Yerel portlar ekranı geliştirme süreçlerinin TCP LISTEN portlarını, PID'yi, bulunabilen IDE ilişkisini ve proje adını gösterir. Aç, durdur ve doğrulanmış komut/çalışma klasörü varsa yeniden başlat eylemleri vardır. Durdurmadan önce süreç oluşturulma kimliği tekrar kontrol edilir. Yeniden başlatma bilgisi 10 dakika tutulur. Çalışma klasörü okunamazsa yeniden başlatma kapalıdır; üst sürecin bulunmaması kesin zombi kanıtı olarak sunulmaz.

Ajan durum takibi, pencereye odaklanma ve Cursor gözlemcisi son kullanıcı isteğiyle kaldırıldı. Bu özellikler sonraki çalışmaya bırakıldı.

## Geliştirme

Windows, Rust MSVC araç zinciri, Visual Studio C++ Build Tools, WebView2, Node ve pnpm gerekir. Node yalnızca geliştirme ve arayüz derlemesinde kullanılır.

```powershell
pnpm install
pnpm desktop
pnpm build
pnpm test
pnpm test:preview
pnpm exec tauri build --debug --no-bundle
pnpm test:ui
pnpm live-check
pnpm package
```

`pnpm dev` tarayıcı önizlemesidir; örnek veriyle gerçekmiş gibi kota göstermez. `pnpm test` Rust testlerini ve Windows'ta yalnızca kendi TCP sunucusunda süreç kimliği, durdurma ve yeniden başlatmayı doğrular. `test:preview` ayrı, görünmeyen Edge tarayıcısında iki sekmeyi, boş durumları, ayarları ve dar ekranı sınar. `test:ui` ayrı test profiliyle gerçek Tauri WebView2 penceresinde canlı kotaları, kendi test portunu ve pencere davranışlarını kontrol eder; kullanıcının sunucularını durdurmaz.

`AGENTHUD_PROFILE_DIR` ayrı uygulama profilidir. Yalnızca açıkça ayrı profil seçilmişken `AGENTHUD_DEBUG_PORT` test WebView2 bağlantısını açabilir. Normal çalışmada bu bağlantı açılmaz.

Kapsam `docs/SPEC.md`, son kanıtlar `docs/VERIFICATION.md`, kabul sınırları `docs/ACCEPTANCE.md` içindedir. Çalışma klasöründe Tauri projesi ve Windows paketleri tutulur. Derleme ve bağımlılık klasörleri yeniden üretilebilir. Sağlayıcı erişim yolları herkese açık, garantili API sözleşmeleri değildir; sağlayıcı güncellemelerinde değişebilir.
