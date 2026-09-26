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

function portableDir() {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  return dir && typeof dir === "string" ? dir : "";
}

function appInstallDir() {
  if (portableDir()) return portableDir();
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, "..");
}

function defaultDatabasePath() {
  // Prefer Documents — install dir can be write-protected on some setups.
  try {
    return path.join(app.getPath("documents"), "Desktop Notes", "notes.json");
  } catch {
    return path.join(appInstallDir(), "notes.json");
  }
}

const portableRoot = portableDir();
if (portableRoot) {
  const userData = path.join(portableRoot, "data");
  mkdirSync(userData, { recursive: true });
  app.setPath("userData", userData);
}
const editorWindows = new Map();
let overlayWindow = null;
let ctxMenuWindow = null;
let tray = null;
let overlayRaised = false;
let dockTimer = null;
let focusWatch = null;
let dockCheckTimer = null;
let docking = false;
let ignoreBlur = false;
let pinGeneration = 0;
/** After raiseOverlay: don't auto-dock until this timestamp (ms). Prevents "invisible app" on start. */
let raiseHoldUntil = 0;

function beginRaiseHold(ms = 2800) {
  raiseHoldUntil = Date.now() + ms;
}

function isRaiseHoldActive() {
  return Date.now() < raiseHoldUntil;
}

function isAlwaysOnTop() {
  return db.getMeta("ui.alwaysOnTop") === "1";
}

const DEFAULT_COLOR_BG = "#14110c";
const DEFAULT_COLOR_ACCENT = "#f0c94d";
const DEFAULT_COLOR_BLINK = "#e23d3d";

function normalizeHex(value, fallback) {
  const raw = String(value || "").trim();
  const short = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = raw.match(/^#([0-9a-fA-F]{6})$/);
  return full ? `#${full[1].toLowerCase()}` : fallback;
}

function getColors() {
  return {
    colorBg: normalizeHex(db.getMeta("ui.colorBg"), DEFAULT_COLOR_BG),
    colorAccent: normalizeHex(db.getMeta("ui.colorAccent"), DEFAULT_COLOR_ACCENT),
    colorBlink: normalizeHex(db.getMeta("ui.colorBlink"), DEFAULT_COLOR_BLINK),
  };
}

function mixHex(a, b, amount) {
  const parse = (hex) => {
    const h = normalizeHex(hex, "#000000").slice(1);
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
    };
  };
  const from = parse(a);
  const to = parse(b);
  const byte = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");
  return `#${byte(from.r + (to.r - from.r) * amount)}${byte(from.g + (to.g - from.g) * amount)}${byte(
    from.b + (to.b - from.b) * amount,
  )}`;
}

function notePaperBackground(note) {
  const colors = getColors();
  const custom = typeof note?.color === "string" ? note.color.trim() : "";
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(custom)) return custom;
  // Match renderer --card (accent mixed toward white).
  return mixHex(colors.colorAccent, "#ffffff", 0.16);
}

function syncEditorBackground(win, note) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setBackgroundColor(notePaperBackground(note));
  } catch {
    // ignore
  }
}

function setColors(patch = {}) {
  if (patch.colorBg != null) db.setMeta("ui.colorBg", normalizeHex(patch.colorBg, DEFAULT_COLOR_BG));
  if (patch.colorAccent != null) {
    db.setMeta("ui.colorAccent", normalizeHex(patch.colorAccent, DEFAULT_COLOR_ACCENT));
  }
  if (patch.colorBlink != null) {
    db.setMeta("ui.colorBlink", normalizeHex(patch.colorBlink, DEFAULT_COLOR_BLINK));
  }
  const next = getColors();
  for (const [id, win] of editorWindows.entries()) {
    if (win.isDestroyed()) continue;
    syncEditorBackground(win, db.getNote(id));
  }
  overlayWindow?.webContents.send("theme:changed", next);
  for (const win of editorWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send("theme:changed", next);
  }
  return next;
}

