use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct CompactQuota {
    pub name: &'static str,
    pub window: &'static str,
    pub remaining: Option<f64>,
    pub disabled: bool,
    pub stale: bool,
}

pub fn compact_quotas(providers: &[Value; 3]) -> Vec<CompactQuota> {
    let codex = quota_rows(&providers[0]);
    let cursor: Vec<_> = quota_rows(&providers[1])
        .into_iter()
        .filter(|q| q["id"] == "cursor-models" || q["label"] == "Cursor Models")
        .collect();
    let mut result = vec![
        summarize("Codex", &codex, &providers[0]),
        summarize("Cursor Models", &cursor, &providers[1]),
    ];
    let antigravity = quota_rows(&providers[2]);
    for name in ["Gemini", "Argon", "Other Models"] {
        let rows: Vec<_> = antigravity
            .iter()
            .copied()
            .filter(|q| group_kind(q["group"].as_str().unwrap_or("")) == Some(name))
            .collect();
        if !rows.is_empty() {
            result.push(summarize(name, &rows, &providers[2]));
        }
    }
    if result.len() == 2 {
        result.push(summarize("Antigravity", &[], &providers[2]));
    }
    result
}

fn quota_rows(provider: &Value) -> Vec<&Value> {
    provider["quotas"]
        .as_array()
        .map(|rows| rows.iter().collect())
        .unwrap_or_default()
}

fn group_kind(group: &str) -> Option<&'static str> {
    let group = group.to_lowercase();
    if group.contains("argon") {
        Some("Argon")
    } else if group.contains("gemini") {
        Some("Gemini")
    } else if group.contains("other") || (group.contains("claude") && group.contains("gpt")) {
        Some("Other Models")
    } else {
        None
    }
}

fn remaining(quota: &Value) -> Option<f64> {
    quota["remaining"]
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=100.0).contains(v))
}

