<h1 align="center">AgentHUD</h1>

<p align="center">Codex, Cursor ve Antigravity limitlerin, masaüstünde küçük bir adada.</p>

<p align="center">
  <a href="https://github.com/serhatkochan/agenthud/releases/latest/download/AgentHUD.exe"><strong>Windows için indir</strong></a> ·
  <a href="https://agenthud.serhatkochan.com">Web sitesi</a> ·
  <a href="https://github.com/serhatkochan/agenthud/releases">Sürümler</a>
</p>

![AgentHUD kota adasının örnek verilerle hazırlanmış önizlemesi](site/assets/preview.jpg)

AgentHUD, AI araçlarında **ne kadar hakkın kaldığını** aynı yerde gösteren kompakt bir Windows uygulamasıdır. Şeffaf ada diğer pencerelerin üzerinde durur. İstediğin yere sürükle; koduna devam et.

Arayüz Rust ve Windows API ile çizilir. Çalışırken Electron, WebView veya Node süreci açılmaz.

> Görsel, örnek verilerle hazırlanmış etkileşimli web önizlemesidir. Gerçek uygulama, kendi hesabından dönen ölçümleri gösterir.

## İndir ve kullan

1. [AgentHUD.exe’yi indir](https://github.com/serhatkochan/agenthud/releases/latest/download/AgentHUD.exe) ve aç. Windows 10 / 11, x64. Kurulum gerektirmez.
2. Cursor’da ve Codex uygulamasında veya CLI’da hesabına giriş yapmış ol. Codex plan limitleri için ChatGPT hesabıyla giriş gerekir; yalnızca API anahtarı yeterli değildir.
3. Antigravity limitlerini de görmek için Antigravity’yi açık tut ve hesabına giriş yap.

Ada ilk açılışta ekranın sağ üstünde görünür. Boş bir yerinden sürükleyerek taşıyabilir, **×** ile kapatabilirsin. Haklar **60 saniyede bir** yenilenir. Ayrı bir AgentHUD hesabı veya elle API anahtarı girişi gerekmez.

## Hangi limitleri gösterir?

Yüzdeler **kalan hakkı** gösterir. Örneğin `%20`, o kullanım havuzunun %20’sinin kaldığı anlamına gelir. Bir aracın farklı havuzları tek yüzdeye düşürülmez.

| Araç | Ayrı ayrı gösterilen ölçümler |
| --- | --- |
| **Codex** | Hesabın döndürdüğü 5 saatlik, haftalık veya aylık kullanım pencereleri. |
| **Cursor** | **Cursor Models** ve **Other Models** kullanım havuzları. |
| **Antigravity** | Gemini Models, Other Models (Claude/GPT), Gemini 4 Argon ve servisin döndürdüğü diğer gruplar. Her grubun haftalık ve 5 saatlik pencereleri ayrı satırlarda. |

Sıra yukarıdan aşağı **Codex → Cursor → Antigravity**. Her hesap aynı pencere ve model gruplarını sunmaz. Veri dönmeyen bir limit için yüzde uydurulmaz; devre dışı pencereler soluk görünür.

## Boyut ve bellek

| Ölçüm | Değer |
| --- | --- |
| v0.9.0 indirme boyutu | **5,2 MB** (5.205.504 bayt) |
| Çalışma kümesi (RAM) | Bu cihazdaki anlık ölçümde yaklaşık **22 MB** |
| Özel bellek (private bytes) | Aynı ölçümde yaklaşık **5 MB** |

Bellek ölçümü 20 Ekim 2026’da çalışan Windows uygulamasından alındı. Çalışma kümesi, özel bellek ve dosya boyutu farklı ölçümlerdir. RAM tüketimi Windows’a, yenileme anına ve çalışma süresine göre değişir; bu değerler sabit bir üst sınır değildir.

## Oturum ve veri akışı

AgentHUD, mevcut uygulama oturumlarını cihazdan okur:

| Araç | Oturum kaynağı | Kullanım sorgusu |
| --- | --- | --- |
| Cursor | Yerel `state.vscdb`, salt okunur erişim | Doğrudan `cursor.com` kullanım servisi |
| Codex | `CODEX_HOME/auth.json` veya `%USERPROFILE%\.codex\auth.json` | Doğrudan `chatgpt.com` kullanım servisi |
| Antigravity | Çalışan dil sunucusu | Cihazdaki yerel kullanım servisi |

Kota sorguları için bir AgentHUD sunucusu bulunmaz. Oturum bilgileri arayüzde gösterilmez. Uygulama, sağlayıcıların kullanım servislerine ve yerel oturum biçimlerine bağlıdır; bunlar değiştiğinde bağlantıların güncellenmesi gerekebilir.

## Bir limit görünmüyorsa

- **Giriş gerekli:** İlgili uygulamada yeniden giriş yap. Codex için ChatGPT hesabını kullan.
- **Bağlantı yok:** İnternet bağlantını ve sağlayıcının durumunu kontrol et. Uygulama sonraki yenilemede tekrar dener.
- **Antigravity görünmüyor:** Antigravity’nin çalıştığını ve oturumunun açık olduğunu kontrol et.
- **Beklediğin bir pencere eksik:** Hesabın veya sağlayıcının yanıtı o pencereyi sunmuyor olabilir. Planına göre gösterilen gruplar değişebilir.

## Kaynak koddan çalıştır

Windows, Rust MSVC araç zinciri ve Visual Studio C++ Build Tools / Windows SDK gerekir. WebView2 veya Node.js gerekmez.

```powershell
git clone https://github.com/serhatkochan/agenthud.git
cd agenthud

# Geliştirme sürümünü aç
cargo run --manifest-path src-tauri/Cargo.toml

# Rust testlerini çalıştır
cargo test --manifest-path src-tauri/Cargo.toml

# Taşınabilir Windows uygulamasını derle
cargo build --release --manifest-path src-tauri/Cargo.toml
```

Çıktı: `src-tauri/target/release/agenthud.exe`.

`src-tauri` klasör adı eski Tauri sürümünden kalır; güncel uygulama doğrudan Windows API kullanır.

```text
site/                         Statik tanıtım sayfası
src-tauri/src/bar.rs           Şeffaf Windows adası ve otomatik yenileme
src-tauri/src/providers.rs     Kota okuma ve sağlayıcı bağlantıları
src-tauri/src/system.rs        Yerel süreç / port keşfi
src-tauri/src/models.rs        Veri yapıları
```

Tanıtım sayfası `site/` içindeki HTML, CSS ve JavaScript dosyalarından oluşur; derleme adımı yoktur. Vercel, `vercel.json` üzerinden bu klasörü yayınlar.

---

[Serhat Kochan](https://serhatkochan.com) tarafından geliştirildi. AgentHUD bağımsız bir projedir; OpenAI, Cursor veya Google’ın resmi ürünü değildir.
