use crate::{
    models::{now_ms, Inventory},
    ports::basename,
};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub async fn read_sessions(system: &Inventory, cursor_sessions: Vec<Value>) -> Vec<Value> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join(".codex")));
    let now = now_ms();
    let local = tokio::task::spawn_blocking(move || {
        home.map(|p| read_codex_sessions(&p, now))
            .unwrap_or_default()
    });
    let (mut result, codex) =
        tokio::join!(crate::providers::read_antigravity_sessions(system), local);
    result.extend(cursor_sessions);
    result.extend(codex.unwrap_or_default());
    add_process_fallbacks(&mut result, system, now);
    result.sort_by(|a, b| {
        priority(a).cmp(&priority(b)).then_with(|| {
            b["updatedAt"]
                .as_u64()
                .unwrap_or(0)
                .cmp(&a["updatedAt"].as_u64().unwrap_or(0))
        })
    });
    result
}

fn priority(session: &Value) -> u8 {
    match session["state"].as_str() {
        Some("blocked") => 0,
        Some("working") => 1,
        Some("done") => 2,
        Some("idle") => 3,
        _ => 4,
    }
}

fn add_process_fallbacks(result: &mut Vec<Value>, system: &Inventory, now: u64) {
    for (provider, name) in [("cursor", "Cursor.exe"), ("antigravity", "Antigravity.exe")] {
        if system
            .processes
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(name))
            && !result.iter().any(|s| s["provider"] == provider)
        {
            result.push(json!({"id":provider,"provider":provider,"project":"Uygulama açık","state":"unknown","cwd":"","updatedAt":0,"source":"Yalnızca uygulama süreci","observedAt":now}));
        }
    }
}

fn read_codex_sessions(home: &Path, now: u64) -> Vec<Value> {
    let day = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now as i64)
        .unwrap_or_default()
        .format("%Y/%m/%d")
        .to_string();
    let directory = home.join("sessions").join(day);
    let Ok(entries) = fs::read_dir(directory) else {
        return vec![];
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|file| {
            let path = file.path();
            if path.extension().is_none_or(|v| v != "jsonl") {
                return None;
            }
            let metadata = file.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((path, modified))
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files
        .into_iter()
        .take(8)
        .filter(|(_, at)| now.saturating_sub(*at) <= 86_400_000)
        .filter_map(|(path, _)| {
            let mut state = codex_state(&edges(&path).ok()?, now);
            let cwd = state["cwd"].as_str()?.to_owned();
            if cwd.is_empty() {
                return None;
            }
            let object = state.as_object_mut()?;
            object.insert("id".into(), json!(path.to_string_lossy()));
            object.insert("provider".into(), json!("codex"));
            object.insert("project".into(), json!(basename(&cwd)));
            object.insert("source".into(), json!("Codex · yerel oturum"));
            object.insert("observedAt".into(), json!(now));
            Some(state)
        })
        .collect()
}

fn codex_state(events: &[Value], now: u64) -> Value {
    let mut state = "unknown";
    let mut cwd = "";
    let mut updated_at = 0;
    for event in events {
        if event["type"] == "session_meta" {
            if let Some(path) = event["payload"]["cwd"].as_str().filter(|v| !v.is_empty()) {
                cwd = path
            }
        }
        if event["type"] != "event_msg" {
            continue;
        }
        let next = match event["payload"]["type"].as_str() {
            Some("task_started") => "working",
            Some("task_complete" | "turn_complete") => "done",
            Some("approval_request" | "exec_approval_request") => "blocked",
            Some("turn_aborted") => "idle",
            _ => continue,
        };
        state = next;
        updated_at = event["timestamp"]
            .as_str()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .and_then(|d| u64::try_from(d.timestamp_millis()).ok())
            .unwrap_or(0);
    }
    if state == "working" && now.saturating_sub(updated_at) > 900_000 {
        state = "unknown"
    }
    json!({"state":state,"cwd":cwd,"updatedAt":updated_at})
}

fn edges(path: &Path) -> std::io::Result<Vec<Value>> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut first = vec![0; size.min(1024 * 1024) as usize];
    file.read_exact(&mut first)?;
    let tail_size = size.min(128 * 1024);
    file.seek(SeekFrom::Start(size - tail_size))?;
    let mut last = vec![0; tail_size as usize];
    file.read_exact(&mut last)?;
    let header = String::from_utf8_lossy(&first);
    let tail = String::from_utf8_lossy(&last);
    Ok(header
        .lines()
        .take(1)
        .chain(tail.lines())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_authoritative_events_and_working_lease() {
        let at = "2026-10-18T12:00:00Z";
        let now = chrono::DateTime::parse_from_rfc3339(at)
            .unwrap()
            .timestamp_millis() as u64;
        let start = json!({"type":"event_msg","timestamp":at,"payload":{"type":"task_started"}});
        assert_eq!(codex_state(&[start.clone()], now)["state"], "working");
        assert_eq!(
            codex_state(
                &[
                    start.clone(),
                    json!({"type":"event_msg","timestamp":at,"payload":{"type":"turn_complete"}})
                ],
                now
            )["state"],
            "done"
        );
        assert_eq!(codex_state(&[start], now + 900001)["state"], "unknown");
        assert_eq!(
            codex_state(
                &[json!({"type":"response_item","payload":{"type":"tool_call"}})],
                now
            )["state"],
            "unknown"
        );
    }
    #[test]
    fn bounded_jsonl_edges_keep_large_first_line_and_latest_event() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("fixture.jsonl");
        let first=json!({"type":"session_meta","payload":{"cwd":"C:\\ex\\sample","base_instructions":"x".repeat(200000)}}).to_string();
        let filler = json!({"type":"response_item","text":"x".repeat(200000)}).to_string();
        std::fs::write(&file,format!("{first}\n{filler}\n{filler}\n{filler}\n{filler}\n{filler}\n{{\"type\":\"event_msg\",\"timestamp\":\"2026-10-18T12:00:00Z\",\"payload\":{{\"type\":\"task_started\"}}}}\n")).unwrap();
        let result = codex_state(&edges(&file).unwrap(), 1792324800000);
        assert_eq!(result["cwd"], "C:\\ex\\sample");
        assert_eq!(result["state"], "working");
    }
}
