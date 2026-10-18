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

0.4.0'da `electron/cursor-tracking.mjs` ve Windows PowerShell gözlemcisi bu bağlantıyı sağlıyor. Ajanlar ekranındaki kullanıcı eylemiyle etkinleşir. Yalnızca sessionStart, afterAgentThought, afterAgentResponse, stop ve sessionEnd izlenir. İzin kancalarına eklenmez; boş JSON çıktısı komut onayı veya takip görevi üretmez. Düşünce/yanıt metni alınsa bile yalnızca olay türü, proje, oturum/tur kimliği ve zaman diske yazılır.

Yapılandırma değişimi özgün baytları yedekler; geçersiz UTF-8/JSON ve bilinmeyen sürüm değiştirilmez. Kaldırma yalnızca doğru veri klasörüne sahip AgentHUD v1 gözlemcilerini hedefler. Geç gelen bitiş ve yeni tur olayları ayrı değerlendirilir.

Gerçek Windows gözlemcisi ve arayüz bağlantısı, resmî biçimdeki örnek olaylarla geçici Cursor profillerinde doğrulandı. Çalışma ve bitiş satırları 5 saniyelik taramayla göründü; kaldırma ve bozuk ayarı koruma sınandı. Kullanıcının asıl `.cursor/hooks.json` dosyası hâlâ yok; kullanıcı profilindeki hook yapılandırmaları değiştirilmedi. Gerçek IDE'den olay alma kabulü, kullanıcı bağlantıyı etkinleştirdikten sonra yapılmalı. Ayrıntı `CURSOR-TRACKING.md` içinde.

## Claude Code

0.6.0'da isteğe bağlı kullanıcı ayarı bağlantısı eklendi. UserPromptSubmit, PostToolUse/PostToolUseFailure, Notification, Stop/StopFailure ve SessionStart/SessionEnd olayları izlenir. İzin bildirimi bekleme kanıtıdır; izin kararını veren kancalar kullanılmaz. Yanıt bitişi bütün hedefin bittiği iddiasını taşımaz. Kullanıcının Claude hesabı olmadığı için canlı oturum test edilmedi. Ayrı profilde gerçek Windows gözlemcisi, bağlantı diyaloğu, çalışma/onay/devam/bitiş ve kompakt maskot kontrol edildi. Ayrıntı ve kaynak `CLAUDE-TRACKING.md` içinde.
