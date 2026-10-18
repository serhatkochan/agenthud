use crate::models::{now_ms, Inventory};
use base64::{engine::general_purpose, Engine};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    redirect::Policy,
    Client, Response,
};
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

pub fn provider_metadata() -> Vec<Value> {
    vec![
        json!({"id":"cursor","name":"Cursor","description":"Cursor Models & Other Models","url":"https://cursor.com/dashboard?tab=usage"}),
        json!({"id":"antigravity","name":"Antigravity","description":"Model grupları & kullanım pencereleri","url":"https://antigravity.google/"}),
        json!({"id":"codex","name":"Codex","description":"ChatGPT plan limitleri","url":"https://chatgpt.com/codex/settings/usage"}),
    ]
}

pub async fn read_provider(id: &str, system: &Inventory) -> Value {
    let result = match id {
        "cursor" => fetch_cursor().await,
        "codex" => fetch_codex().await,
        "antigravity" => fetch_antigravity(system).await,
        _ => Err(ProviderError::new("local", "Sağlayıcı desteklenmiyor.")),
    };
    match result {
        Ok(data) if data.quotas.is_empty() => json!({
            "id":id,"status":"unavailable","quotas":[],"source":data.source,
            "message":"Hesap bağlı, ancak sağlayıcı ölçülebilir limit bilgisi paylaşmadı."
        }),
        Ok(data) => {
            let mut result = json!({"id":id,"status":"connected","quotas":data.quotas,"source":data.source,"updatedAt":now_ms()});
            if let Some(scope) = data.account_scope {
                result["accountScope"] = json!(scope);
            }
            if let Some(plan) = data.plan {
                result["plan"] = plan;
            }
            result
        }
        Err(error) => {
            let mut result = json!({"id":id,"status":if error.kind=="auth" {"needs-login"} else {"error"},"errorKind":error.kind,"message":error.message,"quotas":[]});
            if let Some(scope) = error.account_scope {
                result["accountScope"] = json!(scope);
            }
            result
        }
    }
}

pub fn merge_refresh(previous: &Value, mut next: Value) -> Value {
    let same_scope = previous["accountScope"]
        .as_str()
        .filter(|s| !s.is_empty())
        .is_some_and(|scope| next["accountScope"].as_str() == Some(scope));
    if previous["quotas"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty())
        && next["errorKind"] == "network"
        && same_scope
    {
        let mut stale = previous.clone();
        stale["status"] = json!("stale");
        stale["message"] = next["message"].clone();
        stale
    } else {
        if !next.is_object() {
            next = json!({});
        }
        if next.get("quotas").is_none_or(Value::is_null) {
            next["quotas"] = json!([]);
        }
        next
    }
}

fn measured(value: &Value, max: f64) -> Option<f64> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= max)
}

fn reset_date(value: &Value) -> Value {
    value
        .as_str()
        .filter(|s| {
            DateTime::parse_from_rfc3339(s).is_ok()
                || NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
        })
        .map(|s| json!(s))
        .unwrap_or(Value::Null)
}

fn quota_row(id: &str, label: &str, used: f64, reset: &Value, group: Option<&str>) -> Value {
    let mut row = json!({"id":id,"label":label,"remaining":((100.0-used)*100.0).round()/100.0,"resetsAt":reset_date(reset)});
    if let Some(group) = group {
        row["group"] = json!(group);
    }
    row
}

fn parse_cursor(data: &Value) -> Vec<Value> {
    [
        ("cursor-models", "Cursor Models", "autoPercentUsed"),
        ("other-models", "Other Models", "apiPercentUsed"),
    ]
    .into_iter()
    .filter_map(|(id, label, key)| {
        measured(&data["individualUsage"]["plan"][key], 100.0)
            .map(|used| quota_row(id, label, used, &data["billingCycleEnd"], None))
    })
    .collect()
}

fn parse_codex(data: &Value) -> Vec<Value> {
    [
        ("primary_window", "5 saatlik"),
        ("secondary_window", "Haftalık"),
    ]
    .into_iter()
    .filter_map(|(id, default_label)| {
        let window = &data["rate_limit"][id];
        let used = measured(&window["used_percent"], 100.0)?;
        let label = match window["limit_window_seconds"].as_u64() {
            Some(2592000) => "Aylık",
            Some(604800) => "Haftalık",
            Some(18000) => "5 saatlik",
            _ => default_label,
        };
        let reset = window["reset_at"]
            .as_f64()
            .filter(|n| n.is_finite())
            .and_then(|seconds| DateTime::<Utc>::from_timestamp_millis((seconds * 1000.0) as i64))
            .map(|date| json!(date.to_rfc3339_opts(SecondsFormat::Millis, true)))
            .unwrap_or(Value::Null);
        Some(quota_row(id, label, used, &reset, None))
    })
    .collect()
}

