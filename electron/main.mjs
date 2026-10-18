import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  Notification,
  session,
  screen,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { providerMeta, readProvider, accountScope } from "./providers.mjs";
import { mergeRefresh } from "./quota.mjs";
import { inventory } from "./system.mjs";
import { PortManager } from "./ports.mjs";
import { readSessions, focusProvider } from "./sessions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let win,
  tray,
  timer,
  refreshing,
  quitting = false;
const loginWindows = new Map();
const portManager = new PortManager();
const defaults = {
  alwaysOnTop: false,
  refreshSeconds: 60,
  notifications: true,
  clickThrough: false,
  launchCompact: false,
};
let settings = { ...defaults };
let state = {
  providers: providerMeta.map((p) => ({ ...p, status: "loading", quotas: [] })),
  ports: [],
  sessions: [],
  settings,
  mode: "dashboard",
  refreshing: false,
  systemError: null,
  shortcutAvailable: false,
};
const notify = () => {
  state.settings = settings;
  win?.webContents.send("hud:update", state);
};
const safeError = (e) => ({
  ok: false,
  message:
    e.message?.includes("Port") ||
    e.message?.includes("Süreç") ||
    e.message?.includes("Pencere") ||
    e.message?.includes("Bu süreç")
      ? e.message
      : "İşlem tamamlanamadı. Yeniden dene.",
});
const getProvider = (id) => {
  const p = providerMeta.find((p) => p.id === id);
  if (!p) throw new Error("Geçersiz sağlayıcı");
  return p;
};

