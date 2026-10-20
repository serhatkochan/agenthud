mod bar;
mod quota_view;
pub mod models;
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
    bar::run();
}
