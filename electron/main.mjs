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
import { GhostMode, registerRecoveryShortcut } from "./ghost.mjs";
import { loadAltReader } from "./windows-input.mjs";
import { CursorTracker } from "./cursor-tracking.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let win,
  tray,
  timer,
  sessionTimer,
  sessionRefresh,
  ghost,
  ghostTimer,
  cursorTracker,
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
  sessionsUpdatedAt: null,
  sessionsError: null,
  cursorTracking: { enabled: false, status: "loading", configPath: "" },
  settings,
  mode: "dashboard",
  refreshing: false,
  systemError: null,
  shortcutAvailable: false,
  recoveryShortcut: null,
  ghostAvailable: false,
  ghostPeeking: false,
  ghostError: null,
};
const notify = () => {
  state.settings = settings;
  state.ghostPeeking = ghost?.peeking ?? false;
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

async function refreshSessions(system) {
  if (sessionRefresh) return sessionRefresh;
  sessionRefresh = (async () => {
    const [current, cursor] = await Promise.all([
      system || inventory({ workingDirectories: false, agentsOnly: true }),
      cursorTracker.readSessions(),
    ]);
    state.cursorTracking = cursor.connection;
    state.sessions = await readSessions(current, {
      cursorSessions: cursor.sessions,
    });
    state.sessionsUpdatedAt = Date.now();
    state.sessionsError = null;
  })()
    .catch(() => {
      state.sessions = state.sessions.map((s) => ({
        ...s,
        state: "unknown",
        statusLabel: "Son kontrol başarısız",
        stale: true,
      }));
      state.sessionsError =
        "Ajan durumları okunamadı. Son görülen oturumlar gösteriliyor.";
    })
    .finally(() => {
      sessionRefresh = null;
      notify();
    });
  return sessionRefresh;
}

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
    await Promise.all([
      refreshSessions(state.systemError ? undefined : system),
      ...providerMeta.map(async (meta) => {
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
    ]);
    if (!state.systemError) {
      state.ports = await portManager.scan(system);
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
function applyPin() {
  // Electron's default Windows level moves the HWND behind the taskbar after activation.
  win.setAlwaysOnTop(settings.alwaysOnTop, "pop-up-menu");
}
function applyMode(mode, peekAnchor) {
  if (!["dashboard", "panel", "compact"].includes(mode)) return;
  const previousMode = state.mode;
  const previous = win.getBounds();
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
    const anchor = peekAnchor || previous;
    const work = screen.getDisplayMatching(anchor).workArea;
    const x = peekAnchor
      ? anchor.x
      : previousMode === "dashboard"
        ? work.x + work.width - size[0] - 24
        : previous.x + previous.width - size[0];
    const y = peekAnchor
      ? anchor.y
      : previousMode === "dashboard"
        ? work.y + 24
        : previous.y;
    win.setPosition(
      Math.max(work.x, Math.min(x, work.x + work.width - size[0])),
      Math.max(work.y, Math.min(y, work.y + work.height - size[1])),
      true,
    );
  }
  applyPin();
  notify();
}
function disableGhost() {
  clearInterval(ghostTimer);
  settings.clickThrough = false;
  ghost?.disable();
}
function openMode(mode) {
  if (!["dashboard", "panel", "compact"].includes(mode)) return;
  if (mode === "dashboard") disableGhost();
  if (ghost) ghost.open(mode);
  else applyMode(mode);
}
function recoverWindow() {
  disableGhost();
  win.show();
  win.focus();
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
  settings.clickThrough = false;
  cursorTracker = new CursorTracker({
    directory:
      process.env.AGENTHUD_CURSOR_DIRECTORY ||
      join(app.getPath("home"), ".cursor"),
  });
  state.cursorTracking = await cursorTracker.status();
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
  applyPin();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  let altDown;
  try {
    altDown = loadAltReader();
    altDown();
    state.ghostAvailable = true;
  } catch {
    state.ghostAvailable = false;
  }
  ghost = new GhostMode({
    bounds: () => win.getBounds(),
    mode: () => state.mode,
    visible: () => !win.isDestroyed() && win.isVisible() && !win.isMinimized(),
    cursor: () => screen.getCursorScreenPoint(),
    altDown: () => altDown(),
    ignore: (value) => {
      if (!win.isDestroyed())
        win.setIgnoreMouseEvents(value, { forward: true });
    },
    show: applyMode,
    failed: () => {
      disableGhost();
      state.ghostAvailable = false;
      state.ghostError =
        "Hayalet modu durduruldu. Pencere yeniden tıklanabilir.";
      applyMode("panel");
    },
  });
  ghost.disable();
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("ready-to-show", () => {
    if (settings.launchCompact) openMode("compact");
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
          openMode("dashboard");
        },
      },
      {
        label: "Küçük görünüm",
        click: () => {
          win.show();
          openMode("compact");
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
  tray.on("click", recoverWindow);
  state.recoveryShortcut = registerRecoveryShortcut((accelerator) =>
    globalShortcut.register(accelerator, recoverWindow),
  );
  state.shortcutAvailable = !!state.recoveryShortcut;
  setupTimer();
  sessionTimer = setInterval(() => void refreshSessions(), 5000);
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
    if (patch.clickThrough && !state.ghostAvailable)
      return {
        ...state,
        ok: false,
        message: "Hayalet modu bu bilgisayarda başlatılamadı.",
      };
    if (patch.clickThrough) {
      state.ghostError = null;
      settings.clickThrough = true;
      ghost.enable();
      ghost.open("compact");
      clearInterval(ghostTimer);
      ghostTimer = setInterval(() => ghost.tick(), 40);
    } else disableGhost();
  }
  applyPin();
  setupTimer();
  await writeFile(
    join(app.getPath("userData"), "settings.json"),
    JSON.stringify({ ...settings, clickThrough: false }),
  );
  notify();
  return state;
});
handle("hud:window", (action) => {
  if (["compact", "panel", "dashboard"].includes(action)) openMode(action);
  else if (action === "minimize") win.minimize();
  else if (action === "close") win.hide();
  else if (action === "quit") {
    quitting = true;
    app.quit();
  }
  return state;
});
handle("hud:hotspot", (rectangle) => {
  ghost.setHotspot(rectangle);
  return { ok: true };
});
handle("hud:tracking", async (provider, enabled) => {
  if (provider !== "cursor" || typeof enabled !== "boolean")
    return { ok: false, message: "Geçersiz takip ayarı." };
  try {
    await cursorTracker.setEnabled(enabled);
    await refreshSessions();
    return { ok: true };
  } catch (error) {
    state.cursorTracking = await cursorTracker.status();
    notify();
    return {
      ok: false,
      message: error.message?.startsWith("Cursor")
        ? error.message
        : "Takip ayarı kaydedilemedi. Mevcut ayarlar korundu.",
    };
  }
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
  clearInterval(sessionTimer);
  clearInterval(ghostTimer);
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {});
