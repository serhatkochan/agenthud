# Kabul durumu · Rust + Tauri 0.8.0

Güncel kapsam: kullanıcının son isteğiyle **Kota radarı ve Yerel portlar**. Ajanlar bölümü, durum takibi, gözlemci ve pencereye odaklanma sonraki çalışmaya bırakıldı. Bağımsız Claude entegrasyonu da kapsam dışındadır.

| İstenen davranış                           | Kanıt ve sınır                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust + Tauri                               | Rust çekirdeği, dar Tauri IPC, React/WebView2; dağıtımda Electron/Node yok                                                                      |
| İki sekme                                  | Güncel üretim arayüzünün görünmeyen Edge kontrolünde yalnızca Kota radarı ve Yerel portlar                                                      |
| Ajan takibinin kaldırılması                | Rust snapshot regresyonu; takip/odak IPC'si ve arka plan döngüsü silindi. Bu makinenin Cursor ayarlarında AgentHUD gözlemci komutu sayısı sıfır |
| Cursor Models / Other Models               | İki bağımsız kalan yüzde; gerçek yerel hesap ve ayrıştırıcı testleri                                                                            |
| Antigravity View Usage                     | Dönen model grupları ve haftalık/beş saatlik pencereler; sağlayıcının kapattığı pencereler açıklanır                                            |
| Codex                                      | Hesabın döndürdüğü gerçek plan pencereleri; API parası veya mesaj tahmini yok                                                                   |
| Eksik/sıfır, ağ hatası, hesap değişimi     | Güncel Rust ayrıştırıcı ve birleştirme testleri; HTTP süre/boyut/yönlendirme kontrolleri                                                        |
| Port kimliği, durdur/başlat, gerçek klasör | Güncel Windows testinde kendi TCP sunucusuna yanlış kimlik reddi, stop/restart, Unicode/apostrof klasör ve Windows argümanları                  |
| Normal/yüzen/48 px çubuk ve ayarlar        | Güncel tarayıcı kontrolünde 1120/420/380 px taşma yok; iki sekme, boş durum, ayar ve görünüm geçişleri                                          |
| Windows pencere davranışları               | Tauri 0.7.0'da gerçek pencere bayraklarıyla sabitleme, küçültme, tepsi, geri çağırma ve click-through kontrolü; bu kod 0.8.0'da değişmedi       |
| Alt ile geçici panel                       | Kullanıcı gerçek Tauri penceresinde Alt basılıyken açılıp bırakınca çubuğa döndüğünü doğruladı; aynı hayalet modu kodu korunuyor                |
| Dağıtım                                    | Güncel optimize EXE ve NSIS paketi; sonuç/hash kaydı VERIFICATION.md içinde                                                                     |

0.8.0 için native pencere otomasyonu tekrar çalıştırılmadı: kullanıcı masaüstü kontrolünü Escape ile durdurdu. Bu sınır gizlenmez; güncel arayüz ayrı görünmeyen test tarayıcısında, gerçek sağlayıcılar üretim EXE'sinin salt okunur canlı kontrolünde sınanır. Kurulum dosyasının kullanıcı hesabına kurulması geliştirme kontrolünün parçası değildir.
