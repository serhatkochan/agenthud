use crate::models::{Inventory, Listener, ProcessInfo};
#[cfg(test)]
use serde_json::Value;
use std::collections::HashSet;

pub fn read_processes() -> Result<Vec<ProcessInfo>, String> {
    if !cfg!(windows) {
        return Ok(vec![]);
    }
    read_session_processes(false, &HashSet::new())
}

pub fn inventory(working_directories: bool) -> Result<Inventory, String> {
    if !cfg!(windows) {
        return Ok(Inventory::default());
    }
    let listeners = read_listeners()?;
    let pids = listeners.iter().map(|listener| listener.pid).collect();
    Ok(Inventory {
        processes: read_session_processes(working_directories, &pids)?,
        listeners,
    })
}

fn creation_identity(low: u32, high: u32) -> (String, String) {
    let ticks = ((high as u64) << 32) | low as u64;
    let id = ticks.to_string();
    const UNIX_DIFF: u64 = 11_644_473_600_000_0000;
    if ticks < UNIX_DIFF {
        return (String::new(), id);
    }
    let unix_100ns = ticks - UNIX_DIFF;
    let secs = (unix_100ns / 10_000_000) as i64;
    let fraction = unix_100ns % 10_000_000;
    let Some(time) = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, (fraction * 100) as u32)
    else {
        return (String::new(), id);
    };
    (
        format!("{}.{:07}Z", time.format("%Y-%m-%dT%H:%M:%S"), fraction),
        id,
    )
}

fn tcp_port(value: u32) -> u16 {
    u16::from_be(value as u16)
}

#[cfg(not(windows))]
fn read_listeners() -> Result<Vec<Listener>, String> {
    Ok(vec![])
}

#[cfg(windows)]
fn read_listeners() -> Result<Vec<Listener>, String> {
    use std::net::{Ipv4Addr, Ipv6Addr};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
    let mut listeners = Vec::new();
    for family in [AF_INET as u32, AF_INET6 as u32] {
        let bytes = tcp_table(family)?;
        if bytes.len() < 4 {
            continue;
        }
        let count = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        let body = &bytes[4..];
        if family == AF_INET as u32 {
            for row in table_rows::<Ipv4Listener>(body, count) {
                let port = tcp_port(row.local_port);
                if port == 0 || row.pid == 0 {
                    continue;
                }
                listeners.push(Listener {
                    address: Ipv4Addr::from(u32::from_be(row.local_addr)).to_string(),
                    port,
                    pid: row.pid,
                });
            }
        } else {
            for row in table_rows::<Ipv6Listener>(body, count) {
                let port = tcp_port(row.local_port);
                if port == 0 || row.pid == 0 {
                    continue;
                }
                listeners.push(Listener {
                    address: format!("[{}]", Ipv6Addr::from(row.local_addr)),
                    port,
                    pid: row.pid,
                });
            }
        }
    }
    Ok(listeners)
}

