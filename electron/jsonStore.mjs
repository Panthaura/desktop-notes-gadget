import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import * as db from "./db.mjs";
import { dateLocale, t } from "./i18n.mjs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SIX_MONTH_MS = 182 * 24 * 60 * 60 * 1000;

let jsonPath = "";
let autoSave = true;
let writing = false;
let lastWriteAt = 0;
let lastHash = "";
let timer = null;
let watcher = null;
let onExternalChange = null;

export function getState() {
  return { jsonPath, autoSave };
}

export function initJsonStore({ defaultPath, onExternal }) {
  onExternalChange = onExternal;
  autoSave = db.getMeta("json.autoSave", "1") !== "0";
  jsonPath = db.getMeta("json.path") || defaultPath;
  if (!db.getMeta("json.path")) db.setMeta("json.path", jsonPath);

  const empty = db.isBoardEmpty();
  if (existsSync(jsonPath)) {
    if (empty) loadFromDisk({ replace: true });
    else mergeFromDisk();
  }
  if (autoSave) writeNow();
  else rotateBackups();
  startWatch();
}

export function setAutoSave(enabled) {
  autoSave = Boolean(enabled);
  db.setMeta("json.autoSave", autoSave ? "1" : "0");
  if (autoSave) writeNow();
}

export function scheduleWrite() {
  if (!autoSave || !jsonPath) return;
  clearTimeout(timer);
  timer = setTimeout(() => writeNow(), 250);
}

