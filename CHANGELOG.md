# Değişiklikler

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
