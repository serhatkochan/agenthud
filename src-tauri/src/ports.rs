use crate::{
    models::{now_ms, Inventory, ProcessInfo},
    system,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
};
const RETENTION_MS: u64 = 600_000;

#[derive(Clone)]
struct PortEntry {
    key: String,
    port: u16,
    pid: u32,
    process_name: String,
    project: String,
    agent: Option<String>,
    listening: bool,
    orphan: bool,
    cwd: Option<String>,
    identity: String,
    creation_id: String,
    executable: Option<String>,
    command: Option<String>,
    stopped_at: Option<u64>,
}
struct Launched {
    child: Child,
    executable: String,
}
#[derive(Default)]
pub struct PortManager {
    entries: BTreeMap<String, PortEntry>,
    launched: HashMap<u32, Launched>,
}
impl PortManager {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn scan(&mut self, system: &Inventory) -> Vec<Value> {
        self.scan_at(system, now_ms())
    }
    fn scan_at(&mut self, system: &Inventory, now: u64) -> Vec<Value> {
        let mut live = HashSet::new();
        self.launched
            .retain(|_, launch| matches!(launch.child.try_wait(), Ok(None)));
        let app_directory = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        for listener in &system.listeners {
            if listener.port < 1024 {
                continue;
            }
            let Some(process) = system
                .processes
                .iter()
                .find(|p| p.process_id == listener.pid)
            else {
                continue;
            };
            if process.process_id == std::process::id() {
                continue;
            }
            let key = format!("{}:{}", listener.port, process.process_id);
            let previous = self
                .entries
                .values()
                .find(|entry| same_process(entry, process))
                .cloned();
            let own_launch = self
                .launched
                .get(&process.process_id)
                .is_some_and(|launch| {
                    process
                        .executable_path
                        .as_ref()
                        .is_some_and(|exe| exe.eq_ignore_ascii_case(&launch.executable))
                });
            if !developer_process(process, &system.processes) && previous.is_none() && !own_launch {
                continue;
            }
            let cwd = process
                .working_directory
                .as_deref()
                .filter(|p| absolute_directory(p))
                .and_then(|p| std::path::absolute(p).ok())
                .map(|p| p.to_string_lossy().into_owned());
            if cwd
                .as_ref()
                .zip(app_directory.as_ref())
                .is_some_and(|(cwd, app)| {
                    cwd.trim_end_matches(['\\', '/'])
                        .eq_ignore_ascii_case(app.trim_end_matches(['\\', '/']))
                })
            {
                continue;
            }
            let hint = cwd.clone().or_else(|| {
                project_hint_directory(process.command_line.as_deref().unwrap_or_default())
            });
            let mut project = hint
                .as_deref()
                .map(basename)
                .unwrap_or_else(|| process.name.trim_end_matches(".exe").to_owned());
            if let Some(hint) = &hint {
                project = project_name(Path::new(hint), &project)
            }
            let entry = PortEntry {
                key: key.clone(),
                port: listener.port,
                pid: process.process_id,
                process_name: process.name.clone(),
                project,
                cwd,
                agent: system::agent_for(process, &system.processes)
                    .or_else(|| previous.as_ref().and_then(|e| e.agent.clone())),
                listening: true,
                orphan: !system
                    .processes
                    .iter()
                    .any(|p| p.process_id == process.parent_process_id),
                identity: process.creation_date.clone(),
                creation_id: process.creation_id.clone(),
                executable: process.executable_path.clone(),
                command: process.command_line.clone(),
                stopped_at: None,
            };
            live.insert(key.clone());
            self.entries.insert(key, entry);
            if own_launch {
                self.launched.remove(&process.process_id);
            }
        }
        self.entries.retain(|key, entry| {
            if !live.contains(key) && entry.listening {
                entry.listening = false;
                entry.stopped_at = Some(now)
            }
            entry.listening
                || entry
                    .stopped_at
                    .is_some_and(|at| now.saturating_sub(at) <= RETENTION_MS)
        });
        self.public_entries()
    }
    fn public_entries(&self) -> Vec<Value> {
        let mut entries:Vec<_>=self.entries.values().map(|e|json!({"key":e.key,"port":e.port,"pid":e.pid,"processName":e.process_name,"project":e.project,"agent":e.agent,"status":if e.listening{"listening"}else{"stopped"},"orphan":e.orphan,"canRestart":e.cwd.is_some()&&e.executable.is_some()&&e.command.is_some()})).collect();
        entries.sort_by_key(|e| e["port"].as_u64());
        entries
    }
    pub fn stop(&mut self, key: &str) -> Result<(), String> {
        let entry = self
            .entries
            .get(key)
            .filter(|e| e.listening)
            .ok_or("Port artık açık değil. Listeyi yenile.")?
            .clone();
        if entry.pid == std::process::id() {
            return Err("Uygulamanın kendi süreci durdurulamaz.".into());
        }
        let current = system::inventory(true)?
            .processes
            .into_iter()
            .find(|p| p.process_id == entry.pid)
            .filter(|p| same_process(&entry, p))
            .ok_or("Süreç değişmiş. Listeyi yenile ve yeniden dene.")?;
        terminate_verified(&current)?;
        if let Some(entry) = self.entries.get_mut(key) {
            entry.cwd = current.working_directory.filter(|p| absolute_directory(p));
            entry.listening = false;
            entry.stopped_at = Some(now_ms());
        }
        Ok(())
    }
    pub fn restart(&mut self, key: &str) -> Result<(), String> {
        let entry = self
            .entries
            .get(key)
            .filter(|e| {
                !e.listening
                    && e.stopped_at
                        .is_some_and(|at| now_ms().saturating_sub(at) <= RETENTION_MS)
            })
            .ok_or("Bu süreç için yeniden başlatma bilgisi bulunmuyor.")?;
        let (cwd, executable, command) = match (&entry.cwd, &entry.executable, &entry.command) {
            (Some(cwd), Some(executable), Some(command)) => (cwd, executable, command),
            _ => return Err("Bu süreç için yeniden başlatma bilgisi bulunmuyor.".into()),
        };
        let mut launch = Command::new(executable);
        launch
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            launch
                .raw_arg(command_tail(command))
                .creation_flags(0x08000000 | 0x00000200);
        }
        #[cfg(not(windows))]
        {
            let _ = command;
            return Err("Süreç yeniden başlatma yalnızca Windows'ta kullanılabilir.".into());
        }
        #[cfg(windows)]
        {
            let child = launch
                .spawn()
                .map_err(|_| "Süreç başlatılamadı. Proje klasörünü kontrol et.".to_owned())?;
            self.launched.insert(
                child.id(),
                Launched {
                    child,
                    executable: executable.clone(),
                },
            );
            self.entries.remove(key);
            Ok(())
        }
    }
}

