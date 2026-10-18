use crate::{models::now_ms, ports::basename};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const EVENTS: [&str; 5] = [
    "sessionStart",
    "afterAgentThought",
    "afterAgentResponse",
    "stop",
    "sessionEnd",
];
const COMMAND_PREFIX: &str = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ";
pub struct CursorTracker {
    directory: PathBuf,
    gate: Mutex<()>,
}
impl CursorTracker {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory: std::path::absolute(&directory).unwrap_or(directory),
            gate: Mutex::new(()),
        }
    }
    fn config_path(&self) -> PathBuf {
        self.directory.join("hooks.json")
    }
    fn events_directory(&self) -> PathBuf {
        self.directory.join("agenthud").join("events")
    }
    fn observer_header(&self) -> String {
        format!(
            "# AgentHUD Cursor observer v1\n$AgentHudDirectory='{}'\n",
            self.events_directory()
                .to_string_lossy()
                .replace('\'', "''")
        )
    }
    fn command(&self) -> Result<String, String> {
        let source =
            self.observer_header() + &include_str!("../native/cursor.ps1").replace("\r\n", "\n");
        let command = COMMAND_PREFIX.to_owned()
            + &STANDARD.encode(
                source
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            );
        if command.len() > 7800 {
            return Err("Cursor profil yolu gözlemci için çok uzun.".into());
        }
        Ok(command)
    }
    fn owns(&self, entry: &Value) -> bool {
        let Some(command) = entry["command"].as_str().filter(|v| v.len() <= 7800) else {
            return false;
        };
        let Some(encoded) = command.strip_prefix(COMMAND_PREFIX) else {
            return false;
        };
        let Ok(bytes) = STANDARD.decode(encoded) else {
            return false;
        };
        if bytes.len() % 2 != 0 {
            return false;
        }
        let units: Vec<_> = bytes
            .chunks_exact(2)
            .map(|v| u16::from_le_bytes([v[0], v[1]]))
            .collect();
        String::from_utf16(&units).is_ok_and(|source| source.starts_with(&self.observer_header()))
    }
    fn config(&self) -> Result<(Option<Vec<u8>>, Value), String> {
        let raw = match read_bounded(&self.config_path(), 1024 * 1024) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Cursor ayarları okunamadı; dosya değiştirilmedi.".into()),
        };
        let config = match raw.as_ref() {
            None => json!({"version":1,"hooks":{}}),
            Some(bytes) => std::str::from_utf8(bytes)
                .ok()
                .and_then(|v| serde_json::from_str::<Value>(v.trim_start_matches('\u{feff}')).ok())
                .ok_or("Cursor ayarlarında geçersiz JSON var; dosya değiştirilmedi.")?,
        };
        if !config.is_object()
            || config["version"] != 1
            || !config["hooks"].is_object()
            || !config["hooks"]
                .as_object()
                .is_some_and(|hooks| hooks.values().all(Value::is_array))
        {
            return Err("Cursor ayarlarının biçimi desteklenmiyor; dosya değiştirilmedi.".into());
        }
        Ok((raw, config))
    }
    pub fn status(&self) -> Value {
        let result = (|| {
            let (_, config) = self.config()?;
            self.command()?;
            let count = EVENTS
                .iter()
                .filter(|event| {
                    config["hooks"][**event]
                        .as_array()
                        .is_some_and(|entries| entries.iter().any(|entry| self.owns(entry)))
                })
                .count();
            let mut status = json!({"enabled":count==EVENTS.len(),"status":if count==0{"off"}else if count==EVENTS.len(){"waiting"}else{"error"},"configPath":self.config_path()});
            if count > 0 && count < EVENTS.len() {
                status["message"] =
                    json!("Cursor takip bağlantısı eksik. Yeniden etkinleştirebilirsin.")
            }
            Ok::<_, String>(status)
        })();
        result.unwrap_or_else(|error|json!({"enabled":false,"status":"error","configPath":self.config_path(),"message":error}))
    }
    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "Cursor takip ayarı tamamlanamadı.".to_owned())?;
        let (raw, mut config) = self.config()?;
        let command = self.command()?;
        let mut changed = false;
        for event in EVENTS {
            let previous = config["hooks"][event]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut next: Vec<_> = previous
                .iter()
                .filter(|entry| !self.owns(entry))
                .cloned()
                .collect();
            if enabled {
                next.push(json!({"command":command,"timeout":3}))
            }
            if previous != next {
                changed = true;
                config["hooks"][event] = json!(next)
            }
        }
        if !changed {
            return Ok(());
        }
        fs::create_dir_all(&self.directory)
            .map_err(|_| "Cursor ayar klasörü oluşturulamadı.".to_owned())?;
        let temporary = self
            .directory
            .join(format!(".agenthud-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| "Cursor ayarları yazılamadı.".to_owned())?;
            let mut bytes = serde_json::to_vec_pretty(&config)
                .map_err(|_| "Cursor ayarları hazırlanamadı.".to_owned())?;
            bytes.push(b'\n');
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Cursor ayarları yazılamadı.".to_owned())?;
            drop(file);
            let current = match read_bounded(&self.config_path(), 1024 * 1024) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => {
                    return Err("Cursor ayarları yeniden okunamadı; dosya değiştirilmedi.".into())
                }
            };
            if current != raw {
                return Err("Cursor ayarları işlem sırasında değişti. Tekrar dene.".into());
            }
            if let Some(original) = raw {
                let backup = self.directory.join(format!(
                    "hooks.agenthud-{}-{}.bak",
                    now_ms(),
                    uuid::Uuid::new_v4()
                ));
                let mut backup = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(backup)
                    .map_err(|_| {
                        "Cursor ayar yedeği yazılamadı; dosya değiştirilmedi.".to_owned()
                    })?;
                backup
                    .write_all(&original)
                    .and_then(|_| backup.sync_all())
                    .map_err(|_| {
                        "Cursor ayar yedeği yazılamadı; dosya değiştirilmedi.".to_owned()
                    })?;
            }
            fs::rename(&temporary, self.config_path())
                .map_err(|_| "Cursor ayarları değiştirilemedi.".to_owned())?;
            Ok(())
        })();
        let _ = fs::remove_file(temporary);
        result
    }
    pub fn read_sessions(&self) -> (Value, Vec<Value>) {
        let mut connection = self.status();
        if connection["enabled"] != true || connection["status"] == "error" {
            return (connection, vec![]);
        }
        let entries = match fs::read_dir(self.events_directory()) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return (connection, vec![])
            }
            Err(_) => {
                connection["status"] = json!("error");
                connection["message"] = json!("Cursor olayları okunamadı.");
                return (connection, vec![]);
            }
        };
        let mut files: Vec<_> = entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| event_filename(name))
            .collect();
        files.sort();
        let records: Vec<Value> = files
            .into_iter()
            .rev()
            .take(4096)
            .filter_map(|name| {
                read_bounded(&self.events_directory().join(name), 65536)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            })
            .collect();
        let sessions = reduce_cursor_events(&records, now_ms());
        if let Some(last) = sessions
            .iter()
            .filter_map(|s| s["updatedAt"].as_u64())
            .max()
            .filter(|at| *at > 0)
        {
            connection["status"] = json!("active");
            connection["lastEventAt"] = json!(last)
        }
        (connection, sessions)
    }
}