async function refresh() {
  if (refreshing) return refreshing;
  state.refreshing = true;
  notify();
  refreshing = (async () => {
    let system = { processes: [], listeners: [] };
    try {
      system = await inventory();
      state.systemError = null;
    } catch {
      state.systemError = "Süreç ve port bilgileri okunamadı.";
    }
    await Promise.all(
      providerMeta.map(async (meta) => {
        const partition = session.fromPartition(`persist:agenthud-${meta.id}`);
        const cookies =
          meta.id === "claude" || meta.id === "cursor"
            ? await partition.cookies.get({
                url:
                  meta.id === "claude"
                    ? "https://claude.ai"
                    : "https://cursor.com",
              })
            : [];
        const hasSession = cookies.some((c) =>
          meta.id === "claude"
            ? c.name === "sessionKey"
            : /session.?token/i.test(c.name),
        );
        const data = await readProvider(
          meta.id,
          system,
          hasSession ? partition.fetch.bind(partition) : undefined,
          hasSession
            ? accountScope(
                cookies
                  .filter((c) =>
                    meta.id === "claude"
                      ? c.name === "sessionKey"
                      : /session.?token/i.test(c.name),
                  )
                  .map((c) => c.value)
                  .join("|"),
              )
            : undefined,
        );
        const previous = state.providers.find((p) => p.id === meta.id);
        const next = { ...meta, ...mergeRefresh(previous, data) };
        if (settings.notifications && data.status === "connected")
          for (const q of data.quotas) {
            const old = previous?.quotas?.find((x) => x.id === q.id);
            if (
              q.remaining < 20 &&
              (!old || old.remaining >= 20) &&
              Notification.isSupported()
            )
              new Notification({
                title: `${meta.name} · Kullanım uyarısı`,
                body: `${q.group ? q.group + " · " : ""}${q.label}: %${Math.round(q.remaining)} kaldı.`,
              }).show();
          }
        state.providers = state.providers.map((p) =>
          p.id === meta.id ? next : p,
        );
        notify();
      }),
    );
    if (!state.systemError) {
      state.ports = await portManager.scan(system);
      state.sessions = await readSessions(system);
    }
    state.refreshing = false;
    state.refreshedAt = Date.now();
    notify();
    return state;
  })()
    .catch(() => {
      state.refreshing = false;
      state.systemError = "Yenileme tamamlanamadı. Tekrar dene.";
      notify();
      return state;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
function applyMode(mode) {
  if (!["dashboard", "panel", "compact"].includes(mode)) return;
  win.setIgnoreMouseEvents(false);
  settings.clickThrough = false;
  state.mode = mode;
  const size =
    mode === "compact"
      ? [420, 48]
      : mode === "panel"
        ? [420, 720]
        : [1120, 940];
  win.setMinimumSize(
    mode === "dashboard" ? 760 : 380,
    mode === "compact" ? 48 : 540,
  );
  win.setSize(...size, true);
  if (mode !== "dashboard") {
    const work = screen.getDisplayNearestPoint(win.getBounds()).workArea;
    win.setPosition(work.x + work.width - size[0] - 24, work.y + 24, true);
  }
  win.setAlwaysOnTop(settings.alwaysOnTop);
  notify();
}
function setupTimer() {
  clearInterval(timer);
  timer = setInterval(() => void refresh(), settings.refreshSeconds * 1000);
}
function login(id) {
  const meta = getProvider(id);
  if (id === "antigravity" || id === "codex")
    return shell.openExternal(meta.url);
  if (loginWindows.has(id)) {
    loginWindows.get(id).focus();
    return;
  }
  const w = new BrowserWindow({
    width: 1060,
    height: 790,
    title: `${meta.name} hesabını bağla`,
    parent: win,
    webPreferences: {
      partition: `persist:agenthud-${id}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  loginWindows.set(id, w);
  w.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const host = new URL(url).hostname;
      if (
        [
          "accounts.google.com",
          "claude.ai",
          "cursor.com",
          "authenticator.cursor.sh",
        ].includes(host)
      ) {
        void w.loadURL(url);
      }
    } catch {}
    return { action: "deny" };
  });
  const cookies = w.webContents.session.cookies;
  const changed = (_event, cookie, _cause, removed) => {
    if (
      !removed &&
      ((id === "claude" && cookie.name === "sessionKey") ||
        (id === "cursor" && /session.?token/i.test(cookie.name)))
    ) {
      setTimeout(() => void refresh(), 800);
    }
  };
  cookies.on("changed", changed);
  w.on("closed", () => {
    cookies.removeListener("changed", changed);
    loginWindows.delete(id);
    void refresh();
  });
  void w.loadURL(meta.url);
}
async function createWindow() {
  try {
    settings = {
      ...defaults,
      ...JSON.parse(
        await readFile(join(app.getPath("userData"), "settings.json"), "utf8"),
      ),
    };
  } catch {}
  win = new BrowserWindow({
    width: 1120,
    height: 940,
    minWidth: 760,
    minHeight: 540,
    frame: false,
    alwaysOnTop: settings.alwaysOnTop,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    title: "AgentHUD",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("ready-to-show", () => {
    if (settings.launchCompact) applyMode("compact");
    win.show();
  });
  await win.loadFile(join(here, "../dist/index.html"));
  const icon = nativeImage
    .createFromPath(join(here, "../assets/icon.png"))
    .resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("AgentHUD · Kullanım hakların");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "AgentHUD’ı aç",
        click: () => {
          win.show();
          applyMode("dashboard");
        },
      },
      {
        label: "Küçük görünüm",
        click: () => {
          win.show();
          applyMode("compact");
        },
      },
      { label: "Yenile", click: () => void refresh() },
      { type: "separator" },
      {
        label: "Çıkış",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    win.setIgnoreMouseEvents(false);
    settings.clickThrough = false;
    win.show();
    win.focus();
    notify();
  });
  state.shortcutAvailable = globalShortcut.register(
    "CommandOrControl+Shift+H",
    () => {
      win.setIgnoreMouseEvents(false);
      settings.clickThrough = false;
      win.show();
      win.focus();
      notify();
    },
  );
  setupTimer();
  void refresh();
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents)
      return { ok: false, message: "Geçersiz pencere." };
    try {
      return await fn(...args);
    } catch (e) {
      return safeError(e);
    }
  });
}
handle("hud:snapshot", () => state);
handle("hud:refresh", refresh);
handle("hud:usage", (id) => shell.openExternal(getProvider(id).url));
handle("hud:connect", login);
handle("hud:settings", async (patch) => {
  if (!patch || typeof patch !== "object") return state;
  for (const key of ["alwaysOnTop", "notifications", "launchCompact"])
    if (typeof patch[key] === "boolean") settings[key] = patch[key];
  if ([30, 60, 120, 300].includes(patch.refreshSeconds))
    settings.refreshSeconds = patch.refreshSeconds;
  if (typeof patch.clickThrough === "boolean") {
    if (patch.clickThrough && state.mode === "dashboard")
      throw new Error("Hayalet modu için küçük görünüme geç.");
    if (patch.clickThrough && !state.shortcutAvailable)
      return {
        ...state,
        ok: false,
        message:
          "Geri çağırma kısayolu başka bir uygulamada kullanılıyor. Hayalet modu açılamadı.",
      };
    settings.clickThrough = patch.clickThrough;
    win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  }
  win.setAlwaysOnTop(settings.alwaysOnTop);
  setupTimer();
  await writeFile(
    join(app.getPath("userData"), "settings.json"),
    JSON.stringify({ ...settings, clickThrough: false }),
  );
  notify();
  return state;
});
handle("hud:window", (action) => {
  if (["compact", "panel", "dashboard"].includes(action)) applyMode(action);
  else if (action === "minimize") win.minimize();
  else if (action === "close") win.hide();
  else if (action === "quit") {
    quitting = true;
    app.quit();
  }
  return state;
});
handle("hud:focus", async (provider) => {
  getProvider(provider);
  await focusProvider(provider);
  return { ok: true };
});
handle("hud:port", async (action, key) => {
  if (typeof key !== "string") throw new Error("Geçersiz port");
  if (action === "open") {
    const entry = portManager.entries.get(key);
    if (!entry || entry.status !== "listening")
      throw new Error("Port açık değil.");
    await shell.openExternal(`http://localhost:${entry.port}`);
  } else if (action === "stop") state.ports = await portManager.stop(key);
  else if (action === "restart") {
    await portManager.restart(key);
    setTimeout(() => void refresh(), 1600);
  } else throw new Error("Geçersiz işlem");
  notify();
  return { ok: true };
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app.whenReady().then(createWindow);
}
app.on("before-quit", () => {
  quitting = true;
  clearInterval(timer);
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {});
