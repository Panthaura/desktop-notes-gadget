import { createHash } from "node:crypto";
import {
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
import * as backup from "./backup.mjs";
import * as db from "./db.mjs";
import { dateLocale, t } from "./i18n.mjs";

let jsonPath = "";
let writing = false;
let lastWriteAt = 0;
let lastHash = "";
let timer = null;
let watcher = null;
let onExternalChange = null;

export function getState() {
  return { jsonPath, ...backup.getConfig() };
}

export function initJsonStore({ defaultPath, onExternal }) {
  onExternalChange = onExternal;
  db.setMeta("json.autoSave", "1");
  jsonPath = db.getMeta("json.path") || defaultPath;
  if (!db.getMeta("json.path")) db.setMeta("json.path", jsonPath);

  const empty = db.isBoardEmpty();
  let loaded = false;
  if (existsSync(jsonPath)) {
    if (empty) loaded = loadFromDisk({ replace: true });
    else loaded = mergeFromDisk();
    if (!loaded && empty) {
      // Don't overwrite a broken/unreadable existing file with an empty board.
      console.warn("JSON vorhanden, aber nicht lesbar – kein Überschreiben:", jsonPath);
      startWatch();
      return;
    }
  }
  writeNow();
  startWatch();
}

export function scheduleWrite() {
  if (!jsonPath) return;
  clearTimeout(timer);
  timer = setTimeout(() => writeNow(), 250);
}

export async function chooseJsonPath(parent) {
  const target = await dialog.showSaveDialog(parent ?? undefined, {
    title: t("jsonSaveAsTitle", "Datenbank speichern unter…"),
    defaultPath: jsonPath || "notes.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (target.canceled || !target.filePath) {
    return { ...getState(), cancelled: true };
  }
  const nextPath = target.filePath;

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

export function listBackups() {
  return backup.listBackups(jsonPath);
}

export function restoreBackup(id) {
  const loaded = backup.readBackupSnapshot(jsonPath, id);
  if (!loaded) return { ok: false };
  db.replaceFromSnapshot(loaded.snapshot);
  db.migrateDefaultGroup();
  db.migrateUngroupedNotes();
  writeNow();
  return { ok: true, date: loaded.date };
}

export function createBackup() {
  writeNow({ rotate: false });
  return backup.rotateBackups(jsonPath, { force: true });
}

export function setBackupSchedule(patch) {
  const next = backup.setConfig(patch);
  backup.rotateBackups(jsonPath);
  return next;
}

function writeNow({ rotate = true } = {}) {
  if (!jsonPath) return;
  try {
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
    if (rotate) backup.rotateBackups(jsonPath);
  } catch (err) {
    writing = false;
    console.warn("JSON speichern fehlgeschlagen:", err?.message || err);
  }
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
    db.migrateDefaultGroup();
    db.migrateUngroupedNotes();
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
