# AgentHUD 0.1.1 kontrol kaydı

18 Ekim 2026. Bu kayıt, ilk çalışan masaüstü sürümünün kanıtlarını ve devam eden işleri ayırır. Bütün PRD'nin tamamlandığı iddiası değildir.

## Doğrulananlar

- TypeScript ve Vite üretim derlemesi geçti.
- `pnpm test`: 16 test, 16 başarılı. İlk 13 kapsama ek olarak gerçek klasörün script yolundan ayrılması, doğrulanmayan klasörle yeniden başlatmanın engellenmesi ve süreç oluşturulma zamanı eşleştirmesi kapsanıyor.
- Gerçek hesap kontrolü: Cursor, Antigravity ve Codex bağlı. Cursor Models ile Other Models ayrı. Antigravity üç model grubunu ve beş ölçümü döndürüyor. Claude, kullanıcının hesabı olmadığı için doğru biçimde giriş gerekli durumunda.
- Gerçek Electron kontrolü hem geliştirme sürümünde hem `release/win-unpacked/AgentHUD.exe` içinde geçti. Ana ekran, bütün sağlayıcı bağlantı diyalogları, ayarlar, Escape, üç gezinme sekmesi, 48 px kompakt görünüm, yüzen panel ve 380 px dar görünüm tıklandı.
- Sabitleme ayarı açılışta, kapatılırken ve yeniden açılırken `BrowserWindow.isAlwaysOnTop()` ile doğrulandı. Önceki yalnızca tersine çevirme testi eksikti: başlangıçta aktif tercihi pencereye uygulanmıyor ve Windows'ta açıkça verilen `floating` seviyesi üstte kalma durumunu bozabiliyordu. Sadece bool alanı kullanan çağrı ve açılış tercihi düzeltildi. Simge durumuna küçültme `isMinimized()` ile ve tepsiye gizleme `isVisible()` ile doğrulandı. Kısayol başka uygulamada kayıtlıyken hayalet modunun hem arayüzden hem ana süreçten engellendiği test edildi. Gerçek işletim sistemi kısayoluna basarak geri çağırma ayrıca test edilmedi.
- Klavye odağı görünür; normal/dar panelde ana içeriğin yatay taşmadığı doğrulandı. Renderer'da sıfır konsol hatası / sayfa hatası kaydedildi.
- Port kabul testi yalnızca kendi geçici HTTP sunucusunda geçti: ortak `node_modules` içindeki script, `apps/Gerçek çalışma alanı` klasöründe çalıştırıldı. Gerçek klasör PID ve oluşturulma zamanıyla doğrulandı; yeniden başlatılan HTTP sunucusu `process.cwd()` değerini aynı klasör olarak döndürdü. Windows program yolunda boşluk olmasına ilişkin önceki düzeltme de bu akışta kapsanıyor.
- Canlı mevcut portlar listelendi; kullanıcının çalışan sunucuları durdurulmadı.
- Muted metin `#A4AFA6 / #1C231E`: 7.08:1. Küçük soluk metin `#7B8A7E / #111612`: 5.04:1. İkisi de normal metinde AA eşiğini geçiyor.
- Portable EXE üretildi ve doğrudan başlatıldı. Çalışan pencere Windows pencere envanterinde `AgentHUD · Kullanım alanın` başlığıyla bulundu. Ek Windows ekran yakalama kontrolünde araç onayı zaman aşımına uğradı; bu ek kontrol tamamlanmadı. Paketlenmiş uygulamanın Electron ekran/tıklama kontrolleri daha önce geçti.
- İmza durumu `NotSigned`. SHA256 kaydı `release/SHA256SUMS.txt` içinde.

Yerel kanıtlar: `.cache/ui-result.json`, `.cache/dashboard.png`, `.cache/compact.png`, `.cache/panel.png`, `.cache/panel-settings-380.png`, `.cache/agents.png`, `.cache/ports.png`. Bunlar gerçek kullanım bilgisi içerebildiğinden Git dışında tutulur.

## Tasarım teslim kontrolü

- Hard Gate PASS: üretim derlemesi ve gerçek Electron kontrolleri geçti; bağlantı/yükleme/boş/hata durumları mevcut, sahte kota ve pazarlama sayıları yok. Görünür eylemlerin kaynak bağlantıları incelendi; ana akışlar tıklanarak doğrulandı. Hesap girişi, dış kullanım sayfaları ve gerçek masaüstü kısayolu için canlı kabul sınırı yukarıda belirtilir.
- Purpose Gate PASS: renk, tipografi, kart grupları, maskot ve geçişlerin amacı `SPEC.md` içinde yazılı. Gerçek kota dışında dekoratif grafik kullanılmıyor.
- Liveliness PASS: ENERGY 2 / RHYTHM 2 / MOTION 2; kalan yüzdeler odak noktası, sağlayıcı grupları içerik düzenini belirliyor, hareket azaltma tercihi uygulanıyor.
- Craftsmanship PASS: ana/dar/kompakt görünümler kontrol edildi; belirsiz çalışma durumları ve eksik limitler açıkça belirtiliyor. Kontrol edilmeyen bir özelliğe test edildi denmiyor.

## Hedef içinde açık kalan işler

1. Cursor, Claude ve Antigravity için kanıtlı Working / Blocked / Done / Idle olayları. Şimdilik süreç varlığı tek başına çalışma durumuna çevrilmiyor; Codex task olayları okunabiliyor.
2. Çok pencereli IDE'lerde belirli proje/oturum penceresine tam odaklanma. Şimdiki odaklanma uygulama düzeyinde.
3. Claude hesabı edinildiğinde gerçek giriş ve kullanım yanıtının uçtan uca testi.

Windows gerçek cwd okuması tamamlandı ve gerçek alt klasör testiyle doğrulandı. Erişilemeyen süreçlerde yeniden başlatma kapalı tutulur. PEB yerleşimi işletim sisteminin iç yapısı olduğundan gelecekteki Windows sürümlerinde tekrar doğrulanmalıdır. İlgili API sınırı [Microsoft'un NtQueryInformationProcess belgesinde](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess) açıklanır. Sabitleme düzeltmesi [kullanılan Electron sürümünün pencere uygulaması](https://github.com/electron/electron/blob/v44.9.0/shell/browser/native_window_views.cc) ve gerçek pencere testiyle karşılaştırıldı.

Herdr entegrasyonu PRD'de isteğe bağlıdır; uygulanmadı ve zorunlu tamamlanma kapısı sayılmaz.

Ana hedef bu maddeler için açık tutulur. Kota ekranının çalışması bütün izleme PRD'sinin tamamlandığı olarak işaretlenmez.
