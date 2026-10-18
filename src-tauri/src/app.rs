use crate::{
    ghost::{Ghost, Hotspot},
    layout::{layout, Rect},
    models::{now_ms, Inventory},
    ports::PortManager,
    providers, system,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

pub struct Runtime {
    data: Mutex<Value>,
    ports: Mutex<PortManager>,
    ghost: Mutex<Ghost>,
    raw_providers: Mutex<HashMap<String, Value>>,
    warned: Mutex<HashSet<String>>,
    config: PathBuf,
    refresh_lock: tokio::sync::Mutex<()>,
    refresh_changed: tokio::sync::Notify,
    pub quitting: AtomicBool,
}
fn defaults() -> Value {
    json!({"alwaysOnTop":false,"refreshSeconds":60,"notifications":true,"clickThrough":false,"launchCompact":false})
}
fn settings_from(value: &Value) -> Value {
    let mut result = defaults();
    for key in ["alwaysOnTop", "notifications", "launchCompact"] {
        if let Some(b) = value[key].as_bool() {
            result[key] = b.into();
        }
    }
    if let Some(seconds) = value["refreshSeconds"].as_u64() {
        if [30, 60, 120, 300].contains(&seconds) {
            result["refreshSeconds"] = seconds.into();
        }
    }
    result
}
impl Runtime {
    pub fn new(config: PathBuf) -> Self {
        let existing = std::fs::read(&config)
            .ok()
            .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
            .or_else(|| {
                std::env::var_os("APPDATA")
                    .and_then(|d| {
                        std::fs::read(PathBuf::from(d).join("AgentHUD/settings.json")).ok()
                    })
                    .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
            })
            .unwrap_or(Value::Null);
        let providers = providers::provider_metadata()
            .into_iter()
            .map(|mut p| {
                p["status"] = "loading".into();
                p["quotas"] = json!([]);
                p
            })
            .collect::<Vec<_>>();
        Self {
            data: Mutex::new(
                json!({"providers":providers,"ports":[],"settings":settings_from(&existing),"mode":"dashboard","refreshing":false,"shortcutAvailable":false,"recoveryShortcut":null,"ghostAvailable":false,"ghostPeeking":false}),
            ),
            ports: Mutex::new(PortManager::new()),
            ghost: Mutex::new(Ghost::default()),
            raw_providers: Mutex::new(HashMap::new()),
            warned: Mutex::new(HashSet::new()),
            config,
            refresh_lock: tokio::sync::Mutex::new(()),
            refresh_changed: tokio::sync::Notify::new(),
            quitting: AtomicBool::new(false),
        }
    }
    fn snapshot(&self) -> Value {
        self.data.lock().unwrap().clone()
    }
    fn save(&self, settings: &Value) -> Result<(), String> {
        let folder = self.config.parent().ok_or("Ayar klasörü bulunamadı.")?;
        std::fs::create_dir_all(folder).map_err(|_| "Ayarlar kaydedilemedi.")?;
        let temp = folder.join(format!(".settings-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temp, serde_json::to_vec_pretty(settings).unwrap())
            .map_err(|_| "Ayarlar kaydedilemedi.")?;
        let result =
            std::fs::rename(&temp, &self.config).map_err(|_| "Ayarlar kaydedilemedi.".into());
        let _ = std::fs::remove_file(temp);
        result
    }
}
fn rt(app: &AppHandle) -> Arc<Runtime> {
    app.state::<Arc<Runtime>>().inner().clone()
}
fn emit(app: &AppHandle) {
    let state = rt(app).snapshot();
    let _ = app.emit_to("main", "hud:update", state);
}
fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or("Pencere bulunamadı.".into())
}
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Bu pencereye izin verilmedi.".into())
    }
}
fn bounds(window: &WebviewWindow) -> Result<Rect, String> {
    let p = window
        .outer_position()
        .map_err(|_| "Pencere konumu okunamadı.")?;
    let s = window
        .outer_size()
        .map_err(|_| "Pencere boyutu okunamadı.")?;
    Ok(Rect {
        x: p.x,
        y: p.y,
        width: s.width,
        height: s.height,
    })
}
fn work_area(window: &WebviewWindow) -> Result<Rect, String> {
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let hwnd = window.hwnd().map_err(|_| "Pencere bilgisi okunamadı.")?.0;
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err("Ekran bilgisi okunamadı.".into());
        }
        Ok(Rect {
            x: info.rcWork.left,
            y: info.rcWork.top,
            width: (info.rcWork.right - info.rcWork.left) as u32,
            height: (info.rcWork.bottom - info.rcWork.top) as u32,
        })
    }
}
fn apply_mode(app: &AppHandle, mode: &str, anchor: Option<Rect>) -> Result<Value, String> {
    if !["dashboard", "panel", "compact"].contains(&mode) {
        return Err("Geçersiz görünüm.".into());
    }
    let runtime = rt(app);
    let window = main_window(app)?;
    let current = runtime.snapshot();
    let previous = bounds(&window)?;
    let work = work_area(&window)?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let (rect, minimum) = layout(
        mode,
        current["mode"].as_str().unwrap_or("dashboard"),
        previous,
        work,
        scale,
        anchor,
    );
    window
        .set_ignore_cursor_events(false)
        .map_err(|_| "Fare etkileşimi açılamadı.")?;
    window
        .set_min_size(Some(PhysicalSize::new(minimum.0, minimum.1)))
        .map_err(|_| "Pencere boyutu ayarlanamadı.")?;
    window
        .set_size(PhysicalSize::new(rect.width, rect.height))
        .map_err(|_| "Pencere boyutu ayarlanamadı.")?;
    window
        .set_position(PhysicalPosition::new(rect.x, rect.y))
        .map_err(|_| "Pencere konumu ayarlanamadı.")?;
    window
        .set_always_on_top(
            current["settings"]["alwaysOnTop"]
                .as_bool()
                .unwrap_or(false),
        )
        .map_err(|_| "Sabitleme ayarlanamadı.")?;
    runtime.data.lock().unwrap()["mode"] = mode.into();
    emit(app);
    Ok(runtime.snapshot())
}
pub fn recover(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<Runtime>>() else {
        return;
    };
    let runtime = state.inner().clone();
    runtime.ghost.lock().unwrap().cancel();
    {
        let mut data = runtime.data.lock().unwrap();
        data["settings"]["clickThrough"] = false.into();
        data["ghostPeeking"] = false.into();
    }
    if let Ok(window) = main_window(app) {
        let _ = window.set_ignore_cursor_events(false);
        let _ = apply_mode(app, "panel", None);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    emit(app);
}
fn quit(app: &AppHandle) {
    rt(app).quitting.store(true, Ordering::Relaxed);
    app.exit(0);
}
async fn inventory(working: bool) -> Result<Inventory, String> {
    tauri::async_runtime::spawn_blocking(move || system::inventory(working))
        .await
        .map_err(|_| "Yerel bilgiler okunamadı.".to_string())?
}
async fn refresh_all(app: &AppHandle) -> Value {
    let runtime = rt(app);
    let _guard = runtime.refresh_lock.lock().await;
    runtime.data.lock().unwrap()["refreshing"] = true.into();
    emit(app);
    let system = inventory(true).await;
    let inventory = match system {
        Ok(system) => {
            let rows = runtime.ports.lock().unwrap().scan(&system);
            let mut data = runtime.data.lock().unwrap();
            data["ports"] = rows.into();
            data["systemError"] = Value::Null;
            system
        }
        Err(_) => {
            runtime.data.lock().unwrap()["systemError"] =
                "Port bilgileri okunamadı. Yeniden dene.".into();
            Inventory::default()
        }
    };
    let outcomes = futures_util::future::join_all(
        ["cursor", "antigravity", "codex"]
            .into_iter()
            .map(|id| providers::read_provider(id, &inventory)),
    )
    .await;
    let mut public = vec![];
    let metadata = providers::provider_metadata();
    for (index, next) in outcomes.into_iter().enumerate() {
        let id = metadata[index]["id"].as_str().unwrap();
        let merged = {
            let mut raw = runtime.raw_providers.lock().unwrap();
            let merged = providers::merge_refresh(raw.get(id).unwrap_or(&Value::Null), next);
            raw.insert(id.into(), merged.clone());
            merged
        };
        let mut provider = metadata[index].clone();
        if let Some(fields) = merged.as_object() {
            for (key, value) in fields {
                if !["accountScope", "errorKind"].contains(&key.as_str()) {
                    provider[key] = value.clone();
                }
            }
        }
        public.push(provider);
    }
    let notifications = runtime.snapshot()["settings"]["notifications"]
        .as_bool()
        .unwrap_or(false);
    if notifications {
        let mut warned = runtime.warned.lock().unwrap();
        for p in &public {
            if p["status"] != "connected" {
                continue;
            }
            for q in p["quotas"].as_array().into_iter().flatten() {
                let key = format!("{}:{}", p["id"], q["id"]);
                if q["remaining"].as_f64().unwrap_or(100.) < 20. && q["disabled"] != true {
                    if warned.insert(key) {
                        let _ = app
                            .notification()
                            .builder()
                            .title("AgentHUD · Kullanım hakkın azalıyor")
                            .body(format!(
                                "{} · {}: %{} kaldı",
                                p["name"].as_str().unwrap_or(""),
                                q["label"].as_str().unwrap_or(""),
                                q["remaining"]
                            ))
                            .show();
                    }
                } else {
                    warned.remove(&key);
                }
            }
        }
    }
    {
        let mut data = runtime.data.lock().unwrap();
        data["providers"] = public.into();
        data["refreshing"] = false.into();
        data["refreshedAt"] = now_ms().into();
    }
    emit(app);
    runtime.snapshot()
}
#[tauri::command]
pub fn snapshot(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    authorize(&window)?;
    Ok(rt(&app).snapshot())
}
#[tauri::command]
pub async fn refresh(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    authorize(&window)?;
    Ok(refresh_all(&app).await)
}
fn open_url(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Bağlantı açılamadı.".into())
}
#[tauri::command]
pub fn open_usage(window: WebviewWindow, id: String) -> Result<Value, String> {
    authorize(&window)?;
    let provider = providers::provider_metadata()
        .into_iter()
        .find(|p| p["id"] == id)
        .ok_or("Geçersiz sağlayıcı.")?;
    open_url(provider["url"].as_str().ok_or("Bağlantı bulunamadı.")?)?;
    Ok(json!({"ok":true}))
}
#[tauri::command]
pub fn connect_provider(window: WebviewWindow, id: String) -> Result<Value, String> {
    open_usage(window, id)
}
#[tauri::command]
pub fn window_action(
    window: WebviewWindow,
    app: AppHandle,
    action: String,
) -> Result<Value, String> {
    authorize(&window)?;
    let runtime = rt(&app);
    match action.as_str() {
        "dashboard" | "panel" | "compact" => {
            runtime.ghost.lock().unwrap().cancel();
            {
                let mut data = runtime.data.lock().unwrap();
                data["ghostPeeking"] = false.into();
                if action == "dashboard" {
                    data["settings"]["clickThrough"] = false.into();
                }
            }
            apply_mode(&app, &action, None)
        }
        "minimize" => {
            window
                .set_ignore_cursor_events(false)
                .map_err(|_| "Pencere küçültülemedi.")?;
            window.minimize().map_err(|_| "Pencere küçültülemedi.")?;
            Ok(runtime.snapshot())
        }
        "close" | "hide" => {
            window
                .set_ignore_cursor_events(false)
                .map_err(|_| "Pencere gizlenemedi.")?;
            window.hide().map_err(|_| "Pencere gizlenemedi.")?;
            Ok(runtime.snapshot())
        }
        "show" => {
            recover(&app);
            Ok(runtime.snapshot())
        }
        "drag" => {
            window.start_dragging().map_err(|_| "Pencere taşınamadı.")?;
            Ok(runtime.snapshot())
        }
        "quit" => {
            quit(&app);
            Ok(runtime.snapshot())
        }
        _ => Err("Geçersiz pencere işlemi.".into()),
    }
}
#[tauri::command]
pub fn set_settings(window: WebviewWindow, app: AppHandle, patch: Value) -> Result<Value, String> {
    authorize(&window)?;
    let runtime = rt(&app);
    let current = runtime.snapshot();
    let mut settings = current["settings"].clone();
    for key in [
        "alwaysOnTop",
        "notifications",
        "launchCompact",
        "clickThrough",
    ] {
        if let Some(value) = patch[key].as_bool() {
            settings[key] = value.into();
        }
    }
    if let Some(seconds) = patch["refreshSeconds"].as_u64() {
        if [30, 60, 120, 300].contains(&seconds) {
            settings["refreshSeconds"] = seconds.into();
        }
    }
    if settings["clickThrough"] == true {
        if current["mode"] == "dashboard" {
            return Err("Hayalet modu için küçük görünüme geç.".into());
        }
        if current["shortcutAvailable"] != true {
            return Err("Geri çağırma kısayolu kullanılamıyor. Hayalet modu açılamadı.".into());
        }
    }
    runtime.save(&settings)?;
    runtime.data.lock().unwrap()["settings"] = settings.clone();
    if settings["refreshSeconds"] != current["settings"]["refreshSeconds"] {
        runtime.refresh_changed.notify_one();
    }
    window
        .set_always_on_top(settings["alwaysOnTop"] == true)
        .map_err(|_| "Sabitleme ayarlanamadı.")?;
    if patch["clickThrough"].is_boolean() {
        runtime.ghost.lock().unwrap().cancel();
        runtime.data.lock().unwrap()["ghostPeeking"] = false.into();
        if settings["clickThrough"] == true {
            apply_mode(&app, "compact", None)?;
        } else {
            window
                .set_ignore_cursor_events(false)
                .map_err(|_| "Fare etkileşimi açılamadı.")?;
        }
    }
    emit(&app);
    Ok(runtime.snapshot())
}
#[tauri::command]
pub async fn port_action(
    window: WebviewWindow,
    app: AppHandle,
    action: String,
    key: String,
) -> Result<Value, String> {
    authorize(&window)?;
    if key.len() > 64 {
        return Err("Geçersiz port.".into());
    }
    let runtime = rt(&app);
    let operation = runtime.clone();
    match action.as_str() {
        "open" => {
            let row = runtime.snapshot()["ports"]
                .as_array()
                .and_then(|rows| rows.iter().find(|p| p["key"] == key))
                .cloned()
                .ok_or("Port artık listede yok.")?;
            let port = row["port"]
                .as_u64()
                .filter(|p| *p > 0 && *p <= 65535)
                .ok_or("Geçersiz port.")?;
            open_url(&format!("http://localhost:{port}"))?;
        }
        "stop" | "restart" => {
            tauri::async_runtime::spawn_blocking(move || {
                let mut manager = operation.ports.lock().unwrap();
                if action == "stop" {
                    manager.stop(&key)
                } else {
                    manager.restart(&key)
                }
            })
            .await
            .map_err(|_| "Port işlemi tamamlanamadı.".to_string())??;
        }
        _ => return Err("Geçersiz port işlemi.".into()),
    };
    refresh_all(&app).await;
    Ok(json!({"ok":true}))
}
#[tauri::command]
pub fn set_hotspot(
    window: WebviewWindow,
    app: AppHandle,
    rectangle: Value,
) -> Result<Value, String> {
    authorize(&window)?;
    let hotspot = if rectangle.is_null() {
        None
    } else {
        let h = Hotspot {
            x: rectangle["x"].as_f64().ok_or("Geçersiz alan.")?,
            y: rectangle["y"].as_f64().ok_or("Geçersiz alan.")?,
            width: rectangle["width"].as_f64().ok_or("Geçersiz alan.")?,
            height: rectangle["height"].as_f64().ok_or("Geçersiz alan.")?,
        };
        if !h.valid() {
            return Err("Geçersiz alan.".into());
        }
        Some(h)
    };
    rt(&app).ghost.lock().unwrap().hotspot = hotspot;
    Ok(json!({"ok":true}))
}
fn poll_ghost(app: &AppHandle) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::POINT,
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU},
            WindowsAndMessaging::GetCursorPos,
        },
    };
    let runtime = rt(app);
    let data = runtime.snapshot();
    let window = main_window(app)?;
    if data["settings"]["clickThrough"] != true {
        return Ok(());
    }
    let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
    if !visible {
        runtime.ghost.lock().unwrap().cancel();
        window
            .set_ignore_cursor_events(false)
            .map_err(|_| "Fare etkileşimi açılamadı.")?;
        return Ok(());
    }
    let mut point = POINT { x: 0, y: 0 };
    let pointer = unsafe {
        if GetCursorPos(&mut point) == 0 {
            return Err("Fare konumu okunamadı.".into());
        }
        (point.x, point.y)
    };
    let alt =
        unsafe { GetAsyncKeyState(VK_MENU as i32) < 0 && GetAsyncKeyState(VK_CONTROL as i32) >= 0 };
    let rect = bounds(&window)?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let effect = runtime.ghost.lock().unwrap().step(
        true,
        data["mode"].as_str().unwrap_or("dashboard"),
        visible,
        rect,
        pointer,
        alt,
        scale,
    );
    if effect.open {
        apply_mode(app, "panel", Some(rect))?;
    } else if effect.close {
        apply_mode(app, "compact", effect.anchor)?;
    }
    window
        .set_ignore_cursor_events(effect.ignore)
        .map_err(|_| "Fare geçişi uygulanamadı.")?;
    let peeking = runtime.ghost.lock().unwrap().peeking;
    let mut state = runtime.data.lock().unwrap();
    if state["ghostPeeking"] != peeking {
        state["ghostPeeking"] = peeking.into();
        drop(state);
        emit(app);
    }
    Ok(())
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let profile = std::env::var_os("AGENTHUD_PROFILE_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_config_dir()?);
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?;
    if std::env::var_os("AGENTHUD_PROFILE_DIR").is_some() {
        builder = builder.data_directory(profile.join("webview"));
        if let Some(port) = std::env::var("AGENTHUD_DEBUG_PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .filter(|port| *port > 0)
        {
            builder = builder.additional_browser_args(&format!("--remote-debugging-port={port}"));
        }
    }
    builder.build()?;
    let runtime = Arc::new(Runtime::new(profile.join("settings.json")));
    app.manage(runtime.clone());
    let mut shortcut = None;
    for key in ["Ctrl+Shift+H", "Ctrl+Alt+H", "Ctrl+Shift+G"] {
        if app.global_shortcut().register(key).is_ok() {
            shortcut = Some(key);
            break;
        }
    }
    {
        let mut state = runtime.data.lock().unwrap();
        state["recoveryShortcut"] = shortcut.map(|s| s.replace('+', " + ")).into();
        state["shortcutAvailable"] = shortcut.is_some().into();
        state["ghostAvailable"] = shortcut.is_some().into();
    }
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let show = MenuItem::with_id(app, "show", "AgentHUD'u göster", true, None::<&str>)?;
    let compact = MenuItem::with_id(app, "compact", "Küçük görünüm", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &compact, &exit])?;
    TrayIconBuilder::with_id("agenthud")
        .tooltip("AgentHUD")
        .icon(
            app.default_window_icon()
                .ok_or("Uygulama simgesi bulunamadı.")?
                .clone(),
        )
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => recover(app),
            "compact" => {
                let _ = apply_mode(app, "compact", None);
                if let Ok(w) = main_window(app) {
                    let _ = w.show();
                }
            }
            "exit" => quit(app),
            _ => (),
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                recover(tray.app_handle());
            }
        })
        .build(app)?;
    let mode = if runtime.snapshot()["settings"]["launchCompact"] == true {
        "compact"
    } else {
        "dashboard"
    };
    apply_mode(app.handle(), mode, None)?;
    main_window(app.handle())?.show()?;
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        refresh_all(&handle).await;
        loop {
            let seconds = rt(&handle).snapshot()["settings"]["refreshSeconds"]
                .as_u64()
                .unwrap_or(60);
            let runtime = rt(&handle);
            tokio::select! { _=tokio::time::sleep(Duration::from_secs(seconds))=>{refresh_all(&handle).await;}, _=runtime.refresh_changed.notified()=>{} }
        }
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(40));
        if rt(&handle).quitting.load(Ordering::Relaxed) {
            break;
        }
        if let Err(message) = poll_ghost(&handle) {
            let runtime = rt(&handle);
            runtime.data.lock().unwrap()["ghostError"] = message.into();
            recover(&handle);
        }
    });
    Ok(())
}
pub fn shortcut(app: &AppHandle, state: ShortcutState) {
    if state == ShortcutState::Pressed {
        recover(app)
    }
}
pub fn close(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let runtime = rt(window.app_handle());
        if !runtime.quitting.load(Ordering::Relaxed) {
            api.prevent_close();
            runtime.ghost.lock().unwrap().cancel();
            let _ = window.set_ignore_cursor_events(false);
            let _ = window.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dashboard_exposes_quotas_and_ports_without_agent_tracking() {
        let directory = tempfile::tempdir().unwrap();
        let data = Runtime::new(directory.path().join("settings.json")).snapshot();
        assert!(data["providers"].is_array());
        assert!(data["ports"].is_array());
        for removed in [
            "sessions",
            "cursorTracking",
            "sessionsUpdatedAt",
            "sessionsError",
        ] {
            assert!(
                data.get(removed).is_none(),
                "Removed agent field: {removed}"
            );
        }
    }
    #[test]
    fn old_settings_are_validated_and_ghost_never_auto_enables() {
        let result = settings_from(
            &json!({"alwaysOnTop":true,"clickThrough":true,"refreshSeconds":1,"unknown":"discard","notifications":"yes"}),
        );
        assert_eq!(
            result,
            json!({"alwaysOnTop":true,"clickThrough":false,"refreshSeconds":60,"launchCompact":false,"notifications":true})
        );
    }
}
