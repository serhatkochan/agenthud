# Claude Code durum takibi

0.6.0. Ajanlar > Claude Code durum takibi > Bağla ile açılır. Bu bağlantı Claude abonelik kotası için giriş yapmaz. Kullanıcının şu anda Claude hesabı yok; canlı Claude oturumu ve kota girişi doğrulanmış değildir.

İşlemden önce değişecek dosya arayüzde gösterilir. Kullanıcı ayar dosyasının özgün baytları yedeklenir. Diğer kancalar, eşleştiriciler ve izin kuralları korunur. Kapatma yalnızca AgentHUD komutlarını çıkarır; aynı gruba sonradan eklenen başka komutları korur. Geçersiz veya okunamayan dosya değiştirilmez. Değişiklik sırasında dosya farklılaşırsa işlem reddedilir. Tüm kancaları kapatan kullanıcı tercihi değiştirilmez.

Varsayılan dosya `~/.claude/settings.json`; uygulamanın ortamında `CLAUDE_CONFIG_DIR` varsa o klasör kullanılır. `AGENTHUD_CLAUDE_DIRECTORY` test profili için önceliklidir. Birden çok Claude profilini toplamaz. Proje ve kurum ayarları bağlantının çalışmasını etkileyebilir; ilk olay gelmeden aktif bağlantı iddiasında bulunulmaz.

## Olaylar ve sınırlar

Kaynak: [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Claude yapılandırma klasörü](https://code.claude.com/docs/en/claude-directory).

- SessionStart → Boşta; UserPromptSubmit → İstek gönderildi.
- PostToolUse / PostToolUseFailure → Çalışıyor. Başarısız bir araç tek başına bütün görevin bittiği anlamına gelmez.
- Notification.permission_prompt → Onay bekliyor. Bildirim gecikebilir; bu olay bulunmayan eski sürümlerde onay takibi yoktur. Notification.idle_prompt → Boşta.
- Stop → Yanıt tamamlandı. Arka plan işi bildirildiyse Arka plan işi sürüyor. Yanıtın bitişi bütün proje hedefinin tamamlandığı anlamına gelmez; başka bitiş kancaları yeni çalışma başlatabilir.
- StopFailure → Hata ile durdu; SessionEnd → Oturum kapandı.

PermissionRequest ve PreToolUse bağlantıları kurulmaz. Alt ajan olayları ana oturum durumunu değiştirmez. Kesilen bir kullanıcı isteği Stop üretmeyebilir. Çalışma veya onay bekleme için 15 dakika yeni olay yoksa durum bilinmiyor olur; son 24 saat görünür. Olay sıralaması gözlemci sürecinin başlangıç zamanına dayanır; Claude olayında Cursor'daki gibi tur kimliği yoktur.

## Saklanan bilgiler ve kontrol

PowerShell gözlemcisi yalnızca olay türü, oturum kimliği, proje klasörü, zaman, izin bildirimi türü ve arka plan işi var/yok bilgisini yazar. İstem, yanıt, bildirim metni, araç komutu veya hata ayrıntısı saklanmaz. Çıktı `{}`, çıkış kodu 0'dır; izin, devam veya yeniden deneme kararı üretmez. Ek Node kurulumu gerektirmez. Ayarlarda eşzamanlı command hook olarak üç saniye süre sınırı vardır.

Kayıtlar profilin `agenthud/events` klasöründedir. Tarama en yeni 4096 kayıt ve kayıt başına 64 KiB ile sınırlıdır. Gözlemci bitişte yalnızca kendi dosya biçimindeki 24 saatten eski kayıtları temizler.

`pnpm test:claude`, gerçek Windows gözlemcisini ayrı ayar klasöründe resmî biçimdeki örnek olaylarla çalıştırır. Bağlantı diyaloğu, 380 px görünüm, çalışma/onay/devam/yanıt bitişi, kompakt maskot, kaldırma ve bozuk dosyayı koruma kontrol edilir. Bu, canlı Claude Code'dan olay alındığı veya bir hesabın kullanım verilerinin doğrulandığı anlamına gelmez. Bağlantı etkinleştirildikten sonra Claude Code oturumunu yeniden açmak gerekir.