function isAppFocused() {
  try {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused()) return true;
  } catch {
    // ignore
  }
  for (const win of editorWindows.values()) {
    try {
      if (!win.isDestroyed() && win.isFocused()) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function syncEditorLayer() {
  const onTop = overlayRaised || isAlwaysOnTop();
  for (const win of editorWindows.values()) {
    if (win.isDestroyed()) continue;
    try {
      if (onTop) win.setAlwaysOnTop(true, "screen-saver");
      else win.setAlwaysOnTop(false);
    } catch {
      // ignore
    }
  }
}

function scheduleDockCheck() {
  if (dockCheckTimer) clearTimeout(dockCheckTimer);
  dockCheckTimer = setTimeout(() => {
    dockCheckTimer = null;
    if (app.isQuitting || docking || ignoreBlur || isRaiseHoldActive()) return;
    if (!overlayRaised || isAlwaysOnTop()) return;
    if (isAppFocused()) return;
    void dockOverlay();
  }, 180);
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

function clearAlwaysOnTop() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try {
    overlayWindow.setAlwaysOnTop(false);
    if (overlayWindow.isAlwaysOnTop()) {
      overlayWindow.setAlwaysOnTop(true, "normal");
      overlayWindow.setAlwaysOnTop(false);
    }
  } catch {
    // ignore
  }
}

function raiseOverlay({ focusOverlay = true, holdMs = 2800 } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  pinGeneration += 1;
  overlayRaised = true;
  beginRaiseHold(holdMs);
  stopDockLoop();
  // While raised, show a taskbar entry so the app is discoverable (docked mode hides it again).
  overlayWindow.setSkipTaskbar(false);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  if (focusOverlay) {
    overlayWindow.focus();
    overlayWindow.moveTop();
  }
  syncEditorLayer();
  if (!focusOverlay) {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && focused !== overlayWindow && !focused.isDestroyed()) {
      try {
        focused.setAlwaysOnTop(true, "screen-saver");
        focused.moveTop();
        focused.focus();
      } catch {
        // ignore
      }
    }
  }
  if (!isAlwaysOnTop()) startFocusWatch();
  else stopFocusWatch();
  // "raise" clears TOOLWINDOW / sets APPWINDOW so setSkipTaskbar(false) can stick.
  void pinAsDesktopGadget(overlayWindow, "raise").catch(() => undefined);
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
  const minW = 220;
  const minH = 200;
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
  restoreOverlayMenuSpace();
  if (!force && isAlwaysOnTop()) {
    raiseOverlay();
    return;
  }
  docking = true;
  overlayRaised = false;
  raiseHoldUntil = 0;
  stopFocusWatch();
  clearAlwaysOnTop();
  overlayWindow.show();
  const gen = ++pinGeneration;
  try {
    await pinAsDesktopGadget(overlayWindow, "bottom");
  } catch (err) {
    console.warn("Desktop-Pin fehlgeschlagen:", err);
  } finally {
    if (gen === pinGeneration && !overlayRaised && overlayWindow && !overlayWindow.isDestroyed()) {
      clearAlwaysOnTop();
      overlayWindow.setSkipTaskbar(true);
      startDockLoop();
    }
    docking = false;
  }
  syncEditorLayer();
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

function startFocusWatch() {
  if (focusWatch) return;
  let missed = 0;
  focusWatch = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (!overlayRaised || isAlwaysOnTop() || docking || ignoreBlur || isRaiseHoldActive()) {
      missed = 0;
      return;
    }
    if (overlayWindow.isFocused() || isAppFocused()) {
      missed = 0;
      return;
    }
    missed += 1;
    // ~1.2s without focus before docking (was ~400ms and hid the app on launch)
    if (missed >= 6) void dockOverlay();
  }, 200);
}

