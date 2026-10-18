use crate::models::ProcessInfo;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, PartialEq, Eq)]
struct WindowTarget {
    handle: usize,
    pid: u32,
    creation_id: String,
    title: String,
    app: String,
}

#[derive(Debug, PartialEq, Eq)]
enum Selection {
    Target(WindowTarget, &'static str),
    Choices(Vec<WindowTarget>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FocusOutcome {
    Focused,
    Stale,
    Denied,
}

trait WindowApi {
    fn list(&self, processes: &[&ProcessInfo]) -> Result<Vec<WindowTarget>, ()>;
    fn focus(&self, target: &WindowTarget) -> FocusOutcome;
}

struct PendingSelection {
    created: Instant,
    context: (String, String),
    targets: HashMap<String, WindowTarget>,
}

#[derive(Default)]
pub struct FocusService {
    pending: HashMap<String, PendingSelection>,
}

impl FocusService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn request(
        &mut self,
        session: &Value,
        choice_id: Option<&str>,
        processes: &[ProcessInfo],
    ) -> Value {
        self.request_with(
            session,
            choice_id,
            processes,
            &NativeWindows,
            Instant::now(),
        )
    }

    fn request_with(
        &mut self,
        session: &Value,
        choice_id: Option<&str>,
        processes: &[ProcessInfo],
        native: &impl WindowApi,
        now: Instant,
    ) -> Value {
        self.pending.retain(|_, request| {
            now.saturating_duration_since(request.created) < Duration::from_secs(60)
        });
        let Some(id) = session
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return failure("Oturum bilgisi artık güncel değil. Listeyi yenile.");
        };
        let Some(provider) = session
            .get("provider")
            .and_then(Value::as_str)
            .filter(|provider| provider_executable(provider).is_some())
        else {
            return failure("Bu sağlayıcı için pencere odağı desteklenmiyor.");
        };
        let context = (
            provider.to_owned(),
            session
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        );
        if let Some(choice_id) = choice_id {
            let target = self
                .pending
                .get(id)
                .filter(|request| request.context == context)
                .and_then(|request| request.targets.get(choice_id));
            return match target {
                Some(target) => activate(native, target, "selected"),
                None => failure("Pencere seçimi artık güncel değil. Listeyi yenile."),
            };
        }
        self.pending.remove(id);
        let processes = candidate_processes(provider, processes);
        let windows = match native.list(&processes) {
            Ok(windows) => windows,
            Err(()) => return failure("Pencere bilgisi okunamadı. Yeniden dene."),
        };
        match choose_window(session, windows) {
            Selection::Target(target, scope) => activate(native, &target, scope),
            Selection::Choices(windows) if windows.is_empty() => {
                failure("Bu oturuma ait açık bir uygulama penceresi bulunamadı.")
            }
            Selection::Choices(windows) => {
                let mut targets = HashMap::new();
                let choices: Vec<Value> = windows
                    .into_iter()
                    .map(|window| {
                        let id = uuid::Uuid::new_v4().to_string();
                        let choice = json!({ "id": id, "title": window.title, "app": window.app });
                        targets.insert(id, window);
                        choice
                    })
                    .collect();
                self.pending.insert(
                    id.to_owned(),
                    PendingSelection {
                        created: now,
                        context,
                        targets,
                    },
                );
                json!({ "ok": true, "choices": choices })
            }
        }
    }
}

fn failure(message: &str) -> Value {
    json!({ "ok": false, "message": message })
}

fn activate(native: &impl WindowApi, target: &WindowTarget, scope: &str) -> Value {
    match native.focus(target) {
        FocusOutcome::Focused => json!({ "ok": true, "scope": scope }),
        FocusOutcome::Stale => failure("Seçilen pencere değişmiş veya kapanmış. Listeyi yenile."),
        FocusOutcome::Denied => failure("Pencere öne getirilemedi. Görev çubuğundan açabilirsin."),
    }
}

fn provider_executable(provider: &str) -> Option<&'static str> {
    match provider {
        "cursor" => Some("cursor.exe"),
        "antigravity" => Some("antigravity.exe"),
        "codex" => Some("codex.exe"),
        _ => None,
    }
}