fn first<'a>(values: impl IntoIterator<Item = &'a Value>) -> &'a Value {
    values
        .into_iter()
        .find(|v| !v.is_null())
        .unwrap_or(&Value::Null)
}

fn parse_antigravity(data: &Value) -> Vec<Value> {
    let root = first([
        &data["response"],
        &data["quotaSummary"],
        &data["userQuotaSummary"],
        data,
    ]);
    let mut rows = Vec::new();
    if let Some(groups) = first([&root["quotaGroups"], &root["groups"]]).as_array() {
        for group in groups {
            let group_id = first([
                &group["groupId"],
                &group["groupName"],
                &group["displayName"],
            ])
            .as_str()
            .unwrap_or("");
            let group_name = first([
                &group["groupName"],
                &group["displayName"],
                &group["groupId"],
            ])
            .as_str();
            if let Some(buckets) = first([&group["quotaBuckets"], &group["buckets"]]).as_array() {
                for bucket in buckets {
                    let Some(fraction) = measured(&bucket["remainingFraction"], 1.0) else {
                        continue;
                    };
                    let fallback = rows.len().to_string();
                    let id = first([&bucket["bucketId"], &bucket["name"]])
                        .as_str()
                        .unwrap_or(&fallback);
                    let display = bucket["displayName"].as_str().unwrap_or("");
                    let text = format!("{id} {display}").to_lowercase();
                    let label = if text.contains("week") {
                        "Haftalık"
                    } else if ["hour", "session", "5h"].iter().any(|s| text.contains(s)) {
                        "5 saatlik"
                    } else if !display.is_empty() {
                        display
                    } else {
                        id
                    };
                    let mut row = quota_row(
                        &format!("{group_id}:{id}"),
                        label,
                        100.0 - fraction * 100.0,
                        first([&bucket["resetTime"], &bucket["resetTimestamp"]]),
                        group_name,
                    );
                    if bucket["disabled"] == true {
                        row["disabled"] = json!(true);
                    }
                    rows.push(row);
                }
            }
        }
    }
    if !rows.is_empty() {
        return rows;
    }
    if let Some(models) = first([
        &data["userStatus"]["cascadeModelConfigData"]["clientModelConfigs"],
        &data["clientModelConfigs"],
        &data["modelConfigs"],
    ])
    .as_array()
    {
        for model in models {
            let Some(fraction) = measured(&model["quotaInfo"]["remainingFraction"], 1.0) else {
                continue;
            };
            let id = first([&model["modelId"], &model["label"]])
                .as_str()
                .unwrap_or("");
            let label = first([&model["label"], &model["modelId"]])
                .as_str()
                .unwrap_or("");
            rows.push(quota_row(
                id,
                label,
                100.0 - fraction * 100.0,
                &model["quotaInfo"]["resetTime"],
                Some("Model limitleri"),
            ));
        }
    }
    rows
}

struct Target {
    port: u16,
    token: String,
    secure: bool,
}
struct LanguageServer {
    targets: Vec<Target>,
}

fn command_flag<'a>(command: &'a str, name: &str) -> Option<&'a str> {
    let flag = format!("--{name}");
    for (offset, _) in command.match_indices(&flag) {
        if offset > 0 && !command[..offset].ends_with(char::is_whitespace) {
            continue;
        }
        let tail = &command[offset + flag.len()..];
        let value = if let Some(value) = tail.strip_prefix('=') {
            value
        } else if tail.starts_with(char::is_whitespace) {
            tail.trim_start()
        } else {
            continue;
        };
        let value = match value.chars().next()? {
            '"' => value[1..].split_once('"').map(|(value, _)| value),
            '\'' => value[1..].split_once('\'').map(|(value, _)| value),
            _ => value.split_whitespace().next(),
        };
        if let Some(value) = value.filter(|s| !s.is_empty()) {
            return Some(value);
        }
    }
    None
}

