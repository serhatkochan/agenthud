# Değişiklikler

## 0.7.0 · 18 Ekim 2026

- Masaüstü çekirdeği Rust + Tauri 2'ye taşındı. Electron, Node çalışma ortamı ve Koffi bağımlılıkları kaldırıldı; React arayüzü Windows WebView2 kullanıyor.
- Bağımsız Claude kotası, giriş ve durum takibi kaldırıldı. Cursor, Antigravity ve Codex gerçek yerel oturumlarla çalışıyor; Antigravity'nin kendi Claude/GPT grubu korunuyor.
- Kota okuyucuları, süreç kimliğiyle güvenli port yönetimi, Cursor gözlemcisi, yerel oturumlar ve pencereye odaklanma Rust modüllerine taşındı.
- Tepsi, geri çağırma kısayolu, 48 piksel çubuk, sabitleme, hayalet modu ve ayarlar Tauri'ye bağlandı. Pencere geçişindeki eşzamanlı kilitlenme gerçek Windows testinde bulunup düzeltildi.
- Tek örnek koruması eklendi; ikinci açılış gizli mevcut paneli geri getirir. Ayrı test profilleri normal uygulamadan ayrılır.
- Windows NSIS yükleyicisi ve doğrudan çalıştırılabilir EXE üretimi eklendi. Son doğrulama kapsamı `docs/VERIFICATION.md` içinde.

## 0.6.0 · 18 Ekim 2026

- Claude Code için isteğe bağlı durum bağlantısı eklendi. Çalışma, onay bildirimi, devam, yanıt bitişi ve hata durumları ayrı gösterilir; bekleyen onay kompakt maskota yansır.
- Claude ayarları ve izin kuralları korunur, özgün dosya yedeklenir; kaldırma yalnızca AgentHUD komutlarını çıkarır. Claude kotası bağlantısından bağımsızdır.
- Cursor ile ortak bağlantı diyaloğu ve dosya işlemleri paylaşılır; her sağlayıcının olay ve ayar biçimi ayrı kalır. Bozuk ayarlar değiştirilmez.
- Claude hesabı ve canlı oturumuyla uçtan uca kabul yapılmadı. Windows gözlemcisi ve arayüz ayrı profilde örnek olaylarla test edildi.
- Portlarda `go.mod` modül adı okunur; Go/Cargo araçlarının başlattığı derlenmiş sunucular tanınır. Başlatıcı kapandıktan sonra yalnızca aynı süreç kimliği korunur; yeniden başlatılan sunucu tekrar listelenir. Geçersiz proje adı nesneleri arayüze taşınmaz.

## 0.5.0 · 18 Ekim 2026

- Odaklan düğmesi oturumun uygulama pencerelerini bulur. Benzersiz çalışma alanı başlığı eşleşmesinde pencereyi açar; belirsiz veya birden fazla eşleşmede seçim gösterir.
- Süreç ve pencere kimliği yeniden doğrulanır; eski seçimler ve kapanan pencereler reddedilir. Küçültülmüş pencere geri getirilir, başarılı odaklanmada HUD küçülür.
- Normal görünüme dönüşte pencerenin ekran dışına taşması düzeltildi. Boyut ve konum ekranın çalışma alanına sığdırılır.

## 0.4.0 · 18 Ekim 2026

- Ajanlar ekranına Cursor durum takibi bağlantısı eklendi. Kullanıcı etkinleştirdiğinde resmî oturum olaylarından proje, çalışma ve bitiş durumu gösterilir.
- Mevcut Cursor kancaları korunur, özgün dosya yedeklenir. Bağlantıyı kapatmak yalnızca AgentHUD gözlemcisini kaldırır; bozuk ayarlar değiştirilmez.
- Gözlemci sohbet metni, düşünce içeriği ve komut saklamaz; komut izinlerini ve otomatik devam davranışını değiştirmez.
- Derleme kontrolüne Electron ana sürecinin sözdizimi denetimi eklendi.

## 0.3.0 · 18 Ekim 2026

- Hayalet modunda kota alanı tıklamaları arkaya geçirirken maskot tıklanabilir kalır. Maskot paneli açar; panel küçültülünce hayalet modu sürer.
- Alt ile geçici panel eklendi. AltGr ayrı tutulur. Normal görünüm, tepsi ve geri çağırma kısayolu fare etkileşimini geri getirir.
- Dolu geri çağırma kısayolu için iki alternatif eklenir; kullanılan kısayol ayarlarda gösterilir.
- Görünüm değişirken Windows sabitlemesinin düşmesi düzeltildi. Önceki ayar açma/kapama kontrolü bu geçişi kapsamıyordu; gerçek pencere kontrolü genişletildi.

## 0.2.0 · 18 Ekim 2026

- Antigravity'nin gerçek oturumları, proje klasörleri ve servis durumları ajan ekranına bağlandı. Süreç varlığı ile ölçülen çalışma durumu ayrı gösterilir.
- Ajanlar, kota yenileme aralığından bağımsız olarak 5 saniyede bir kontrol edilir. Kaynak ve son etkinlik zamanı görünür.
- Yerel servis isteklerine toplam süre ve yanıt boyutu sınırı eklendi. Yarıda kesilen, bozuk veya yönlendirilen yanıtlar yenilemeyi askıda bırakmaz.

## 0.1.1 · 18 Ekim 2026

- Windows portları, komutun bulunduğu dizin yerine doğrulanan gerçek çalışma klasöründe yeniden başlatılır. Ortak `node_modules`, Türkçe klasör adı ve boşluk içeren yol gerçek sunucuyla test edildi.
- Her zaman üstte kalma tercihi açılışta uygulanır. Sabitleme düğmesinde Windows görev çubuğu seviyesinden kaynaklanan hata giderildi; açma ve kapama ayrı ayrı doğrulandı.
- Geri çağırma kısayolu başka bir uygulamada kullanılıyorsa hayalet modu açılmaz ve arayüz nedenini gösterir.
- Masaüstü testleri ayrı kullanıcı profiliyle çalışır; açık uygulamanın ayarlarını değiştirmez.

## 0.1.0 · 18 Ekim 2026

- Cursor, Antigravity ve Codex için yerel oturumlardan canlı kullanım kotaları.
- Claude bağlantı akışı ve doğru giriş bekleme durumu.
- Normal, yüzen ve kompakt görünüm; tepsi, bildirimler ve port yöneticisi.