fn candidate_processes<'a>(provider: &str, processes: &'a [ProcessInfo]) -> Vec<&'a ProcessInfo> {
    let Some(executable) = provider_executable(provider) else {
        return vec![];
    };
    let by_id: HashMap<u32, &ProcessInfo> = processes
        .iter()
        .map(|process| (process.process_id, process))
        .collect();
    let mut selected = Vec::new();
    let mut selected_ids = HashSet::new();
    for process in processes
        .iter()
        .filter(|process| process.name.eq_ignore_ascii_case(executable))
    {
        if selected_ids.insert(process.process_id) {
            selected.push(process);
        }
        let mut seen = HashSet::from([process.process_id]);
        let mut parent_id = process.parent_process_id;
        while let Some(parent) = by_id.get(&parent_id) {
            if !seen.insert(parent.process_id) {
                break;
            }
            let name = parent.name.to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "windowsterminal.exe"
                    | "conhost.exe"
                    | "openconsole.exe"
                    | "powershell.exe"
                    | "pwsh.exe"
                    | "cmd.exe"
                    | "cursor.exe"
                    | "antigravity.exe"
                    | "code.exe"
            ) && selected_ids.insert(parent.process_id)
            {
                selected.push(*parent);
            }
            parent_id = parent.parent_process_id;
        }
    }
    selected
}

fn same_process_birth(left: &str, right: &str) -> bool {
    fn parse(value: &str) -> Option<u64> {
        if value.is_empty()
            || value.len() > 20
            || !value.bytes().all(|value| value.is_ascii_digit())
        {
            return None;
        }
        value.parse().ok()
    }
    matches!((parse(left), parse(right)), (Some(left), Some(right)) if left / 10 == right / 10)
}

fn normalized(value: &str) -> String {
    value.trim().nfc().collect()
}

fn workspace_caption(title: &str) -> Option<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (offset, character) in title.char_indices() {
        if matches!(character, '-' | '—' | '–' | '|' | '·')
            && title[..offset]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace)
            && title[offset + character.len_utf8()..]
                .chars()
                .next()
                .is_some_and(char::is_whitespace)
        {
            parts.push(normalized(&title[start..offset]));
            start = offset + character.len_utf8();
        }
    }
    parts.push(normalized(&title[start..]));
    if parts.len() < 2
        || !matches!(
            parts.last()?.to_lowercase().as_str(),
            "cursor" | "antigravity" | "visual studio code"
        )
    {
        return None;
    }
    let mut caption = parts[parts.len() - 2].clone();
    if let Some(without_marker) = caption.strip_prefix('●') {
        caption = without_marker.trim_start().to_owned();
    }
    const SUFFIX: &str = " (Workspace)";
    if caption
        .to_ascii_lowercase()
        .ends_with(&SUFFIX.to_ascii_lowercase())
    {
        caption.truncate(caption.len() - SUFFIX.len());
    }
    Some(caption)
}

fn absolute_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

fn normalized_windows_path(path: &str) -> String {
    let path = normalized(path).replace('/', "\\").to_lowercase();
    let mut parts = Vec::new();
    for part in path[3..].split('\\') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    format!("{}\\{}", &path[..2], parts.join("\\"))
}

fn project_matches(session: &Value, window: &WindowTarget) -> bool {
    let Some(cwd) = session
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|cwd| !cwd.is_empty())
    else {
        return false;
    };
    let Some(caption) = workspace_caption(&window.title) else {
        return false;
    };
    let path = cwd.replace('/', "\\");
    let basename = path
        .trim_end_matches('\\')
        .rsplit('\\')
        .next()
        .unwrap_or_default();
    if normalized(&caption) == normalized(basename) {
        return true;
    }
    absolute_windows_path(&caption)
        && absolute_windows_path(cwd)
        && normalized_windows_path(&caption) == normalized_windows_path(cwd)
}

