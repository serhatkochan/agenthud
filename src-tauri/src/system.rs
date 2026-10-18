use crate::models::{Inventory, Listener, ProcessInfo};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::{
    collections::HashSet,
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub fn powershell(script: &str) -> Result<String, String> {
    let source=format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; {script}");
    let encoded = STANDARD.encode(
        source
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let bytes = run_hidden(
        "powershell.exe",
        &[
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ],
        Duration::from_secs(18),
        8 * 1024 * 1024,
    )?;
    String::from_utf8(bytes)
        .map(|v| v.trim_start_matches('\u{feff}').trim().to_owned())
        .map_err(|_| "Windows sorgusu geçersiz metin döndürdü.".into())
}

fn run_hidden(
    program: &str,
    args: &[&str],
    timeout: Duration,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Windows sorgusu başlatılamadı.".to_owned())?;
    let output = child.stdout.take().ok_or("Windows sorgusu okunamadı.")?;
    let errors = child.stderr.take().ok_or("Windows sorgusu okunamadı.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let error_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        errors.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Windows sorgusu zamanında tamamlanamadı.");
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "Windows sorgusu okunamadı.")?
        .map_err(|_| "Windows sorgusu okunamadı.")?;
    let _ = error_reader.join();
    if !status?.success() {
        return Err("Windows sorgusu tamamlanamadı.".into());
    }
    if bytes.len() as u64 > limit {
        return Err("Windows sorgusu boyut sınırını aştı.".into());
    }
    Ok(bytes)
}

pub fn read_processes() -> Result<Vec<ProcessInfo>, String> {
    if !cfg!(windows) {
        return Ok(vec![]);
    }
    let source=format!("$sid=(Get-Process -Id $PID).SessionId; @(Get-CimInstance Win32_Process -Filter \"SessionId=$sid\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,@{{Name='CreationDate';Expression={{if($_.CreationDate){{$_.CreationDate.ToUniversalTime().ToString('o')}}else{{''}}}}}},@{{Name='CreationId';Expression={{if($_.CreationDate){{$_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)}}else{{''}}}}}}) | ConvertTo-Json -Compress -Depth 3");
    decode_rows(&powershell(&source)?)?
        .into_iter()
        .map(|row| serde_json::from_value(row).map_err(|_| "Süreç bilgisi okunamadı.".to_owned()))
        .collect()
}

pub fn inventory(working_directories: bool) -> Result<Inventory, String> {
    if !cfg!(windows) {
        return Ok(Inventory::default());
    }
    let processes = read_processes()?;
    let output = run_hidden(
        "netstat.exe",
        &["-ano", "-p", "tcp"],
        Duration::from_secs(10),
        4 * 1024 * 1024,
    )?;
    let listeners = parse_netstat(&String::from_utf8_lossy(&output));
    let processes = if working_directories {
        let pids: HashSet<_> = listeners.iter().map(|p| p.pid).collect();
        let ids: Vec<_> = processes
            .iter()
            .filter(|p| pids.contains(&p.process_id))
            .map(|p| p.process_id)
            .filter(|p| *p > 0)
            .take(128)
            .collect();
        let directories = read_working_directories(&ids).unwrap_or_default();
        attach_working_directories(processes, &directories)
    } else {
        processes
    };
    Ok(Inventory {
        processes,
        listeners,
    })
}

fn read_working_directories(pids: &[u32]) -> Result<Vec<Value>, String> {
    if pids.is_empty() {
        return Ok(vec![]);
    }
    let ids = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let source=format!("Add-Type -TypeDefinition @'\n{}\n'@; $processIds=@({ids}); @($processIds | ForEach-Object {{ [HudProcessDirectory]::ReadDirectory([int]$_) }} | Where-Object {{ $null -ne $_ }}) | ConvertTo-Json -Compress -Depth 3",include_str!("../native/ProcessDirectory.cs"));
    decode_rows(&powershell(&source)?)
}

fn decode_rows(text: &str) -> Result<Vec<Value>, String> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(text)
        .map(json_rows)
        .map_err(|_| "Süreç listesi okunamadı.".to_owned())
}

fn json_rows(value: Value) -> Vec<Value> {
    match value {
        Value::Array(rows) => rows,
        Value::Object(_) => vec![value],
        _ => vec![],
    }
}

pub fn agent_for(process: &ProcessInfo, processes: &[ProcessInfo]) -> Option<String> {
    let mut current = Some(process);
    let mut seen = HashSet::new();
    while let Some(row) = current {
        if !seen.insert(row.process_id) {
            break;
        }
        let name = row.name.to_ascii_lowercase();
        for provider in ["cursor", "antigravity", "codex"] {
            if name.contains(provider) {
                return Some(provider.into());
            }
        }
        current = processes
            .iter()
            .find(|p| p.process_id == row.parent_process_id);
    }
    None
}

