# AgentHUD 0.5.0 kontrol kaydı

18 Ekim 2026. Bu kayıt, ilk çalışan masaüstü sürümünün kanıtlarını ve devam eden işleri ayırır. Bütün PRD'nin tamamlandığı iddiası değildir.

## Doğrulananlar

- Electron ana süreç sözdizimi, TypeScript ve Vite üretim derlemesi geçti.
- `pnpm test`: 62 test, 62 başarılı. Kota, port, Antigravity, hayalet modu ve Cursor gözlemcisine ek olarak pencere seçimi, süreç kimliği, eski seçimleri reddetme ve ekran sınırı yerleşimi sınanır.
- Odaklanma, farklı bir süreçte açılan iki geçici pencereyle gerçek Windows ön plan tanıtıcısı okunarak doğrulandı. Benzersiz çalışma alanı başlığı, küçültülmüş pencereyi geri getirme, birden çok pencere seçimi, kapalı seçimi reddetme, liste yenileme ve 380 px seçim diyaloğu geçti. Başarılı odaklanma sonrası sabitlenmiş HUD küçüldü ve odak hedef pencerede kaldı; HUD genişlerken ekranın çalışma alanında kaldı. Test kullanıcının IDE pencerelerine odaklanmadı. Başlık adı, tam proje yolu veya genel ajan arayüzünde sohbet sekmesi kanıtı sayılmaz.
- Cursor bağlantı akışı geçici profilde arayüzden açıldı; düşünce olayıyla Çalışıyor, bitiş olayıyla Tamamlandı göründü. Takibi kapatma diğer kancaları korudu. Bozuk dosyada işlem reddedildi ve özgün içerik korundu. Bağlantı diyaloğu 380 px görünümde taşmadı. Test olayları resmî biçimdeki örneklerdi; gerçek Cursor ajanına görev gönderilmedi. Asıl kullanıcı profilindeki hook dosyası değiştirilmedi.
- Cursor bağlantı akışı 0.5.0 paketinde de tekrar geçti; yeni odaklanma diyalogları mevcut bağlantı diyaloglarını etkilemedi.
- Gerçek hesap kontrolü: Cursor, Antigravity ve Codex bağlı. Cursor Models ile Other Models ayrı. Antigravity üç model grubunu ve beş ölçümü döndürüyor. Claude, kullanıcının hesabı olmadığı için doğru biçimde giriş gerekli durumunda.
- Antigravity'nin iki gerçek Idle oturumu proje klasörleri ve yerel servis kaynağıyla arayüzde doğrulandı. Ajan kontrol zamanı 5 saniyelik döngüde ilerlerken kota ölçüm tarihlerinin değişmediği test edildi. Çalışan/onay bekleyen bir kullanıcı oturumu test amacıyla başlatılmadı. Busy/Running/Canceling adları kurulu uygulama ikilisinde doğrulandı ve karşılıkları yanıt örnekleriyle sınandı; bilinmeyen değerler çalışma veya onay durumu sayılmıyor.
- Gerçek Electron kontrolü hem geliştirme sürümünde hem 0.5.0 `release/win-unpacked/AgentHUD.exe` içinde geçti. Ana ekran, bütün sağlayıcı bağlantı diyalogları, ayarlar, Escape, üç gezinme sekmesi, 48 px kompakt görünüm, yüzen panel ve 380 px dar görünüm tıklandı. `test:focus` pakette iki ayrı test penceresiyle geçti. `test:ghost` paketlenmiş uygulamada da geçti; Windows N-API bileşeni başarıyla yüklendi.
- Sabitleme ayarı açılışta, kapatılırken ve yeniden açılırken `BrowserWindow.isAlwaysOnTop()` ile doğrulandı. 0.3.0 kontrolünde görünüm değişimi sonrasında sabitlemenin düştüğü ayrıca bulundu. Bool çağrısı da Electron'da varsayılan `floating` seviyesini seçiyormuş; önceki 0.1.1 düzeltmesi eksik kaldı. Windows için `pop-up-menu` seviyesi seçildi; panel/çubuk değişimi sonrası sabitleme yeniden doğrulandı. Ayrıntı ve kaynaklar `GHOST-MODE.md` içinde. Simge durumuna küçültme `isMinimized()` ile ve tepsiye gizleme `isVisible()` ile doğrulandı.
- Hayalet modunda gerçek Windows tıklama geçişi bayrağı kota alanında aktif, maskot bölgesinde pasif bulundu. Panel açma, küçültme, kapatma ve normal görünüme dönme etkileşimi sınandı. Fiziksel fareyle hayalet modundaki maskota tıklandı ve panel açıldı. Ana kısayol doluyken seçilen Ctrl + Alt + H gerçek klavye girdisiyle hayalet modunu kapattı. Alt basılı tutma geçişi mantık testinde ve native okuyucu yükleme testinde var; fiziksel kısa Alt denemesi basılı tutmayı kanıtlamadı.
- Klavye odağı görünür; normal/dar panelde ana içeriğin yatay taşmadığı doğrulandı. Renderer'da sıfır konsol hatası / sayfa hatası kaydedildi.
- Port kabul testi yalnızca kendi geçici HTTP sunucusunda geçti: ortak `node_modules` içindeki script, `apps/Gerçek çalışma alanı` klasöründe çalıştırıldı. Gerçek klasör PID ve oluşturulma zamanıyla doğrulandı; yeniden başlatılan HTTP sunucusu `process.cwd()` değerini aynı klasör olarak döndürdü. Windows program yolunda boşluk olmasına ilişkin önceki düzeltme de bu akışta kapsanıyor.
- Canlı mevcut portlar listelendi; kullanıcının çalışan sunucuları durdurulmadı.
- Muted metin `#A4AFA6 / #1C231E`: 7.08:1. Küçük soluk metin `#7B8A7E / #111612`: 5.04:1. İkisi de normal metinde AA eşiğini geçiyor.
- 0.5.0 Portable EXE üretildi; içindeki paketlenmiş uygulamanın Electron ekran/tıklama, pencereye odaklanma ve Windows hayalet modu kontrolleri geçti. Fiziksel fare ve kısayol testleri 0.3.0 geliştirme sürümünde yapıldı. Portable dış sarmalayıcı için ayrıca fiziksel giriş testi yapılmadı.
- İmza durumu `NotSigned`. SHA256 kaydı `release/SHA256SUMS.txt` içinde.

