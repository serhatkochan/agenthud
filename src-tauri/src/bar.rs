use crate::{providers, system};
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
    Foundation::{
        COLORREF, ERROR_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, SIZE,
        WPARAM,
    },
    Graphics::Gdi::{
        BeginPaint, CreateCompatibleBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW,
        CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, EndPaint,         FillRect, GetDC, GetDIBits, InvalidateRect,
        ReleaseDC, ScreenToClient, SelectObject, SetBkMode, SetTextColor, AC_SRC_ALPHA,
        ANTIALIASED_QUALITY, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, DIB_RGB_COLORS,
        DEFAULT_CHARSET, DT_END_ELLIPSIS, DT_LEFT, DT_RIGHT, DT_SINGLELINE, DT_VCENTER, FW_NORMAL,
        FW_SEMIBOLD, TRANSPARENT,
    },
    System::{LibraryLoader::GetModuleHandleW, Threading::CreateMutexW},
    UI::{
        HiDpi::{
            GetDpiForWindow, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, FindWindowW, GetClientRect,
            GetWindowRect,
            GetMessageW, LoadCursorW, LoadIconW, PostMessageW, PostQuitMessage, RegisterClassW,
            SetForegroundWindow, SetWindowPos, ShowWindow, SystemParametersInfoW, TranslateMessage,
            CS_HREDRAW, CS_VREDRAW, HTCAPTION, HTCLIENT, HWND_TOPMOST, IDC_ARROW, SPI_GETWORKAREA,
            SWP_NOACTIVATE, SW_SHOW, ULW_ALPHA, UpdateLayeredWindow, WM_DESTROY, WM_DPICHANGED,
            WM_ERASEBKGND, WM_LBUTTONUP, WM_NCHITTEST, WM_PAINT, WNDCLASSW, WS_EX_LAYERED,
            WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
        },
    },
};

const REPAINT: u32 = 0x8000;
const NAMES: [&str; 3] = ["Codex", "Cursor", "Antigravity"];
const IDS: [&str; 3] = ["codex", "cursor", "antigravity"];

struct Line {
    text: String,
    remaining: Option<f64>,
    header: bool,
    disabled: bool,
}

