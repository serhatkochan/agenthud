# Pencereye odaklanma

AgentHUD, seçilen oturumun sağlayıcısına ait süreçlerle Windows pencerelerini eşleştirir. Renderer bir pencere tanıtıcısı veya komut vermez; yalnızca mevcut oturum kimliğini ve ana sürecin ürettiği seçim kimliğini gönderir.

- Başlıktaki çalışma alanı adı tek bir pencereyle eşleşiyorsa o pencere açılır. Ad eşleşmesi tam proje yolu kanıtı değildir.
- Tek uygulama penceresi varsa uygulama düzeyinde açılır. Başlık proje kanıtı sayılmıyorsa proje veya sohbet sekmesinin seçildiği iddia edilmez.
- Birden fazla uygun pencere ve belirsiz eşleşme varsa kullanıcı başlık listesinden seçer. Alt dize veya uygulama adının geçmesi tek başına proje eşleşmesi değildir.
- CLI oturumunda ilgili IDE/terminal üst süreci aday olabilir; diğer uygulamaların pencereleri aday değildir.
- Seçim süreli ve oturuma bağlıdır. Seçilen pencerenin süreç kimliği, oluşturulma zamanı ve başlığı tekrar kontrol edilir. Kapanan, değişen veya yeniden kullanılan pencere açılmaz.
- Küçültülmüş pencere geri yüklenir. Windows'un ön plana getirme kuralları aşılmaz; sonuç gerçek ön plan penceresiyle kontrol edilir. Komut çalıştırılmaz ve onay düğmesine basılmaz.
- Başarılı odaklanmada HUD küçük çubuğa döner. Normal görünüme dönüşte boyut ve konum seçilen ekranın çalışma alanına sığdırılır. Genel ajan pencereleri içinde belirli sohbet sekmesi seçilmez.

Kaynaklar: [EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows), [GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid), [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes), [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow).
