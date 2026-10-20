# AgentHUD

Cursor, Codex ve Antigravity kalan haklarını tek şeffaf çubukta gösteren Windows uygulaması. Arayüz Rust ile çizilir. Electron, WebView veya Node çalışmaz.

Görev Yöneticisi'nde yaklaşık **4 MB** bellek kullanır.

## İndir

[AgentHUD.exe](https://github.com/serhatkochan/agenthud/releases/latest/download/AgentHUD.exe)

Windows 10 veya 11. Kurulum yok; dosyayı açman yeterli.

Site: [agenthud.serhatkochan.com](https://agenthud.serhatkochan.com)

## Ne gösterir

Sıra yukarıdan aşağı Codex, Cursor, Antigravity. Yüzde **kalan** haktır.

- Codex plan pencereleri
- Cursor Models ve Other Models
- Antigravity model grupları: haftalık, 5 saatlik, Gemini 4 Argon ve dönen diğer gruplar

Çubuk her zaman üsttedir, sürüklenir ve dakikada bir yenilenir. × kapatır. Oturumlar yalnızca bu cihazda okunur; arayüze parola veya token gitmez.

## Geliştirme

Rust MSVC araç zinciri gerekir.

```powershell
cargo run --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml
```

Yayın dosyası `src-tauri/target/release/agenthud.exe`.
