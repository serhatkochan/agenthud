# AgentHUD

AI geliştirme araçlarının kalan kullanım haklarını bir araya getiren yerel Windows uygulaması.

## Çalıştırma

`release/AgentHUD-0.4.0-Windows.exe` dosyasını aç. Portable sürüm kurulum istemez. Önceki sürüm açıksa tepsi menüsünden Çıkış'ı seçip yeni dosyayı aç. Başlıktaki küçük çubuk düğmesi kompakt görünüme geçirir; maskot yüzen paneli açar. X düğmesi uygulamayı tepsiye gizler. Tamamen kapatmak için Ayarlar > Uygulamadan çık veya tepsi menüsünü kullan.

`Ctrl + Shift + H` uygulamayı geri çağırır ve hayalet modunu kapatır. Bu kısayol doluysa `Ctrl + Alt + H`, ardından `Ctrl + Shift + G` denenir. Etkin kısayol ayarlarda görünür. Hiçbiri kullanılamıyorsa hayalet modu açılmaz. Küçük panel ve normal görünümde başlıktaki sabitleme düğmesi her zaman üstte kalmayı değiştirir; kaydedilen tercih açılışta uygulanır ve görünüm değişimlerinde korunur.

Hayalet modu ayarlardan açılınca küçük çubuğa geçer. Kota alanındaki tıklamalar arkadaki uygulamaya gider; maskot tıklanabilir kalır ve paneli açar. Panel açıkken normal şekilde etkileşirsin; küçültünce tıklama geçişi geri gelir. Çubuğun üzerindeyken Alt basılı tutmak geçici panel açar; bırakınca çubuğa döner. AltGr bu davranışı tetiklemez. Normal görünüme geçmek veya tepsi/kısayolla geri çağırmak hayalet modunu kapatır. Hayalet modu açılışta kendiliğinden etkinleşmez.

Bu geliştirme paketi bir kod imzalama sertifikasıyla imzalanmamıştır. Windows ilk çalıştırmada yayıncı uyarısı gösterebilir. SHA256 doğrulaması `release/SHA256SUMS.txt` dosyasındadır.

## Gerçek veri kaynakları

| Araç | Okunan bilgi | Bağlantı |
| --- | --- | --- |
| Cursor | Cursor Models, Other Models, fatura dönemi bitişi | Cursor'ın yerel SQLite oturumu veya uygulamaya ait giriş penceresi |
| Antigravity | Gemini, Claude/GPT, Argon dahil dönen bütün ölçülebilir model grupları; haftalık ve 5 saatlik pencereler | Açık Antigravity'nin yerel servisi |
| Claude | 5 saatlik, haftalık, sağlayıcı döndürürse model bazlı haklar | Claude Code yerel OAuth oturumu veya ayrı Claude giriş penceresi |
| Codex | Hesabın döndürdüğü gerçek plan pencereleri | Codex yerel ChatGPT oturumu |

Bütün yüzdeler **kalan** hakkı gösterir. Eksik limit sıfır veya yüzde yüz sayılmaz. Sağlayıcı bir pencereyi kapatmışsa, sayıyla birlikte açıklanır. Geçici ağ hatasında aynı hesap için önceki ölçüm tarihi korunur ve eski veri olduğu belirtilir. Hesap değişimi veya giriş hatasında eski haklar temizlenir.

Claude hesabı bu bilgisayarda bulunmadığından canlı Claude kotası doğrulanamadı. Bağlanmamış kart doğru şekilde giriş ister; hesap eklendiğinde giriş akışının canlı kabul testi yapılmalıdır. API kullanım bedelleri, ChatGPT abonelik limitleri ve tahmini mesaj sayıları birbirine dönüştürülmez.

Kimlik bilgileri ana süreçte kalır. Yerel veritabanları ve mevcut kimlik dosyaları değiştirilmez. Oturumlar yalnızca kendi sağlayıcısına yapılan kullanım isteklerinde kullanılır; Antigravity istekleri `127.0.0.1` adresine gider. Uygulama kişisel tarayıcı profillerini taramaz. Yeni web girişleri uygulamanın ayrı profilinde tutulur.

## Portlar ve ajanlar

Port yöneticisi geliştirme süreçlerinin TCP LISTEN portlarını, süreç kimliğini ve bulunabilirse IDE üst sürecini gösterir. Tarayıcıda açma ve süreç durdurma bağlıdır. Durdurmadan önce PID'nin aynı sürece ait olduğu yeniden kontrol edilir. Çalıştırma komutu ve proje klasörü çözülebildiğinde yeniden başlatma bilgisi 10 dakika tutulur.

Windows'ta gerçek çalışma klasörü sürecin dizin bilgisinden salt okunur olarak alınır ve süreç oluşturulma kimliğiyle eşleştirilir. Süreç durdurulmadan hemen önce tekrar okunur. Böylece ortak `node_modules` yolundan farklı bir alt klasörde çalışan sunucu aynı klasörde yeniden başlatılır. Windows bu bilgiye erişim vermezse veya yerleşim doğrulanamazsa yeniden başlatma kapalı kalır. Script yolu yalnızca proje adı için yardımcı ipucudur. Üst sürecin bulunamaması kesin zombi süreç kanıtı olarak sunulmaz.

