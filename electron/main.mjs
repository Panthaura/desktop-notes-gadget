import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import * as db from "./db.mjs";
import { pinAsDesktopGadget } from "./gadget.mjs";
import * as i18n from "./i18n.mjs";
import * as jsonStore from "./jsonStore.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorWindows = new Map();
let overlayWindow = null;
let tray = null;
let overlayRaised = false;
let dockTimer = null;
let docking = false;
let ignoreBlur = false;

function isAlwaysOnTop() {
  return db.getMeta("ui.alwaysOnTop") === "1";
}

function clampPreviewSplit(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 38;
  return Math.min(70, Math.max(22, Math.round(next)));
}

function getPreviewSplit() {
  return clampPreviewSplit(db.getMeta("ui.previewSplit") || "38");
}

async function withOverlayNotTop(fn) {
  const wasRaised = overlayRaised || isAlwaysOnTop();
  ignoreBlur = true;
  if (wasRaised) overlayWindow?.setAlwaysOnTop(false);
  try {
    return await fn();
  } finally {
    ignoreBlur = false;
    if (wasRaised && overlayWindow && !overlayWindow.isDestroyed()) {
      raiseOverlay();
    }
  }
}

function raiseOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayRaised = true;
  stopDockLoop();
  overlayWindow.setSkipTaskbar(true);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.moveTop();
  void pinAsDesktopGadget(overlayWindow, "tool").catch(() => undefined);
}

function rendererUrl(query) {
  const encoded = new URLSearchParams(query).toString();
  if (process.env.ELECTRON_START_URL) {
    return `${process.env.ELECTRON_START_URL}/?${encoded}`;
  }
  return path.join(__dirname, "..", "dist", "index.html");
}

function loadRenderer(win, query) {
  if (process.env.ELECTRON_START_URL) {
    void win.loadURL(rendererUrl(query));
    return;
  }
  void win.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function createYellowIcon() {
  const size = 32;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const on = x >= 4 && x < size - 4 && y >= 4 && y < size - 4;
      if (!on) continue;
      const i = 1 + x * 4;
      row[i] = 240;
      row[i + 1] = 201;
      row[i + 2] = 77;
      row[i + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function broadcastBoard() {
  overlayWindow?.webContents.send("board:changed");
  for (const win of editorWindows.values()) {
    win.webContents.send("board:changed");
  }
}

function defaultOverlayBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1080, Math.max(560, workArea.width - 40));
  const height = Math.min(640, Math.max(400, workArea.height - 80));
  return {
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height,
  };
}

function clampBounds(bounds) {
  const minW = 560;
  const minH = 400;
  const next = {
    ...bounds,
    width: Math.max(minW, bounds.width || minW),
    height: Math.max(minH, bounds.height || minH),
  };
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    const overlapX =
      next.x < area.x + area.width - 80 && next.x + Math.min(next.width, 160) > area.x;
    const overlapY = next.y < area.y + area.height - 80 && next.y + 48 > area.y;
    return overlapX && overlapY;
  });
  return visible ? next : defaultOverlayBounds();
}

async function dockOverlay({ force = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed() || docking) return;
  if (!force && isAlwaysOnTop()) {
    raiseOverlay();
    return;
  }
  docking = true;
  overlayRaised = false;
  overlayWindow.setAlwaysOnTop(false);
  overlayWindow.show();
  try {
    await pinAsDesktopGadget(overlayWindow, "bottom");
  } catch (err) {
    console.warn("Desktop-Pin fehlgeschlagen:", err);
  }
  overlayWindow.setSkipTaskbar(true);
  startDockLoop();
  docking = false;
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayRaised && overlayWindow.isFocused()) void dockOverlay({ force: true });
  else raiseOverlay();
}

function startDockLoop() {
  if (dockTimer) return;
  dockTimer = setInterval(() => {
    if (!overlayRaised && overlayWindow && !overlayWindow.isDestroyed()) {
      void pinAsDesktopGadget(overlayWindow, "bottom").catch(() => undefined);
    }
  }, 2500);
}

