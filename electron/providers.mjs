import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import https from "node:https";
import http from "node:http";
import { createHash } from "node:crypto";
import {
  parseCursor,
  parseClaude,
  parseCodex,
  parseAntigravity,
} from "./quota.mjs";
import { flag } from "./system.mjs";

export const providerMeta = [
  {
    id: "cursor",
    name: "Cursor",
    description: "Cursor Models & Other Models",
    url: "https://cursor.com/dashboard?tab=usage",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    description: "Model grupları & kullanım pencereleri",
    url: "https://antigravity.google/",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Oturum & haftalık kullanım",
    url: "https://claude.ai/settings/usage",
  },
  {
    id: "codex",
    name: "Codex",
    description: "ChatGPT plan limitleri",
    url: "https://chatgpt.com/codex/settings/usage",
  },
];
class ProviderError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
const login = (message) => {
  throw new ProviderError("auth", message);
};
export const accountScope = (value) =>
  createHash("sha256").update(value).digest("hex");
async function scoped(scope, operation) {
  try {
    return { ...(await operation()), accountScope: scope };
  } catch (error) {
    error.accountScope = scope;
    throw error;
  }
}

async function json(url, headers = {}, customFetch = fetch) {
  let response;
  try {
    response = await customFetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ProviderError(
      "network",
      "Bağlantı kurulamadı. Birazdan yeniden denenecek.",
    );
  }
  if ([401, 403].includes(response.status))
    login("Oturuma erişilemiyor. Hesabını yeniden bağla.");
  if (response.status === 429)
    throw new ProviderError(
      "network",
      "Sağlayıcı çok sık istek aldı. Birazdan yeniden denenecek.",
    );
  if (!response.ok)
    throw new ProviderError(
      "network",
      `Sağlayıcı şu anda yanıt vermiyor (HTTP ${response.status}).`,
    );
  try {
    return await response.json();
  } catch {
    throw new ProviderError(
      "format",
      "Sağlayıcıdan beklenen kullanım bilgisi alınamadı.",
    );
  }
}
function localPost(port, token, method, secure = true) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      metadata: {
        ideName: "antigravity",
        extensionName: "antigravity",
        ideVersion: "unknown",
        locale: "en",
      },
    });
    const req = (secure ? https : http).request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": token,
        },
      },
      (res) => {
        let result = "";
        res.on("data", (chunk) => {
          result += chunk;
          if (result.length > 2 * 1024 * 1024) req.destroy();
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) throw new Error();
            resolve(JSON.parse(result));
          } catch {
            reject(new Error("local-api"));
          }
        });
      },
    );
    req.setTimeout(1600, () => req.destroy());
    req.on("error", reject);
    req.end(body);
  });
}
export function readCursorToken(appData = process.env.APPDATA) {
  let db;
  try {
    db = new DatabaseSync(
      join(appData, "Cursor/User/globalStorage/state.vscdb"),
      { readOnly: true },
    );
    const v = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("cursorAuth/accessToken")?.value;
    const value =
      typeof v === "string" ? v : Buffer.from(v ?? []).toString("utf8");
    return value.startsWith('"') ? JSON.parse(value) : value;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
export async function fetchCursor(browserFetch, browserScope) {
  let headers = {};
  let source = "Cursor oturumu";
  let scope = browserScope;
  if (!browserFetch) {
    const token = readCursorToken();
    if (!token) login("Cursor’da giriş yap, ardından yeniden dene.");
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
    } catch {
      login("Cursor oturumu okunamadı. Cursor’da yeniden giriş yap.");
    }
    if (payload.exp * 1000 < Date.now() + 60000)
      login("Cursor oturumunun süresi dolmuş. Cursor’da yeniden giriş yap.");
    const user = payload.sub?.split("|").at(-1);
    if (!user) login("Cursor hesabı doğrulanamadı.");
    headers = { Cookie: `WorkosCursorSessionToken=${user}%3A%3A${token}` };
    scope = accountScope(user);
    source = "Cursor · yerel oturum";
  }
  return scoped(scope, async () => {
    const data = await json(
      "https://cursor.com/api/usage-summary",
      headers,
      browserFetch,
    );
    return { quotas: parseCursor(data), plan: data.membershipType, source };
  });
}
export async function fetchCodex() {
  let auth;
  try {
    auth = JSON.parse(
      await readFile(
        join(
          process.env.CODEX_HOME || join(process.env.USERPROFILE, ".codex"),
          "auth.json",
        ),
        "utf8",
      ),
    );
  } catch {
    login("Codex uygulamasında veya CLI’da giriş yap.");
  }
  const token = auth.tokens?.access_token;
  if (!token)
    login("ChatGPT plan limitleri için Codex’te ChatGPT hesabınla giriş yap.");
  const headers = { Authorization: `Bearer ${token}` };
  if (auth.tokens.account_id)
    headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
  return scoped(accountScope(auth.tokens.account_id || token), async () => {
    const data = await json(
      "https://chatgpt.com/backend-api/wham/usage",
      headers,
    );
    return {
      quotas: parseCodex(data),
      plan: data.plan_type,
      source: "Codex · yerel oturum",
    };
  });
}
export async function fetchClaude(browserFetch, browserScope) {
  if (browserFetch) {
    return scoped(browserScope, async () => {
      const orgs = await json(
        "https://claude.ai/api/organizations",
        {},
        browserFetch,
      );
      if (!Array.isArray(orgs) || !orgs.length)
        login("Claude hesabında bir çalışma alanı bulunamadı.");
      const org =
        orgs.find((x) => x.capabilities?.includes("claude_pro")) ?? orgs[0];
      if (!/^[\da-f-]+$/i.test(org.uuid))
        throw new ProviderError(
          "format",
          "Claude çalışma alanı doğrulanamadı.",
        );
      const data = await json(
        `https://claude.ai/api/organizations/${org.uuid}/usage`,
        {},
        browserFetch,
      );
      return { quotas: parseClaude(data), source: "Claude · uygulama girişi" };
    });
  }
  let auth;
  try {
    auth = JSON.parse(
      await readFile(
        join(
          process.env.CLAUDE_CONFIG_DIR ||
            join(process.env.USERPROFILE, ".claude"),
          ".credentials.json",
        ),
        "utf8",
      ),
    );
  } catch {
    login("Claude hesabını bağla veya Claude Code’da giriş yap.");
  }
  const token = auth.claudeAiOauth?.accessToken;
  if (!token) login("Claude Code kullanım oturumu bulunamadı. Hesabını bağla.");
  return scoped(accountScope(token), async () => {
    const data = await json("https://api.anthropic.com/api/oauth/usage", {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code/2.1.0",
    });
    return {
      quotas: parseClaude(data),
      plan: auth.claudeAiOauth?.subscriptionType,
      source: "Claude Code · yerel oturum",
    };
  });
}
export async function fetchAntigravity(system) {
  const candidates = system.processes.filter(
    (p) =>
      /language.?server/i.test(p.Name) &&
      /antigravity/i.test(
        (p.CommandLine ?? "") + " " + (p.ExecutablePath ?? ""),
      ),
  );
  if (!candidates.length)
    throw new ProviderError(
      "local",
      "Antigravity’yi aç ve hesabına giriş yap.",
    );
  for (const p of candidates) {
    const token = flag(p.CommandLine, "csrf_token");
    if (!token) continue;
    const ports = [
      ...new Set(
        system.listeners
          .filter((x) => x.pid === p.ProcessId)
          .map((x) => x.port),
      ),
    ].slice(0, 12);
    const targets = ports.map((port) => ({ port, token, secure: true }));
    const fallback = Number(flag(p.CommandLine, "extension_server_port"));
    if (fallback)
      targets.push({
        port: fallback,
        token: flag(p.CommandLine, "extension_server_csrf_token") ?? token,
        secure: false,
      });
    for (const method of [
      "RetrieveUserQuotaSummary",
      "GetUserStatus",
      "GetCommandModelConfigs",
    ]) {
      const outcomes = await Promise.allSettled(
        targets.map(async (t) => {
          const data = await localPost(t.port, t.token, method, t.secure);
          const quotas = parseAntigravity(data);
          return quotas.length
            ? { quotas, source: "Antigravity · yerel servis" }
            : null;
        }),
      );
      const valid = outcomes.find((x) => x.status === "fulfilled" && x.value);
      if (valid) return valid.value;
    }
  }
  throw new ProviderError(
    "local",
    "Antigravity açık, ancak kullanım servisi yanıt vermedi. Uygulamayı güncelleyip yeniden dene.",
  );
}
export async function readProvider(id, system, browserFetch, browserScope) {
  try {
    const result = await {
      cursor: () => fetchCursor(browserFetch, browserScope),
      claude: () => fetchClaude(browserFetch, browserScope),
      codex: fetchCodex,
      antigravity: () => fetchAntigravity(system),
    }[id]();
    if (!result.quotas.length)
      return {
        id,
        status: "unavailable",
        quotas: [],
        message:
          "Hesap bağlı, ancak sağlayıcı ölçülebilir limit bilgisi paylaşmadı.",
        source: result.source,
      };
    return { id, status: "connected", ...result, updatedAt: Date.now() };
  } catch (error) {
    return {
      id,
      status: error.kind === "auth" ? "needs-login" : "error",
      errorKind: error.kind ?? "local",
      accountScope: error.accountScope,
      message:
        error instanceof ProviderError
          ? error.message
          : "Yerel kullanım verisi okunamadı.",
      quotas: [],
    };
  }
}