Antigravity'nin yerel servisinden gerçek proje klasörü ve oturum durumu okunur: Boşta, Çalışıyor, Meşgul veya Durduruluyor. Codex'in yakın tarihli yerel oturumlarından doğrulanabilen task olayları okunur. Satırlarda veri kaynağı ve son etkinlik zamanı görünür. Ajanlar 5 saniyede bir kontrol edilir; uzak kota servisleri bu sıklıkta sorgulanmaz.

Cursor için **Ajanlar > Cursor durum takibi > Bağla** seçeneğini kullanabilirsin. Değişecek dosya ve saklanacak bilgiler gösterilir; Takibi etkinleştir mevcut kullanıcı kancalarını koruyup özgün dosyayı yedekler. Düşünce/yanıt olayı Çalışıyor, bitiş olayı Tamamlandı olarak görünür. İlk olay gelene kadar bağlantı bekliyor durumundadır. Takibi kapat yalnızca AgentHUD gözlemcisini kaldırır. Bozuk veya bilinmeyen sürümlü ayarlar değiştirilmez. Sohbet içeriği ve komutlar kaydedilmez; izin kancalarına ekleme yapılmaz. Ayrıntı `docs/CURSOR-TRACKING.md` içinde.

Cursor bağlantısının olay → Windows gözlemcisi → uygulama → arayüz akışı geçici profilde doğrulandı. Bu bilgisayarın asıl Cursor ayarları henüz değiştirilmedi; gerçek IDE olaylarının canlı kabulü bağlantı etkinleştirildiğinde yapılmalıdır. Claude yalnızca uygulama süreci bulunursa açık olarak gösterilir. CPU etkinliği üzerinden onay veya çalışma durumu uydurulmaz. Antigravity servisindeki enumlarda ayrı bir onay bekleme veya tamamlanma durumu yoktur; Boşta, Tamamlandı olarak sunulmaz. Tüm araçlar için onay bekleme takibi ve oturumun tam penceresine odaklanma açık işlerdir. Odaklan düğmesi şu anda uygulama penceresini açar. Herdr entegrasyonu henüz yoktur.

## Geliştirme ve kontroller

Node 24 ve pnpm gerekir. Bağımlılıkları `pnpm install` ile kur; Electron çalışma dosyası yoksa `node node_modules/electron/install.js` çalıştır.

```powershell
pnpm build
pnpm desktop
pnpm test
pnpm test:ui
pnpm test:ports
pnpm test:ghost
pnpm test:cursor
pnpm live-check
pnpm package
```

`pnpm dev` sadece tarayıcıdaki arayüz önizlemesini açar. Tarayıcı önizlemesi gerçekmiş gibi örnek kota göstermez; yerel bağlantılar masaüstü uygulamasındadır.

`test:cursor`, gerçek PowerShell gözlemcisini resmî biçimdeki örnek olaylarla ayrı bir Cursor klasöründe çalıştırır; çalışma/bitiş, bağlantıyı kaldırma ve hatalı yapılandırma akışlarını arayüzde kontrol eder. `AGENTHUD_CURSOR_DIRECTORY` yalnızca bu testlerin veya alternatif yerel profilin hedefini belirler; varsayılan kullanıcının `.cursor` klasörüdür.

`test:ui` gerçek Electron penceresini açar, canlı ölçümlerin tamamlanmasını bekler ve arayüzü tıklar. `test:ports` kendi geçici sunucusunu açar, durdurur ve yeniden başlatır; mevcut sunuculara dokunmaz. `test:ghost`, ayrı profilinde pencerenin gerçek Windows tıklama geçişi bayrağını ve maskot istisnasını kontrol eder. Fiziksel klavyede Alt basılı tutma bu otomatik kontrolün kapsamı değildir. Canlı kontroller Windows süreçlerine ve ağa erişim gerektirir. Görüntüler ve test çıktıları `.cache/` altında tutulur, Git'e eklenmez.

## Kaynaklar ve kapsam

Kullanıcı tarafından verilen Gemini PRD'sinin yorumu ve kabul koşulları `docs/SPEC.md` dosyasındadır. Uygulama Electron + React ile hazırlanmıştır; PRD'deki önerilen Tauri yerine yerel SQLite ve ayrı web giriş oturumlarını aynı ortamda sunmak için bu tercih yapılmıştır.

Sağlayıcı erişim yolları [CodexBar'ın Cursor](https://github.com/steipete/CodexBar/blob/main/docs/cursor.md), [Antigravity](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md) ve [Claude](https://github.com/steipete/CodexBar/blob/main/docs/claude.md) kaynak notlarıyla karşılaştırıldı. Bunlar sağlayıcıların garanti ettiği herkese açık API sözleşmeleri değildir; ileride değişebilirler.