function stopDockLoop() {
  if (!dockTimer) return;
  clearInterval(dockTimer);
  dockTimer = null;
}

async function createOverlay() {
  const saved = db.getMeta("overlay.bounds");
  const bounds = saved ? clampBounds(JSON.parse(saved)) : defaultOverlayBounds();
  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    resizable: true,
    minWidth: 560,
    minHeight: 400,
    focusable: true,
    roundedCorners: true,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      void dockOverlay();
    }
  });
  overlayWindow.on("moved", saveOverlayBounds);
  overlayWindow.on("resized", saveOverlayBounds);
  overlayWindow.on("blur", () => {
    if (app.isQuitting || docking || ignoreBlur) return;
    if (overlayRaised && !isAlwaysOnTop()) void dockOverlay();
  });
  overlayWindow.on("focus", () => {
    if (app.isQuitting || docking || overlayRaised || isAlwaysOnTop()) return;
    void pinAsDesktopGadget(overlayWindow, "bottom").catch(() => undefined);
  });
  overlayWindow.on("ready-to-show", () => {
    applyOpacity();
    raiseOverlay();
    overlayWindow.setSkipTaskbar(true);
  });
  overlayWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload-Fehler", preloadPath, error);
  });
  overlayWindow.webContents.on("did-finish-load", async () => {
    const hasApi = await overlayWindow.webContents.executeJavaScript("Boolean(window.notesApi)");
    console.log("notesApi geladen:", hasApi);
  });
  loadRenderer(overlayWindow, { window: "overlay" });
}

function saveOverlayBounds() {
  if (!overlayWindow) return;
  db.setMeta("overlay.bounds", JSON.stringify(overlayWindow.getBounds()));
}

function startupVbsPath() {
  return path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "DesktopNotes.vbs",
  );
}

