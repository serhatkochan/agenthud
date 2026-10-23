mod paint;
use paint::present;

use crate::{
    providers,
    quota_view::{compact_quotas, CompactQuota},
    system,
};
use serde_json::{json, Value};
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicIsize, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    Graphics::Gdi::{
        BeginPaint, EndPaint, GetMonitorInfoW, InvalidateRect, MonitorFromWindow, ScreenToClient,
        MONITORINFO, MONITOR_DEFAULTTONEAREST,
    },
    System::{LibraryLoader::GetModuleHandleW, Threading::CreateMutexW},
    UI::{
        HiDpi::{
            GetDpiForWindow, SetProcessDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowW,
            GetClientRect, GetMessageW, GetWindowRect, LoadCursorW, LoadIconW, PostMessageW,
            PostQuitMessage, RegisterClassW, SetForegroundWindow, SetWindowPos, ShowWindow,
            SystemParametersInfoW, TranslateMessage, CS_HREDRAW, CS_VREDRAW, HTCAPTION, HTCLIENT,
            HWND_TOPMOST, IDC_ARROW, SPI_GETWORKAREA, SWP_NOACTIVATE, SW_SHOW, WM_DESTROY,
            WM_DPICHANGED, WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONUP, WM_NCHITTEST, WM_PAINT,
            WNDCLASSW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
        },
    },
};

const REPAINT: u32 = 0x8000;
const WINDOW_EX_STYLE: u32 = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
const NAMES: [&str; 3] = ["Codex", "Cursor", "Antigravity"];
const IDS: [&str; 3] = ["codex", "cursor", "antigravity"];
const PANEL_WIDTH: i32 = 368;
const HEADER_HEIGHT: i32 = 42;
const ROW_HEIGHT: i32 = 23;
const GROUP_HEIGHT: i32 = 28;
const COMPACT_HEIGHT: i32 = 50;
const COMPACT_BRAND: i32 = 138;
const COMPACT_CELL: i32 = 104;
const CLOSE_SPACE: i32 = 34;

struct Line {
    text: String,
    remaining: Option<f64>,
    header: bool,
    disabled: bool,
}

struct Bar {
    providers: [Value; 3],
    collapsed: bool,
}

struct Frame {
    lines: Vec<Line>,
    summary: Vec<CompactQuota>,
    collapsed: bool,
}

impl Frame {
    fn size(&self) -> (i32, i32) {
        if self.collapsed {
            (
                COMPACT_BRAND + COMPACT_CELL * self.summary.len() as i32 + CLOSE_SPACE,
                COMPACT_HEIGHT,
            )
        } else {
            (
                PANEL_WIDTH,
                HEADER_HEIGHT
                    + 12
                    + self
                        .lines
                        .iter()
                        .map(|line| {
                            if line.header {
                                GROUP_HEIGHT
                            } else {
                                ROW_HEIGHT
                            }
                        })
                        .sum::<i32>(),
            )
        }
    }
}

static STATE: OnceLock<Mutex<Bar>> = OnceLock::new();
static WINDOW: AtomicIsize = AtomicIsize::new(0);