fn language_servers(system: &Inventory) -> Vec<LanguageServer> {
    system
        .processes
        .iter()
        .filter(|process| {
            let name = process.name.to_lowercase();
            let is_server = name.find("language").is_some_and(|start| {
                let tail = &name[start + 8..];
                tail.starts_with("server")
                    || tail.get(1..).is_some_and(|tail| tail.starts_with("server"))
            });
            is_server
                && format!(
                    "{} {}",
                    process.command_line.as_deref().unwrap_or(""),
                    process.executable_path.as_deref().unwrap_or("")
                )
                .to_lowercase()
                .contains("antigravity")
        })
        .map(|process| {
            let command = process.command_line.as_deref().unwrap_or("");
            let Some(token) = command_flag(command, "csrf_token") else {
                return LanguageServer {
                    targets: Vec::new(),
                };
            };
            let mut ports = HashSet::new();
            let mut targets = system
                .listeners
                .iter()
                .filter(|listener| {
                    listener.pid == process.process_id
                        && listener.port > 0
                        && ports.insert(listener.port)
                })
                .take(12)
                .map(|listener| Target {
                    port: listener.port,
                    token: token.into(),
                    secure: true,
                })
                .collect::<Vec<_>>();
            if let Some(port) = command_flag(command, "extension_server_port")
                .and_then(|value| value.parse::<u16>().ok())
                .filter(|port| *port > 0)
            {
                targets.push(Target {
                    port,
                    token: command_flag(command, "extension_server_csrf_token")
                        .unwrap_or(token)
                        .into(),
                    secure: false,
                });
            }
            LanguageServer { targets }
        })
        .collect()
}

async fn post_language_server(target: &Target, method: &str) -> Result<Value, &'static str> {
    if target.port == 0 {
        return Err("local-api-port");
    }
    if ![
        "RetrieveUserQuotaSummary",
        "GetUserStatus",
        "GetCommandModelConfigs",
    ]
    .contains(&method)
    {
        return Err("local-api-method");
    }
    // This client only receives literal loopback URLs and never follows redirects.
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .danger_accept_invalid_certs(target.secure)
        .timeout(Duration::from_millis(1600))
        .build()
        .map_err(|_| "local-api-client")?;
    let url = format!(
        "{}://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/{method}",
        if target.secure { "https" } else { "http" },
        target.port
    );
    let response=client.post(url).header("Connect-Protocol-Version","1").header("X-Codeium-Csrf-Token",&target.token)
        .json(&json!({"metadata":{"ideName":"antigravity","extensionName":"antigravity","ideVersion":"unknown","locale":"en"}}))
        .send().await.map_err(|error|if error.is_timeout() {"local-api-timeout"} else {"local-api-request"})?;
    if response.status().as_u16() != 200 {
        return Err("local-api-status");
    }
    bounded_json(response).await
}

async fn bounded_json(mut response: Response) -> Result<Value, &'static str> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("local-api-too-large");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            "local-api-timeout"
        } else {
            "local-api-aborted"
        }
    })? {
        if chunk.len() > MAX_RESPONSE_BYTES - body.len() {
            return Err("local-api-too-large");
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "local-api-json")
}

struct Credentials {
    headers: HeaderMap,
    scope: String,
}
#[derive(Debug)]
struct ProviderError {
    kind: &'static str,
    message: String,
    account_scope: Option<String>,
}
impl ProviderError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            account_scope: None,
        }
    }
    fn scoped(mut self, scope: &str) -> Self {
        self.account_scope = Some(scope.into());
        self
    }
}
struct ProviderData {
    quotas: Vec<Value>,
    plan: Option<Value>,
    source: &'static str,
    account_scope: Option<String>,
}

fn account_scope(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn read_cursor_token(path: &Path) -> Option<String> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    db.busy_timeout(Duration::from_millis(500)).ok()?;
    let value = db
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            ["cursorAuth/accessToken"],
            |row| {
                Ok(match row.get_ref(0)? {
                    ValueRef::Text(bytes) | ValueRef::Blob(bytes)
                        if bytes.len() <= MAX_RESPONSE_BYTES =>
                    {
                        String::from_utf8(bytes.to_vec()).ok()
                    }
                    _ => None,
                })
            },
        )
        .ok()??;
    if value.starts_with('"') {
        serde_json::from_str::<String>(&value).ok()
    } else {
        Some(value)
    }
}