export async function chooseJsonPath(parent, { createNew = false } = {}) {
  let nextPath = "";
  if (createNew) {
    const target = await dialog.showSaveDialog(parent ?? undefined, {
      title: t("jsonCreateTitle", "Neue JSON-Datei anlegen"),
      defaultPath: jsonPath || "notes.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) {
      return { ...getState(), cancelled: true };
    }
    nextPath = target.filePath;
  } else {
    const target = await dialog.showOpenDialog(parent ?? undefined, {
      title: t("jsonOpenTitle", "JSON-Datei zum Import wählen"),
      defaultPath: jsonPath || "notes.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (target.canceled || !target.filePaths?.[0]) {
      return { ...getState(), cancelled: true };
    }
    nextPath = target.filePaths[0];
  }

  let snapshot = null;
  let prefer = "newer";
  let imported = false;
  let conflicts = 0;

  if (existsSync(nextPath)) {
    try {
      snapshot = JSON.parse(readFileSync(nextPath, "utf8"));
    } catch (err) {
      console.warn("JSON konnte nicht gelesen werden:", err);
      await dialog.showMessageBox(parent ?? undefined, {
        type: "error",
        title: t("jsonInvalid", "JSON ungültig"),
        message: t("jsonUnreadable", "Die vorhandene Datei konnte nicht gelesen werden."),
        buttons: [t("ok", "OK")],
      });
      return { ...getState(), cancelled: true };
    }
    if (!snapshot?.notes && !snapshot?.groups) {
      await dialog.showMessageBox(parent ?? undefined, {
        type: "error",
        title: t("jsonInvalid", "JSON ungültig"),
        message: t("jsonEmpty", "Die Datei enthält keine Notizen oder Gruppen."),
        buttons: [t("ok", "OK")],
      });
      return { ...getState(), cancelled: true };
    }

    const found = db.findNoteConflicts(snapshot.notes ?? []);
    conflicts = found.length;
    if (found.length) {
      const lines = found.slice(0, 6).map((item) => {
        const here = formatStamp(item.localUpdatedAt);
        const file = formatStamp(item.remoteUpdatedAt);
        return `„${item.title}“\n  ${t("jsonCurrent", "Aktuell: {date}", { date: here })}\n  ${t("jsonFile", "Datei: {date}", { date: file })}`;
      });
      const extra =
        found.length > 6
          ? `\n${t("jsonMore", "… und {count} weitere", { count: found.length - 6 })}`
          : "";
      const choice = await dialog.showMessageBox(parent ?? undefined, {
        type: "question",
        title: t("jsonDuplicates", "Doppelte Notizen"),
        message:
          found.length === 1
            ? t("jsonDuplicatesOne", "1 Notiz existiert bereits. Welche Version behalten?")
            : t("jsonDuplicatesMany", "{count} Notizen existieren bereits. Welche Version behalten?", {
                count: found.length,
              }),
        detail: `${lines.join("\n\n")}${extra}`,
        buttons: [
          t("keepNewer", "Neuere behalten"),
          t("keepOlder", "Ältere behalten"),
          t("cancel", "Abbrechen"),
        ],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice.response === 2) {
        return { ...getState(), cancelled: true };
      }
      prefer = choice.response === 0 ? "newer" : "older";
    }
    imported = true;
  }

  jsonPath = nextPath;
  db.setMeta("json.path", jsonPath);
  if (snapshot) {
    db.mergeSnapshot(snapshot, { prefer });
    db.migrateUngroupedNotes();
  }
  writeNow();
  startWatch();
  return { ...getState(), cancelled: false, imported, conflicts };
}

function formatStamp(ms) {
  return new Date(ms).toLocaleString(dateLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hashOf(text) {
  return createHash("sha256").update(text).digest("hex");
}

function backupPaths() {
  const dir = path.dirname(jsonPath);
  const base = path.basename(jsonPath, path.extname(jsonPath));
  return {
    dir,
    weekly: path.join(dir, `${base}.weekly.json`),
    monthly: path.join(dir, `${base}.monthly.json`),
    sixPrefix: `${base}.6months-`,
  };
}

function copyAtomic(from, to) {
  const tmp = `${to}.tmp`;
  copyFileSync(from, tmp);
  try {
    renameSync(tmp, to);
  } catch {
    copyFileSync(from, to);
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function rotateBackups() {
  try {
    if (!jsonPath || !existsSync(jsonPath)) return;
    const now = Date.now();
    const names = backupPaths();
    mkdirSync(names.dir, { recursive: true });

    const weeklyAt = Number(db.getMeta("backup.weeklyAt") || "0");
    if (!weeklyAt || now - weeklyAt >= WEEK_MS || !existsSync(names.weekly)) {
      copyAtomic(jsonPath, names.weekly);
      db.setMeta("backup.weeklyAt", String(now));
    }

    const monthlyAt = Number(db.getMeta("backup.monthlyAt") || "0");
    if (!monthlyAt || now - monthlyAt >= MONTH_MS || !existsSync(names.monthly)) {
      copyAtomic(jsonPath, names.monthly);
      db.setMeta("backup.monthlyAt", String(now));
    }

    const sixAt = Number(db.getMeta("backup.sixAt") || "0");
    if (!sixAt || now - sixAt >= SIX_MONTH_MS) {
      const stamp = new Date(now).toISOString().slice(0, 10);
      const sixPath = path.join(names.dir, `${names.sixPrefix}${stamp}.json`);
      if (!existsSync(sixPath)) copyAtomic(jsonPath, sixPath);
      db.setMeta("backup.sixAt", String(now));
    }
  } catch (err) {
    console.warn("Backup fehlgeschlagen:", err);
  }
}

function writeNow() {
  if (!jsonPath) return;
  if (autoSave) {
    const payload = JSON.stringify(db.exportSnapshot(), null, 2);
    const hash = hashOf(payload);
    if (hash !== lastHash) {
      writing = true;
      lastWriteAt = Date.now();
      mkdirSync(path.dirname(jsonPath), { recursive: true });
      const tmp = `${jsonPath}.tmp`;
      writeFileSync(tmp, payload, "utf8");
      try {
        renameSync(tmp, jsonPath);
      } catch {
        writeFileSync(jsonPath, payload, "utf8");
        try {
          unlinkSync(tmp);
        } catch {
          // ignore
        }
      }
      lastHash = hash;
      setTimeout(() => {
        writing = false;
      }, 1500);
    }
  }
  rotateBackups();
}

function parseSnapshot() {
  const text = readFileSync(jsonPath, "utf8");
  const hash = hashOf(text);
  const snapshot = JSON.parse(text);
  return { snapshot, hash, text };
}

function loadFromDisk({ replace }) {
  try {
    const { snapshot, hash } = parseSnapshot();
    if (!snapshot?.notes && !snapshot?.groups) return false;
    if (replace) db.replaceFromSnapshot(snapshot);
    else db.mergeSnapshot(snapshot);
    lastHash = hash;
    return true;
  } catch (err) {
    console.warn("JSON konnte nicht geladen werden:", err);
    return false;
  }
}

function mergeFromDisk() {
  return loadFromDisk({ replace: false });
}

function startWatch() {
  try {
    watcher?.close();
  } catch {
    // ignore
  }
  watcher = null;
  if (!jsonPath) return;
  const dir = path.dirname(jsonPath);
  const name = path.basename(jsonPath);
  mkdirSync(dir, { recursive: true });
  try {
    watcher = watch(dir, (_event, filename) => {
      if (writing) return;
      if (Date.now() - lastWriteAt < 2000) return;
      if (filename && filename !== name) return;
      if (!existsSync(jsonPath)) return;
      try {
        const { hash } = parseSnapshot();
        if (hash === lastHash) return;
      } catch {
        return;
      }
      if (mergeFromDisk()) onExternalChange?.();
    });
  } catch (err) {
    console.warn("JSON-Watch nicht aktiv:", err);
  }
}