struct Bar {
    providers: [Value; 3],
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
        let (width, height) = (dip(380, 96), dip(body_height(3), 96));
        let (x, y) = place(width, height);
        let title = wide("AgentHUD");
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
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
        let group = quota["group"].as_str().filter(|group| !group.is_empty()).map(display_group);
        let disabled = quota["disabled"] == true;
        let text = match group {
            Some(group) if group != label => format!("{group} · {label}"),
            _ => label.to_string(),
        };
        rows.push(Line {
            text,
            remaining: quota["remaining"].as_f64().filter(|value| value.is_finite()),
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

fn visible_lines() -> Vec<Line> {
    STATE
        .get()
        .map(|state| {
            let bar = state.lock().unwrap();
            NAMES
                .into_iter()
                .zip(bar.providers.iter())
                .flat_map(|(name, value)| lines(name, value))
                .collect()
        })
        .unwrap_or_default()
}

fn percent_text(value: Option<f64>) -> String {
    match value {
        Some(value) if value > 0.0 && value < 1.0 => format!("{value:.1}%"),
        Some(value) => format!("{}%", value.round() as i32),
        None => "…".into(),
    }
}

fn tone(line: &Line) -> COLORREF {
    if line.disabled {
        return rgb(0x6A, 0x72, 0x6C);
    }
    match line.remaining {
        Some(value) if value < 20.0 => rgb(0xC4, 0x84, 0x7C),
        Some(value) if value < 50.0 => rgb(0xC4, 0xA3, 0x6A),
        Some(_) => rgb(0x7D, 0xAB, 0x90),
        None => rgb(0x8E, 0x97, 0x90),
    }
}

fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}

fn dip(value: i32, dpi: u32) -> i32 {
    value * dpi.max(96) as i32 / 96
}

fn body_height(rows: usize) -> i32 {
    6 + rows as i32 * 16 + 4
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn place(width: i32, height: i32) -> (i32, i32) {
    let mut work = RECT { left: 0, top: 0, right: 1280, bottom: 720 };
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
        let dpi = GetDpiForWindow(hwnd).max(96);
        let rows = visible_lines().len().max(3);
        let width = dip(380, dpi);
        let height = dip(body_height(rows), dpi);
        let (x, y) = if move_to_corner {
            place(width, height)
        } else {
            let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(hwnd, &mut rect);
            (rect.left, rect.top)
        };
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE);
        present(hwnd);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        REPAINT => {
            resize(hwnd, false);
            InvalidateRect(hwnd, std::ptr::null(), 0);
            0
        }
        WM_DPICHANGED => {
            resize(hwnd, false);
            0
        }
        WM_ERASEBKGND => 1,
        WM_NCHITTEST => hit(hwnd, lparam),
        WM_LBUTTONUP => {
            if in_close(hwnd, lparam) {
                PostQuitMessage(0);
            }
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
    if close_rect(hwnd).contains(point.x, point.y) {
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
    let mut client = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetClientRect(hwnd, &mut client) };
    let dpi = unsafe { GetDpiForWindow(hwnd).max(96) };
    let side = dip(20, dpi);
    BoxRect { left: client.right - side, top: 0, right: client.right, bottom: side }
}

fn present(hwnd: HWND) {
    unsafe {
        let mut window = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        GetWindowRect(hwnd, &mut window);
        let width = window.right - window.left;
        let height = window.bottom - window.top;
        if width < 2 || height < 2 {
            return;
        }
        let screen = GetDC(std::ptr::null_mut());
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..BITMAPINFOHEADER::default()
            },
            ..BITMAPINFO::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let glass = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        if glass.is_null() || bits.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen);
            return;
        }
        let count = (width * height) as usize;
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u32, count);
        let dpi = GetDpiForWindow(hwnd).max(96);
        fill_island(pixels, width, height, dip(22, dpi));
        let memory = CreateCompatibleDC(screen);
        let mask_bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous_mask = SelectObject(memory, mask_bitmap as _);
        let black = CreateSolidBrush(rgb(0, 0, 0));
        let full = RECT { left: 0, top: 0, right: width, bottom: height };
        FillRect(memory, &full, black);
        SetBkMode(memory, TRANSPARENT as i32);
        let row_h = dip(16, dpi);
        let font_text = font(dip(12, dpi), FW_NORMAL as i32);
        let font_header = font(dip(12, dpi), FW_SEMIBOLD as i32);
        let rows = visible_lines();
        let close = close_rect(hwnd);
        for (index, line) in rows.iter().enumerate() {
            let top = dip(3, dpi) + index as i32 * row_h;
            let label_right = if line.header { close.left } else { width - dip(52, dpi) };
            let mut text = wide(&line.text);
            SelectObject(memory, if line.header { font_header } else { font_text } as _);
            SetTextColor(memory, if line.header { rgb(0xC8, 0xCE, 0xCB) } else { rgb(0xF2, 0xF4, 0xF3) });
            draw(
                memory,
                &mut text,
                RECT {
                    left: dip(if line.header { 10 } else { 16 }, dpi),
                    top,
                    right: label_right,
                    bottom: top + row_h,
                },
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS,
            );
            if !line.header && line.remaining.is_some() {
                let mut percent = wide(&percent_text(line.remaining));
                SetTextColor(memory, tone(line));
                draw(
                    memory,
                    &mut percent,
                    RECT { left: label_right, top, right: width - dip(14, dpi), bottom: top + row_h },
                    DT_RIGHT | DT_VCENTER | DT_SINGLELINE,
                );
            }
        }
        let mut close_label = wide("×");
        SelectObject(memory, font_header as _);
        SetTextColor(memory, rgb(0xC8, 0xCE, 0xCB));
        draw(
            memory,
            &mut close_label,
            RECT { left: close.left, top: close.top, right: close.right - dip(6, dpi), bottom: close.bottom },
            DT_LEFT | DT_VCENTER | DT_SINGLELINE,
        );
        SelectObject(memory, previous_mask);
        let mut mask = vec![0u32; count];
        GetDIBits(screen, mask_bitmap, 0, height as u32, mask.as_mut_ptr() as *mut c_void, &mut info, DIB_RGB_COLORS);
        composite(pixels, &mask);
        let previous = SelectObject(memory, glass as _);
        let destination = POINT { x: window.left, y: window.top };
        let origin = POINT { x: 0, y: 0 };
        let size = SIZE { cx: width, cy: height };
        let blend = BLENDFUNCTION { BlendOp: 0, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
        UpdateLayeredWindow(hwnd, std::ptr::null_mut(), &destination, &size, memory, &origin, 0, &blend, ULW_ALPHA);
        SelectObject(memory, previous);
        DeleteObject(font_text as _);
        DeleteObject(font_header as _);
        DeleteObject(black as _);
        DeleteObject(mask_bitmap as _);
        DeleteObject(glass as _);
        DeleteDC(memory);
        ReleaseDC(std::ptr::null_mut(), screen);
    }
}