fn same_process(entry: &PortEntry, process: &ProcessInfo) -> bool {
    entry.pid == process.process_id
        && !entry.identity.is_empty()
        && entry.identity == process.creation_date
        && entry.creation_id == process.creation_id
        && entry.command == process.command_line
        && entry.executable == process.executable_path
}
fn developer_process(process: &ProcessInfo, processes: &[ProcessInfo]) -> bool {
    let name = process.name.to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    if [
        "node",
        "bun",
        "deno",
        "go",
        "uvicorn",
        "cargo",
        "rust",
        "dotnet",
        "docker-proxy",
        "php",
        "ruby",
        "java",
    ]
    .contains(&name)
        || name
            .strip_prefix("python")
            .is_some_and(|v| v.chars().all(|c| c.is_ascii_digit() || c == '.'))
    {
        return true;
    }
    let mut seen = HashSet::from([process.process_id]);
    let mut parent = process.parent_process_id;
    while parent != 0 && seen.insert(parent) {
        let Some(current) = processes.iter().find(|p| p.process_id == parent) else {
            break;
        };
        if ["go", "cargo", "rustc"]
            .contains(&current.name.to_ascii_lowercase().trim_end_matches(".exe"))
        {
            return true;
        }
        parent = current.parent_process_id;
    }
    false
}
pub(crate) fn basename(directory: &str) -> String {
    directory
        .trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(directory)
        .to_owned()
}
fn absolute_directory(directory: &str) -> bool {
    let bytes = directory.as_bytes();
    !directory.contains('\0')
        && ((bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
            || directory.starts_with("\\\\")
            || cfg!(not(windows)) && directory.starts_with('/'))
}
fn manifest(directory: &Path, name: &str) -> String {
    let Ok(file) = fs::File::open(directory.join(name)) else {
        return String::new();
    };
    if file.metadata().map_or(true, |m| m.len() > 1024 * 1024) {
        return String::new();
    }
    let mut content = String::new();
    if file
        .take(1024 * 1024 + 1)
        .read_to_string(&mut content)
        .is_err()
        || content.len() > 1024 * 1024
    {
        return String::new();
    }
    content
}
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= 200 && !name.chars().any(|c| c <= '\u{1f}')
}
fn project_name(directory: &Path, fallback: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(&manifest(directory, "package.json")) {
        if let Some(name) = value["name"].as_str().filter(|v| valid_name(v)) {
            return name.into();
        }
    }
    for line in manifest(directory, "go.mod").lines() {
        let line = line.trim();
        let Some(rest) = line
            .strip_prefix("module")
            .filter(|v| v.starts_with([' ', '\t']))
            .map(str::trim_start)
        else {
            continue;
        };
        let value = if rest.starts_with('"') {
            let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<String>();
            let Some(Ok(value)) = stream.next() else {
                continue;
            };
            let tail = rest[stream.byte_offset()..].trim();
            if !tail.is_empty() && !tail.starts_with("//") {
                continue;
            }
            value
        } else {
            let Some(name) = rest.split_whitespace().next() else {
                continue;
            };
            if name.starts_with('/') || name.contains('"') {
                continue;
            }
            let tail = rest[name.len()..].trim();
            if !tail.is_empty() && !tail.starts_with("//") {
                continue;
            }
            name.to_owned()
        };
        if valid_name(&value) {
            return value;
        }
    }
    fallback.into()
}
fn project_hint_directory(command: &str) -> Option<String> {
    let lower = command.to_ascii_lowercase();
    for marker in ["\\node_modules\\", "/node_modules/"] {
        if let Some(end) = lower.find(marker) {
            let prefix = &command[..end];
            if let Some((start, _)) = prefix
                .as_bytes()
                .windows(3)
                .enumerate()
                .filter(|(_, v)| {
                    v[0].is_ascii_alphabetic() && v[1] == b':' && (v[2] == b'/' || v[2] == b'\\')
                })
                .last()
            {
                return Some(prefix[start..].into());
            }
        }
    }
    for quoted in command.split('"').skip(1).step_by(2) {
        if absolute_directory(quoted)
            && [".js", ".mjs", ".cjs", ".py"]
                .iter()
                .any(|ext| quoted.ends_with(ext))
        {
            return quoted.rsplit_once(['\\', '/']).map(|p| p.0.to_owned());
        }
    }
    None
}
fn command_tail(command: &str) -> &str {
    let command = command.trim_start();
    let end = if let Some(command) = command.strip_prefix('"') {
        command
            .find('"')
            .map(|p| p + 2)
            .unwrap_or(command.len() + 1)
    } else {
        command.find(char::is_whitespace).unwrap_or(command.len())
    };
    command[end..].trim_start()
}