fn read_bounded(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let file = File::open(path)?;
    if file.metadata()?.len() > limit {
        return Err(std::io::Error::other("file too large"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(std::io::Error::other("file too large"));
    }
    Ok(bytes)
}
fn event_filename(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() == 61
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && bytes[8] == b'T'
        && bytes[9..22].iter().all(u8::is_ascii_digit)
        && &bytes[22..24] == b"Z-"
        && bytes[24..56]
            .iter()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(v))
        && &bytes[56..] == b".json"
}

#[derive(Clone)]
struct Event {
    name: String,
    id: String,
    generation: String,
    roots: Vec<String>,
    at: u64,
    status: Option<String>,
    reason: Option<String>,
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"_.:-".contains(&v))
}
fn root_path(value: &str) -> bool {
    if value.len() > 1024 {
        return false;
    }
    let bytes = value.as_bytes();
    (bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || value.strip_prefix("\\\\").is_some_and(|v| {
            v.split_once('\\')
                .is_some_and(|(server, share)| !server.is_empty() && !share.is_empty())
        })
}
fn validated_event(value: &Value, now: u64) -> Option<Event> {
    if !value.is_object() || value["version"] != 1 {
        return None;
    }
    let name = value["event"]
        .as_str()
        .filter(|name| EVENTS.contains(name))?;
    let id = value["conversationId"].as_str().filter(|v| identifier(v))?;
    let generation = value["generationId"].as_str()?;
    if !(generation.is_empty() || identifier(generation))
        || (!["sessionStart", "sessionEnd"].contains(&name) && !identifier(generation))
    {
        return None;
    }
    let at = value["at"]
        .as_str()
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .and_then(|v| u64::try_from(v.timestamp_millis()).ok())?;
    if at < now.saturating_sub(86_400_000) || at > now.saturating_add(60_000) {
        return None;
    }
    let roots = value["roots"]
        .as_array()
        .map(|roots| {
            roots
                .iter()
                .filter_map(Value::as_str)
                .filter(|v| root_path(v))
                .take(8)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let status = value["status"]
        .as_str()
        .filter(|v| ["completed", "aborted", "error"].contains(v))
        .map(str::to_owned);
    let reason = value["reason"]
        .as_str()
        .filter(|v| {
            [
                "completed",
                "aborted",
                "error",
                "window_close",
                "user_close",
            ]
            .contains(v)
        })
        .map(str::to_owned);
    Some(Event {
        name: name.into(),
        id: id.into(),
        generation: generation.into(),
        roots,
        at,
        status,
        reason,
    })
}
fn terminal_state(event: &Event) -> (&'static str, &'static str) {
    let result = if event.name == "sessionEnd" {
        event.reason.as_deref()
    } else {
        event.status.as_deref()
    };
    match result {
        Some("completed") => ("done", "Tamamlandı"),
        Some("aborted") => ("idle", "Durduruldu"),
        Some("window_close" | "user_close") => ("idle", "Oturum kapandı"),
        Some("error") => ("unknown", "Hata ile durdu"),
        _ => ("unknown", "Durum bilinmiyor"),
    }
}
fn reduce_cursor_events(records: &[Value], now: u64) -> Vec<Value> {
    let mut conversations: BTreeMap<String, Vec<Event>> = BTreeMap::new();
    for event in records.iter().filter_map(|v| validated_event(v, now)) {
        conversations
            .entry(event.id.clone())
            .or_default()
            .push(event)
    }
    conversations.into_iter().filter_map(|(id,mut events)|{
        events.sort_by_key(|e|e.at);
        let mut generations:BTreeMap<&str,Vec<&Event>>=BTreeMap::new();
        for event in &events{if !event.generation.is_empty()&&!["sessionStart","sessionEnd"].contains(&event.name.as_str()){generations.entry(&event.generation).or_default().push(event)}}
        let group=generations.values().max_by_key(|events|events.first().map(|e|e.at));
        let latest=group.and_then(|g|g.last().copied()).or_else(||events.last())?;
        let end=events.iter().rev().find(|e|e.name=="sessionEnd"&&e.at>=latest.at);
        let terminal=end.or_else(||group.and_then(|g|g.iter().rev().find(|e|e.name=="stop").copied()));
        let (mut state,mut label)=if let Some(terminal)=terminal{terminal_state(terminal)}else if group.is_some(){("working","")}else if latest.name=="sessionEnd"{terminal_state(latest)}else{("idle","")};
        let updated_at=latest.at.max(terminal.map_or(0,|e|e.at));
        if state=="working"&&now.saturating_sub(updated_at)>900_000{state="unknown";label="Yeni olay bekleniyor"}
        let cwd=events.iter().rev().flat_map(|e|e.roots.iter()).next().map(String::as_str).unwrap_or_default();
        let mut session=json!({"id":format!("cursor:{id}"),"provider":"cursor","project":if cwd.is_empty(){"Cursor oturumu".into()}else{basename(cwd)},"cwd":cwd,"state":state,"updatedAt":updated_at,"observedAt":now,"source":"Cursor · oturum olayları"});
        if !label.is_empty(){session["statusLabel"]=json!(label)}
        Some(session)
    }).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn installation_preserves_user_hooks_and_exact_bytes_backup() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("hooks.json");
        let original=b"{\"version\":1,\"other\":{\"keep\":true},\"hooks\":{\"stop\":[{\"command\":\"user-observer\"}],\"preToolUse\":[{\"command\":\"security-gate\"}]}}\n";
        fs::write(&config, original).unwrap();
        let tracker = CursorTracker::new(dir.path().into());
        tracker.set_enabled(true).unwrap();
        assert_eq!(tracker.status()["enabled"], true);
        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(installed["hooks"]["stop"][0]["command"], "user-observer");
        assert_eq!(
            installed["hooks"]["preToolUse"][0]["command"],
            "security-gate"
        );
        assert_eq!(installed["other"]["keep"], true);
        assert_eq!(installed["hooks"]["stop"].as_array().unwrap().len(), 2);
        let bytes = fs::read(&config).unwrap();
        tracker.set_enabled(true).unwrap();
        assert_eq!(fs::read(&config).unwrap(), bytes);
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|p| p.path().extension().is_some_and(|v| v == "bak"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(backups[0].path()).unwrap(), original);
        tracker.set_enabled(false).unwrap();
        let final_config: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(
            final_config["hooks"]["stop"],
            json!([{"command":"user-observer"}])
        );
    }
    #[test]
    fn malformed_configs_are_never_written() {
        for bytes in [
            b"not json".as_slice(),
            b"[]",
            b"{\"version\":2,\"hooks\":{}}",
            b"{\"version\":1,\"hooks\":{\"stop\":42}}",
            b"{\"version\":1,\"hooks\":{},\"bad\":\"\xff\"}",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("hooks.json");
            fs::write(&path, bytes).unwrap();
            assert!(CursorTracker::new(dir.path().into())
                .set_enabled(true)
                .is_err());
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
    }
    #[test]
    fn generation_reducer_uses_latest_started_turn_without_leaking_payload() {
        let event = |name: &str, generation: &str, at: &str| json!({"version":1,"event":name,"conversationId":"conversation-1","generationId":generation,"roots":["C:\\ex\\sample"],"at":at,"text":"PRIVATE"});
        let mut stopped = event("stop", "one", "2026-10-18T12:00:03Z");
        stopped["status"] = json!("completed");
        let rows = reduce_cursor_events(
            &[
                event("afterAgentThought", "one", "2026-10-18T12:00:00Z"),
                stopped,
                event("afterAgentThought", "two", "2026-10-18T12:00:02Z"),
            ],
            1792324804000,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["state"], "working");
        assert_eq!(rows[0]["project"], "sample");
        assert!(!rows[0].to_string().contains("PRIVATE"));
    }
    #[test]
    fn old_encoded_observers_remain_owned_and_unrelated_commands_survive_removal() {
        let dir = tempfile::tempdir().unwrap();
        let tracker = CursorTracker::new(dir.path().into());
        tracker.set_enabled(true).unwrap();
        let path = dir.path().join("hooks.json");
        let mut config: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let previous = COMMAND_PREFIX.to_owned()
            + &STANDARD.encode(
                (tracker.observer_header() + "# previous implementation")
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            );
        for event in EVENTS {
            config["hooks"][event][0]["command"] = json!(previous)
        }
        config["hooks"]["stop"].as_array_mut().unwrap().push(json!({"command":COMMAND_PREFIX.to_owned()+&STANDARD.encode("# another observer".encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>())}));
        fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(tracker.status()["enabled"], true);
        tracker.set_enabled(false).unwrap();
        let config: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(config["hooks"]["stop"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn invalid_events_and_expired_working_leases_cannot_fabricate_activity() {
        let now = 1792324804000;
        let event = json!({"version":1,"event":"afterAgentThought","conversationId":"one","generationId":"turn","roots":["relative/path"],"at":"2026-10-18T11:44:00Z"});
        let rows = reduce_cursor_events(&[event.clone()], now);
        assert_eq!(rows[0]["state"], "unknown");
        assert_eq!(rows[0]["cwd"], "");
        for (key, value) in [
            ("event", json!("beforeShellExecution")),
            ("conversationId", json!("../escape")),
            ("generationId", json!("")),
            ("at", json!("2026-10-20T12:00:00Z")),
            ("at", json!("bad")),
        ] {
            let mut invalid = event.clone();
            invalid[key] = value;
            assert!(reduce_cursor_events(&[invalid], now).is_empty());
        }
    }
    #[cfg(windows)]
    #[test]
    fn actual_observer_outputs_neutral_json_and_records_only_lifecycle_metadata() {
        use std::{
            io::Write,
            os::windows::process::CommandExt,
            process::{Command, Stdio},
        };
        let dir = tempfile::Builder::new()
            .prefix("agenthud cursor Türkçe '")
            .tempdir()
            .unwrap();
        let tracker = CursorTracker::new(dir.path().into());
        tracker.set_enabled(true).unwrap();
        let command = tracker.command().unwrap();
        let encoded = command.strip_prefix(COMMAND_PREFIX).unwrap();
        let invoke = |payload: &str| {
            let mut child = Command::new("powershell.exe")
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-EncodedCommand",
                    encoded,
                ])
                .creation_flags(0x08000000)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(payload.as_bytes())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            assert_eq!(output.stdout, b"{}");
            assert!(output.stderr.is_empty());
        };
        let mut payload = json!({"hook_event_name":"afterAgentThought","conversation_id":"fixture-session","generation_id":"fixture-turn","workspace_roots":["C:\\ex\\Türkçe proje"],"text":"PRIVATE THOUGHT","user_email":"PRIVATE EMAIL","tool_input":{"command":"PRIVATE COMMAND"}});
        invoke(&payload.to_string());
        let (connection, sessions) = tracker.read_sessions();
        assert_eq!(connection["status"], "active");
        assert_eq!(sessions[0]["state"], "working");
        assert_eq!(sessions[0]["project"], "Türkçe proje");
        for file in fs::read_dir(tracker.events_directory()).unwrap().flatten() {
            assert!(!fs::read_to_string(file.path()).unwrap().contains("PRIVATE"))
        }
        payload["hook_event_name"] = json!("stop");
        payload["status"] = json!("completed");
        invoke(&payload.to_string());
        assert_eq!(tracker.read_sessions().1[0]["state"], "done");
        let before = fs::read_dir(tracker.events_directory()).unwrap().count();
        payload["hook_event_name"] = json!("beforeShellExecution");
        invoke(&payload.to_string());
        invoke("not json");
        assert_eq!(
            fs::read_dir(tracker.events_directory()).unwrap().count(),
            before
        );
        tracker.set_enabled(false).unwrap();
        assert!(tracker.read_sessions().1.is_empty());
    }
}