fn cursor_credentials(token: &str, now: u64) -> Result<Credentials, ProviderError> {
    let invalid = || {
        ProviderError::new(
            "auth",
            "Cursor oturumu okunamadı. Cursor’da yeniden giriş yap.",
        )
    };
    let payload = token.split('.').nth(1).ok_or_else(invalid)?;
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .map_err(|_| invalid())?;
    let payload: Value = serde_json::from_slice(&decoded).map_err(|_| invalid())?;
    if payload["exp"]
        .as_f64()
        .is_none_or(|expires| expires * 1000.0 < (now.saturating_add(60000)) as f64)
    {
        return Err(ProviderError::new(
            "auth",
            "Cursor oturumunun süresi dolmuş. Cursor’da yeniden giriş yap.",
        ));
    }
    let user = payload["sub"]
        .as_str()
        .and_then(|subject| subject.rsplit('|').next())
        .filter(|user| !user.is_empty())
        .ok_or_else(|| ProviderError::new("auth", "Cursor hesabı doğrulanamadı."))?;
    let mut headers = HeaderMap::new();
    headers.insert(
        "cookie",
        HeaderValue::from_str(&format!("WorkosCursorSessionToken={user}%3A%3A{token}"))
            .map_err(|_| invalid())?,
    );
    Ok(Credentials {
        headers,
        scope: account_scope(user),
    })
}

fn codex_credentials(auth: &Value) -> Result<Credentials, ProviderError> {
    let missing = || {
        ProviderError::new(
            "auth",
            "ChatGPT plan limitleri için Codex’te ChatGPT hesabınla giriş yap.",
        )
    };
    let token = auth["tokens"]["access_token"]
        .as_str()
        .filter(|token| !token.is_empty())
        .ok_or_else(missing)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| missing())?,
    );
    let account = auth["tokens"]["account_id"]
        .as_str()
        .filter(|account| !account.is_empty());
    if let Some(account) = account {
        headers.insert(
            "ChatGPT-Account-Id",
            HeaderValue::from_str(account).map_err(|_| missing())?,
        );
    }
    Ok(Credentials {
        headers,
        scope: account_scope(account.unwrap_or(token)),
    })
}

fn read_json_file(path: &Path) -> Option<Value> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

async fn remote_json(url: &'static str, credentials: &Credentials) -> Result<Value, ProviderError> {
    let network = || {
        ProviderError::new(
            "network",
            "Bağlantı kurulamadı. Birazdan yeniden denenecek.",
        )
        .scoped(&credentials.scope)
    };
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| network())?;
    let response = client
        .get(url)
        .headers(credentials.headers.clone())
        .send()
        .await
        .map_err(|_| network())?;
    let status = response.status().as_u16();
    if [401, 403].contains(&status) {
        return Err(
            ProviderError::new("auth", "Oturuma erişilemiyor. Hesabını yeniden bağla.")
                .scoped(&credentials.scope),
        );
    }
    if status == 429 {
        return Err(ProviderError::new(
            "network",
            "Sağlayıcı çok sık istek aldı. Birazdan yeniden denenecek.",
        )
        .scoped(&credentials.scope));
    }
    if !(200..300).contains(&status) {
        return Err(ProviderError::new(
            "network",
            format!("Sağlayıcı şu anda yanıt vermiyor (HTTP {status})."),
        )
        .scoped(&credentials.scope));
    }
    bounded_json(response).await.map_err(|kind| {
        if ["local-api-timeout", "local-api-aborted"].contains(&kind) {
            network()
        } else {
            ProviderError::new(
                "format",
                "Sağlayıcıdan beklenen kullanım bilgisi alınamadı.",
            )
            .scoped(&credentials.scope)
        }
    })
}

async fn fetch_cursor() -> Result<ProviderData, ProviderError> {
    let token = tokio::task::spawn_blocking(|| {
        let path = PathBuf::from(std::env::var_os("APPDATA")?)
            .join("Cursor/User/globalStorage/state.vscdb");
        read_cursor_token(&path)
    })
    .await
    .ok()
    .flatten()
    .filter(|token| !token.is_empty())
    .ok_or_else(|| ProviderError::new("auth", "Cursor’da giriş yap, ardından yeniden dene."))?;
    let credentials = cursor_credentials(&token, now_ms())?;
    let data = remote_json("https://cursor.com/api/usage-summary", &credentials).await?;
    Ok(ProviderData {
        quotas: parse_cursor(&data),
        plan: data.get("membershipType").cloned(),
        source: "Cursor · yerel oturum",
        account_scope: Some(credentials.scope),
    })
}

