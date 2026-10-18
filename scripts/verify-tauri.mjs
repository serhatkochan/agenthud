import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

await mkdir(".cache", { recursive: true });
const profile = await mkdtemp(join(process.cwd(), ".cache", "tauri-ui-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    alwaysOnTop: true,
    refreshSeconds: 300,
    notifications: false,
  }),
);
const freePort = async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
};
const port = await freePort();
const app = spawn(
  resolve(process.argv[2] || "src-tauri/target/debug/agenthud.exe"),
  [],
  {
    windowsHide: true,
    env: {
      ...process.env,
      AGENTHUD_PROFILE_DIR: profile,
      AGENTHUD_DEBUG_PORT: String(port),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
app.stdout.on("data", (b) => (log += b));
app.stderr.on("data", (b) => (log += b));
let browser, page;
const fixtures = [];
let ownedServer;
const watchdog = setTimeout(() => app.kill(), 120000);
const exec = promisify(execFile);
let windowHandle;
const native = async (width = 0, height = 0) => {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-File",
      resolve("scripts/tauri-window.ps1"),
      "-ProcessId",
      String(app.pid),
      ...(windowHandle ? ["-WindowHandle", windowHandle] : []),
      "-Width",
      String(width),
      "-Height",
      String(height),
    ],
    { windowsHide: true, timeout: 10000 },
  );
  const state = JSON.parse(stdout);
  windowHandle = state.windowHandle;
  return state;
};
try {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {}
    if (app.exitCode !== null)
      throw new Error(`Native app exited ${app.exitCode}: ${log.slice(-2500)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 10000,
  });
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "WebView2 page missing");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor({ timeout: 20000 });
  await page
    .locator(".connection-state.connected")
    .first()
    .waitFor({ timeout: 45000 });
  const initial = await page.evaluate(() => window.agenthud.snapshot());
  assert.deepEqual(
    initial.providers.map((p) => p.id),
    ["cursor", "antigravity", "codex"],
  );
  assert.equal(
    initial.providers.some((p) => p.id === "claude"),
    false,
  );
  assert.equal(await page.locator(".provider-card").count(), 3);
  assert.equal(
    await page
      .getByRole("navigation", { name: "Ana gezinme" })
      .getByRole("button")
      .count(),
    2,
  );
  assert.equal(
    await page.getByRole("button", { name: "Ajanlar", exact: true }).count(),
    0,
  );
  for (const field of [
    "sessions",
    "cursorTracking",
    "sessionsUpdatedAt",
    "sessionsError",
  ])
    assert.equal(field in initial, false, `Removed field: ${field}`);
  const api = await page.evaluate(() => Object.keys(window.agenthud));
  assert.equal(api.includes("focus"), false);
  assert.equal(api.includes("tracking"), false);
  assert.equal(api.includes("setTracking"), false);
  assert.deepEqual(
    initial.providers.map((p) => p.status),
    ["connected", "connected", "connected"],
  );
  assert.equal(initial.providers[0].quotas.length, 2);
  assert.match(
    await page.locator(".overview-strip strong").first().textContent(),
    /3\s*\/\s*3/,
  );
  await page.screenshot({ path: ".cache/tauri-dashboard.png" });
  console.log("Live quotas and dashboard passed.");
  await page.evaluate(() => window.agenthud.window("hide"));
  const duplicate = spawn(
    resolve(process.argv[2] || "src-tauri/target/debug/agenthud.exe"),
    [],
    {
      windowsHide: true,
      env: {
        ...process.env,
        AGENTHUD_PROFILE_DIR: profile,
      },
      stdio: "ignore",
    },
  );
  fixtures.push(duplicate);
  const duplicateExit = await Promise.race([
    new Promise((resolve) => duplicate.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  assert.equal(
    duplicateExit,
    0,
    "Second launch must exit and recover the existing window",
  );
  assert.equal((await native()).visible, true);
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).mode,
    "panel",
  );
  await page.evaluate(() => window.agenthud.window("dashboard"));
  console.log("Single-instance relaunch recovery passed.");
  await page
    .getByRole("button", { name: "Yerel portlar", exact: true })
    .click();
  const serverDirectory = join(profile, "Gerçek çalışma alanı ' Rust");
  await mkdir(serverDirectory);
  const serverPort = await freePort();
  const serverToken = randomUUID();
  ownedServer = { url: `http://127.0.0.1:${serverPort}`, token: serverToken };
  const serverFile = join(serverDirectory, "server.mjs");
  await writeFile(
    serverFile,
    `import http from 'node:http';\nconst token=${JSON.stringify(serverToken)};\nconst server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({token,pid:process.pid,cwd:process.cwd()}));if(req.url==='/quit/'+token)server.close();});\nserver.listen(${serverPort},'127.0.0.1',()=>console.log('ready'));\nsetTimeout(()=>server.close(),90000).unref();\n`,
  );
  const server = spawn(process.execPath, [serverFile], {
    cwd: serverDirectory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fixtures.push(server);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Owned TCP fixture did not start")),
      10000,
    );
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Owned TCP fixture exited before listening"));
    });
    server.stdout.once("data", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
  const firstResponse = await (await fetch(ownedServer.url)).json();
  assert.equal(firstResponse.cwd, serverDirectory);
  await page.evaluate(() => window.agenthud.refresh());
  const portRow = page
    .locator(".port-row")
    .filter({ has: page.getByText(`:${serverPort}`, { exact: true }) });
  await portRow
    .getByRole("button", { name: `${serverPort} portunu durdur`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Süreci durdur", exact: true })
    .click();
  await portRow
    .getByText("Durduruldu", { exact: true })
    .waitFor({ timeout: 25000 });
  await portRow.getByRole("button", { name: "Başlat", exact: true }).click();
  await page
    .locator(".port-row.listening")
    .filter({ has: page.getByText(`:${serverPort}`, { exact: true }) })
    .waitFor({ timeout: 25000 });
  const restarted = await (await fetch(ownedServer.url)).json();
  assert.equal(restarted.token, serverToken);
  assert.equal(restarted.cwd, serverDirectory);
  assert.notEqual(restarted.pid, firstResponse.pid);
  await fetch(`${ownedServer.url}/quit/${serverToken}`);
  ownedServer = undefined;
  console.log("Own TCP server UI stop/restart preserved native cwd.");
  await page.screenshot({ path: ".cache/tauri-ports.png" });
  await page.evaluate(() => window.agenthud.window("compact"));
  await page.waitForFunction(() => innerHeight === 48);
  await page.screenshot({ path: ".cache/tauri-compact.png" });
  await page
    .getByRole("button", { name: "Paneli genişlet", exact: true })
    .click();
  await page.waitForFunction(() => innerWidth === 420);
  assert.equal(
    await page
      .locator(".app")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: ".cache/tauri-panel.png" });
  assert.equal((await native()).topmost, true);
  const scale = await page.evaluate(() => devicePixelRatio);
  await native(Math.round(380 * scale), Math.round(720 * scale));
  await page.waitForFunction(() => innerWidth === 380);
  assert.equal(
    await page
      .locator(".app")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.getByRole("button", { name: "Ayarları aç", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: ".cache/tauri-settings-380.png" });
  console.log("Native window sizes and narrow settings passed.");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const beforeGhost = await page.evaluate(() => window.agenthud.snapshot());
  if (beforeGhost.shortcutAvailable) {
    await page.evaluate(() =>
      window.agenthud.setSettings({ clickThrough: true }),
    );
    await page.waitForFunction(() => innerHeight === 48);
    await new Promise((r) => setTimeout(r, 150));
    let state = await native();
    const hot = await page.locator(".mascot-button").boundingBox();
    const x = (state.pointerX - state.clientX) / scale,
      y = (state.pointerY - state.clientY) / scale;
    assert.equal(
      state.transparent,
      !(
        x >= hot.x &&
        x < hot.x + hot.width &&
        y >= hot.y &&
        y < hot.y + hot.height
      ),
    );
    await page.evaluate(() =>
      window.agenthud.setSettings({ clickThrough: false }),
    );
    assert.equal((await native()).transparent, false);
    console.log("Native ghost mode passed.");
  }
  await page.evaluate(() => window.agenthud.window("dashboard"));
  assert.equal(
    await page.evaluate(async () => {
      const r = await window.agenthud.setSettings({ alwaysOnTop: false });
      return r.settings.alwaysOnTop;
    }),
    false,
  );
  assert.equal((await native()).topmost, false);
  await page.evaluate(() => window.agenthud.setSettings({ alwaysOnTop: true }));
  assert.equal((await native()).topmost, true);
  await page.evaluate(() => window.agenthud.window("minimize"));
  assert.equal((await native()).minimized, true);
  await page.evaluate(() => window.agenthud.window("show"));
  await page.evaluate(() => window.agenthud.window("hide"));
  assert.equal((await native()).visible, false);
  await page.evaluate(() => window.agenthud.window("show"));
  console.log("Pin, minimize, hide and recovery passed.");
  assert.deepEqual(errors, []);
  const final = await page.evaluate(() => window.agenthud.snapshot());
  await writeFile(
    ".cache/tauri-ui-result.json",
    JSON.stringify(
      {
        ok: true,
        runtime: "Rust + Tauri + WebView2",
        providers: final.providers.map((p) => ({
          id: p.id,
          status: p.status,
          quotaCount: p.quotas.length,
        })),
        checked: [
          "three-live-providers",
          "single-instance-relaunch-recovery",
          "no-standalone-claude",
          "no-agent-monitoring",
          "own-TCP-server-UI-stop-restart-cwd",
          "two-navigation-tabs",
          "compact48",
          "panel420",
          "no-horizontal-overflow",
          "settings-save",
          "native-topmost",
          "native-minimize-hide-recover",
          "native-ghost-click-through",
          "settings-380px",
          "no-renderer-errors",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Tauri UI checks passed.");
} finally {
  clearTimeout(watchdog);
  if (ownedServer)
    await fetch(`${ownedServer.url}/quit/${ownedServer.token}`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  if (page) {
    await Promise.race([
      page.evaluate(() => window.agenthud.window("quit")).catch(() => {}),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
  await browser?.close().catch(() => {});
  if (app.exitCode === null) app.kill();
  for (const child of fixtures) if (child.exitCode === null) child.kill();
}
