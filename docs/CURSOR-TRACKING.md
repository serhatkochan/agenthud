# Cursor oturum takibi

Yerel kullanıcı bağlantısı. Kullanıcı, Ajanlar ekranından gözlemciyi açar veya kapatır. Mevcut `~/.cursor/hooks.json` ayarları korunur; değişiklikten önce özgün dosya yedeklenir. Geçersiz JSON ve bilinmeyen yapılandırma sürümü değiştirilmez. Testler ayrı profil klasörlerinde çalışır.

## Sözleşme

Gözlemci yalnızca `sessionStart`, `afterAgentThought`, `afterAgentResponse`, `stop` ve `sessionEnd` olaylarına eklenir. İzin ve araç çalıştırma kancalarına eklenmez; çıktısı boş JSON nesnesidir. Komut onaylamaz, ek görev veya otomatik yeniden deneme üretmez. Kaynak: [Cursor hooks](https://cursor.com/docs/hooks).

Olay dosyası: `{version:1,event,conversationId,generationId,roots,at,status?,reason?}`. Sohbet metni, düşünce içeriği, e-posta, araç komutu ve kimlik bilgileri saklanmaz. Dosya adı kullanıcı verisinden bir yol oluşturmaz. Gözlemci gelen JSON'u sınırlar; yalnızca izin verilen alanları çıkarır.

`sessionStart` → Boşta. Düşünce veya yanıt olayı → Çalışıyor. `stop.completed` → Tamamlandı; `aborted` → Boşta; `error` → Hata ile durdu, çalışma durumu bilinmiyor. `sessionEnd` kapanışı yalnızca oturumun kapandığını gösterir. Ayrı bir onay bekleme olayı yoktur; pre-tool veya CPU etkinliği onay bekleme kanıtı sayılmaz.

İlk düşünce/yanıt olayı gelene kadar çalışma durumu bilinmeyebilir. Aynı turdaki bitiş olayı geç gelen çalışma olayına üstün gelir. Önceki turun bitişi yeni turun çalışma durumunu kapatmaz. Çalışma olayından 15 dakika sonra yeni kanıt yoksa durum bilinmiyor olur. Son 24 saatin kayıtları gösterilir.

Bir tarama en yeni 4096 olay dosyasıyla sınırlıdır. Olaylar kullanıcıya ait `.cursor/agenthud/events` klasöründedir; bitiş olaylarında 24 saatten eski gözlemci dosyaları temizlenir. Başka dosyalar temizlenmez. Yapılandırmadaki AgentHUD komutları, sürümlü sahiplik başlığı ve doğru yerel veri klasörüyle tanınır; eski gözlemci uygulaması da kaldırılabilir.

Gözlemci Windows PowerShell komutuyla çalışır; ek Node kurulumu ve uygulamanın açık kalması gerekmez. Uygulamanın kotaya erişimi ve bu isteğe bağlı bağlantı birbirinden bağımsızdır. Takibi kapatmak yalnızca AgentHUD'un eklediği gözlemci komutlarını kaldırır.