function stopFocusWatch() {
  if (!focusWatch) return;
  clearInterval(focusWatch);
  focusWatch = null;
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
    minWidth: 220,
    minHeight: 200,
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
  overlayWindow.on("will-resize", () => {
    if (overlayUserResizing) return;
    overlayUserResizing = true;
  });
  overlayWindow.on("resized", () => {
    overlayUserResizing = false;
    saveOverlayBounds();
    try {
      overlayWindow.webContents.send("overlay:resized");
    } catch {
      // ignore
    }
  });
  overlayWindow.on("blur", () => {
    if (app.isQuitting || docking || ignoreBlur || isRaiseHoldActive()) return;
    if (overlayRaised && !isAlwaysOnTop()) scheduleDockCheck();
  });
  overlayWindow.on("focus", () => {
    if (app.isQuitting || docking || overlayRaised || isAlwaysOnTop()) return;
    void pinAsDesktopGadget(overlayWindow, "bottom").catch(() => undefined);
  });
  overlayWindow.on("ready-to-show", () => {
    applyOpacity();
    // Longer hold on cold start so Autostart / Explorer focus doesn't pin it behind immediately.
    raiseOverlay({ holdMs: 4500 });
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
  // Window stays fully opaque so settings/dialogs can render solid.
  // Visual transparency is applied in the renderer via CSS on .overlay-fade.
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(1);
  } catch {
    // ignore
  }
  for (const win of editorWindows.values()) {
    try {
      if (!win.isDestroyed()) win.setOpacity(1);
    } catch {
      // ignore
    }
  }
  const opacity = Math.min(1, Math.max(0.4, value));
  try {
    overlayWindow?.webContents.send("opacity:changed", opacity);
  } catch {
    // ignore
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
  ignoreBlur = true;
  const releaseBlur = () => {
    setTimeout(() => {
      ignoreBlur = false;
    }, 400);
  };
  const existing = editorWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (!overlayRaised && !isAlwaysOnTop()) raiseOverlay({ focusOverlay: false });
    else syncEditorLayer();
    existing.show();
    existing.focus();
    releaseBlur();
    return;
  }
  const note = db.getNote(id);
  const win = new BrowserWindow({
    width: 720,
    height: 780,
    minWidth: 420,
    minHeight: 360,
    title: note?.title || "Notiz",
    backgroundColor: notePaperBackground(note),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  editorWindows.set(id, win);
  try {
    win.setOpacity(1);
  } catch {
    // ignore
  }
  applyOpacity();
  if (overlayRaised || isAlwaysOnTop()) {
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      // ignore
    }
  } else {
    raiseOverlay({ focusOverlay: false });
  }
  win.on("closed", () => editorWindows.delete(id));
  win.on("blur", () => scheduleDockCheck());
  win.on("focus", () => {
    if (app.isQuitting || docking) return;
    if (!overlayRaised && !isAlwaysOnTop()) raiseOverlay({ focusOverlay: false });
  });
  loadRenderer(win, { window: "editor", id });
  win.once("ready-to-show", releaseBlur);
  setTimeout(releaseBlur, 800);
}

function registerHotkey() {
  const combos = ["Control+Alt+N", "Control+Shift+N"];
  for (const combo of combos) {
    if (globalShortcut.register(combo, toggleOverlay)) return combo;
  }
  return null;
}

function getAppVersion() {
  try {
    return app.getVersion() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getSettings() {
  return {
    openAtLogin: getOpenAtLogin(),
    opacity: getOpacity(),
    alwaysOnTop: isAlwaysOnTop(),
    previewSplit: getPreviewSplit(),
    compact: db.getMeta("ui.compact") === "1",
    compactLocked: db.getMeta("ui.compactLocked") === "1",
    locale: i18n.getLocale(),
    appVersion: getAppVersion(),
    ...getColors(),
    ...jsonStore.getState(),
  };
}

function setAlwaysOnTopEnabled(enabled) {
  db.setMeta("ui.alwaysOnTop", enabled ? "1" : "0");
  if (enabled) {
    raiseOverlay();
    return;
  }
  if (overlayRaised) startFocusWatch();
}

function setPreviewSplit(value) {
  db.setMeta("ui.previewSplit", String(clampPreviewSplit(value)));
}

function setCompactMode(enabled, { locked = false } = {}) {
  const on = Boolean(enabled);
  db.setMeta("ui.compact", on ? "1" : "0");
  db.setMeta("ui.compactLocked", on && locked ? "1" : "0");
}

/** Note card max (260) + equal L/R chrome (border+board+cards pads). */
const COMPACT_MIN_WIDTH = 290;
/** 2 notes × 48 + gap 9 + bar ~32 + pads ~24 ≈ 161; floor at 160. */
const COMPACT_MIN_HEIGHT = 160;
/** Keep low so the window can shrink into auto-compact (< 400×300). */
const DEFAULT_MIN_WIDTH = 220;
const DEFAULT_MIN_HEIGHT = 200;

/** True while the user is interactively resizing the overlay (will-resize → resized). */
let overlayUserResizing = false;

function shrinkOverlayToNotes(size) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  // Don't fight an open context-menu resize.
  if (menuSpaceBackup) return;
  const bounds = overlayWindow.getBounds();
  const preferredWidth = Math.max(
    COMPACT_MIN_WIDTH,
    Math.round(Number(size?.width) || COMPACT_MIN_WIDTH),
  );
  const minHeight = Math.max(
    COMPACT_MIN_HEIGHT,
    Math.round(Number(size?.minHeight) || COMPACT_MIN_HEIGHT),
  );
  const preferredHeight = Math.max(minHeight, Math.round(Number(size?.height) || minHeight));
  const forceHeight = Boolean(size?.forceHeight);
  // Always allow at least 2-note height / note width; never use preferred width as a hard max.
  overlayWindow.setMinimumSize(COMPACT_MIN_WIDTH, minHeight);

  // setBounds during an active user drag makes Windows snap back on mouse-up — skip.
  if (overlayUserResizing) {
    return;
  }

  let width = bounds.width;
  let height = bounds.height;
  if (forceHeight) {
    width = bounds.width > preferredWidth ? bounds.width : preferredWidth;
    height = preferredHeight;
  } else {
    // Auto-compact: only lift true floors, never snap to preferred fit size.
    if (width < COMPACT_MIN_WIDTH) width = COMPACT_MIN_WIDTH;
    if (height < minHeight) height = minHeight;
  }
  const nextBounds = clampBounds({ ...bounds, width, height });
  if (bounds.width === nextBounds.width && bounds.height === nextBounds.height) return;
  overlayWindow.setBounds(nextBounds);
}

function clearCompactMode() {
  setCompactMode(false);
  if (!overlayWindow || overlayWindow.isDestroyed()) return getSettings();
  overlayWindow.setMinimumSize(DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT);
  return getSettings();
}

function expandOverlayChrome() {
  clearCompactMode();
  if (!overlayWindow || overlayWindow.isDestroyed()) return getSettings();
  const bounds = overlayWindow.getBounds();
  const width = Math.max(bounds.width, 640);
  const height = Math.max(bounds.height, 480);
  if (width !== bounds.width || height !== bounds.height) {
    overlayWindow.setBounds(clampBounds({ ...bounds, width, height }));
  }
  return getSettings();
}

/** Backup of overlay bounds while a context menu needs extra room. */
let menuSpaceBackup = null;

function fitOverlayMenuSpace(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  const menuLeft = Number(payload?.menuLeft) || 0;
  const menuTop = Number(payload?.menuTop) || 0;
  const menuWidth = Math.ceil(Number(payload?.menuWidth) || 0);
  const menuHeight = Math.ceil(Number(payload?.menuHeight) || 0);
  if (menuWidth < 8 || menuHeight < 8) return null;

  if (!menuSpaceBackup) {
    menuSpaceBackup = overlayWindow.getBounds();
  }
  const base = menuSpaceBackup;
  const pad = 12;
  let width = Math.max(base.width, Math.ceil(menuLeft + menuWidth + pad));
  let height = Math.max(base.height, Math.ceil(menuTop + menuHeight + pad));
  let x = base.x;
  let y = base.y;

  const display = screen.getDisplayMatching({
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
  });
  const wa = display.workArea;
  width = Math.min(width, wa.width);
  height = Math.min(height, wa.height);
  if (x + width > wa.x + wa.width) x = wa.x + wa.width - width;
  if (y + height > wa.y + wa.height) y = wa.y + wa.height - height;
  if (x < wa.x) x = wa.x;
  if (y < wa.y) y = wa.y;

  overlayWindow.setBounds({ x, y, width, height });
  return { x, y, width, height };
}

function restoreOverlayMenuSpace() {
  if (!menuSpaceBackup) return;
  const backup = menuSpaceBackup;
  menuSpaceBackup = null;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(backup);
}

function closeCtxMenu() {
  ignoreBlur = false;
  if (!ctxMenuWindow || ctxMenuWindow.isDestroyed()) {
    ctxMenuWindow = null;
    return;
  }
  try {
    if (ctxMenuWindow.isVisible()) ctxMenuWindow.hide();
  } catch {
    // ignore
  }
}

function clampCtxMenuBounds(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const wa = display.workArea;
  const w = Math.min(Math.max(160, width), wa.width);
  const h = Math.min(Math.max(80, height), wa.height);
  let nextX = Math.round(x);
  let nextY = Math.round(y);
  if (nextX + w > wa.x + wa.width) nextX = wa.x + wa.width - w;
  if (nextY + h > wa.y + wa.height) nextY = wa.y + wa.height - h;
  if (nextX < wa.x) nextX = wa.x;
  if (nextY < wa.y) nextY = wa.y;
  return { x: nextX, y: nextY, width: w, height: h };
}

let ctxMenuReady = false;
let ctxMenuLoadPromise = null;
let pendingCtxPresent = null;
/** Bumps on each open so stale blur-timeouts don't close a freshly opened menu. */
let ctxMenuEpoch = 0;
let ctxMenuReleaseBlurTimer = null;

function armCtxMenuBlurGuard(ms = 350) {
  ignoreBlur = true;
  if (ctxMenuReleaseBlurTimer) {
    clearTimeout(ctxMenuReleaseBlurTimer);
    ctxMenuReleaseBlurTimer = null;
  }
  ctxMenuReleaseBlurTimer = setTimeout(() => {
    ctxMenuReleaseBlurTimer = null;
    ignoreBlur = false;
  }, ms);
}

function ensureCtxMenuWindow() {
  if (ctxMenuWindow && !ctxMenuWindow.isDestroyed()) {
    return ctxMenuLoadPromise || Promise.resolve(ctxMenuWindow);
  }
  ctxMenuReady = false;
  pendingCtxPresent = null;
  ctxMenuWindow = new BrowserWindow({
    width: 260,
    height: 360,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  ctxMenuWindow.setMenuBarVisibility(false);
  try {
    ctxMenuWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {
    // ignore
  }
  ctxMenuWindow.on("blur", () => {
    const epoch = ctxMenuEpoch;
    setTimeout(() => {
      if (epoch !== ctxMenuEpoch) return;
      if (ignoreBlur) return;
      if (!ctxMenuWindow || ctxMenuWindow.isDestroyed()) return;
      if (!ctxMenuWindow.isVisible()) return;
      if (ctxMenuWindow.isFocused()) return;
      closeCtxMenu();
    }, 150);
  });
  ctxMenuWindow.on("closed", () => {
    ctxMenuWindow = null;
    ctxMenuReady = false;
    ctxMenuLoadPromise = null;
    pendingCtxPresent = null;
    ignoreBlur = false;
    if (ctxMenuReleaseBlurTimer) {
      clearTimeout(ctxMenuReleaseBlurTimer);
      ctxMenuReleaseBlurTimer = null;
    }
  });
  ctxMenuLoadPromise = new Promise((resolve) => {
    ctxMenuWindow.webContents.once("did-finish-load", () => {
      ctxMenuReady = true;
      resolve(ctxMenuWindow);
    });
    loadRenderer(ctxMenuWindow, { window: "ctxmenu" });
  });
  return ctxMenuLoadPromise;
}

function presentCtxMenu(payload = {}) {
  if (!ctxMenuWindow || ctxMenuWindow.isDestroyed()) return;
  const kind = payload.kind === "shell" ? "shell" : "note";
  const noteId = String(payload.noteId || payload.note?.id || "");
  const note =
    kind === "note"
      ? payload.note && payload.note.id
        ? payload.note
        : db.getNote(noteId)
      : null;
  const colors = getColors();
  const width = kind === "shell" ? 200 : 260;
  const height = kind === "shell" ? 160 : 360;
  const bounds = clampCtxMenuBounds(
    Number(payload.x) || 0,
    Number(payload.y) || 0,
    width,
    height,
  );
  ctxMenuWindow.setBounds(bounds);
  pendingCtxPresent = {
    kind,
    note,
    colors,
    locale: i18n.getLocale(),
    x: bounds.x,
    y: bounds.y,
  };
  try {
    ctxMenuWindow.webContents.send("ctxmenu:present", pendingCtxPresent);
  } catch {
    // ignore
  }
}

async function openCtxMenu(payload = {}) {
  // Cancel any pending "close because blurred" from the previous menu instance.
  ctxMenuEpoch += 1;
  armCtxMenuBlurGuard(400);
  try {
    await ensureCtxMenuWindow();
    presentCtxMenu(payload);
  } catch {
    ignoreBlur = false;
  }
}

function showCtxMenuAt(size = {}) {
  if (!ctxMenuWindow || ctxMenuWindow.isDestroyed()) return null;
  const current = ctxMenuWindow.getBounds();
  const width = Math.ceil(Number(size.width) || current.width);
  const height = Math.ceil(Number(size.height) || current.height);
  const next = clampCtxMenuBounds(current.x, current.y, width + 4, height + 4);
  ctxMenuWindow.setBounds(next);
  armCtxMenuBlurGuard(400);
  if (!ctxMenuWindow.isVisible()) {
    ctxMenuWindow.show();
  }
  try {
    ctxMenuWindow.focus();
  } catch {
    // ignore
  }
  return next;
}

function resizeCtxMenu(size = {}) {
  return showCtxMenuAt(size);
}

function prefetchCtxMenu() {
  void ensureCtxMenuWindow().catch(() => undefined);
}

let reminderTimer = null;

function stopReminderWatch() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

function checkDueReminders() {
  const fired = db.fireDueReminders();
  if (!fired.length) return;
  broadcastBoard();
  raiseOverlay({ holdMs: 8000 });
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("reminders:fired", {
        count: fired.length,
        title: fired[0]?.title || "",
      });
    }
  } catch {
    // ignore
  }
}

function startReminderWatch() {
  stopReminderWatch();
  checkDueReminders();
  reminderTimer = setInterval(checkDueReminders, 15_000);
}

function quitApp() {
  app.isQuitting = true;
  overlayRaised = false;
  closeCtxMenu();
  restoreOverlayMenuSpace();
  stopReminderWatch();
  stopDockLoop();
  stopFocusWatch();
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
  const version = getAppVersion();
  tray.setToolTip(`Desktop Notes ${version}`);
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
        label: i18n.t("trayVersion", "Version {version}", { version }),
        enabled: false,
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
  const candidates = [
    path.join(process.resourcesPath || "", "icon.png"),
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(appInstallDir(), "resources", "icon.png"),
  ];
  let image = null;
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const loaded = nativeImage.createFromPath(file);
    if (!loaded.isEmpty()) {
      image = loaded.resize({ width: 32, height: 32 });
      break;
    }
  }
  if (!image || image.isEmpty()) image = createYellowIcon();
  tray = new Tray(image);
  tray.setToolTip(`Desktop Notes ${getAppVersion()}`);
  refreshTrayMenu();
  tray.on("click", () => raiseOverlay({ holdMs: 3500 }));
  tray.on("double-click", () => raiseOverlay({ holdMs: 3500 }));
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
    if (editor && !editor.isDestroyed()) {
      editor.setTitle(note.title);
      if (patch.color !== undefined) syncEditorBackground(editor, note);
    }
    broadcastBoard();
    return note;
  });
  ipcMain.handle("notes:delete", (_e, id) => {
    db.deleteNote(id);
    const editor = editorWindows.get(id);
    if (editor && !editor.isDestroyed()) editor.close();
    broadcastBoard();
  });
  ipcMain.handle("notes:archived", () => db.listArchivedNotes());
  ipcMain.handle("notes:restore", (_e, id) => {
    const note = db.restoreNote(id);
    broadcastBoard();
    return note;
  });
  ipcMain.handle("notes:purge", (_e, id) => {
    const ok = db.purgeNote(id);
    if (ok) broadcastBoard();
    return ok;
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
  ipcMain.handle("overlay:setCompact", (_e, payload) => {
    const enabled = Boolean(payload?.enabled);
    setCompactMode(enabled, { locked: Boolean(payload?.locked) });
    if (enabled && (payload?.width || payload?.height || payload?.minHeight || payload?.forceHeight)) {
      shrinkOverlayToNotes(payload);
    }
    return getSettings();
  });
  ipcMain.handle("overlay:clearCompact", () => clearCompactMode());
  ipcMain.handle("overlay:expandChrome", () => expandOverlayChrome());
  ipcMain.handle("overlay:fitMenuSpace", (_e, payload) => fitOverlayMenuSpace(payload));
  ipcMain.handle("overlay:restoreMenuSpace", () => {
    restoreOverlayMenuSpace();
  });
  ipcMain.handle("ctxmenu:open", async (_e, payload) => {
    await openCtxMenu(payload || {});
  });
  ipcMain.handle("ctxmenu:close", () => {
    closeCtxMenu();
  });
  ipcMain.handle("ctxmenu:resize", (_e, size) => resizeCtxMenu(size || {}));
  ipcMain.handle("ctxmenu:ready", (_e, size) => showCtxMenuAt(size || {}));
  ipcMain.handle("ctxmenu:takePresent", () => pendingCtxPresent);
  ipcMain.handle("overlay:openSettings", () => {
    raiseOverlay({ holdMs: 5000 });
    try {
      overlayWindow?.webContents.send("overlay:open-settings");
    } catch {
      // ignore
    }
  });
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:setOpenAtLogin", (_e, enabled) => {
    setOpenAtLogin(enabled);
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
  ipcMain.handle("settings:chooseJsonPath", async () => {
    const result = await withOverlayNotTop(() => jsonStore.chooseJsonPath(overlayWindow));
    broadcastBoard();
    return result;
  });
  ipcMain.handle("backups:list", () => jsonStore.listBackups());
  ipcMain.handle("backups:restore", (_e, id) => {
    const result = jsonStore.restoreBackup(id);
    if (result.ok) broadcastBoard();
    return result;
  });
  ipcMain.handle("backups:create", () => jsonStore.createBackup());
  ipcMain.handle("backups:setSchedule", (_e, patch) => {
    jsonStore.setBackupSchedule(patch);
    return getSettings();
  });
  ipcMain.handle("settings:setLocale", (_e, locale) => {
    applyLocale(locale);
    return getSettings();
  });
  ipcMain.handle("settings:setColors", (_e, patch) => {
    setColors(patch);
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
    raiseOverlay({ holdMs: 4000 });
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("desktop.notes.gadget");
    await db.openDatabase(app.getPath("userData"));
    db.migrateNoteExtras();
    db.setOnChange(() => jsonStore.scheduleWrite());
    jsonStore.initJsonStore({
      defaultPath: defaultDatabasePath(),
      onExternal: () => broadcastBoard(),
    });
    await chooseInitialLocale();
    db.seedIfEmpty();
    db.migrateUngroupedNotes();
    db.migrateDefaultGroup();
    db.syncWelcomeNote(i18n.getLocale());
    if (db.getMeta("autostart") === "1") setOpenAtLogin(true);
    jsonStore.scheduleWrite();
    registerIpc();
    await createOverlay();
    createTray();
    startReminderWatch();
    prefetchCtxMenu();
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
  stopFocusWatch();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Overlay bleibt versteckt im Tray leben.
});
