# Kabul durumu · Rust + Tauri 0.7.0

Kaynak: kullanıcının Gemini PRD'si, üç ekran görüntüsü ve son teknoloji/kapsam yönlendirmesi. Son komutlar ve kanıt `VERIFICATION.md` içindedir.

| İstenen davranış | Kanıt ve sınır |
| --- | --- |
| Rust + Tauri masaüstü uygulaması | Rust çekirdeği, Tauri IPC, gerçek WebView2. Aktif kaynak ve bağımlılıklarda Electron/Koffi yok |
| Claude kısmının iptali | Bağımsız sağlayıcı, giriş, kart ve gözlemci kaldırıldı; üç sağlayıcı kaldı |
| Cursor Models / Other Models | Gerçek yerel hesapta iki ölçüm, ayrıştırıcı testleri ve gerçek Tauri kartı |
| Antigravity View Usage | Gerçek hesapta üç model grubu / beş ölçüm; kapalı pencere açıklaması korunuyor |
| Codex plan hakkı | Gerçek hesapta bir pencere; API parası veya mesaj tahmini yok |
| Eksik/sıfır, ağ hatası, hesap değişimi | Rust ayrıştırıcı ve birleştirme testleri; yerel HTTP sınır deneyleri |
| Normal/yüzen/48 px çubuk, ayarlar | Gerçek Tauri penceresinde tıklama ve 380 px taşma kontrolü |
| Sabitleme, küçültme, gizleme, geri çağırma | Gerçek Windows pencere bayraklarıyla kontrol |
| Hayalet modu | Gerçek Windows tıklama geçişi bayrağı ve mantık testleri; fiziksel Alt basılı tutma kabulü bekliyor |
| Ajan çalışma/bitiş/boşta | Yerel Antigravity/Codex kayıtları ve Cursor örnek olay → gerçek gözlemci → Tauri arayüz akışı. Cursor'un gerçek IDE olay kabulü kullanıcı bağlantısından sonra |
| Pencereye odaklanma | Kendi iki Rust test penceresinde seçim, gerçek ön plan ve küçültülmüş pencereyi açma kontrolü; kullanıcının bütün IDE/terminal ortamları denenmedi |
| Port kimliği, gerçek çalışma klasörü, durdur/başlat | Kendi gerçek TCP sunucusunda yanlış oluşturulma kimliğini reddetme, stop/restart ve Unicode/apostrof klasör doğrulaması |
| Windows paketi | NSIS ve doğrudan EXE; son üretim ve hash kaydı `VERIFICATION.md` içinde |
| Herdr | PRD'de isteğe bağlı; uygulanmadı |

Kaynağın sağlamadığı onay veya tamamlanma durumları uydurulmaz. Claude hesabı edinmek artık kabul koşulu değildir. Tauri'ye taşıma, eski Electron kontrollerinin yeni sürümde yapıldığı anlamına gelmez; yalnızca yeni çalıştırmalar güncel kanıttır.