#[cfg(windows)]
fn terminate_verified(process: &ProcessInfo) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::Threading::{
            GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_TERMINATE,
        },
    };
    let expected = system::creation_micros(&process.creation_id)
        .ok_or("Süreç kimliği doğrulanamadı. Listeyi yenile.")?;
    unsafe {
        let handle = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            0,
            process.process_id,
        );
        if handle.is_null() {
            return Err("Süreç durdurulamadı. Erişim iznini kontrol et.".into());
        }
        let mut created: FILETIME = std::mem::zeroed();
        let mut exited: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let read = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user);
        let actual = (((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64) / 10;
        let result = if read == 0 || actual != expected {
            Err("Süreç değişmiş. Listeyi yenile ve yeniden dene.".into())
        } else if TerminateProcess(handle, 1) == 0 {
            Err("Süreç durdurulamadı. Erişim iznini kontrol et.".into())
        } else {
            Ok(())
        };
        CloseHandle(handle);
        result
    }
}
#[cfg(not(windows))]
fn terminate_verified(_process: &ProcessInfo) -> Result<(), String> {
    Err("Süreç durdurma yalnızca Windows'ta kullanılabilir.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Listener;
    use std::fs;
    fn server(directory: &str) -> ProcessInfo {
        ProcessInfo {
            process_id: 42,
            parent_process_id: 41,
            name: "backend.exe".into(),
            command_line: Some("\"C:\\build\\backend.exe\" --flag \"two words\"".into()),
            executable_path: Some("C:\\build\\backend.exe".into()),
            working_directory: Some(directory.into()),
            creation_date: "identity-a".into(),
            creation_id: "134368017789901740".into(),
        }
    }
    #[test]
    fn compiled_children_keep_known_identity_and_agent_after_launcher_exits() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("go.mod"),
            "module example.com/team/backend-api\n\ngo 1.24\n",
        )
        .unwrap();
        for launcher in ["go.exe", "cargo.exe"] {
            let child = server(dir.path().to_str().unwrap());
            let mut manager = PortManager::new();
            let listeners = vec![Listener {
                pid: 42,
                port: 8080,
                ..Default::default()
            }];
            let rows = manager.scan(&Inventory {
                listeners: listeners.clone(),
                processes: vec![
                    child.clone(),
                    ProcessInfo {
                        process_id: 41,
                        parent_process_id: 40,
                        name: launcher.into(),
                        ..Default::default()
                    },
                    ProcessInfo {
                        process_id: 40,
                        name: "Cursor.exe".into(),
                        ..Default::default()
                    },
                ],
            });
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0]["project"], "example.com/team/backend-api");
            assert_eq!(rows[0]["agent"], "cursor");
            let rows = manager.scan(&Inventory {
                listeners: listeners.clone(),
                processes: vec![child.clone()],
            });
            assert_eq!(rows[0]["orphan"], true);
            assert_eq!(rows[0]["agent"], "cursor");
            let replaced = ProcessInfo {
                creation_date: "identity-b".into(),
                creation_id: "134368017789901750".into(),
                ..child
            };
            let rows = manager.scan(&Inventory {
                listeners,
                processes: vec![replaced],
            });
            assert_eq!(rows[0]["status"], "stopped");
        }
    }
    #[test]
    fn package_and_go_names_are_strings_without_control_characters() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"name":{"unexpected":true}}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("go.mod"),
            "module \"example.com/team/api\" // comment\n",
        )
        .unwrap();
        assert_eq!(project_name(dir.path(), "fallback"), "example.com/team/api");
        fs::write(dir.path().join("go.mod"), "module \"bad\\nname\"\n").unwrap();
        assert_eq!(project_name(dir.path(), "fallback"), "fallback");
    }
    #[test]
    fn command_tail_preserves_original_windows_argument_bytes() {
        assert_eq!(
            command_tail("  \"C:\\Program Files\\node.exe\"  --title \"a b\"  C:\\x\\"),
            "--title \"a b\"  C:\\x\\"
        );
        assert_eq!(
            command_tail("C:\\node.exe --flag=\"x y\""),
            "--flag=\"x y\""
        );
    }
    #[test]
    fn public_ports_never_include_private_command_or_cwd() {
        let child = ProcessInfo {
            name: "node.exe".into(),
            working_directory: None,
            ..server("C:\\private")
        };
        let mut manager = PortManager::new();
        let rows = manager.scan(&Inventory {
            listeners: vec![
                Listener {
                    pid: 42,
                    port: 3000,
                    ..Default::default()
                },
                Listener {
                    pid: 42,
                    port: 3000,
                    address: "[::]".into(),
                },
            ],
            processes: vec![child],
        });
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["canRestart"], false);
        assert!(rows[0].get("command").is_none());
        assert!(rows[0].get("cwd").is_none());
    }
    #[test]
    fn stopped_commands_expire_after_ten_minutes_and_hints_never_authorize_restart() {
        let mut manager = PortManager::new();
        let process = ProcessInfo {
            name: "node.exe".into(),
            working_directory: None,
            command_line: Some("node \"C:\\shared\\node_modules\\vite\\bin\\vite.js\"".into()),
            ..server("C:\\private")
        };
        let rows = manager.scan_at(
            &Inventory {
                processes: vec![process],
                listeners: vec![Listener {
                    port: 3000,
                    pid: 42,
                    ..Default::default()
                }],
            },
            1000,
        );
        assert_eq!(rows[0]["project"], "shared");
        assert_eq!(rows[0]["canRestart"], false);
        assert_eq!(
            manager.scan_at(&Inventory::default(), 2000)[0]["status"],
            "stopped"
        );
        assert_eq!(manager.scan_at(&Inventory::default(), 602000).len(), 1);
        assert!(manager.scan_at(&Inventory::default(), 602001).is_empty());
        assert!(manager.stop("missing").is_err());
        assert!(manager.restart("missing").is_err());
    }
    #[cfg(windows)]
    #[test]
    fn own_windows_server_stop_checks_identity_and_restart_preserves_arguments_and_cwd() {
        use std::{
            io::Write,
            os::windows::process::CommandExt,
            thread,
            time::{Duration, Instant},
        };
        let directory = tempfile::Builder::new()
            .prefix("agenthud port Türkçe '")
            .tempdir()
            .unwrap();
        let script = directory.path().join("fixture server.ps1");
        let artifact = directory.path().join("fixture.json");
        let mut file = fs::File::create(&script).unwrap();
        file.write_all(br#"param([string]$First,[string]$Last)
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
$value=@{pid=$PID;port=$listener.LocalEndpoint.Port;first=$First;last=$Last;cwd=(Get-Location).Path}|ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path (Get-Location) 'fixture.json'),$value,[Text.UTF8Encoding]::new($false))
while($true){Start-Sleep -Milliseconds 100}
"#).unwrap();
        drop(file);
        let child = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .args(["two words", "C:\\trailing\\"])
            .current_dir(directory.path())
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        struct Owned(Child);
        impl Drop for Owned {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut child = Owned(child);
        let wait_artifact = || {
            let start = Instant::now();
            loop {
                if let Ok(raw) = fs::read(&artifact) {
                    if let Ok(value) = serde_json::from_slice::<Value>(&raw) {
                        return value;
                    }
                }
                assert!(
                    start.elapsed() < Duration::from_secs(15),
                    "owned fixture did not start"
                );
                thread::sleep(Duration::from_millis(30));
            }
        };
        let first = wait_artifact();
        let port = first["port"].as_u64().unwrap() as u16;
        assert_eq!(first["first"], "two words");
        assert_eq!(first["last"], "C:\\trailing\\");
        let mut inventory = system::inventory(true).unwrap();
        let process = inventory
            .processes
            .iter_mut()
            .find(|p| p.process_id == child.0.id())
            .unwrap();
        assert!(process.working_directory.as_ref().is_some_and(|p| p
            .trim_end_matches(['\\', '/'])
            .eq_ignore_ascii_case(directory.path().to_str().unwrap())));
        process.name = "node.exe".into();
        let mut manager = PortManager::new();
        let key = format!("{port}:{}", child.0.id());
        assert!(manager.scan(&inventory).iter().any(|row| row["key"] == key));
        let real_identity = manager.entries[&key].creation_id.clone();
        manager.entries.get_mut(&key).unwrap().creation_id = "1".into();
        assert!(manager.stop(&key).is_err());
        assert!(child.0.try_wait().unwrap().is_none());
        manager.entries.get_mut(&key).unwrap().creation_id = real_identity;
        manager.stop(&key).unwrap();
        child.0.wait().unwrap();
        fs::remove_file(&artifact).unwrap();
        manager.restart(&key).unwrap();
        // Keep the restarted child's handle until cleanup even if an assertion fails.
        let (_, launch) = manager.launched.drain().next().unwrap();
        let _restarted = Owned(launch.child);
        let second = wait_artifact();
        assert_eq!(second["first"], "two words");
        assert_eq!(second["last"], "C:\\trailing\\");
        assert_eq!(second["cwd"], first["cwd"]);
        assert_ne!(second["pid"], first["pid"]);
    }
}
