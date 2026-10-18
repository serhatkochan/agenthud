#[cfg(windows)]
fn main() {
    use std::io::Write;
    use std::ptr::null_mut;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::COLOR_WINDOW,
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentProcessId},
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            LoadCursorW, PostQuitMessage, RegisterClassW, SetTimer, ShowWindow, TranslateMessage,
            CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW, MSG, SW_MINIMIZE, SW_SHOWNOACTIVATE,
            WM_DESTROY, WM_TIMER, WNDCLASSW, WS_OVERLAPPEDWINDOW,
        },
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            WM_TIMER => {
                DestroyWindow(hwnd);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    let args: Vec<String> = std::env::args().skip(1).collect();
    let title = args
        .first()
        .filter(|arg| !arg.starts_with("--"))
        .map(String::as_str)
        .unwrap_or("AgentHUD owned focus fixture - Cursor");
    let minimized = args.iter().any(|arg| arg == "--minimized");
    let lifetime_ms = args
        .iter()
        .find_map(|arg| {
            arg.strip_prefix("--lifetime-ms=")
                .and_then(|value| value.parse::<u32>().ok())
        })
        .unwrap_or(600_000)
        .clamp(1_000, 3_600_000);
    let class_name: Vec<u16> = "AgentHudOwnedFocusFixture\0".encode_utf16().collect();
    let caption: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();

    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: (COLOR_WINDOW + 1) as usize as _,
            lpszClassName: class_name.as_ptr(),
            ..std::mem::zeroed()
        };
        assert_ne!(
            RegisterClassW(&class),
            0,
            "fixture class registration failed"
        );
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            caption.as_ptr(),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            680,
            420,
            null_mut(),
            null_mut(),
            instance,
            std::ptr::null(),
        );
        assert!(!hwnd.is_null(), "fixture window creation failed");
        ShowWindow(
            hwnd,
            if minimized {
                SW_MINIMIZE
            } else {
                SW_SHOWNOACTIVATE
            },
        );
        SetTimer(hwnd, 1, lifetime_ms, None);
        println!(
            "{}",
            serde_json::json!({ "pid": GetCurrentProcessId(), "handle": (hwnd as usize).to_string(), "title": title })
        );
        std::io::stdout()
            .flush()
            .expect("fixture metadata output failed");
        let mut message: MSG = std::mem::zeroed();
        loop {
            let result = GetMessageW(&mut message, null_mut(), 0, 0);
            if result == 0 {
                break;
            }
            assert_ne!(result, -1, "fixture message loop failed");
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The owned focus fixture requires Windows.");
}
