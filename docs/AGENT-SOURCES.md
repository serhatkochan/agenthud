# Ajan durumu kaynakları · Tauri 0.7.0

18 Ekim 2026. Kota okuma ve ajan durum takibi birbirinden bağımsızdır. `app.rs` oturumları 5 saniyelik, geciken turları atlayan zamanlayıcıyla okur. Süreç varlığı veya CPU etkinliği çalışma/onay durumu sayılmaz.

## Antigravity

`providers.rs`, bulunan yerel language server'a `GetAllCascadeTrajectories` isteği gönderir. Yalnızca `127.0.0.1`, bulunan port ve CSRF bağlamı kullanılır. Yönlendirme izlenmez; süre 1.6 saniye, yanıt sınırı 4 MiB'dir. Yerel HTTPS sertifika istisnası uzak sağlayıcı istemcisine uygulanmaz.

`trajectorySummaries`, oturum kimliği, çalışma alanının `file:` URI'si ve etkinlik tarihi okunur. Birden fazla servisin kayıtları kimlikle birleştirilir; yeni kayıt tercih edilir. İstem, yanıt ve sohbet başlıkları aktarılmaz.

`IDLE` → Boşta, `BUSY` → Meşgul, `RUNNING` → Çalışıyor, `CANCELING` → Durduruluyor. Bilinmeyen durum bilinmiyor kalır. Ayrı onay bekleme veya tamamlanma kanıtı bulunmadığından Idle, Tamamlandı olarak gösterilmez. Gerçek Idle oturumları okundu; diğer enumlar kontrollü yanıtlarla sınandı.

## Cursor

`cursor_tracker.rs` isteğe bağlı kullanıcı bağlantısını yönetir. Windows gözlemcisi `native/cursor.ps1` dosyasıdır. Kullanıcı Ajanlar ekranındaki bağlantı diyaloğundan etkinleştirir; kendi `hooks.json` dosyası yedeklenir ve mevcut kancalar korunur.

`sessionStart`, `afterAgentThought`, `afterAgentResponse`, `stop`, `sessionEnd` izlenir. Yalnızca olay türü, oturum/tur kimliği, proje ve zaman saklanır. Boş JSON çıktısı izin kararı veya ek görev üretmez. Bozuk/bilinmeyen yapılandırma değiştirilmez. Ayrıntı `CURSOR-TRACKING.md` içindedir.

Gerçek PowerShell gözlemcisine resmî biçimde örnek olay → Rust okuyucu → WebView2 arayüz zinciri ayrı profilde doğrulandı. Kullanıcının asıl IDE ayarları değiştirilmedi. Gerçek Cursor görevinden olay alma kabulü kullanıcı bağlantıyı etkinleştirdiğinde yapılmalıdır. Kaynak: [Cursor hooks](https://cursor.com/docs/hooks).

## Codex

`sessions.rs`, yerel güncel oturum kayıtlarının sınırlı kuyruğundan task başlangıç/bitiş ve doğrulanabilir olayları okur. Boşta ile tamamlanma ayrılır; eski/eksik kanıt bilinmiyor olarak kalır. Token, istem ve yanıt metni arayüze gönderilmez. Oturumlar sınırlı sayıda ve sürede okunur.

Bağımsız Claude sağlayıcısı ve gözlemcisi kullanıcı isteğiyle kaldırıldı. Antigravity'nin Claude/GPT kota grubu bu karardan bağımsızdır.
