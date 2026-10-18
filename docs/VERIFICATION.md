# AgentHUD 0.7.0 · Rust + Tauri kontrol kaydı

18 Ekim 2026. Bu kayıt güncel Rust + Tauri sürümüne aittir. Eski Electron paketleri ve rapor arşivi çalışma klasöründen kaldırıldı; geçmişleri Git'te bulunabilir.

## Kaynak ve test

- `cargo test --manifest-path src-tauri/Cargo.toml`: **63 başarılı, 0 başarısız, 1 isteğe bağlı etkileşimli test atlandı**. Gerçek ön plan denemesi genel testte Windows odağını değiştirmemek için atlanır; ayrı WebView2 akışında kendi iki test penceresiyle ayrıca çalıştırıldı.
- Testler gerçek Cursor SQLite dosyasını değiştirmeden okuma, hesap kimliği, sıfır/eksik kotalar, eski veri, zaman aşımı, yönlendirme, yarım/4 MiB üstü HTTP yanıtı, port PID/oluşturulma kimliği, pencere kimliği, olay sırası ve DPI/ekran sınırlarını kapsar.
- Windows yerel testinde kendi PowerShell TCP sunucusu keşfedildi. Yanlış oluşturulma kimliği durdurmayı reddetti ve sunucu açık kaldı. Doğru süreç durdurulup aynı komut, Unicode/apostrof içeren gerçek çalışma klasörü ve Windows argümanlarıyla tekrar başlatıldı. Kullanıcının sunucuları durdurulmadı.
- Gerçek Windows Cursor gözlemcisi geçici profilde nötr `{}` döndürdü; yalnızca yaşam döngüsü bilgisi kaydetti. Mevcut kancaları ve özgün dosya yedeğini koruma, bozuk ayarı reddetme ve yalnızca kendi gözlemcisini kaldırma testleri geçti.
- TypeScript + Vite üretim derlemesi geçti. Aktif `package.json`, kilit dosyası ve uygulama ağacında Electron/Koffi bağımlılığı yoktur.
- Bağımsız son incelemenin tek önemli bulgusu tek örnek korumasıydı. İkinci açılış regresyonu gerçek eski EXE'de önce başarısız oldu; resmî Tauri eklentisi ilk sıraya eklendikten sonra ikinci süreç 0 ile çıkıp gizli mevcut paneli geri getirdi. İncelemeci dar düzeltmede engel bulmadı.

## Gerçek masaüstü

`scripts/verify-tauri.mjs` uygulamanın kendi WebView2 penceresine ayrı test profili üzerinden bağlanır. `scripts/tauri-window.ps1`, yalnızca testin sahip olduğu PID ve doğrulanan HWND için Windows pencere bayraklarını okur; yeniden boyutlandırma dar ekran kontrolü içindir. Renderer'a HWND verilmez.

Geliştirme EXE'sinde geçen kontroller:

- Gerçek oturumlarla **Cursor: 2, Antigravity: 5, Codex: 1** kota ölçümü. Bağımsız Claude sağlayıcısı yok; üç kart ve üç gezinme sekmesi.
- Cursor bağlantısını arayüzden açma → resmî biçimde düşünce olayı → Çalışıyor → bitiş olayı → Tamamlandı → bağlantıyı kaldırma. Kullanıcının asıl `.cursor` ayarları değiştirilmedi.
- Ayrı iki Rust penceresini Cursor adıyla açma, seçim diyaloğu ve küçültülmüş hedefi seçme. Windows'un gerçek ön plan penceresi hedef oldu, hedef geri yüklendi ve HUD kompakt kaldı. Kullanıcının IDE pencerelerine odaklanılmadı.
- 48 px kompakt çubuk, 420 px panel, 380 px pencere/ayarlar; yatay taşma yok. Sabitleme gerçek `WS_EX_TOPMOST` ile açma/kapamada doğrulandı.
- Hayalet modu gerçek `WS_EX_TRANSPARENT` bayrağı ve maskot alanına göre kontrol edildi; kapatınca etkileşim geri geldi. Küçültme, gizleme ve tekrar gösterme gerçek native bayraklarla geçti.
- Görünüm geçişindeki Ghost kilidi/Tauri ana iş parçacığı bekleşmesi bulundu ve düzeltildi. Aynı uçtan uca kontrol düzeltmeden sonra geçti. Ayrılmış maskot DOM elemanının boş dikdörtgen bildirimi de düzeltildi; son çalışmada renderer sayfa hatası yok.

Bu kontrollerde oluşan ekran görüntüleri, makine sonuçları ve geçici profiller çalışma klasörü temizliğinde silindi. Tekrar üretmek için README'deki derleme ve `pnpm test:ui` adımlarını kullan; yeni çıktılar `.cache/` altında oluşur. Canlı kullanım ve proje bilgisi içerebildikleri için Git dışında tutulur.

## Dağıtım

`pnpm package` başarılı: optimize Rust EXE ve x64 NSIS yükleyicisi üretildi. Yukarıdaki tüm WebView2 ekran/pencere akışı **son üretim EXE'sinde tekrar geçti**; renderer sayfa hatası yok. Üç sağlayıcıya ek olarak 3 / 3 bağlantı sayacı doğrulandı. Tek örnek ikinci açılış testi geçti.

Son üretim kontrolünde kendi Node TCP test sunucusu arayüzden durdurulup yeniden başlatıldı. Yanıttaki PID değişti; rastgele test kimliği ve Unicode/apostrof içeren `cwd` birebir aynı kaldı. Yalnızca testin kendi portuna dokunuldu. Bu sunucunun Node çalışma ortamı test içindir; dağıtıma Node eklenmez.

| Dosya | Boyut | SHA256 |
| --- | --- | --- |
| `release/AgentHUD-0.7.0-Setup.exe` | 4.188.898 bayt | `42bdb99f79b7abed6ca4f6f48ff2660d5588d28fe13b340bfe984962587f14d9` |
| `release/AgentHUD-0.7.0-Windows.exe` | 15.228.416 bayt | `84306f0edd884f0b29e7febf69f660a2d803ddb9f9966087eb2b047aa168db68` |

İki dosyanın imzası `NotSigned`. Kurulumun kullanıcı hesabına gerçekten kurulması bu geliştirme kontrolünde yapılmadı; yükleyici üretildi ve onun paketlediği uygulama EXE'si çalıştırıldı. Kopyalanmış son EXE'de `--live-check` tekrar **Cursor 2 / Antigravity 5 / Codex 1, üçü bağlı** döndürdü. `release/SHA256SUMS.txt` yalnızca mevcut iki Tauri paketinin doğrulama değerlerini içerir.

## Kabul sınırları

Cursor'un gerçek IDE görevinden olay alması kullanıcı bağlantısı etkinleşince doğrulanmalıdır. Ayrı profildeki resmî biçimli olaylar bu canlı kabulün yerine geçmez. Bütün gerçek IDE/terminal ortamları odaklanma için denenmedi. Alt basılı tutmanın fiziksel klavye kabulü yapılmadı; durum geçişi mantık testlerinde kapsandı. Önceki Electron fiziksel kontrolleri yeni sürümün kanıtı değildir.

Kaynağın döndürmediği onay veya tamamlanma durumları uydurulmaz. Herdr isteğe bağlıdır ve uygulanmadı. Claude entegrasyonu son istekle kaldırıldığı için Claude hesabı/giriş testi beklenmiyor. Windows paketi imzasızdır; WebView2 çalışma ortamı gerekir.