pub fn flag(command: &str, name: &str) -> Option<String> {
    let needle = format!("--{name}");
    for (index, _) in command.match_indices(&needle) {
        if index > 0 && !command[..index].ends_with(char::is_whitespace) {
            continue;
        }
        let tail = &command[index + needle.len()..];
        let value = if let Some(value) = tail.strip_prefix('=') {
            value
        } else if tail.starts_with(char::is_whitespace) {
            tail.trim_start()
        } else {
            continue;
        };
        let value = if let Some(quote) = value.chars().next().filter(|v| *v == '\'' || *v == '"') {
            value[1..].split_once(quote).map(|p| p.0)
        } else {
            value.split_whitespace().next()
        };
        if let Some(value) = value.filter(|v| !v.is_empty()) {
            return Some(value.into());
        }
    }
    None
}

fn parse_netstat(text: &str) -> Vec<Listener> {
    text.lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() != 5 || fields[0] != "TCP" || fields[3] != "LISTENING" {
                return None;
            }
            let (address, port) = fields[1].rsplit_once(':')?;
            Some(Listener {
                address: address.into(),
                port: port.parse().ok()?,
                pid: fields[4].parse().ok()?,
            })
        })
        .collect()
}

pub(crate) fn creation_micros(id: &str) -> Option<u64> {
    if id.is_empty() || id.len() > 20 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    id.parse::<u64>().ok().map(|v| v / 10)
}

fn attach_working_directories(
    processes: Vec<ProcessInfo>,
    directories: &[Value],
) -> Vec<ProcessInfo> {
    processes
        .into_iter()
        .map(|mut process| {
            process.working_directory = creation_micros(&process.creation_id)
                .and_then(|created| {
                    directories.iter().find(|d| {
                        d["ProcessId"].as_u64() == Some(process.process_id as u64)
                            && d["CreationId"].as_str().and_then(creation_micros) == Some(created)
                    })
                })
                .and_then(|d| d["WorkingDirectory"].as_str())
                .map(str::to_owned);
            process
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn listeners_accept_ipv4_ipv6_and_ignore_established_connections() {
        let rows = parse_netstat("  TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 42\r\n TCP [::]:3000 [::]:0 LISTENING 42\n TCP 1.2.3.4:4000 1.1.1.1:90 ESTABLISHED 42");
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[1].address.as_str(), rows[1].port, rows[1].pid),
            ("[::]", 3000, 42)
        );
    }
    #[test]
    fn cwd_is_attached_only_to_matching_pid_and_creation_microseconds() {
        let processes = [42, 43, 44]
            .into_iter()
            .map(|id| ProcessInfo {
                process_id: id,
                creation_id: if id == 43 {
                    "134368017789901750"
                } else {
                    "134368017789901740"
                }
                .into(),
                ..Default::default()
            })
            .collect();
        let rows = attach_working_directories(
            processes,
            &[
                json!({"ProcessId":42,"CreationId":"134368017789901749","WorkingDirectory":"C:\\actual"}),
                json!({"ProcessId":43,"CreationId":"134368017789901749","WorkingDirectory":"C:\\wrong"}),
            ],
        );
        assert_eq!(rows[0].working_directory.as_deref(), Some("C:\\actual"));
        assert_eq!(rows[1].working_directory, None);
        assert_eq!(rows[2].working_directory, None);
    }
    #[test]
    fn ancestor_traversal_handles_cycles_and_ignores_removed_provider() {
        let process = ProcessInfo {
            process_id: 7,
            parent_process_id: 5,
            name: "node.exe".into(),
            ..Default::default()
        };
        let parent = ProcessInfo {
            process_id: 5,
            name: "Cursor.exe".into(),
            ..Default::default()
        };
        assert_eq!(agent_for(&process, &[parent]), Some("cursor".into()));
        let cyclic = ProcessInfo {
            parent_process_id: 7,
            ..process.clone()
        };
        assert_eq!(agent_for(&cyclic, &[cyclic.clone()]), None);
        let removed = ProcessInfo {
            name: "claude.exe".into(),
            ..process
        };
        assert_eq!(agent_for(&removed, &[]), None);
    }
    #[test]
    fn flags_preserve_quoted_values_and_exact_names() {
        assert_eq!(
            flag(
                "--csrf_token \"secret value\" --extension_server_port=1234",
                "csrf_token"
            ),
            Some("secret value".into())
        );
        assert_eq!(
            flag("--extension_server_port=1234", "extension_server_port"),
            Some("1234".into())
        );
        assert_eq!(flag("--other_csrf_token=wrong", "csrf_token"), None);
    }
    #[test]
    fn empty_powershell_pipeline_is_a_valid_empty_inventory() {
        assert!(decode_rows("").unwrap().is_empty());
        assert!(decode_rows(" \r\n").unwrap().is_empty());
        assert_eq!(decode_rows(r#"{"ProcessId":42}"#).unwrap().len(), 1);
        assert!(decode_rows("not json").is_err());
    }
}