function setOpenAtLogin(enabled) {
  const on = Boolean(enabled);
  db.setMeta("autostart", on ? "1" : "0");
  const vbs = startupVbsPath();
  if (!on) {
    try {
      if (existsSync(vbs)) unlinkSync(vbs);
    } catch {
      // ignore
    }
    try {
      app.setLoginItemSettings({ openAtLogin: false });
    } catch {
      // ignore
    }
    return;
  }
  mkdirSync(path.dirname(vbs), { recursive: true });
  const command = app.isPackaged
    ? `"${process.execPath}"`
    : `cmd /c "${path.join(app.getAppPath(), "start.bat")}"`;
  const escaped = command.replace(/"/g, '""');
  const script = `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "${escaped}", 1, False\r\n`;
  writeFileSync(vbs, script, "ascii");
}

function getOpacity() {
  const raw = Number(db.getMeta("ui.opacity") || "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0.4, raw));
}

function applyOpacity(value = getOpacity()) {
  const opacity = Math.min(1, Math.max(0.4, value));
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(opacity);
  } catch {
    // ignore
  }
  for (const win of editorWindows.values()) {
    try {
      if (!win.isDestroyed()) win.setOpacity(opacity);
    } catch {
      // ignore
    }
  }
}

function setWindowOpacity(value) {
  const opacity = Math.min(1, Math.max(0.4, Number(value) || 1));
  db.setMeta("ui.opacity", String(opacity));
  applyOpacity(opacity);
}

function getOpenAtLogin() {
  return db.getMeta("autostart") === "1" || existsSync(startupVbsPath());
}

async function openEditor(id) {
  const existing = editorWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const note = db.getNote(id);
  const win = new BrowserWindow({
    width: 720,
    height: 780,
    minWidth: 420,
    minHeight: 360,
    title: note?.title || "Notiz",
    backgroundColor: "#14110c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  editorWindows.set(id, win);
  applyOpacity();
  win.on("closed", () => editorWindows.delete(id));
  loadRenderer(win, { window: "editor", id });
}

function registerHotkey() {
  const combos = ["Control+Alt+N", "Control+Shift+N"];
  for (const combo of combos) {
    if (globalShortcut.register(combo, toggleOverlay)) return combo;
  }
  return null;
}

function getSettings() {
  return {
    openAtLogin: getOpenAtLogin(),
    opacity: getOpacity(),
    alwaysOnTop: isAlwaysOnTop(),
    previewSplit: getPreviewSplit(),
    locale: i18n.getLocale(),
    ...jsonStore.getState(),
  };
}

function setAlwaysOnTopEnabled(enabled) {
  db.setMeta("ui.alwaysOnTop", enabled ? "1" : "0");
  if (enabled) raiseOverlay();
}

function setPreviewSplit(value) {
  db.setMeta("ui.previewSplit", String(clampPreviewSplit(value)));
}

function quitApp() {
  app.isQuitting = true;
  overlayRaised = false;
  stopDockLoop();
  try {
    overlayWindow?.setClosable(true);
  } catch {
    // ignore
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }
  try {
    tray?.destroy();
  } catch {
    // ignore
  }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners("close");
      win.destroy();
    } catch {
      // ignore
    }
  }
  app.exit(0);
}

function applyLocale(next) {
  const locale = next === "en" ? "en" : "de";
  db.setMeta("ui.locale", locale);
  db.setMeta("ui.localeChosen", "1");
  i18n.setLocale(locale);
  if (db.syncWelcomeNote(locale)) broadcastBoard();
  refreshTrayMenu();
  overlayWindow?.webContents.send("locale:changed", locale);
  for (const win of editorWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send("locale:changed", locale);
  }
}

async function chooseInitialLocale() {
  const saved = db.getMeta("ui.locale");
  if (db.getMeta("ui.localeChosen") === "1" || saved) {
    i18n.setLocale(saved === "en" ? "en" : "de");
    if (saved) db.setMeta("ui.localeChosen", "1");
    return;
  }
  if (!app.isPackaged) {
    i18n.setLocale("de");
    return;
  }
  const result = await dialog.showMessageBox({
    type: "question",
    noLink: true,
    title: "Desktop Notes",
    message: "Sprache wählen / Choose language",
    detail:
      "Welche Sprache soll Desktop Notes verwenden?\nWhich language should Desktop Notes use?\n\nDu kannst das später in den Einstellungen ändern.\nYou can change this later in Settings.",
    buttons: ["Deutsch", "English"],
    defaultId: 0,
    cancelId: 0,
  });
  const locale = result.response === 1 ? "en" : "de";
  db.setMeta("ui.locale", locale);
  db.setMeta("ui.localeChosen", "1");
  i18n.setLocale(locale);
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setToolTip("Desktop Notes");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: i18n.t("trayShow", "Overlay einblenden"), click: () => raiseOverlay() },
      {
        label: i18n.t("trayNewNote", "Neue Notiz"),
        click: async () => {
          raiseOverlay();
          const note = db.createNote(null);
          broadcastBoard();
          await openEditor(note.id);
        },
      },
      { type: "separator" },
      {
        label: i18n.t("trayQuit", "Beenden"),
        click: () => quitApp(),
      },
    ]),
  );
}

function createTray() {
  const image = createYellowIcon();
  tray = new Tray(image);
  refreshTrayMenu();
  tray.on("click", () => raiseOverlay());
  tray.on("double-click", () => raiseOverlay());
}