pub fn run() {
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let class = wide("AgentHUDBar");
    let mutex_name = wide("Local\\AgentHUD.Compact");
    unsafe {
        let mutex = CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr());
        if !mutex.is_null() && GetLastError() == ERROR_ALREADY_EXISTS {
            let existing = FindWindowW(class.as_ptr(), std::ptr::null());
            if !existing.is_null() {
                ShowWindow(existing, SW_SHOW);
                SetForegroundWindow(existing);
            }
            return;
        }
        STATE
            .set(Mutex::new(Bar {
                providers: std::array::from_fn(|_| json!({"status":"loading","quotas":[]})),
                collapsed: true,
            }))
            .ok();
        let instance = GetModuleHandleW(std::ptr::null());
        let mut info: WNDCLASSW = std::mem::zeroed();
        info.style = CS_HREDRAW | CS_VREDRAW;
        info.lpfnWndProc = Some(wndproc);
        info.hInstance = instance;
        info.hCursor = LoadCursorW(std::ptr::null_mut(), IDC_ARROW);
        info.hIcon = LoadIconW(instance, 1 as *const u16);
        info.lpszClassName = class.as_ptr();
        if RegisterClassW(&info) == 0 {
            return;
        }
        let (width, height) = (PANEL_WIDTH, 210);
        let (x, y) = place(width, height);
        let title = wide("AgentHUD");
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            width,
            height,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return;
        }
        WINDOW.store(hwnd as isize, Ordering::Relaxed);
        resize(hwnd, true);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Yenileme başlatılamadı");
        runtime.spawn(async move {
            loop {
                refresh().await;
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
        let mut message = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        runtime.shutdown_background();
    }
}

async fn refresh() {
    let inventory = tokio::task::spawn_blocking(|| system::inventory(false).unwrap_or_default())
        .await
        .unwrap_or_default();
    let previous = STATE
        .get()
        .map(|state| state.lock().unwrap().providers.clone())
        .unwrap_or_else(|| std::array::from_fn(|_| Value::Null));
    let mut next = previous.clone();
    for (index, id) in IDS.into_iter().enumerate() {
        next[index] = providers::merge_refresh(
            &previous[index],
            providers::read_provider(id, &inventory).await,
        );
    }
    if let Some(state) = STATE.get() {
        state.lock().unwrap().providers = next;
    }
    let hwnd = WINDOW.load(Ordering::Relaxed) as HWND;
    if !hwnd.is_null() {
        unsafe { PostMessageW(hwnd, REPAINT, 0, 0) };
    }
}

fn lines(name: &str, value: &Value) -> Vec<Line> {
    let mut rows = vec![Line {
        text: name.into(),
        remaining: None,
        header: true,
        disabled: false,
    }];
    let Some(quotas) = value["quotas"].as_array().filter(|rows| !rows.is_empty()) else {
        rows.push(Line {
            text: status_text(value).into(),
            remaining: None,
            header: false,
            disabled: false,
        });
        return rows;
    };
    for quota in quotas {
        let label = quota["label"].as_str().unwrap_or("Limit");
        let group = quota["group"]
            .as_str()
            .filter(|group| !group.is_empty())
            .map(display_group);
        let disabled = quota["disabled"] == true;
        let text = match group {
            Some(group) if group != label => format!("{group} · {label}"),
            _ => label.to_string(),
        };
        rows.push(Line {
            text,
            remaining: quota["remaining"]
                .as_f64()
                .filter(|value| value.is_finite()),
            header: false,
            disabled,
        });
    }
    rows
}

fn display_group(group: &str) -> &str {
    let folded = group.to_ascii_lowercase();
    if folded.contains("claude") && folded.contains("gpt") {
        "Other Models"
    } else {
        group
    }
}

fn status_text(value: &Value) -> &'static str {
    match value["status"].as_str() {
        Some("needs-login") => "Giriş gerekli",
        Some("error") => "Bağlantı yok",
        Some("unavailable") => "Ölçüm yok",
        _ => "…",
    }
}

fn current_frame() -> Frame {
    let bar = STATE
        .get()
        .expect("Pencere durumu hazır değil")
        .lock()
        .unwrap();
    Frame {
        lines: NAMES
            .into_iter()
            .zip(bar.providers.iter())
            .flat_map(|(name, value)| lines(name, value))
            .collect(),
        summary: compact_quotas(&bar.providers),
        collapsed: bar.collapsed,
    }
}

fn percent_text(value: Option<f64>) -> String {
    match value {
        Some(value) if value > 0.0 && value < 1.0 => format!("{value:.1}%"),
        Some(value) => format!("{}%", value.round() as i32),
        None => "…".into(),
    }
}

fn dip(value: i32, dpi: u32) -> i32 {
    value * dpi.max(96) as i32 / 96
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn place(width: i32, height: i32) -> (i32, i32) {
    let mut work = RECT {
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
    };
    unsafe {
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut RECT as *mut c_void, 0);
    }
    (
        (work.right - width - 16).max(work.left),
        (work.top + 16).min(work.bottom - height).max(work.top),
    )
}