#[cfg(windows)]
fn tcp_table(family: u32) -> Result<Vec<u8>, String> {
    use std::ffi::c_void;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, TCP_TABLE_OWNER_PID_LISTENER,
    };
    let mut size = 0u32;
    for _ in 0..4 {
        let mut buffer = vec![0u8; size as usize];
        let status = unsafe {
            GetExtendedTcpTable(
                if size == 0 {
                    std::ptr::null_mut()
                } else {
                    buffer.as_mut_ptr() as *mut c_void
                },
                &mut size,
                0,
                family,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        if status == 0 {
            buffer.truncate(size as usize);
            return Ok(buffer);
        }
        if status != 122 {
            return Err("Port listesi okunamadı.".into());
        }
    }
    Err("Port listesi okunamadı.".into())
}

#[cfg(windows)]
#[repr(C)]
struct Ipv4Listener {
    state: u32,
    local_addr: u32,
    local_port: u32,
    remote_addr: u32,
    remote_port: u32,
    pid: u32,
}

#[cfg(windows)]
#[repr(C)]
struct Ipv6Listener {
    local_addr: [u8; 16],
    local_scope: u32,
    local_port: u32,
    remote_addr: [u8; 16],
    remote_scope: u32,
    remote_port: u32,
    state: u32,
    pid: u32,
}

#[cfg(windows)]
fn table_rows<T>(body: &[u8], count: usize) -> Vec<T> {
    let stride = std::mem::size_of::<T>();
    let count = count.min(body.len() / stride.max(1));
    let mut rows = Vec::with_capacity(count);
    for index in 0..count {
        let start = index * stride;
        let mut row = std::mem::MaybeUninit::<T>::uninit();
        unsafe {
            std::ptr::copy_nonoverlapping(
                body[start..start + stride].as_ptr(),
                row.as_mut_ptr() as *mut u8,
                stride,
            );
            rows.push(row.assume_init());
        }
    }
    rows
}

#[cfg(windows)]
fn read_session_processes(
    working_directories: bool,
    listeners: &HashSet<u32>,
) -> Result<Vec<ProcessInfo>, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            RemoteDesktop::ProcessIdToSessionId,
            Threading::{
                GetCurrentProcessId, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
            },
        },
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_null() || snapshot == INVALID_HANDLE_VALUE {
        return Err("Süreç listesi okunamadı.".into());
    }
    let mut session = 0u32;
    let session = unsafe {
        if ProcessIdToSessionId(GetCurrentProcessId(), &mut session) == 0 {
            None
        } else {
            Some(session)
        }
    };
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut processes = Vec::new();
    let mut cwd_budget = 128u32;
    let mut reading = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while reading {
        let pid = entry.th32ProcessID;
        let mut same = 0u32;
        let include = pid > 0
            && (session.is_none()
                || unsafe { ProcessIdToSessionId(pid, &mut same) != 0 && same == session.unwrap() });
        if include {
            let mut process = ProcessInfo {
                process_id: pid,
                parent_process_id: entry.th32ParentProcessID,
                name: utf16_prefix(&entry.szExeFile),
                ..Default::default()
            };
            let interesting = listeners.contains(&pid)
                || process.name.to_ascii_lowercase().contains("language");
            let access =
                PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION;
            let handle = if interesting {
                unsafe { OpenProcess(access, 0, pid) }
            } else {
                std::ptr::null_mut()
            };
            if !handle.is_null() {
                let mut created: FILETIME = unsafe { std::mem::zeroed() };
                let mut exited: FILETIME = unsafe { std::mem::zeroed() };
                let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
                let mut user: FILETIME = unsafe { std::mem::zeroed() };
                if unsafe {
                    GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)
                } != 0
                {
                    let (date, id) =
                        creation_identity(created.dwLowDateTime, created.dwHighDateTime);
                    process.creation_date = date;
                    process.creation_id = id;
                }
                let mut image = [0u16; 1024];
                let mut length = image.len() as u32;
                if unsafe { QueryFullProcessImageNameW(handle, 0, image.as_mut_ptr(), &mut length) }
                    != 0
                {
                    process.executable_path =
                        Some(utf16_prefix(&image[..length.min(image.len() as u32) as usize]));
                }
                if let Some((parameters, x86)) = process_parameters(handle) {
                    process.command_line = unicode_at(
                        handle,
                        parameters + if x86 { 0x40 } else { 0x70 },
                        x86,
                    );
                    if working_directories && listeners.contains(&pid) && cwd_budget > 0 {
                        cwd_budget -= 1;
                        process.working_directory =
                            working_directory(handle, parameters, x86);
                    }
                }
                unsafe { CloseHandle(handle) };
            }
            processes.push(process);
        }
        reading = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    Ok(processes)
}

#[cfg(not(windows))]
fn read_session_processes(
    _working_directories: bool,
    _listeners: &HashSet<u32>,
) -> Result<Vec<ProcessInfo>, String> {
    Ok(vec![])
}

#[cfg(windows)]
fn utf16_prefix(buf: &[u16]) -> String {
    let end = buf.iter().position(|unit| *unit == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(windows)]
#[repr(C)]
struct BasicInfo {
    exit_status: isize,
    peb: *mut std::ffi::c_void,
    affinity: usize,
    priority: isize,
    process_id: usize,
    parent_id: usize,
}

#[cfg(windows)]
fn process_parameters(handle: windows_sys::Win32::Foundation::HANDLE) -> Option<(u64, bool)> {
    use std::ffi::c_void;
    use windows_sys::Wdk::System::Threading::{
        NtQueryInformationProcess, ProcessBasicInformation, ProcessWow64Information,
    };
    let mut basic: BasicInfo = unsafe { std::mem::zeroed() };
    let mut returned = 0u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            ProcessBasicInformation,
            &mut basic as *mut BasicInfo as *mut c_void,
            std::mem::size_of::<BasicInfo>() as u32,
            &mut returned,
        )
    };
    if status != 0 || basic.peb.is_null() {
        return None;
    }
    let mut wow: *mut c_void = std::ptr::null_mut();
    let wow_status = unsafe {
        NtQueryInformationProcess(
            handle,
            ProcessWow64Information,
            &mut wow as *mut *mut c_void as *mut c_void,
            std::mem::size_of::<*mut c_void>() as u32,
            &mut returned,
        )
    };
    if wow_status != 0 {
        return None;
    }
    let x86 = !wow.is_null();
    let peb = if x86 { wow as u64 } else { basic.peb as u64 };
    let parameters = read_pointer(handle, peb + if x86 { 0x10 } else { 0x20 }, x86)?;
    Some((parameters, x86))
}