function registerIpc() {
  ipcMain.handle("board:get", () => db.getBoard());
  ipcMain.handle("notes:create", (_e, groupId) => {
    const note = db.createNote(groupId);
    broadcastBoard();
    return note;
  });
  ipcMain.handle("notes:update", (_e, patch) => {
    const note = db.updateNote(patch);
    if (!note) return null;
    const editor = editorWindows.get(patch.id);
    if (editor && !editor.isDestroyed()) editor.setTitle(note.title);
    broadcastBoard();
    return note;
  });
  ipcMain.handle("notes:delete", (_e, id) => {
    db.deleteNote(id);
    const editor = editorWindows.get(id);
    if (editor && !editor.isDestroyed()) editor.close();
    broadcastBoard();
  });
  ipcMain.handle("notes:get", (_e, id) => db.getNote(id));
  ipcMain.handle("notes:copy", (_e, id) => {
    const note = db.getNote(id);
    if (!note) return false;
    const body = note.body ?? "";
    const text =
      note.titleIsManual && body && !body.startsWith(note.title)
        ? `${note.title}\n\n${body}`
        : body || note.title;
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("clipboard:write", (_e, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.handle("shell:open", async (_e, url) => {
    if (typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("groups:create", (_e, name) => {
    const group = db.createGroup(name);
    broadcastBoard();
    return group;
  });
  ipcMain.handle("groups:rename", (_e, { id, name }) => {
    db.renameGroup(id, name);
    broadcastBoard();
  });
  ipcMain.handle("groups:delete", (_e, id) => {
    const removed = db.deleteGroup(id);
    broadcastBoard();
    return removed;
  });
  ipcMain.handle("groups:reorder", (_e, ids) => {
    db.reorderGroups(ids);
    broadcastBoard();
  });
  ipcMain.handle("notes:move", (_e, { id, groupId, index }) => {
    db.moveNote(id, groupId, index);
    broadcastBoard();
  });
  ipcMain.handle("editor:open", (_e, id) => openEditor(id));
  ipcMain.handle("overlay:hide", () => dockOverlay({ force: true }));
  ipcMain.handle("overlay:raise", () => raiseOverlay());
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:setOpenAtLogin", (_e, enabled) => {
    setOpenAtLogin(enabled);
    return getSettings();
  });
  ipcMain.handle("settings:setAutoSave", (_e, enabled) => {
    jsonStore.setAutoSave(enabled);
    return getSettings();
  });
  ipcMain.handle("settings:setOpacity", (_e, value) => {
    setWindowOpacity(value);
    return getSettings();
  });
  ipcMain.handle("settings:setAlwaysOnTop", (_e, enabled) => {
    setAlwaysOnTopEnabled(Boolean(enabled));
    return getSettings();
  });
  ipcMain.handle("settings:setPreviewSplit", (_e, value) => {
    setPreviewSplit(value);
    return getSettings();
  });
  ipcMain.handle("settings:chooseJsonPath", async (_e, createNew) => {
    const result = await withOverlayNotTop(() =>
      jsonStore.chooseJsonPath(overlayWindow, { createNew: Boolean(createNew) }),
    );
    broadcastBoard();
    return result;
  });
  ipcMain.handle("settings:setLocale", (_e, locale) => {
    applyLocale(locale);
    return getSettings();
  });
  ipcMain.handle("dialog:confirm", async (event, payload) => {
    return withOverlayNotTop(async () => {
      const parent = BrowserWindow.fromWebContents(event.sender) || overlayWindow;
      const result = await dialog.showMessageBox(parent ?? undefined, {
        type: "question",
        buttons: [i18n.t("cancel", "Abbrechen"), payload?.ok || i18n.t("ok", "OK")],
        defaultId: 1,
        cancelId: 0,
        title: payload?.title || i18n.t("confirm", "Bestätigen"),
        message: payload?.message || "",
      });
      return result.response === 1;
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    raiseOverlay();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("desktop.notes.gadget");
    await db.openDatabase(app.getPath("userData"));
    db.setOnChange(() => jsonStore.scheduleWrite());
    jsonStore.initJsonStore({
      defaultPath: path.join(app.getPath("documents"), "Desktop Notes", "notes.json"),
      onExternal: () => broadcastBoard(),
    });
    await chooseInitialLocale();
    db.seedIfEmpty();
    db.migrateUngroupedNotes();
    db.syncWelcomeNote(i18n.getLocale());
    if (db.getMeta("autostart") === "1") setOpenAtLogin(true);
    jsonStore.scheduleWrite();
    registerIpc();
    await createOverlay();
    createTray();
    const hotkey = registerHotkey();
    if (!hotkey) {
      console.warn("Hotkey konnte nicht registriert werden. Overlay über das Tray einblenden.");
    }
  });
}

app.on("before-quit", (event) => {
  if (app.isQuitting) return;
  event.preventDefault();
  quitApp();
});

app.on("will-quit", () => {
  app.isQuitting = true;
  stopDockLoop();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Overlay bleibt versteckt im Tray leben.
});