Yerel kanıtlar: `.cache/focus-result.json`, `.cache/focus-choices.png`, `.cache/focus-choices-380.png`, `.cache/ui-result.json`, `.cache/cursor-ui-result.json`, `.cache/cursor-tracking-connect.png`, `.cache/cursor-tracking-connect-380.png`, `.cache/cursor-tracking-active.png`, `.cache/cursor-tracking-error.png`, `.cache/ghost-result.json`, `.cache/physical-ghost-result.json`, `.cache/ghost-compact.png`, `.cache/ghost-panel.png`, `.cache/dashboard.png`, `.cache/compact.png`, `.cache/panel.png`, `.cache/panel-settings-380.png`, `.cache/agents-panel-380.png`, `.cache/agents.png`, `.cache/ports.png`. Bunlar gerçek kullanım bilgisi içerebildiğinden Git dışında tutulur.

## Tasarım teslim kontrolü

- Hard Gate PASS: üretim derlemesi ve gerçek Electron kontrolleri geçti; bağlantı/yükleme/boş/hata durumları mevcut, sahte kota ve pazarlama sayıları yok. Görünür eylemlerin kaynak bağlantıları incelendi; ana akışlar tıklanarak doğrulandı. Hesap girişi, dış kullanım sayfaları ve gerçek masaüstü kısayolu için canlı kabul sınırı yukarıda belirtilir.
- Purpose Gate PASS: renk, tipografi, kart grupları, maskot ve geçişlerin amacı `SPEC.md` içinde yazılı. Gerçek kota dışında dekoratif grafik kullanılmıyor.
- Liveliness PASS: ENERGY 2 / RHYTHM 2 / MOTION 2; kalan yüzdeler odak noktası, sağlayıcı grupları içerik düzenini belirliyor, hareket azaltma tercihi uygulanıyor.
- Craftsmanship PASS: ana/dar/kompakt görünümler kontrol edildi; belirsiz çalışma durumları ve eksik limitler açıkça belirtiliyor. Kontrol edilmeyen bir özelliğe test edildi denmiyor.

## Hedef içinde açık kalan işler

1. Cursor gözlemcisinin gerçek IDE'den olay alarak canlı kabulü ve Claude için olay bağlantısı. Cursor'un çalışma/bitiş/boşta akışı örnek olay → gerçek Windows gözlemcisi → arayüz zincirinde bağlı; ayrı onay bekleme kaynağı bulunmadı. Antigravity'nin yerel durumları bağlı; ayrı onay ve tamamlanma olayı kaynakta bulunmadığı için gösterilmiyor. Codex task olayları okunabiliyor.
2. Gerçek IDE/terminal ortamlarının tamamında odaklanmanın canlı kabulü. Mekanizma iki ayrı test penceresinde doğrulandı; genel ajan arayüzünde belirli sohbet sekmesi seçilmez.
3. Claude hesabı edinildiğinde gerçek giriş ve kullanım yanıtının uçtan uca testi.
4. Alt basılı tutma davranışının fiziksel kabulü. Maskot etkileşimi, tıklama geçişi ve geri çağırma kısayolu tamamlandı; geçici panel mantık testinde doğrulandı.

Windows gerçek cwd okuması tamamlandı ve gerçek alt klasör testiyle doğrulandı. Erişilemeyen süreçlerde yeniden başlatma kapalı tutulur. PEB yerleşimi işletim sisteminin iç yapısı olduğundan gelecekteki Windows sürümlerinde tekrar doğrulanmalıdır. İlgili API sınırı [Microsoft'un NtQueryInformationProcess belgesinde](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess) açıklanır. Sabitleme düzeltmesi [kullanılan Electron sürümünün pencere uygulaması](https://github.com/electron/electron/blob/v44.9.0/shell/browser/native_window_views.cc) ve gerçek pencere testiyle karşılaştırıldı.

Herdr entegrasyonu PRD'de isteğe bağlıdır; uygulanmadı ve zorunlu tamamlanma kapısı sayılmaz.

Ana hedef bu maddeler için açık tutulur. Kota ekranının çalışması bütün izleme PRD'sinin tamamlandığı olarak işaretlenmez.