fn fill_island(pixels: &mut [u32], width: i32, height: i32, radius: i32) {
    let radius = radius as f32;
    for y in 0..height {
        for x in 0..width {
            let coverage = round_coverage(x as f32 + 0.5, y as f32 + 0.5, width as f32, height as f32, radius);
            let alpha = (coverage * 148.0) as u8;
            let edge = ((1.0 - coverage) * coverage * 90.0) as u8;
            let shade = 18u8.saturating_add(edge);
            pixels[(y * width + x) as usize] = premul(shade, shade, shade.saturating_add(2), alpha);
        }
    }
}

fn round_coverage(x: f32, y: f32, width: f32, height: f32, radius: f32) -> f32 {
    let dx = (x - width * 0.5).abs() - (width * 0.5 - radius);
    let dy = (y - height * 0.5).abs() - (height * 0.5 - radius);
    let outside = (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt() + dx.min(0.0).max(dy.min(0.0)) - radius;
    (0.5 - outside).clamp(0.0, 1.0)
}

fn premul(red: u8, green: u8, blue: u8, alpha: u8) -> u32 {
    let scale = alpha as u32;
    let red = red as u32 * scale / 255;
    let green = green as u32 * scale / 255;
    let blue = blue as u32 * scale / 255;
    (alpha as u32) << 24 | red << 16 | green << 8 | blue
}

fn composite(glass: &mut [u32], mask: &[u32]) {
    for (pixel, source) in glass.iter_mut().zip(mask) {
        let blue = (source & 0xff) as f32;
        let green = ((source >> 8) & 0xff) as f32;
        let red = ((source >> 16) & 0xff) as f32;
        let coverage = red.max(green).max(blue) / 255.0;
        if coverage < 0.04 {
            continue;
        }
        let red = (red / coverage).min(255.0);
        let green = (green / coverage).min(255.0);
        let blue = (blue / coverage).min(255.0);
        let dest_a = ((*pixel >> 24) & 0xff) as f32 / 255.0;
        let dest_r = ((*pixel >> 16) & 0xff) as f32;
        let dest_g = ((*pixel >> 8) & 0xff) as f32;
        let dest_b = (*pixel & 0xff) as f32;
        let out_a = coverage + dest_a * (1.0 - coverage);
        let out_r = red * coverage + dest_r * (1.0 - coverage);
        let out_g = green * coverage + dest_g * (1.0 - coverage);
        let out_b = blue * coverage + dest_b * (1.0 - coverage);
        *pixel = ((out_a * 255.0) as u32) << 24
            | (out_r as u32).min(255) << 16
            | (out_g as u32).min(255) << 8
            | (out_b as u32).min(255);
    }
}

fn font(height: i32, weight: i32) -> windows_sys::Win32::Graphics::Gdi::HFONT {
    let face = wide("Segoe UI");
    unsafe {
        CreateFontW(
            height,
            0,
            0,
            0,
            weight,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            0,
            0,
            ANTIALIASED_QUALITY as u32,
            0,
            face.as_ptr(),
        )
    }
}

unsafe fn draw(dc: windows_sys::Win32::Graphics::Gdi::HDC, text: &mut [u16], mut rect: RECT, format: u32) {
    DrawTextW(dc, text.as_mut_ptr(), -1, &mut rect, format);
}

#[cfg(test)]
mod tests {
    use super::{lines, percent_text, NAMES};
    use serde_json::json;

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
        assert_eq!(lines("Codex", &json!({"status":"loading","quotas":[]}))[1].text, "…");
        assert_eq!(NAMES, ["Codex", "Cursor", "Antigravity"]);
    }
}