fn resize(hwnd: HWND, move_to_corner: bool) {
    unsafe {
        let frame = current_frame();
        let dpi = GetDpiForWindow(hwnd).max(96);
        let work = work_area(hwnd);
        let (width, height) = frame.size();
        let width = dip(width, dpi).min((work.right - work.left - 24).max(1));
        let height = dip(height, dpi).min((work.bottom - work.top - 24).max(1));
        let (x, y) = if move_to_corner {
            place(width, height)
        } else {
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            GetWindowRect(hwnd, &mut rect);
            (rect.right - width, rect.top)
        };
        let x = x.clamp(work.left, (work.right - width).max(work.left));
        let y = y.clamp(work.top, (work.bottom - height).max(work.top));
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE);
        present(hwnd);
    }
}

fn work_area(hwnd: HWND) -> RECT {
    unsafe {
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if GetMonitorInfoW(monitor, &mut info) != 0 {
            info.rcWork
        } else {
            let mut work = RECT {
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            };
            SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut RECT as *mut c_void, 0);
            work
        }
    }
}

fn toggle(hwnd: HWND) {
    if let Some(state) = STATE.get() {
        let mut bar = state.lock().unwrap();
        bar.collapsed = !bar.collapsed;
    }
    resize(hwnd, false);
}

