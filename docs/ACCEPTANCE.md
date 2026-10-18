# Kabul durumu · 0.6.0

Kaynak: kullanıcının üç görüntüsü ve Gemini PRD'si. Bu tablo bütün hedefin tamamlandığını iddia etmez; çalıştırılan kontrollerin ayrıntıları `VERIFICATION.md` içindedir.

| İstenen davranış | Güncel kanıt | Durum |
| --- | --- | --- |
| Cursor Models ve Other Models ayrı kalan limitleri | Yerel kullanıcı oturumu → kullanım yanıtı → iki ayrı ölçüm; gerçek Electron kartları ve ayrıştırıcı testleri | Doğrulandı |
| Antigravity View Usage model grupları ve zaman pencereleri | Üç gerçek grup, beş ölçüm; haftalık tükenince kapatılan pencere ayrı gösterilir | Doğrulandı |
| Claude kalan limitleri ve yenilenme zamanı | Okuyucu ve giriş arayüzü var; oran/sıfır/eksik alan testleri var. Kullanıcının hesabı yok; canlı oturum ve kullanım yanıtı yok | Canlı kabul engeli |
| Codex abonelik pencereleri | Gerçek mevcut hesapta bir pencere, tanımlı süre ve yenilenme; API parasına dönüştürülmez | Doğrulandı |
| Hata, eksik veri, hesap değişimi, eski ölçüm | Ayrıştırıcı/birleştirme testleri, giriş gerekli görünümü, zaman damgaları | Uygulandı; her sağlayıcının her canlı hata türü oluşturulmadı |
| Normal, yüzen ve küçük görünüm, sabitleme, tepsi | Gerçek Electron ve native pencere kontrolleri; 48 px çubuk, 380 px dar görünüm; 0.5'te ekran sınırı düzeltmesi | Doğrulandı |
| Maskot ve düşük kota uyarısı | Ölçülen kota ve kanıtlı çalışma/onay durumlarından görünüm; Claude örnek olayıyla kompakt onay maskotu | Uygulandı ve örnek olayla doğrulandı |
| Hayalet modu, maskot istisnası ve geri çağırma | Windows tıklama geçişi bayrağı; gerçek fareyle maskot, fiziksel geri çağırma kısayolu | Doğrulandı; Alt basılı tutma fiziksel kabulü bekliyor |
| Ajan çalışma/bitiş/onay/boşta ve proje | Gerçek Antigravity Idle ve Codex task olayları; Cursor/Claude gözlemcileri gerçek Windows süreçleri ve örnek olaylarla bağlı | Kaynakta olmayan durumlar uydurulmaz; Cursor/Claude canlı IDE/CLI kabulü bekliyor |
| İlgili IDE/terminale odaklanma | Ayrı süreçte iki kontrollü pencereyle native ön plan tanıtıcısı doğrulandı; belirsizlikte seçim, küçültülmüş pencere, eski seçim ve 380 px kontrolü | Mekanizma doğrulandı; tüm gerçek IDE/terminal ortamlarının kabulü bekliyor |
| Geliştirme portları, PID, klasör, IDE ilişkisi ve proje adı | Gerçek TCP envanteri ve cwd, paket/Go modül adı; Go/Cargo alt süreç ve kimlik değişimi testleri | Uygulandı; derleyici deneyinde gerçek Go/Rust yerine süreç biçimi örneği kullanıldı |
| Port açma/durdurma/aynı komutla başlatma ve 10 dk hafıza | Ayrı HTTP sunucusunda stop/restart ve cevaptaki gerçek cwd; yeniden keşif; 10 dk kayıt testi | Doğrulandı; kullanıcının sunucularına müdahale edilmedi |
| Yetim port | Üst süreç yokluğu işaretlenir; tek başına kesin zombi denmez | Uygulandı |
| Windows dağıtımı | Portable EXE, checksum; paket içi uygulamada Electron kontrolleri; imzasız | Üretildi; dış portable sarmalayıcının fiziksel açılışı ayrıca sınanmadı |
| Herdr | PRD'de isteğe bağlı | Uygulanmadı |

PRD'deki teknoloji yığını ve ekran çizimleri öneridir: Electron/React seçiminin nedeni `SPEC.md` içindedir. Sağlayıcının gerçekten döndürmediği fast-request sayısı, mesaj adedi, API doları veya CPU'dan türetilen onay durumu eklenmedi. Özgün amaç, ekran görüntülerindeki gerçek abonelik limitlerine erişmektir.

Son sürümün bağımsız kontrolleri bittiğinde kalan temel engeller kullanıcı oturumu ve fiziksel kabul gerektirir. Bunlar için hedef tamamlandı sayılmaz. Kullanıcının Claude hesabı olmadığını söylediği bilgi korunur; yeniden hesap açması istenmez.