fn summarize(name: &'static str, rows: &[&Value], provider: &Value) -> CompactQuota {
    let selected = rows
        .iter()
        .find(|q| q["label"] == "5 saatlik")
        .or_else(|| rows.iter().find(|q| q["label"] == "Haftalık"))
        .or_else(|| rows.first());
    let stale = provider["status"] == "stale";
    let Some(selected) = selected else {
        return CompactQuota {
            name,
            window: match provider["status"].as_str() {
                Some("needs-login") => "giriş gerekli",
                Some("error") => "bağlantı yok",
                Some("loading") => "yükleniyor",
                _ => "ölçüm yok",
            },
            remaining: None,
            disabled: false,
            stale,
        };
    };
    let blocked = rows.iter().any(|q| {
        q["group"] == selected["group"]
            && matches!(q["label"].as_str(), Some("Haftalık" | "Aylık"))
            && remaining(q) == Some(0.0)
    });
    let disabled = selected["disabled"] == true && !blocked;
    CompactQuota {
        name,
        window: if disabled {
            "kapalı"
        } else {
            match selected["label"].as_str() {
                Some("5 saatlik") => "5 sa",
                Some("Haftalık") => "hafta",
                Some("Aylık") => "ay",
                _ => "",
            }
        },
        remaining: if blocked {
            Some(0.0)
        } else if disabled {
            None
        } else {
            remaining(selected)
        },
        disabled,
        stale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn view(codex: Value, cursor: Value, antigravity: Value) -> Vec<CompactQuota> {
        compact_quotas(&[codex, cursor, antigravity])
    }

    fn find<'a>(rows: &'a [CompactQuota], name: &str) -> Option<&'a CompactQuota> {
        rows.iter().find(|row| row.name == name)
    }

    #[test]
    fn codex_uses_weekly_when_no_five_hour_window_is_reported() {
        let rows = view(
            json!({"quotas":[{"label":"Haftalık","remaining":54.0}]}),
            Value::Null,
            Value::Null,
        );
        assert_eq!(
            find(&rows, "Codex").map(|r| (r.remaining, r.window)),
            Some((Some(54.0), "hafta"))
        );
    }

    #[test]
    fn codex_prefers_five_hours_regardless_of_api_order() {
        let rows = view(
            json!({"quotas":[
                {"label":"Haftalık","remaining":54.0},
                {"label":"5 saatlik","remaining":82.0}
            ]}),
            Value::Null,
            Value::Null,
        );
        assert_eq!(
            find(&rows, "Codex").map(|r| (r.remaining, r.window)),
            Some((Some(82.0), "5 sa"))
        );
    }

    #[test]
    fn cursor_never_substitutes_the_other_models_pool() {
        let rows = view(
            Value::Null,
            json!({"quotas":[
                {"id":"other-models","label":"Other Models","remaining":100.0},
                {"id":"cursor-models","label":"Cursor Models","remaining":21.0}
            ]}),
            Value::Null,
        );
        assert_eq!(
            find(&rows, "Cursor Models").map(|r| r.remaining),
            Some(Some(21.0))
        );
        let missing = view(
            Value::Null,
            json!({"quotas":[{"id":"other-models","remaining":100.0}]}),
            Value::Null,
        );
        assert_eq!(
            find(&missing, "Cursor Models").map(|r| r.remaining),
            Some(None)
        );
    }

    #[test]
    fn antigravity_uses_short_windows_and_gates_only_the_exhausted_group() {
        let rows = view(
            Value::Null,
            Value::Null,
            json!({"quotas":[
                {"group":"Gemini Models","label":"Haftalık","remaining":66.0},
                {"group":"Gemini Models","label":"5 saatlik","remaining":91.0},
                {"group":"Gemini 4 Argon","label":"Haftalık","remaining":8.0},
                {"group":"Claude and GPT models","label":"Haftalık","remaining":0.0},
                {"group":"Claude and GPT models","label":"5 saatlik","remaining":100.0,"disabled":true}
            ]}),
        );
        assert_eq!(find(&rows, "Gemini").map(|r| r.remaining), Some(Some(91.0)));
        assert_eq!(
            find(&rows, "Argon").map(|r| (r.remaining, r.window)),
            Some((Some(8.0), "hafta"))
        );
        assert_eq!(
            find(&rows, "Other Models").map(|r| (r.remaining, r.disabled)),
            Some((Some(0.0), false))
        );
        assert_eq!(
            rows.iter().map(|r| r.name).collect::<Vec<_>>(),
            ["Codex", "Cursor Models", "Gemini", "Argon", "Other Models"]
        );
    }

    #[test]
    fn argon_prefers_its_own_five_hour_window_if_present() {
        let rows = view(
            Value::Null,
            Value::Null,
            json!({"quotas":[
                {"group":"Gemini 4 Argon","label":"Haftalık","remaining":8.0},
                {"group":"Gemini 4 Argon","label":"5 saatlik","remaining":70.0}
            ]}),
        );
        assert_eq!(
            find(&rows, "Argon").map(|r| (r.remaining, r.window)),
            Some((Some(70.0), "5 sa"))
        );
    }

    #[test]
    fn disabled_window_without_an_exhausted_week_is_not_available_quota() {
        let rows = view(
            Value::Null,
            Value::Null,
            json!({"quotas":[
                {"group":"Other Models","label":"Haftalık","remaining":30.0},
                {"group":"Other Models","label":"5 saatlik","remaining":100.0,"disabled":true}
            ]}),
        );
        assert_eq!(
            find(&rows, "Other Models").map(|r| (r.remaining, r.disabled)),
            Some((None, true))
        );
    }

    #[test]
    fn missing_measurements_and_login_errors_do_not_become_zero_percent() {
        let rows = view(
            json!({"status":"needs-login","quotas":[]}),
            Value::Null,
            Value::Null,
        );
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.remaining.is_none()));
        assert_eq!(
            find(&rows, "Codex").map(|r| r.window),
            Some("giriş gerekli")
        );
    }
}