#[cfg(windows)]
fn read_exact(
    handle: windows_sys::Win32::Foundation::HANDLE,
    address: u64,
    size: usize,
) -> Option<Vec<u8>> {
    use std::ffi::c_void;
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    if address == 0 || size == 0 || size > 32768 {
        return None;
    }
    let mut buffer = vec![0u8; size];
    let mut read = 0usize;
    let ok = unsafe {
        ReadProcessMemory(
            handle,
            address as *const c_void,
            buffer.as_mut_ptr() as *mut c_void,
            size,
            &mut read,
        )
    };
    if ok == 0 || read != size {
        None
    } else {
        Some(buffer)
    }
}

#[cfg(windows)]
fn read_pointer(
    handle: windows_sys::Win32::Foundation::HANDLE,
    address: u64,
    x86: bool,
) -> Option<u64> {
    let bytes = read_exact(handle, address, if x86 { 4 } else { 8 })?;
    Some(if x86 {
        u32::from_le_bytes(bytes.try_into().ok()?) as u64
    } else {
        u64::from_le_bytes(bytes.try_into().ok()?)
    })
}

#[cfg(windows)]
fn unicode_at(
    handle: windows_sys::Win32::Foundation::HANDLE,
    address: u64,
    x86: bool,
) -> Option<String> {
    let width = if x86 { 8 } else { 16 };
    let raw = read_exact(handle, address, width)?;
    let length = u16::from_le_bytes([raw[0], raw[1]]) as usize;
    let capacity = u16::from_le_bytes([raw[2], raw[3]]) as usize;
    if length == 0 || length > 32766 || length > capacity || length % 2 != 0 {
        return None;
    }
    let buffer = if x86 {
        u32::from_le_bytes(raw[4..8].try_into().ok()?) as u64
    } else {
        u64::from_le_bytes(raw[8..16].try_into().ok()?)
    };
    let bytes = read_exact(handle, buffer, length)?;
    let units = bytes
        .chunks_exact(2)
        .map(|unit| u16::from_le_bytes([unit[0], unit[1]]))
        .collect::<Vec<_>>();
    let text = String::from_utf16_lossy(&units);
    let text = text.trim_end_matches('\0');
    if text.is_empty() || text.contains('\0') {
        None
    } else {
        Some(text.to_owned())
    }
}

#[cfg(windows)]
fn working_directory(
    handle: windows_sys::Win32::Foundation::HANDLE,
    parameters: u64,
    x86: bool,
) -> Option<String> {
    let address = parameters + if x86 { 0x24 } else { 0x38 };
    let width = if x86 { 8 } else { 16 };
    let before = read_exact(handle, address, width)?;
    let path = unicode_at(handle, address, x86)?;
    let after = read_exact(handle, address, width)?;
    if before != after || path.contains('\0') || !rooted_directory(&path) {
        return None;
    }
    std::path::Path::new(&path).is_dir().then_some(path)
}

fn rooted_directory(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || path.starts_with("\\\\")
}

#[cfg(test)]
fn decode_rows(text: &str) -> Result<Vec<Value>, String> {
    if text.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(text)
        .map(json_rows)
        .map_err(|_| "Süreç listesi okunamadı.".to_owned())
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
pub(crate) fn creation_micros(id: &str) -> Option<u64> {
    if id.is_empty() || id.len() > 20 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    id.parse::<u64>().ok().map(|v| v / 10)
}

#[cfg(test)]
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
    fn filetime_round_trips_to_stable_utc_identity() {
        let ticks = 11_644_473_600_000_0000u64;
        let (date, id) = creation_identity(ticks as u32, (ticks >> 32) as u32);
        assert_eq!(id, ticks.to_string());
        assert_eq!(date, "1970-01-01T00:00:00.0000000Z");
        assert_eq!(creation_micros(&id), Some(ticks / 10));
        assert_eq!(tcp_port(0x901F), 8080);
    }
    #[test]
    fn empty_powershell_pipeline_is_a_valid_empty_inventory() {
        assert!(decode_rows("").unwrap().is_empty());
        assert!(decode_rows(" \r\n").unwrap().is_empty());
        assert_eq!(decode_rows(r#"{"ProcessId":42}"#).unwrap().len(), 1);
        assert!(decode_rows("not json").is_err());
    }
}