async fn fetch_codex() -> Result<ProviderData, ProviderError> {
    let auth = tokio::task::spawn_blocking(|| {
        let directory = std::env::var_os("CODEX_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex"))
            })?;
        read_json_file(&directory.join("auth.json"))
    })
    .await
    .ok()
    .flatten()
    .ok_or_else(|| ProviderError::new("auth", "Codex uygulamasında veya CLI’da giriş yap."))?;
    let credentials = codex_credentials(&auth)?;
    let data = remote_json("https://chatgpt.com/backend-api/wham/usage", &credentials).await?;
    Ok(ProviderData {
        quotas: parse_codex(&data),
        plan: data.get("plan_type").cloned(),
        source: "Codex · yerel oturum",
        account_scope: Some(credentials.scope),
    })
}

async fn fetch_antigravity(system: &Inventory) -> Result<ProviderData, ProviderError> {
    let servers = language_servers(system);
    if servers.is_empty() {
        return Err(ProviderError::new(
            "local",
            "Antigravity’yi aç ve hesabına giriş yap.",
        ));
    }
    for server in &servers {
        for method in [
            "RetrieveUserQuotaSummary",
            "GetUserStatus",
            "GetCommandModelConfigs",
        ] {
            let responses = futures_util::future::join_all(
                server
                    .targets
                    .iter()
                    .map(|target| post_language_server(target, method)),
            )
            .await;
            for data in responses.into_iter().flatten() {
                let quotas = parse_antigravity(&data);
                if !quotas.is_empty() {
                    return Ok(ProviderData {
                        quotas,
                        plan: None,
                        source: "Antigravity · yerel servis",
                        account_scope: None,
                    });
                }
            }
        }
    }
    Err(ProviderError::new("local","Antigravity açık, ancak kullanım servisi yanıt vermedi. Uygulamayı güncelleyip yeniden dene."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_keeps_independent_fractional_percentage_pools() {
        let rows = parse_cursor(&json!({
            "billingCycleEnd":"2026-11-01T00:00:00Z",
            "individualUsage":{"plan":{"autoPercentUsed":60,"apiPercentUsed":0.36}}
        }));
        assert_eq!(
            rows,
            vec![
                json!({"id":"cursor-models","label":"Cursor Models","remaining":40.0,"resetsAt":"2026-11-01T00:00:00Z"}),
                json!({"id":"other-models","label":"Other Models","remaining":99.64,"resetsAt":"2026-11-01T00:00:00Z"})
            ]
        );
    }

    #[test]
    fn malformed_limits_do_not_claim_unused_allowance() {
        for bad in [Value::Null, json!("60"), json!(-1), json!(101), json!(true)] {
            assert!(
                parse_cursor(&json!({"individualUsage":{"plan":{"autoPercentUsed":bad}}}))
                    .is_empty()
            );
        }
        assert!(parse_cursor(&json!({})).is_empty());
        assert!(
            parse_codex(&json!({"rate_limit":{"primary_window":{"used_percent":null}}})).is_empty()
        );
    }

    #[test]
    fn codex_keeps_zero_values_and_uses_actual_window_duration() {
        let rows = parse_codex(&json!({"rate_limit":{
            "primary_window":{"used_percent":0,"reset_at":1800000000,"limit_window_seconds":2592000},
            "secondary_window":{"used_percent":100,"limit_window_seconds":18000}
        }}));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["remaining"], 100.0);
        assert_eq!(rows[1]["remaining"], 0.0);
        assert_eq!(rows[0]["label"], "Aylık");
        assert_eq!(rows[1]["label"], "5 saatlik");
        assert_eq!(rows[0]["resetsAt"], "2027-01-15T08:00:00.000Z");
        assert_eq!(rows[1]["resetsAt"], Value::Null);
    }

    #[test]
    fn antigravity_retains_all_groups_exhausted_and_disabled_windows() {
        let rows = parse_antigravity(&json!({"response":{"groups":[
            {"displayName":"Gemini Models","buckets":[
                {"bucketId":"gemini-5h","remainingFraction":0.65},
                {"bucketId":"gemini-weekly","remainingFraction":0.91}
            ]},
            {"displayName":"Claude and GPT models","buckets":[
                {"bucketId":"3p-weekly","remainingFraction":0},
                {"bucketId":"3p-5h","remainingFraction":1,"disabled":true}
            ]},
            {"displayName":"Gemini 4 Argon","buckets":[
                {"bucketId":"weekly","remainingFraction":0.31},
                {"bucketId":"unknown"}
            ]}
        ]}}));
        assert_eq!(rows.len(), 5);
        assert_eq!(
            rows.iter()
                .map(|r| r["remaining"].as_f64().unwrap())
                .collect::<Vec<_>>(),
            vec![65.0, 91.0, 0.0, 100.0, 31.0]
        );
        assert_eq!(rows[2]["group"], "Claude and GPT models");
        assert_eq!(rows[2]["label"], "Haftalık");
        assert_eq!(rows[3]["disabled"], true);
        assert_eq!(rows[4]["group"], "Gemini 4 Argon");
    }

    #[test]
    fn antigravity_model_quota_fallback_remains_measured() {
        let rows = parse_antigravity(
            &json!({"userStatus":{"cascadeModelConfigData":{"clientModelConfigs":[
                {"modelId":"model-1","label":"Model One","quotaInfo":{"remainingFraction":0,"resetTime":"2026-10-25T00:00:00Z"}},
                {"modelId":"unknown","quotaInfo":{}},
                {"modelId":"invalid","quotaInfo":{"remainingFraction":1.5}}
            ]}}}),
        );
        assert_eq!(
            rows,
            vec![
                json!({"id":"model-1","label":"Model One","remaining":0.0,"resetsAt":"2026-10-25T00:00:00Z","group":"Model limitleri"})
            ]
        );
    }

    #[test]
    fn stale_refresh_is_limited_to_same_account_network_failure() {
        let old = json!({"id":"cursor","status":"connected","quotas":[{"remaining":40}],"updatedAt":100,"accountScope":"account-a"});
        let stale = merge_refresh(
            &old,
            json!({"id":"cursor","status":"error","errorKind":"network","message":"offline","accountScope":"account-a"}),
        );
        assert_eq!(stale["status"], "stale");
        assert_eq!(stale["updatedAt"], 100);
        assert_eq!(stale["quotas"][0]["remaining"], 40);
        for next in [
            json!({"errorKind":"auth","accountScope":"account-a"}),
            json!({"errorKind":"format","accountScope":"account-a"}),
            json!({"errorKind":"network","accountScope":"account-b"}),
            json!({"errorKind":"network"}),
        ] {
            assert_eq!(merge_refresh(&old, next)["quotas"], json!([]));
        }
    }

    fn local_server(
        handler: impl FnOnce(std::net::TcpStream) + Send + 'static,
    ) -> (u16, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let thread = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(4)))
                .unwrap();
            handler(stream);
        });
        (port, thread)
    }

    fn request(stream: &mut std::net::TcpStream) -> String {
        use std::io::Read;
        let mut bytes = Vec::new();
        let mut buf = [0; 2048];
        loop {
            let count = stream.read(&mut buf).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..count]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn discovery_uses_process_owned_listeners_and_explicit_fallback() {
        use crate::models::{Listener, ProcessInfo};
        let system=Inventory {
            processes:vec![ProcessInfo {
                process_id:10,name:"language_server.exe".into(),
                executable_path:Some("C:\\Antigravity\\language_server.exe".into()),
                command_line:Some("server --csrf_token fixture --extension_server_port=1235 --extension_server_csrf_token 'fallback'".into()),
                ..Default::default()
            },ProcessInfo {process_id:11,name:"language_server.exe".into(),executable_path:Some("C:\\Other\\language_server.exe".into()),..Default::default()}],
            listeners:vec![Listener{pid:10,port:1234,..Default::default()},Listener{pid:99,port:9999,..Default::default()},Listener{pid:10,port:1234,..Default::default()}]
        };
        let servers = language_servers(&system);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].targets.len(), 2);
        assert_eq!(servers[0].targets[0].port, 1234);
        assert_eq!(servers[0].targets[0].token, "fixture");
        assert!(servers[0].targets[0].secure);
        assert_eq!(servers[0].targets[1].port, 1235);
        assert_eq!(servers[0].targets[1].token, "fallback");
        assert!(!servers[0].targets[1].secure);
    }

    #[tokio::test]
    async fn local_rpc_sends_metadata_csrf_and_method_contract() {
        use std::io::Write;
        let (port, thread) = local_server(|mut stream| {
            let req = request(&mut stream);
            assert!(req.starts_with(
                "POST /exa.language_server_pb.LanguageServerService/GetUserStatus HTTP/1.1"
            ));
            assert!(req
                .to_lowercase()
                .contains("x-codeium-csrf-token: fixture\r\n"));
            assert!(req
                .to_lowercase()
                .contains("connect-protocol-version: 1\r\n"));
            let body: Value = serde_json::from_str(req.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(
                body["metadata"],
                json!({"ideName":"antigravity","extensionName":"antigravity","ideVersion":"unknown","locale":"en"})
            );
            let body = "{\"userStatus\":{}}";
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let result = post_language_server(
            &Target {
                port,
                token: "fixture".into(),
                secure: false,
            },
            "GetUserStatus",
        )
        .await;
        assert_eq!(result.unwrap(), json!({"userStatus":{}}));
        thread.join().unwrap();
    }

    #[tokio::test]
    async fn local_rpc_does_not_follow_redirect_with_session_header() {
        use std::io::Write;
        let destination = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        destination.set_nonblocking(true).unwrap();
        let destination_port = destination.local_addr().unwrap().port();
        let (port, thread) = local_server(move |mut stream| {
            request(&mut stream);
            write!(stream,"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{destination_port}/capture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        assert!(matches!(
            post_language_server(
                &Target {
                    port,
                    token: "fixture".into(),
                    secure: false
                },
                "GetUserStatus"
            )
            .await,
            Err("local-api-status")
        ));
        thread.join().unwrap();
        assert_eq!(
            destination.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[tokio::test]
    async fn local_rpc_rejects_aborted_and_oversized_bodies() {
        use std::io::Write;
        for (reply, expected) in [
            (
                "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{".to_string(),
                "local-api-aborted",
            ),
            (
                format!(
                    "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{}",
                    " ".repeat(4 * 1024 * 1024 + 1)
                ),
                "local-api-too-large",
            ),
        ] {
            let (port, thread) = local_server(move |mut stream| {
                request(&mut stream);
                let _ = stream.write_all(reply.as_bytes());
            });
            assert!(
                matches!(post_language_server(&Target{port,token:"fixture".into(),secure:false},"GetUserStatus").await,Err(error) if error==expected)
            );
            thread.join().unwrap();
        }
    }

    #[tokio::test]
    async fn local_rpc_total_deadline_covers_slow_streaming_body() {
        use std::io::Write;
        let (port, thread) = local_server(|mut stream| {
            request(&mut stream);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                .unwrap();
            for _ in 0..40 {
                if stream.write_all(b" ").is_err() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        });
        let start = std::time::Instant::now();
        assert!(matches!(
            post_language_server(
                &Target {
                    port,
                    token: "fixture".into(),
                    secure: false
                },
                "GetUserStatus"
            )
            .await,
            Err("local-api-timeout")
        ));
        assert!(start.elapsed() >= std::time::Duration::from_secs(1));
        assert!(start.elapsed() < std::time::Duration::from_millis(3500));
        thread.join().unwrap();
    }

    #[tokio::test]
    async fn local_rpc_rejects_invalid_ports_and_mutating_methods() {
        let target = Target {
            port: 0,
            token: "fixture".into(),
            secure: false,
        };
        assert!(matches!(
            post_language_server(&target, "GetUserStatus").await,
            Err("local-api-port")
        ));
        let target = Target {
            port: 1234,
            token: "fixture".into(),
            secure: false,
        };
        assert!(matches!(
            post_language_server(&target, "DeleteCascadeTrajectory").await,
            Err("local-api-method")
        ));
    }

    #[test]
    fn cursor_sqlite_reads_plain_json_and_blob_values_without_modifying_db() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.vscdb");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value)", [])
            .unwrap();
        for value in [
            rusqlite::types::Value::Text("fixture.jwt.value".into()),
            rusqlite::types::Value::Text("\"fixture.jwt.value\"".into()),
            rusqlite::types::Value::Blob(b"fixture.jwt.value".to_vec()),
        ] {
            db.execute(
                "INSERT OR REPLACE INTO ItemTable(key,value) VALUES('cursorAuth/accessToken',?1)",
                [value],
            )
            .unwrap();
            let before = std::fs::read(&path).unwrap();
            assert_eq!(
                read_cursor_token(&path).as_deref(),
                Some("fixture.jwt.value")
            );
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
        let missing = temp.path().join("missing.vscdb");
        assert!(read_cursor_token(&missing).is_none());
        assert!(!missing.exists());
    }

    #[test]
    fn cursor_session_cookie_and_scope_use_account_subject() {
        use base64::Engine;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"auth0|user_123","exp":1800001000}"#);
        let token = format!("header.{payload}.signature");
        let credentials = cursor_credentials(&token, 1800000000000).unwrap();
        assert_eq!(
            credentials.headers["cookie"].to_str().unwrap(),
            format!("WorkosCursorSessionToken=user_123%3A%3A{token}")
        );
        assert_eq!(
            credentials.scope,
            "80fba0ae1c48e3978e43e4efc365e14e12ea0c830ba8ba5b9a2dafc7e3f2ab8b"
        );
        assert!(cursor_credentials(&token, 1800000990000).is_err());
        assert!(cursor_credentials("not-a-jwt", 1800000000000).is_err());
    }

    #[test]
    fn codex_auth_uses_access_token_and_optional_account_header() {
        let credentials = codex_credentials(
            &json!({"tokens":{"access_token":"fixture-access","account_id":"account-123"}}),
        )
        .unwrap();
        assert_eq!(
            credentials.headers["authorization"],
            "Bearer fixture-access"
        );
        assert_eq!(credentials.headers["chatgpt-account-id"], "account-123");
        assert!(!credentials.scope.is_empty());
        assert!(codex_credentials(&json!({"OPENAI_API_KEY":"not-a-chatgpt-session"})).is_err());
        assert!(
            codex_credentials(&json!({"tokens":{"access_token":"invalid\r\nheader"}})).is_err()
        );
    }

    fn antigravity_process(pid: u32, port: u16) -> crate::models::ProcessInfo {
        crate::models::ProcessInfo {
            process_id: pid,
            name: "language_server.exe".into(),
            executable_path: Some("C:\\Antigravity\\language_server.exe".into()),
            command_line: Some(format!(
                "server --csrf_token fixture --extension_server_port {port}"
            )),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn public_provider_flow_falls_back_between_read_only_antigravity_methods() {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let thread = std::thread::spawn(move || {
            for method in ["RetrieveUserQuotaSummary", "GetUserStatus"] {
                let (mut stream, _) = listener.accept().unwrap();
                let req = request(&mut stream);
                assert!(req.starts_with(&format!(
                    "POST /exa.language_server_pb.LanguageServerService/{method} "
                )));
                let body=if method=="RetrieveUserQuotaSummary" {json!({})} else {json!({"clientModelConfigs":[{"modelId":"test","label":"Test model","quotaInfo":{"remainingFraction":0}}]})}.to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let system = Inventory {
            processes: vec![antigravity_process(10, port)],
            listeners: vec![],
        };
        let result = read_provider("antigravity", &system).await;
        assert_eq!(result["status"], "connected");
        assert_eq!(result["quotas"][0]["remaining"], 0.0);
        assert_eq!(result["source"], "Antigravity · yerel servis");
        assert!(result["updatedAt"].as_u64().unwrap() > 0);
        assert!(!result.to_string().contains("fixture"));
        thread.join().unwrap();
    }

    #[tokio::test]
    async fn unsupported_provider_and_closed_local_app_have_honest_empty_results() {
        assert_eq!(
            provider_metadata()
                .iter()
                .map(|p| p["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["cursor", "antigravity", "codex"]
        );
        let system = Inventory::default();
        let unsupported = read_provider("claude", &system).await;
        assert_eq!(unsupported["status"], "error");
        assert_eq!(unsupported["errorKind"], "local");
        assert_eq!(unsupported["quotas"], json!([]));
        let closed = read_provider("antigravity", &system).await;
        assert_eq!(closed["errorKind"], "local");
        assert_eq!(closed["quotas"], json!([]));
    }

    #[tokio::test]
    async fn remote_failures_are_classified_without_exposing_response_or_credentials() {
        use std::io::Write;
        for (status, body, want) in [
            (401, "PRIVATE unauthorized", "auth"),
            (403, "PRIVATE forbidden", "auth"),
            (429, "PRIVATE rate limited", "network"),
            (503, "PRIVATE unavailable", "network"),
            (302, "PRIVATE redirect", "network"),
            (200, "PRIVATE invalid JSON", "format"),
        ] {
            let (port, thread) = local_server(move |mut stream| {
                request(&mut stream);
                write!(
                    stream,
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });
            let credentials = codex_credentials(
                &json!({"tokens":{"access_token":"PRIVATE fixture","account_id":"test-account"}}),
            )
            .unwrap();
            let endpoint = Box::leak(format!("http://127.0.0.1:{port}/usage").into_boxed_str());
            let error = remote_json(endpoint, &credentials).await.unwrap_err();
            assert_eq!(error.kind, want);
            assert_eq!(
                error.account_scope.as_deref(),
                Some(credentials.scope.as_str())
            );
            assert!(!error.message.contains("PRIVATE"));
            thread.join().unwrap();
        }
    }
}
