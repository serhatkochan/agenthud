mod app;
mod ghost;
mod layout;
pub mod models;
pub mod ports;
pub mod providers;
pub mod system;
pub fn run() {
    if std::env::args().any(|arg| arg == "--live-check") {
        let runtime = tokio::runtime::Runtime::new().expect("Kontrol başlatılamadı");
        let results = runtime.block_on(async {
            let system = system::inventory(false).unwrap_or_default();
            let mut rows = vec![];
            for id in ["cursor", "antigravity", "codex"] {
                let result = providers::read_provider(id, &system).await;
                rows.push(serde_json::json!({
                    "id": id,
                    "status": result["status"],
                    "quotaCount": result["quotas"].as_array().map(Vec::len).unwrap_or(0)
                }));
            }
            rows
        });
        println!("{}", serde_json::to_string(&results).unwrap());
        return;
    }
    let mut context = tauri::generate_context!();
    if let Some(profile) = std::env::var_os("AGENTHUD_PROFILE_DIR") {
        use sha2::{Digest, Sha256};
        let path = std::path::absolute(&profile).unwrap_or_else(|_| profile.into());
        let identity = path.to_string_lossy().replace('/', "\\").to_lowercase();
        context.config_mut().identifier = format!(
            "com.agenthud.profile.{:x}",
            Sha256::digest(identity.as_bytes())
        );
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            app::recover(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| app::shortcut(app, event.state))
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            app::snapshot,
            app::refresh,
            app::open_usage,
            app::connect_provider,
            app::window_action,
            app::set_settings,
            app::port_action,
            app::set_hotspot
        ])
        .on_window_event(app::close)
        .setup(app::setup)
        .run(context)
        .expect("AgentHUD başlatılamadı");
}
