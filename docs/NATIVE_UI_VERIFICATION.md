# Yerel ada arayüzü kontrolü

20 Ekim 2026. Uygulama Rust / Windows API ile çalışır; yeni bağımlılık eklenmedi.

## Davranış

- Uygulama yatay özetle açılır. Bu hesaptaki ölçümlerle 692 × 50 piksel.
- AgentHUD başlığındaki **+** bütün limitleri açar; **−** yatay özete döner. Açık görünüm bu hesaptaki ölçümlerle 368 × 322 piksel.
- Başlıktan sürükleme ve **×** ile uygulamayı kapatma gerçek pencerede kontrol edildi. Space ile görünüm değiştirme de denendi.
- Codex, varsa 5 saatlik pencereyi seçer; yalnız haftalık dönen hesap haftalık olarak gösterilir.
- Cursor Models, Other Models havuzuyla değiştirilmez.
- Antigravity’de Gemini, Argon ve Other Models ayrı kalır. Kısa pencere varsa o seçilir; yoksa mevcut haftalık pencere kullanılır.
- Bir grubun haftalık hakkı bitmişse özette o grup %0 olur. Başka grupların yüzdesi bundan etkilenmez. Devre dışı pencere kullanılabilir %100 olarak gösterilmez.
- Veri alınamaması %0’a çevrilmez. Durum metni gösterilir.
- Yenileme yalnız sağlayıcı verilerini günceller; görünüm seçimini değiştirmez.

## Doğrulama

- Yeni seçim kuralları için **7 test**, önce başarısız oldukları görülerek eklendi.
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: **32 başarılı test**.
- `cargo build --release --offline --manifest-path src-tauri/Cargo.toml`: başarılı.
- `git diff --check`: başarılı.
- Üretim derlemesi gerçek hesaplarla açıldı; kısa görünüm, geniş görünüm, yeniden açılış ve pencere kontrolleri yerel Windows penceresinde incelendi.
- Son ölçüm: yaklaşık **23 MB çalışma kümesi**, **5 MB özel bellek**. Derlenen EXE: **5.224.960 bayt**. Bellek değeri sabit bir üst sınır değildir.

Yerel ekran görüntüleri `.cache/native-expanded.png` ve `.cache/native-compact.png` altında; bu dosyalar Git’e eklenmez.

Bu çalışma yerel uygulama değişikliğidir. Yeni bir GitHub Release oluşturulmadı.
