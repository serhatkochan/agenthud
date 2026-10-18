# Ajan durumu için doğrulanan kaynaklar

18 Ekim 2026. Kota erişiminden ayrı, salt okunur inceleme.

## Antigravity

Açık uygulamanın yerel language server'ında `GetAllCascadeTrajectories` isteği HTTP 200 döndü. Aynı servis ve CSRF bağlamı kota isteğinde zaten kullanılıyor. Yanıtta `trajectorySummaries` sözlüğü var. Gözlenen alanlar:

- Sözlük anahtarı ve `trajectoryId`: oturum kimliği.
- `status`: iki gerçek kayıtta `CASCADE_RUN_STATUS_IDLE`.
- `lastModifiedTime`, `createdTime`, `lastUserInputTime`: tarih alanları.
- `workspaces[].workspaceFolderAbsoluteUri`: proje klasörünün `file:` URI'si.
- `trajectoryMetadata.workspaces` ve `workspaceUris`: alternatif proje alanları.

Kurulu language server ikilisinde `CASCADE_RUN_STATUS_IDLE`, `BUSY`, `RUNNING`, `CANCELING` ve `UNSPECIFIED` enum adları doğrulandı. Idle → Boşta, Busy → Meşgul, Running → Çalışıyor, Canceling → Durduruluyor eşleştirmesi kullanılıyor. Bilinmeyen değerler, UNSPECIFIED dahil, bilinmiyor olarak kalır. Ayrı bir onay bekleme veya tamamlandı durumu gözlenmedi; Idle tamamlanma kanıtı sayılmaz.

`electron/antigravity-client.mjs` bu kaynağı 5 saniyelik ajan kontrolüne bağlar. Birden fazla language server'dan gelen oturumlar kimlikle birleştirilir; yeni kayıt tercih edilir. Proje `file:` URI'sinden alınır. İstem, yanıt ve sohbet başlıkları arayüze aktarılmaz. Yerel istek 1.6 saniye ve 4 MiB ile sınırlıdır; yönlendirme izlenmez. Servis okunamazsa süreç satırı çalışma durumu bilinmiyor olarak gösterilir.

İstek ve yanıt incelemesi `.research/agent-probe.mjs` içinde, istem/yanıt ve başlık metinleri maskelenerek yapıldı. Kimlik bilgileri rapora yazılmadı. Gerçek uygulamada iki Idle oturumu ve proje klasörleri görüldü; çalışan/onay bekleyen bir kullanıcı oturumu test amacıyla başlatılmadı. Diğer enum eşleştirmeleri yerel yanıt örnekleriyle test edildi.

Resmi [Antigravity hooks belgesi](https://antigravity.google/docs/hooks), `SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse` ve `Stop` olaylarını tanımlıyor. `Stop.fullyIdle` ile arka plan işlerinin bitişi ayrılabiliyor. Bu belgede genel bir onay bekleme olayı görülmedi. Gözlem entegrasyonu, onay kararına müdahale eden çıktı üretmemeli.

## Cursor

Resmi [Cursor hooks belgesinde](https://cursor.com/docs/hooks) `conversation_id`, `generation_id`, `workspace_roots` ve `hook_event_name` ortak alanları doğrulandı. `beforeSubmitPrompt`, `stop`, `sessionStart`, `sessionEnd` gibi yaşam döngüsü olayları var. Çalışma ve bitiş takibi için uygun; onay bekleme olayının ayrı ve güvenilir kaynağı henüz bulunmadı.

Hook kurulumunda mevcut yapılandırma korunmalı, yapılacak değişiklik arayüzde açıklanmalı ve bir izleme hook'u hiçbir komutu kendiliğinden onaylamamalıdır. Henüz kullanıcı profilindeki hook yapılandırmaları değiştirilmedi.
