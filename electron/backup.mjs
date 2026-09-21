import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import * as db from "./db.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 365;
export const KEEP_MIN = 2;
export const KEEP_MAX = 20;
export const DEFAULT_INTERVAL_DAYS = 7;
export const DEFAULT_KEEP_COUNT = 8;

export function clampIntervalDays(value) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return DEFAULT_INTERVAL_DAYS;
  return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, next));
}

export function clampKeepCount(value) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return DEFAULT_KEEP_COUNT;
  return Math.min(KEEP_MAX, Math.max(KEEP_MIN, next));
}

export function getConfig() {
  return {
    backupIntervalDays: clampIntervalDays(db.getMeta("backup.intervalDays", String(DEFAULT_INTERVAL_DAYS))),
    backupKeepCount: clampKeepCount(db.getMeta("backup.keepCount", String(DEFAULT_KEEP_COUNT))),
  };
}

export function setConfig(patch = {}) {
  if (patch.backupIntervalDays != null) {
    db.setMeta("backup.intervalDays", String(clampIntervalDays(patch.backupIntervalDays)));
  }
  if (patch.backupKeepCount != null) {
    db.setMeta("backup.keepCount", String(clampKeepCount(patch.backupKeepCount)));
  }
  return getConfig();
}

function namesFor(jsonPath) {
  return {
    dir: path.dirname(jsonPath),
    base: path.basename(jsonPath, path.extname(jsonPath)),
  };
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseBackupName(base, name) {
  const lower = String(name || "").toLowerCase();
  const prefix = `${String(base || "").toLowerCase()}.`;
  if (!lower.startsWith(prefix) || !lower.endsWith(".json")) return null;
  if (lower === `${prefix}weekly.json`) return { kind: "weekly", stamp: 0 };
  if (lower === `${prefix}monthly.json`) return { kind: "monthly", stamp: 0 };

  const rest = lower.slice(prefix.length);
  const six = rest.match(/^6months-(\d{4}-\d{2}-\d{2})\.json$/);
  if (six) return { kind: "archive", stamp: Date.parse(`${six[1]}T00:00:00`) };
  const scheduled = rest.match(/^backup-(\d{4}-\d{2}-\d{2})(?:-(\d{6}))?\.json$/);
  if (scheduled) {
    const time = scheduled[2]
      ? `${scheduled[2].slice(0, 2)}:${scheduled[2].slice(2, 4)}:${scheduled[2].slice(4, 6)}`
      : "00:00:00";
    return { kind: "scheduled", stamp: Date.parse(`${scheduled[1]}T${time}`) };
  }
  return null;
}

function backupDate(filePath, namedStamp) {
  try {
    const snapshot = JSON.parse(stripBom(readFileSync(filePath, "utf8")));
    const exported = Number(snapshot?.exportedAt);
    if (exported) return exported;
  } catch {
    // list by filename/mtime even if Drive stubs or older files fail to parse
  }
  if (namedStamp) return namedStamp;
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function hashFile(filePath) {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return "";
  }
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

function isSafeId(id) {
  return typeof id === "string" && id.length > 0 && !/[\\/]/.test(id) && !id.includes("..");
}

export function listBackups(jsonPath) {
  if (!jsonPath) return [];
  const { dir, base } = namesFor(jsonPath);
  if (!existsSync(dir)) return [];
  const items = [];
  for (const name of readdirSync(dir)) {
    const parsed = parseBackupName(base, name);
    if (!parsed) continue;
    const full = path.join(dir, name);
    const date = backupDate(full, parsed.stamp);
    if (!date) continue;
    items.push({ id: name, date, kind: parsed.kind });
  }
  items.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
  return items;
}

function prune(jsonPath, keepCount) {
  const { dir } = namesFor(jsonPath);
  const extra = listBackups(jsonPath)
    .filter((item) => item.kind === "scheduled" || item.kind === "archive")
    .slice(keepCount);
  for (const item of extra) {
    try {
      unlinkSync(path.join(dir, item.id));
    } catch {
      // ignore
    }
  }
}

export function rotateBackups(jsonPath, { force = false, now = Date.now() } = {}) {
  try {
    if (!jsonPath || !existsSync(jsonPath)) return { created: false };
    const { dir, base } = namesFor(jsonPath);
    mkdirSync(dir, { recursive: true });
    const { backupIntervalDays, backupKeepCount } = getConfig();
    const lastAt = Number(db.getMeta("backup.lastAt") || "0");
    const due = force || !lastAt || now - lastAt >= backupIntervalDays * DAY_MS;
    if (!due) {
      prune(jsonPath, backupKeepCount);
      return { created: false };
    }

    const latest = listBackups(jsonPath)[0];
    const currentHash = hashFile(jsonPath);
    if (latest && currentHash && currentHash === hashFile(path.join(dir, latest.id))) {
      db.setMeta("backup.lastAt", String(now));
      prune(jsonPath, backupKeepCount);
      return { created: false, skipped: "unchanged" };
    }

    const stamp = new Date(now);
    const day = stamp.toISOString().slice(0, 10);
    let id = `${base}.backup-${day}.json`;
    let dest = path.join(dir, id);
    if (existsSync(dest)) {
      const clock = stamp.toISOString().slice(11, 19).replaceAll(":", "");
      id = `${base}.backup-${day}-${clock}.json`;
      dest = path.join(dir, id);
    }
    copyAtomic(jsonPath, dest);
    db.setMeta("backup.lastAt", String(now));
    prune(jsonPath, backupKeepCount);
    return { created: true, id };
  } catch (err) {
    console.warn("Backup fehlgeschlagen:", err);
    return { created: false };
  }
}

export function readBackupSnapshot(jsonPath, id) {
  if (!isSafeId(id)) return null;
  const match = listBackups(jsonPath).find((item) => item.id === id);
  if (!match) return null;
  const full = path.join(path.dirname(jsonPath), match.id);
  try {
    const snapshot = JSON.parse(stripBom(readFileSync(full, "utf8")));
    if (!snapshot?.notes && !snapshot?.groups) return null;
    return { snapshot, date: match.date };
  } catch (err) {
    console.warn("Backup konnte nicht gelesen werden:", err);
    return null;
  }
}
