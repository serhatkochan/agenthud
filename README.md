# AgentHUD

Cursor, Antigravity ve Codex için kalan abonelik haklarını tek yerde gösteren **Rust + Tauri 2** Windows uygulaması. React arayüzü Windows WebView2 içinde çalışır.

## Kullanım

`release/AgentHUD-0.7.0-Setup.exe` ile kur veya `release/AgentHUD-0.7.0-Windows.exe` dosyasını doğrudan aç. Önceki AgentHUD açıksa tepsi menüsünden Çıkış'ı seç. Uygulama çalışmak için Node veya Electron istemez. Windows WebView2 gerekir; kurulum eksikse yükleyici bunu kurar. Geliştirme paketi imzasızdır; Windows yayıncı uyarısı gösterebilir. Dosya doğrulaması `release/SHA256SUMS.txt` içindedir.

Başlıktaki çubuk düğmesi 48 piksel yüksekliğinde kompakt görünüme geçirir; maskot yüzen paneli açar. Sabitleme düğmesi her zaman üstte kalmayı değiştirir. X tepsiye gizler; tamamen kapatmak için Ayarlar > Uygulamadan çık veya tepsi menüsünü kullan.

Uygulamayı tekrar açmak ikinci bir kopya başlatmaz; mevcut paneli geri getirir. Ayrı test profilleri bu davranıştan bağımsızdır.

`Ctrl + Shift + H` paneli geri çağırır ve hayalet modunu kapatır. Doluysa `Ctrl + Alt + H`, ardından `Ctrl + Shift + G` denenir. Etkin kısayol ayarlarda görünür. Hiçbiri kaydedilemezse hayalet modu açılamaz.

Hayalet modunda kota alanının tıklamaları arkadaki uygulamaya gider; maskot tıklanabilir kalır. Maskot paneli açar. Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar; bırakınca çubuğa döner. AltGr tetiklemez. Panel açıkken normal şekilde etkileşirsin. Hayalet modu açılışta kendiliğinden etkinleşmez.

## Gerçek veri kaynakları

| Araç | Gösterilen bilgi | Yerel bağlantı |
| --- | --- | --- |
| Cursor | Cursor Models, Other Models, fatura dönemi | Cursor'ın salt okunur SQLite oturumu |
| Antigravity | Dönen bütün ölçülebilir model grupları, haftalık ve 5 saatlik pencereler | Açık Antigravity'nin yerel servisi |
| Codex | Hesabın döndürdüğü gerçek plan pencereleri | Yerel ChatGPT oturumu |

Bağımsız Claude entegrasyonu kullanıcı isteğiyle kaldırıldı. Antigravity'nin kendi yanıtında dönen Claude/GPT grubu Antigravity kartında gösterilir.

Yüzdeler **kalan** hakkı gösterir. Eksik limit sıfır veya yüzde yüz sayılmaz. Sağlayıcının kapattığı pencere açıklanır. Geçici ağ hatasında aynı hesabın önceki ölçümü, tarihi ve eski veri uyarısıyla korunur. Hesap değişiminde veya giriş hatasında eski ölçümler temizlenir. Abonelik hakkı API kredisine veya tahmini mesaj sayısına dönüştürülmez.

Giriş gerektiğinde ilgili uygulamada hesabına girip AgentHUD'u yenile. Sağlayıcı oturumları Rust tarafında kalır; arayüze token, çerez veya ham süreç komutu gönderilmez. Mevcut kimlik dosyaları değiştirilmez, kişisel tarayıcı profilleri taranmaz. Antigravity istekleri yalnızca `127.0.0.1` üzerindeki bulunan servise gider. Uzak HTTP istekleri TLS doğrulaması, süre ve yanıt boyutu sınırı kullanır; yönlendirmeler izlenmez.

## Portlar ve ajanlar

Yerel portlar ekranı geliştirme süreçlerinin TCP LISTEN portlarını, PID'yi, bulunabilen IDE ilişkisini ve proje adını gösterir. Aç, durdur ve doğrulanmış komut/çalışma klasörü varsa yeniden başlat eylemleri vardır. Durdurmadan önce süreç oluşturulma kimliği tekrar kontrol edilir. Yeniden başlatma bilgisi 10 dakika tutulur. Çalışma klasörü okunamazsa yeniden başlatma kapalıdır; üst sürecin bulunmaması kesin zombi kanıtı olarak sunulmaz.

Ajanlar 5 saniyede bir kontrol edilir; uzak kota servisleri bu sıklıkta sorgulanmaz. Antigravity'nin gerçek servis durumları ve Codex'in yerel task olayları kullanılır. CPU etkinliği çalışma veya onay bekleme kanıtı sayılmaz.

Cursor için **Ajanlar > Cursor durum takibi > Bağla** seçeneği isteğe bağlı gözlemciyi açar. Değişecek dosya önce gösterilir. Mevcut kancalar korunur, özgün dosya yedeklenir. Çalışma ve bitiş olayları takip edilir; sohbet metni, düşünce içeriği ve komutlar saklanmaz. Kapatma yalnızca AgentHUD gözlemcisini kaldırır. Ayrıntılar `docs/CURSOR-TRACKING.md` içindedir.

**Odaklan**, oturumun uygulama penceresini açar; birden fazla aday varsa seçim ister. Süreç ve pencere kimliği tekrar doğrulanır, küçültülmüş pencere geri yüklenir. Genel uygulama penceresinde belirli sohbet sekmesinin seçildiği iddia edilmez. Ayrıntılar `docs/WINDOW-FOCUS.md` içindedir.

## Geliştirme

Windows, Rust MSVC araç zinciri, Visual Studio C++ Build Tools, WebView2, Node ve pnpm gerekir. Node yalnızca geliştirme ve arayüz derlemesinde kullanılır.

```powershell
pnpm install
pnpm desktop
pnpm build
pnpm test
pnpm exec tauri build --debug --no-bundle
cargo build --manifest-path src-tauri/Cargo.toml --example focus_fixture
pnpm test:ui
pnpm live-check
pnpm package
```

`pnpm dev` tarayıcı önizlemesidir; örnek veriyle gerçekmiş gibi kota göstermez. `pnpm test` Rust testlerini ve Windows'ta kendi süreçleriyle port/gözlemci denemelerini çalıştırır. `test:ui` gerçek Tauri WebView2 penceresinde geçici profil kullanır; canlı kotalar, Cursor olayları, kendi iki test penceresinde odaklanma ve pencere davranışlarını kontrol eder. Bu kontroller süreç bilgisine ve ağa erişim gerektirir; kullanıcının sunucularını durdurmaz veya gerçek IDE ayarlarını değiştirmez.

`AGENTHUD_PROFILE_DIR` ayrı uygulama profili, `AGENTHUD_CURSOR_DIRECTORY` ayrı Cursor gözlemci klasörü içindir. Yalnızca açıkça ayrı profil seçilmişken `AGENTHUD_DEBUG_PORT` test WebView2 bağlantısını açabilir. Normal çalışmada bu bağlantı açılmaz.

Mimari ve kapsam `docs/SPEC.md`, son kanıtlar `docs/VERIFICATION.md`, kabul sınırları `docs/ACCEPTANCE.md` içindedir. Electron 0.6.0 geçmişi Git'te `091173b` ve eski sürüm dosyalarında korunur. Sağlayıcı erişim yolları herkese açık, garantili API sözleşmeleri değildir; sağlayıcı güncellemelerinde değişebilir.
