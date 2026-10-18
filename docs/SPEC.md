# AgentHUD

18 Ekim 2026. Kaynak: kullanıcının Gemini PRD'si ve üç ekran görüntüsü.

## Amaç ve kabul koşulları

Yerel Windows masaüstü uygulaması. Cursor Models ve Other Models kalan yüzdelerini ayrı gösterir. Antigravity model grupları için haftalık ve beş saatlik limitleri, Gemini 4 Argon dahil dönen diğer grupları kaybetmeden gösterir. Codex plan pencereleri de yer alır; ChatGPT aboneliği API kredisine dönüştürülmez. Bağımsız Claude kartı ve durum takibi son kullanıcı yönlendirmesiyle kapsamdan çıkarıldı; Antigravity'nin kendi Claude/GPT grubu korunur. Bütün pencerelerin kaynak ve ölçüm zamanları görünür. Eksik alan sıfır veya yüzde yüz sayılmaz.

Giriş veya bağlantı hataları açıklanır. Yerel oturumlar yalnızca okunur, gizli bilgiler arayüze veya loglara gönderilmez. Giriş gerektiğinde sağlayıcının kendi uygulamasına yönlendirilir. Tarayıcı profilleri taranmaz. Oturumlar hesap değişiminde karıştırılmaz. Ağ istekleri zaman aşımına sahiptir. Otomatik yenileme, elle yenileme, görünür bağlantı ayarları gerekir.

## Masaüstü ve yardımcı modüller

Normal panel, küçük yüzen panel ve 36-48 piksel özet modu. Her zaman üstte tutma, pencere sürükleme, tepsi, maskot ve düşük kota bildirimi. Click-through yalnızca açık ayarla etkinleşir; geri dönüş kısayolu her zaman erişilebilir olmalıdır.

Geliştirme portları gerçek PID ve süreç zinciriyle bulunur. Aç, durdur ve bilinen komut için yeniden başlat. Durdurulan satır 10 dakika saklanır. PID yeniden kullanımı doğrulanır. Yetim üst süreç tek başına kesin zombi kanıtı sayılmaz. Cwd bilinmiyorsa klasör tahmin edilmez.

Ajanlar için süreç varlığı çalışma durumu kanıtı sayılmaz. Working, Blocked, Done ve Idle yalnızca oturum olaylarıyla doğrulanır. Bulunabilen uygulama pencerelerine odaklanılır. Herdr isteğe bağlıdır.

## Teknik yaklaşım

Rust + Tauri 2 + React 19 + TypeScript + Vite. `rusqlite` Cursor oturumunu salt okunur açar; `reqwest` HTTP isteklerini sınırlar. Rust çekirdeği kota, süreç/port keşfi, oturumlar, pencere odağı ve dar IPC sözleşmelerini sahiplenir. React yalnızca izin verilen komutlarla konuşur; genel dosya, kabuk veya HTTP yetkisi yoktur. Tauri, Windows WebView2 kullanır. Dağıtımda Electron veya Node yan süreç yoktur. Windows PowerShell yalnızca yerel envanter ve açıkça bağlanan Cursor gözlemcisi için kullanılır.

## Tasarım

Koyu grafit zemin IDE yanında gözü yormaz. Nane yeşili eylem ve kalan hakkı vurgular; sağlayıcı renkleri kimliği, amber/kırmızı azalan hakkı belirtir. Büyük sayılar sadece kalan kota için kullanılır. Her sağlayıcı kendi farklı limitlerini aynı hizalı ölçüm satırlarında taşır. Segoe UI Variable Türkçe ve Windows okunabilirliği için; sayılarda tabular numerals. Bölmeler gerçek araç gruplarıdır. Tek yüzeyde yumuşak gölge pencere derinliğini verir. Maskot geliştirici yoldaşı fikrini taşır. Geçişler 150-250 ms; reduced-motion desteklenir. ENERGY 2 / RHYTHM 2 / MOTION 2.

## Sıra ve kanıt

1. Kota ayrıştırıcıları: ters yüzde, sıfır, eksik, geçersiz değer ve model grubu testleri.
2. Gerçek yerel kaynaklar ve giriş bağlantıları; gizli bilgi içermeyen canlı kontrol.
3. Erişilebilir normal/yüzen arayüz, boş/yükleniyor/hata durumları.
4. Portlar ve kanıtlı ajan oturumları.
5. Build, testler, gerçek ekran ve tıklama kontrolleri, Windows paket.

Tamamlanmamış şartlar doğrulama raporunda açık tutulur; sadece arayüzün açılması bütün hedefin tamamlandığı sayılmaz.
