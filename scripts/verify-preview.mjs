import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(url)).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error("Preview server exited");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Preview server did not start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1120, height: 940 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  assert.deepEqual(
    await page
      .getByRole("navigation", { name: "Ana gezinme" })
      .getByRole("button")
      .allTextContents(),
    ["Kota radarı0", "Yerel portlar0"],
  );
  assert.equal(
    await page.getByRole("button", { name: "Ajanlar", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator(".provider-card").count(), 3);
  assert.equal(await page.locator(".provider-claude").count(), 0);
  assert.equal(
    await page.getByRole("meter").count(),
    0,
    "Preview must not invent quotas",
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".provider-card")].every(
      (card) => Number(getComputedStyle(card).opacity) === 1,
    ),
  );
  await mkdir(".cache", { recursive: true });
  await page.screenshot({ path: ".cache/preview-quotas.png" });
  await page
    .getByRole("button", { name: "Yerel portlar", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Yerel portlar", exact: true })
    .waitFor();
  await page.locator(".list-empty").waitFor();
  await page.screenshot({ path: ".cache/preview-ports.png" });
  for (const width of [1120, 420, 380]) {
    await page.setViewportSize({ width, height: 940 });
    assert.equal(
      await page
        .locator(".app")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      `Overflow at ${width}px`,
    );
    await page
      .getByRole("button", { name: "Ayarları aç", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      `Settings overflow at ${width}px`,
    );
    await page
      .getByRole("combobox", { name: "Yenileme aralığı" })
      .selectOption("120");
    assert.equal(
      await page
        .getByRole("combobox", { name: "Yenileme aralığı" })
        .inputValue(),
      "120",
    );
    if (width === 380)
      await page.screenshot({ path: ".cache/preview-settings-380.png" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  await page
    .getByRole("button", { name: "Kompakt görünüm", exact: true })
    .click();
  await page.locator(".compact-bar").waitFor();
  await page.setViewportSize({ width: 420, height: 48 });
  assert.equal(await page.locator(".compact-provider").count(), 3);
  await page.screenshot({ path: ".cache/preview-compact.png" });
  await page
    .getByRole("button", { name: "Paneli genişlet", exact: true })
    .click();
  await page.setViewportSize({ width: 420, height: 740 });
  await page.locator(".mode-panel").waitFor();
  assert.equal(
    await page
      .getByRole("navigation", { name: "Ana gezinme" })
      .getByRole("button")
      .count(),
    2,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".cache/preview-result.json",
    JSON.stringify(
      {
        ok: true,
        runtime: "headless Edge preview",
        checked: [
          "two-navigation-tabs",
          "three-providers",
          "no-agents",
          "no-standalone-claude",
          "honest-empty-quotas",
          "ports-empty-state",
          "settings-save",
          "1120-420-380px-no-overflow",
          "compact48-panel",
          "no-renderer-errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Preview UI passed: quotas, ports, settings, compact/panel, 1120/420/380px, no renderer errors.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