unsafe extern "system" fn wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        REPAINT => {
            resize(hwnd, false);
            InvalidateRect(hwnd, std::ptr::null(), 0);
            0
        }
        WM_DPICHANGED => {
            let suggested = &*(lparam as *const RECT);
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                suggested.left,
                suggested.top,
                suggested.right - suggested.left,
                suggested.bottom - suggested.top,
                SWP_NOACTIVATE,
            );
            resize(hwnd, false);
            0
        }
        WM_ERASEBKGND => 1,
        WM_NCHITTEST => hit(hwnd, lparam),
        WM_LBUTTONUP => {
            if in_close(hwnd, lparam) {
                DestroyWindow(hwnd);
            } else if toggle_rect(hwnd).contains(
                (lparam & 0xffff) as i16 as i32,
                ((lparam >> 16) & 0xffff) as i16 as i32,
            ) {
                toggle(hwnd);
            }
            0
        }
        WM_KEYDOWN if wparam == 0x20 || wparam == 0x0D => {
            if lparam & (1 << 30) == 0 {
                toggle(hwnd);
            }
            0
        }
        WM_KEYDOWN if wparam == 0x1B => {
            if let Some(state) = STATE.get() {
                state.lock().unwrap().collapsed = false;
            }
            resize(hwnd, false);
            0
        }
        WM_PAINT => {
            let mut info = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut info);
            EndPaint(hwnd, &info);
            let _ = dc;
            present(hwnd);
            0
        }
        WM_DESTROY => {
            WINDOW.store(0, Ordering::Relaxed);
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

fn hit(hwnd: HWND, lparam: LPARAM) -> LRESULT {
    let mut point = POINT {
        x: (lparam & 0xffff) as i16 as i32,
        y: ((lparam >> 16) & 0xffff) as i16 as i32,
    };
    unsafe { ScreenToClient(hwnd, &mut point) };
    if close_rect(hwnd).contains(point.x, point.y) || toggle_rect(hwnd).contains(point.x, point.y) {
        HTCLIENT as LRESULT
    } else {
        HTCAPTION as LRESULT
    }
}

fn in_close(hwnd: HWND, lparam: LPARAM) -> bool {
    let point = POINT {
        x: (lparam & 0xffff) as i16 as i32,
        y: ((lparam >> 16) & 0xffff) as i16 as i32,
    };
    close_rect(hwnd).contains(point.x, point.y)
}

struct BoxRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
impl BoxRect {
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

fn close_rect(hwnd: HWND) -> BoxRect {
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe { GetClientRect(hwnd, &mut client) };
    let dpi = unsafe { GetDpiForWindow(hwnd).max(96) };
    let header = if client.bottom == dip(COMPACT_HEIGHT, dpi) {
        client.bottom
    } else {
        dip(HEADER_HEIGHT, dpi)
    };
    let top = (header - dip(32, dpi)) / 2;
    BoxRect {
        left: client.right - dip(34, dpi),
        top,
        right: client.right - dip(5, dpi),
        bottom: top + dip(32, dpi),
    }
}

fn toggle_rect(hwnd: HWND) -> BoxRect {
    let dpi = unsafe { GetDpiForWindow(hwnd).max(96) };
    let mut client: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetClientRect(hwnd, &mut client) };
    let header = if client.bottom == dip(COMPACT_HEIGHT, dpi) {
        client.bottom
    } else {
        dip(HEADER_HEIGHT, dpi)
    };
    let top = (header - dip(32, dpi)) / 2;
    BoxRect {
        left: dip(93, dpi),
        top,
        right: dip(128, dpi),
        bottom: top + dip(32, dpi),
    }
}

#[cfg(test)]
mod tests {
    use super::{lines, percent_text, NAMES};
    use serde_json::json;

    #[test]
    fn floating_window_avoids_taskbar_and_close_destroys_it() {
        use super::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, IsWindow, PeekMessageW, UnregisterClassW, GWL_EXSTYLE, PM_REMOVE,
            WM_QUIT, WS_EX_APPWINDOW,
        };
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide("AgentHUD.WindowLifecycleTest");
            let mut info: WNDCLASSW = std::mem::zeroed();
            info.lpfnWndProc = Some(wndproc);
            info.hInstance = instance;
            info.lpszClassName = class.as_ptr();
            assert_ne!(RegisterClassW(&info), 0);
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE,
                class.as_ptr(),
                class.as_ptr(),
                WS_POPUP,
                0,
                0,
                692,
                50,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            let close = close_rect(hwnd);
            let x = (close.left + close.right) / 2;
            let y = (close.top + close.bottom) / 2;
            wndproc(hwnd, WM_LBUTTONUP, 0, ((y << 16) | x) as LPARAM);
            let closed = IsWindow(hwnd) == 0;
            if !closed {
                DestroyWindow(hwnd);
            }
            let mut message = std::mem::zeroed();
            let quit = PeekMessageW(
                &mut message,
                std::ptr::null_mut(),
                WM_QUIT,
                WM_QUIT,
                PM_REMOVE,
            );
            UnregisterClassW(class.as_ptr(), instance);
            assert_ne!(style & WS_EX_TOOLWINDOW, 0);
            assert_eq!(style & WS_EX_APPWINDOW, 0);
            assert!(closed, "× must destroy the window instead of hiding it");
            assert_ne!(quit, 0, "closing the window must end the message loop");
        }
    }

    #[test]
    fn every_window_stays_visible_under_its_group() {
        let value = json!({"status":"connected","quotas":[
            {"label":"Cursor Models","remaining":21.0},
            {"group":"Gemini Models","label":"Haftalık","remaining":66.0},
            {"group":"Gemini Models","label":"5 saatlik","remaining":94.2},
            {"group":"Claude and GPT models","label":"Haftalık","remaining":0.0},
            {"group":"Gemini 4 Argon","label":"Haftalık","remaining":8.0,"disabled":true}
        ]});
        let rows = lines("Antigravity", &value);
        assert_eq!(rows[0].text, "Antigravity");
        assert!(rows[0].header);
        assert_eq!(rows[1].text, "Cursor Models");
        assert_eq!(rows[2].text, "Gemini Models · Haftalık");
        assert_eq!(rows[3].text, "Gemini Models · 5 saatlik");
        assert_eq!(rows[4].remaining, Some(0.0));
        assert_eq!(rows[4].text, "Other Models · Haftalık");
        assert_eq!(rows[5].text, "Gemini 4 Argon · Haftalık");
        assert!(rows[5].disabled);
        assert_eq!(percent_text(Some(0.4)), "0.4%");
        assert_eq!(
            lines("Codex", &json!({"status":"loading","quotas":[]}))[1].text,
            "…"
        );
        assert_eq!(NAMES, ["Codex", "Cursor", "Antigravity"]);
    }
}