fn choose_window(session: &Value, windows: Vec<WindowTarget>) -> Selection {
    let matches: Vec<WindowTarget> = windows
        .iter()
        .filter(|window| project_matches(session, window))
        .cloned()
        .collect();
    match matches.len() {
        1 => Selection::Target(matches.into_iter().next().unwrap(), "project"),
        2.. => Selection::Choices(matches),
        _ if windows.len() == 1 => {
            Selection::Target(windows.into_iter().next().unwrap(), "application")
        }
        _ => Selection::Choices(windows),
    }
}

struct NativeWindows;
#[cfg(not(windows))]
impl WindowApi for NativeWindows {
    fn list(&self, _processes: &[&ProcessInfo]) -> Result<Vec<WindowTarget>, ()> {
        Err(())
    }
    fn focus(&self, _target: &WindowTarget) -> FocusOutcome {
        FocusOutcome::Denied
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, HWND, LPARAM},
        System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::WindowsAndMessaging::{
            EnumWindows, GetAncestor, GetForegroundWindow, GetWindow, GetWindowTextW,
            GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
            ShowWindow, GA_ROOTOWNER, GW_OWNER, SW_RESTORE,
        },
    };

    fn process_id(hwnd: HWND) -> u32 {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        pid
    }

    pub(super) fn creation_id(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut created: FILETIME = std::mem::zeroed();
            let mut exited: FILETIME = std::mem::zeroed();
            let mut kernel: FILETIME = std::mem::zeroed();
            let mut user: FILETIME = std::mem::zeroed();
            let result =
                GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user);
            CloseHandle(process);
            (result != 0).then(|| {
                (((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64).to_string()
            })
        }
    }

    fn title(hwnd: HWND) -> Option<String> {
        let mut text = vec![0u16; 32_769];
        let length = unsafe { GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32) };
        if length <= 0 || length as usize == text.len() - 1 {
            return None;
        }
        String::from_utf16(&text[..length as usize]).ok()
    }

    fn inspect_for_pid(hwnd: HWND, expected_pid: Option<u32>) -> Option<WindowTarget> {
        if unsafe { IsWindow(hwnd) } == 0 {
            return None;
        }
        let pid = process_id(hwnd);
        if pid == 0 || expected_pid.is_some_and(|expected| expected != pid) {
            return None;
        }
        Some(WindowTarget {
            handle: hwnd as usize,
            pid,
            creation_id: creation_id(pid)?,
            title: title(hwnd)?,
            app: String::new(),
        })
    }

    fn foreground_is(hwnd: HWND) -> bool {
        unsafe {
            let foreground = GetForegroundWindow();
            !foreground.is_null()
                && (foreground == hwnd || GetAncestor(foreground, GA_ROOTOWNER) == hwnd)
        }
    }

    struct Enumeration<'a> {
        allowed: HashMap<u32, &'a ProcessInfo>,
        windows: Vec<WindowTarget>,
    }

    unsafe extern "system" fn enumerate(hwnd: HWND, lparam: LPARAM) -> i32 {
        let enumeration = &mut *(lparam as *mut Enumeration<'_>);
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        let Some(process) = enumeration.allowed.get(&process_id(hwnd)) else {
            return 1;
        };
        if let Some(mut window) = inspect_for_pid(hwnd, Some(process.process_id)) {
            if same_process_birth(&process.creation_id, &window.creation_id)
                && !window.title.trim().is_empty()
            {
                window.app = if process.name.to_ascii_lowercase().ends_with(".exe") {
                    &process.name[..process.name.len() - 4]
                } else {
                    &process.name
                }
                .to_owned();
                enumeration.windows.push(window);
            }
        }
        i32::from(enumeration.windows.len() < 128)
    }

    impl WindowApi for NativeWindows {
        fn list(&self, processes: &[&ProcessInfo]) -> Result<Vec<WindowTarget>, ()> {
            if processes.is_empty() {
                return Ok(vec![]);
            }
            let mut enumeration = Enumeration {
                allowed: processes
                    .iter()
                    .map(|process| (process.process_id, *process))
                    .collect(),
                windows: vec![],
            };
            let result = unsafe {
                EnumWindows(
                    Some(enumerate),
                    &mut enumeration as *mut Enumeration<'_> as LPARAM,
                )
            };
            if result == 0 && enumeration.windows.len() < 128 {
                return Err(());
            }
            Ok(enumeration.windows)
        }

        fn focus(&self, target: &WindowTarget) -> FocusOutcome {
            let hwnd = target.handle as HWND;
            let Some(latest) = inspect_for_pid(hwnd, Some(target.pid)) else {
                return FocusOutcome::Stale;
            };
            if latest.pid != target.pid
                || latest.creation_id != target.creation_id
                || latest.title != target.title
                || unsafe { IsWindowVisible(hwnd) } == 0
                || unsafe { !GetWindow(hwnd, GW_OWNER).is_null() }
            {
                return FocusOutcome::Stale;
            }
            unsafe {
                if IsIconic(hwnd) != 0 {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                SetForegroundWindow(hwnd);
            }
            for _ in 0..10 {
                if foreground_is(hwnd) {
                    return FocusOutcome::Focused;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            FocusOutcome::Denied
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::{
            System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentProcessId},
            UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, SetWindowTextW, SW_SHOWMINNOACTIVE,
                SW_SHOWNOACTIVATE, WS_OVERLAPPEDWINDOW,
            },
        };

        struct OwnedWindow(HWND);
        impl OwnedWindow {
            fn new(title: &str) -> Self {
                let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
                let title: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();
                let hwnd = unsafe {
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        title.as_ptr(),
                        WS_OVERLAPPEDWINDOW,
                        0,
                        0,
                        300,
                        180,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        GetModuleHandleW(std::ptr::null()),
                        std::ptr::null(),
                    )
                };
                assert!(!hwnd.is_null());
                Self(hwnd)
            }
        }
        impl Drop for OwnedWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }

        #[test]
        fn native_identity_reads_the_entire_utf16_caption() {
            let title = format!("{} - çalışma-🦀 - Cursor", "x".repeat(1400));
            let owned = OwnedWindow::new(&title);
            let snapshot =
                inspect_for_pid(owned.0, None).expect("owned window must be inspectable");
            assert_eq!(snapshot.title, title);
            assert_eq!(snapshot.pid, unsafe { GetCurrentProcessId() });
            assert!(same_process_birth(
                &snapshot.creation_id,
                &creation_id(snapshot.pid).unwrap()
            ));
        }

        #[test]
        fn native_identity_retains_caption_whitespace() {
            let owned = OwnedWindow::new("  my-app - Cursor  ");
            assert_eq!(
                inspect_for_pid(owned.0, None).unwrap().title,
                "  my-app - Cursor  "
            );
        }

        #[test]
        fn native_rejects_changed_hidden_destroyed_and_recycled_identity_before_focusing() {
            let owned = OwnedWindow::new("owned original - Cursor");
            let snapshot = inspect_for_pid(owned.0, None).unwrap();
            assert_eq!(NativeWindows.focus(&snapshot), FocusOutcome::Stale);
            unsafe {
                ShowWindow(owned.0, SW_SHOWNOACTIVATE);
            }
            let changed_title: Vec<u16> = "owned replacement - Cursor\0".encode_utf16().collect();
            unsafe {
                SetWindowTextW(owned.0, changed_title.as_ptr());
            }
            assert_eq!(NativeWindows.focus(&snapshot), FocusOutcome::Stale);
            let mut wrong_birth = inspect_for_pid(owned.0, None).unwrap();
            wrong_birth.creation_id = "1".into();
            assert_eq!(NativeWindows.focus(&wrong_birth), FocusOutcome::Stale);
            let mut wrong_pid = inspect_for_pid(owned.0, None).unwrap();
            wrong_pid.pid = 0;
            assert_eq!(NativeWindows.focus(&wrong_pid), FocusOutcome::Stale);
            drop(owned);
            assert_eq!(NativeWindows.focus(&snapshot), FocusOutcome::Stale);
        }

        #[test]
        fn enumeration_excludes_unallowed_pids_and_mismatched_cim_creation_identity() {
            let owned = OwnedWindow::new("owned enumeration - Cursor");
            unsafe {
                ShowWindow(owned.0, SW_SHOWNOACTIVATE);
            }
            let mut process = ProcessInfo {
                process_id: unsafe { GetCurrentProcessId() },
                name: "Cursor.exe".into(),
                creation_id: "1".into(),
                ..Default::default()
            };
            assert!(NativeWindows.list(&[&process]).unwrap().is_empty());
            process.creation_id = creation_id(process.process_id).unwrap();
            let allowed = NativeWindows.list(&[&process]).unwrap();
            assert!(allowed
                .iter()
                .any(|window| window.handle == owned.0 as usize
                    && window.title == "owned enumeration - Cursor"));
            process.process_id = u32::MAX;
            assert!(NativeWindows.list(&[&process]).unwrap().is_empty());
        }

        #[test]
        #[ignore = "Activates only a test-owned window; run explicitly in an interactive Windows session"]
        fn activation_result_matches_real_foreground_and_restores_owned_window() {
            let owned = OwnedWindow::new("AgentHUD owned activation fixture - Cursor");
            unsafe {
                ShowWindow(owned.0, SW_SHOWMINNOACTIVE);
            }
            assert_ne!(unsafe { IsIconic(owned.0) }, 0);
            let snapshot = inspect_for_pid(owned.0, None).unwrap();
            let outcome = NativeWindows.focus(&snapshot);
            assert_eq!(unsafe { IsIconic(owned.0) }, 0);
            assert_eq!(outcome == FocusOutcome::Focused, foreground_is(owned.0));
            assert_ne!(outcome, FocusOutcome::Stale);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::time::Duration;

    fn session() -> Value {
        json!({ "id": "cursor:session", "provider": "cursor", "cwd": "C:\\ex\\my-app" })
    }
    fn window(handle: usize, title: &str) -> WindowTarget {
        WindowTarget {
            handle,
            pid: 20,
            creation_id: "134370000000000009".into(),
            title: title.into(),
            app: "Cursor".into(),
        }
    }
    fn process(pid: u32, parent: u32, name: &str) -> ProcessInfo {
        ProcessInfo {
            process_id: pid,
            parent_process_id: parent,
            name: name.into(),
            creation_id: "134370000000000000".into(),
            ..Default::default()
        }
    }
    #[derive(Default)]
    struct FakeWindows {
        windows: RefCell<Vec<WindowTarget>>,
        focused: RefCell<Vec<usize>>,
        stale: Cell<bool>,
        denied: Cell<bool>,
        list_error: Cell<bool>,
    }
    impl FakeWindows {
        fn ambiguous() -> Self {
            Self {
                windows: RefCell::new(vec![
                    window(601, "a.ts - my-app - Cursor"),
                    window(602, "b.ts - my-app - Cursor"),
                ]),
                ..Default::default()
            }
        }
    }
    impl WindowApi for FakeWindows {
        fn list(&self, _processes: &[&ProcessInfo]) -> Result<Vec<WindowTarget>, ()> {
            if self.list_error.get() {
                Err(())
            } else {
                Ok(self.windows.borrow().clone())
            }
        }
        fn focus(&self, target: &WindowTarget) -> FocusOutcome {
            self.focused.borrow_mut().push(target.handle);
            if self.stale.get() {
                FocusOutcome::Stale
            } else if self.denied.get() {
                FocusOutcome::Denied
            } else {
                FocusOutcome::Focused
            }
        }
    }

    #[test]
    fn exact_workspace_caption_beats_file_names_and_similar_folders() {
        let result = choose_window(
            &session(),
            vec![
                window(1, "index.ts - my-app-next - Cursor"),
                window(2, "my-app - other-project - Cursor"),
                window(3, "index.ts - my-app - Cursor"),
            ],
        );
        assert_eq!(
            result,
            Selection::Target(window(3, "index.ts - my-app - Cursor"), "project")
        );
    }

    #[test]
    fn workspace_markers_separator_variants_and_canonical_unicode_match() {
        for title in [
            "● my-app (Workspace) — Cursor",
            "a.ts – my-app | Cursor",
            "a.ts · my-app - Cursor",
        ] {
            assert!(
                matches!(
                    choose_window(
                        &session(),
                        vec![window(1, title), window(2, "elsewhere - Cursor")]
                    ),
                    Selection::Target(_, "project")
                ),
                "{title}"
            );
        }
        let session = json!({ "cwd": "C:\\ex\\café" });
        assert!(matches!(
            choose_window(
                &session,
                vec![
                    window(1, "cafe\u{301} - Cursor"),
                    window(2, "other - Cursor")
                ]
            ),
            Selection::Target(_, "project")
        ));
    }

    #[test]
    fn absolute_caption_uses_windows_path_normalization() {
        assert!(matches!(
            choose_window(
                &session(),
                vec![
                    window(1, "a.ts - c:/EX/old/../my-app/ - Cursor"),
                    window(2, "other - Cursor")
                ]
            ),
            Selection::Target(_, "project")
        ));
        assert!(matches!(
            choose_window(
                &session(),
                vec![
                    window(1, "C:\\different\\my-app - Cursor"),
                    window(2, "other - Cursor")
                ]
            ),
            Selection::Choices(_)
        ));
    }

    #[test]
    fn ambiguous_matches_require_choices_and_generic_single_window_is_application_scope() {
        let same = vec![
            window(1, "a.ts - my-app - Cursor"),
            window(2, "b.ts - my-app - Cursor"),
        ];
        assert_eq!(
            choose_window(&session(), same.clone()),
            Selection::Choices(same)
        );
        assert_eq!(
            choose_window(&session(), vec![window(3, "Cursor Agents")]),
            Selection::Target(window(3, "Cursor Agents"), "application")
        );
        assert_eq!(
            choose_window(&session(), vec![]),
            Selection::Choices(vec![])
        );
        let misleading = vec![
            window(4, "Discuss my-app roadmap"),
            window(5, "my-app-next - Cursor"),
        ];
        assert_eq!(
            choose_window(&session(), misleading.clone()),
            Selection::Choices(misleading)
        );
    }

    #[test]
    fn candidates_include_only_provider_and_eligible_ancestors_and_stop_cycles() {
        let processes = vec![
            process(20, 10, "codex.exe"),
            process(10, 5, "pwsh.exe"),
            process(5, 1, "WindowsTerminal.exe"),
            process(1, 0, "explorer.exe"),
            process(99, 1, "chrome.exe"),
        ];
        assert_eq!(
            candidate_processes("codex", &processes)
                .iter()
                .map(|p| p.process_id)
                .collect::<Vec<_>>(),
            vec![20, 10, 5]
        );
        assert!(candidate_processes("unknown", &processes).is_empty());
        assert!(candidate_processes("claude", &[process(1, 0, "claude.exe")]).is_empty());
        assert_eq!(
            candidate_processes("cursor", &[process(1, 1, "Cursor.exe")]).len(),
            1
        );
        assert_eq!(
            candidate_processes(
                "codex",
                &[
                    process(3, 2, "codex.exe"),
                    process(2, 1, "Cursor.exe"),
                    process(1, 0, "Code.exe")
                ]
            )
            .iter()
            .map(|p| p.process_id)
            .collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
    }

    #[test]
    fn process_birth_allows_only_cim_microsecond_truncation() {
        assert!(same_process_birth(
            "134370000000000000",
            "134370000000000009"
        ));
        for left in [
            "134370000000000010",
            "",
            "-1",
            "1.0",
            "abc",
            "18446744073709551616",
            "000000000000000000000",
        ] {
            assert!(!same_process_birth(left, "134370000000000009"), "{left}");
        }
    }

    #[test]
    fn choices_are_opaque_session_bound_and_expire_at_sixty_seconds() {
        let native = FakeWindows::ambiguous();
        let mut service = FocusService::new();
        let now = Instant::now();
        let result = service.request_with(&session(), None, &[], &native, now);
        let choices = result["choices"]
            .as_array()
            .expect("ambiguity must return choices");
        assert_eq!(choices.len(), 2);
        let id = choices[0]["id"].as_str().unwrap();
        assert!(uuid::Uuid::parse_str(id).is_ok());
        assert!(choices[0].get("handle").is_none());
        assert!(choices[0].get("pid").is_none());
        assert!(choices[0].get("creationId").is_none());
        assert!(native.focused.borrow().is_empty());
        let mut different = session();
        different["id"] = json!("other-session");
        assert_eq!(
            service.request_with(&different, Some(id), &[], &native, now)["ok"],
            false
        );
        different = session();
        different["cwd"] = json!("C:\\other");
        assert_eq!(
            service.request_with(&different, Some(id), &[], &native, now)["ok"],
            false
        );
        different = session();
        different["provider"] = json!("codex");
        assert_eq!(
            service.request_with(&different, Some(id), &[], &native, now)["ok"],
            false
        );
        assert_eq!(
            service.request_with(
                &session(),
                Some(id),
                &[],
                &native,
                now + Duration::from_secs(60)
            )["ok"],
            false
        );
        assert!(native.focused.borrow().is_empty());
    }

    #[test]
    fn refresh_invalidates_old_choice_and_success_reports_selected_scope() {
        let native = FakeWindows::ambiguous();
        let mut service = FocusService::new();
        let now = Instant::now();
        let first = service.request_with(&session(), None, &[], &native, now);
        let second = service.request_with(&session(), None, &[], &native, now);
        assert_eq!(
            service.request_with(
                &session(),
                first["choices"][0]["id"].as_str(),
                &[],
                &native,
                now
            )["ok"],
            false
        );
        let result = service.request_with(
            &session(),
            second["choices"][1]["id"].as_str(),
            &[],
            &native,
            now,
        );
        assert_eq!(result, json!({ "ok": true, "scope": "selected" }));
        assert_eq!(*native.focused.borrow(), vec![602]);
    }

    #[test]
    fn stale_denied_and_native_read_failures_are_recoverable() {
        let native = FakeWindows {
            windows: RefCell::new(vec![window(1, "my-app - Cursor")]),
            ..Default::default()
        };
        let mut service = FocusService::new();
        let now = Instant::now();
        native.stale.set(true);
        let result = service.request_with(&session(), None, &[], &native, now);
        assert_eq!(result["ok"], false);
        assert!(result["message"]
            .as_str()
            .unwrap()
            .contains("değişmiş veya kapanmış"));
        native.stale.set(false);
        native.denied.set(true);
        assert_eq!(
            service.request_with(&session(), None, &[], &native, now)["ok"],
            false
        );
        native.list_error.set(true);
        assert_eq!(
            service.request_with(&session(), None, &[], &native, now)["ok"],
            false
        );
        assert_eq!(
            service.request_with(&session(), Some("forged-choice"), &[], &native, now)["ok"],
            false
        );
    }

    #[test]
    fn invalid_provider_or_session_never_reads_or_activates_windows() {
        let native = FakeWindows::ambiguous();
        let mut service = FocusService::new();
        let now = Instant::now();
        for invalid in [
            json!({}),
            json!({ "id": "x", "provider": "claude", "cwd": "C:\\ex" }),
            json!({ "id": "", "provider": "cursor" }),
        ] {
            assert_eq!(
                service.request_with(&invalid, None, &[], &native, now)["ok"],
                false
            );
        }
        assert!(native.focused.borrow().is_empty());
    }
}
