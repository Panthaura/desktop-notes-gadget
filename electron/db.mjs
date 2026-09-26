import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js/dist/sql-asm.js");

const TITLE_MAX = 40;
const DEFAULT_GROUP_NAME = "Notes";
const LEGACY_DEFAULT_NAMES = ["Notes", "Allgemein"];

let db;
let dbPath;

function now() {
  return Date.now();
}

export function autoTitle(body) {
  const line = body
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!line) return "Neue Notiz";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

const WELCOME_BODIES = {
  de: "Willkommen beim Desktop-Notes-Gadget.\n\nDoppelklick öffnet die Notiz in einem eigenen Fenster.\nKarten per Drag-and-Drop in Gruppen legen.\nEinstellungen: Autostart und JSON-Speicherort (z. B. Google Drive).",
  en: "Welcome to the Desktop Notes gadget.\n\nDouble-click opens the note in its own window.\nDrag and drop cards into groups.\nSettings: autostart and JSON location (e.g. Google Drive).",
};

function normalizeBody(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function welcomeBody(locale = "de") {
  return locale === "en" ? WELCOME_BODIES.en : WELCOME_BODIES.de;
}

function isWelcomeBody(text) {
  const body = normalizeBody(text);
  return body === WELCOME_BODIES.de || body === WELCOME_BODIES.en;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
}

function one(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

function persist(notify = true) {
  const data = Buffer.from(db.export());
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.tmp`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, dbPath);
  } catch {
    writeFileSync(dbPath, data);
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
  if (notify && !skipNotify) onChange?.();
}

let skipNotify = false;
let onChange = null;

export function setOnChange(fn) {
  onChange = fn;
}

function mapNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    title: row.title,
    titleIsManual: Boolean(row.titleIsManual),
    body: row.body,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
    color: row.color ?? null,
    icon: row.icon ?? null,
    highlight: Boolean(row.highlight),
    remindAt: row.remindAt == null ? null : Number(row.remindAt),
  };
}

function tableHasColumn(table, column) {
  return all(`PRAGMA table_info(${table})`).some((col) => col.name === column);
}

export function migrateNoteExtras() {
  const columns = [
    ["color", "TEXT"],
    ["icon", "TEXT"],
    ["highlight", "INTEGER NOT NULL DEFAULT 0"],
    ["remindAt", "INTEGER"],
  ];
  let changed = false;
  for (const [name, def] of columns) {
    if (tableHasColumn("notes", name)) continue;
    run(`ALTER TABLE notes ADD COLUMN ${name} ${def}`);
    changed = true;
  }
  if (changed) persist(false);
}

function mapGroup(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function openDatabase(userDataDir) {
  mkdirSync(userDataDir, { recursive: true });
  dbPath = path.join(userDataDir, "notes.sqlite");
  const SQL = await initSqlJs();
  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      groupId TEXT,
      title TEXT NOT NULL,
      titleIsManual INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL DEFAULT '',
      sortOrder INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER,
      color TEXT,
      icon TEXT,
      highlight INTEGER NOT NULL DEFAULT 0,
      remindAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  persist(false);
  return db;
}

export function isBoardEmpty() {
  const notes = one("SELECT COUNT(*) AS c FROM notes WHERE deletedAt IS NULL");
  const groups = one("SELECT COUNT(*) AS c FROM groups WHERE deletedAt IS NULL");
  return (notes?.c ?? 0) === 0 && (groups?.c ?? 0) === 0;
}

export function seedIfEmpty() {
  if (!isBoardEmpty()) return false;
  const created = now();
  const groupId = randomUUID();
  run(
    "INSERT INTO groups (id, name, sortOrder, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?)",
    [groupId, DEFAULT_GROUP_NAME, created, created],
  );
  const locale = getMeta("ui.locale") === "en" ? "en" : "de";
  const body = welcomeBody(locale);
  const noteId = randomUUID();
  run(
    `INSERT INTO notes (id, groupId, title, titleIsManual, body, sortOrder, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, 0, ?, ?)`,
    [noteId, groupId, autoTitle(body), body, created, created],
  );
  setMeta("seed.welcomeNoteId", noteId);
  setMeta("seed.defaultGroupId", groupId);
  persist();
  return true;
}

export function syncWelcomeNote(locale = "de") {
  const wanted = welcomeBody(locale === "en" ? "en" : "de");
  const savedId = getMeta("seed.welcomeNoteId");
  let note = savedId ? getNote(savedId) : null;
  if (!note) {
    note =
      getBoard().notes.find((item) => isWelcomeBody(item.body)) ?? null;
  }
  if (!note || !isWelcomeBody(note.body)) return false;
  if (normalizeBody(note.body) === normalizeBody(wanted)) {
    setMeta("seed.welcomeNoteId", note.id);
    return false;
  }
  setMeta("seed.welcomeNoteId", note.id);
  updateNote({ id: note.id, body: wanted, titleIsManual: false });
  return true;
}

export function getMeta(key, fallback = "") {
  const row = one("SELECT value FROM meta WHERE key = ?", [key]);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
  persist(false);
}

export function getBoard() {
  const groups = all(
    "SELECT * FROM groups WHERE deletedAt IS NULL ORDER BY sortOrder ASC, createdAt ASC",
  ).map(mapGroup);
  const notes = all(
    "SELECT * FROM notes WHERE deletedAt IS NULL ORDER BY sortOrder ASC, createdAt ASC",
  ).map(mapNote);
  return { groups, notes, defaultGroupId: groups[0] ? resolveDefaultGroupId(groups) : null };
}

export function getNote(id) {
  return mapNote(one("SELECT * FROM notes WHERE id = ? AND deletedAt IS NULL", [id]));
}

function resolveDefaultGroupId(groups) {
  const saved = getMeta("seed.defaultGroupId");
  if (saved && groups.some((group) => group.id === saved)) return saved;
  return groups.find((group) => LEGACY_DEFAULT_NAMES.includes(group.name))?.id ?? groups[0]?.id ?? null;
}

export function defaultGroupId() {
  const groups = getBoard().groups;
  if (!groups.length) {
    seedIfEmpty();
    return getBoard().groups[0]?.id ?? null;
  }
  return resolveDefaultGroupId(groups);
}

export function migrateDefaultGroup() {
  const groups = getBoard().groups;
  if (!groups.length) return;

  const saved = getMeta("seed.defaultGroupId");
  if (saved && groups.some((group) => group.id === saved)) {
    const group = groups.find((item) => item.id === saved);
    if (
      group &&
      LEGACY_DEFAULT_NAMES.includes(group.name) &&
      group.name !== DEFAULT_GROUP_NAME
    ) {
      run("UPDATE groups SET name = ?, updatedAt = ? WHERE id = ?", [
        DEFAULT_GROUP_NAME,
        now(),
        group.id,
      ]);
      persist();
    }
    return;
  }

  const legacy = groups.find((group) => LEGACY_DEFAULT_NAMES.includes(group.name));
  if (legacy) {
    setMeta("seed.defaultGroupId", legacy.id);
    if (legacy.name !== DEFAULT_GROUP_NAME) {
      run("UPDATE groups SET name = ?, updatedAt = ? WHERE id = ?", [
        DEFAULT_GROUP_NAME,
        now(),
        legacy.id,
      ]);
      persist();
    }
    return;
  }

  // Keine Legacy-Default-Gruppe: erste Gruppe merken, aber nicht umbenennen.
  setMeta("seed.defaultGroupId", groups[0].id);
}

export function migrateUngroupedNotes() {
  const gid = defaultGroupId();
  if (!gid) return;
  run("UPDATE notes SET groupId = ? WHERE groupId IS NULL AND deletedAt IS NULL", [gid]);
  persist();
}

export function createNote(groupId) {
  const resolvedGroup = groupId || defaultGroupId();
  const created = now();
  const max = one(
    "SELECT COALESCE(MAX(sortOrder), -1) AS m FROM notes WHERE deletedAt IS NULL AND groupId = ?",
    [resolvedGroup],
  );
  const note = {
    id: randomUUID(),
    groupId: resolvedGroup,
    title: "Neue Notiz",
    titleIsManual: false,
    body: "",
    sortOrder: (max?.m ?? -1) + 1,
    createdAt: created,
    updatedAt: created,
    color: null,
    icon: null,
    highlight: false,
    remindAt: null,
  };
  run(
    `INSERT INTO notes (id, groupId, title, titleIsManual, body, sortOrder, createdAt, updatedAt, color, icon, highlight, remindAt)
     VALUES (?, ?, ?, 0, '', ?, ?, ?, NULL, NULL, 0, NULL)`,
    [note.id, resolvedGroup, note.title, note.sortOrder, created, created],
  );
  persist();
  return note;
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeNoteColor(value) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) return text.toLowerCase();
  return null;
}

function normalizeNoteIcon(value) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  // Allow a short emoji / ZWJ sequence; reject long free text.
  if ([...text].length > 8 || text.length > 24) return null;
  return text;
}

export function updateNote(patch) {
  const current = getNote(patch.id);
  if (!current) return null;
  const body = patch.body !== undefined ? patch.body : current.body;
  let titleIsManual =
    patch.titleIsManual !== undefined ? Boolean(patch.titleIsManual) : current.titleIsManual;
  let title;
  if (titleIsManual) {
    title = patch.title !== undefined ? patch.title : current.title;
    if (!String(title).trim()) {
      titleIsManual = false;
      title = autoTitle(body);
    }
  } else {
    title = autoTitle(body);
  }
  const groupId = patch.groupId !== undefined ? patch.groupId : current.groupId;
  const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder;
  const color =
    patch.color !== undefined ? normalizeNoteColor(patch.color) : current.color ?? null;
  const icon =
    patch.icon !== undefined ? normalizeNoteIcon(patch.icon) : current.icon ?? null;
  const highlight =
    patch.highlight !== undefined ? Boolean(patch.highlight) : Boolean(current.highlight);
  const remindAt =
    patch.remindAt !== undefined
      ? patch.remindAt == null
        ? null
        : Number(patch.remindAt) || null
      : current.remindAt ?? null;
  const changed =
    title !== current.title ||
    body !== current.body ||
    groupId !== current.groupId ||
    sortOrder !== current.sortOrder ||
    Boolean(titleIsManual) !== current.titleIsManual ||
    color !== (current.color ?? null) ||
    icon !== (current.icon ?? null) ||
    highlight !== Boolean(current.highlight) ||
    remindAt !== (current.remindAt ?? null);
  const updatedAt = changed ? now() : current.updatedAt;
  run(
    `UPDATE notes SET title = ?, titleIsManual = ?, body = ?, groupId = ?, sortOrder = ?,
      color = ?, icon = ?, highlight = ?, remindAt = ?, updatedAt = ?
     WHERE id = ?`,
    [
      title,
      titleIsManual ? 1 : 0,
      body,
      groupId,
      sortOrder,
      color,
      icon,
      highlight ? 1 : 0,
      remindAt,
      updatedAt,
      patch.id,
    ],
  );
  persist();
  return getNote(patch.id);
}

export function fireDueReminders(at = Date.now()) {
  const due = all(
    `SELECT * FROM notes
     WHERE deletedAt IS NULL AND remindAt IS NOT NULL AND remindAt <= ?
     ORDER BY remindAt ASC`,
    [at],
  ).map(mapNote);
  if (!due.length) return [];
  const ts = now();
  for (const note of due) {
    run("UPDATE notes SET highlight = 1, remindAt = NULL, updatedAt = ? WHERE id = ?", [
      ts,
      note.id,
    ]);
  }
  persist();
  return due;
}

export function deleteNote(id) {
  run("UPDATE notes SET deletedAt = ?, updatedAt = ?, remindAt = NULL WHERE id = ?", [
    now(),
    now(),
    id,
  ]);
  persist();
}

export function listArchivedNotes() {
  return all(
    "SELECT * FROM notes WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC, updatedAt DESC",
  ).map(mapNote);
}

export function restoreNote(id) {
  const row = one("SELECT * FROM notes WHERE id = ?", [id]);
  if (!row?.deletedAt) return null;
  const groups = getBoard().groups;
  let groupId = row.groupId ?? null;
  if (!groupId || !groups.some((group) => group.id === groupId)) {
    groupId = defaultGroupId();
  }
  const max = one(
    "SELECT COALESCE(MAX(sortOrder), -1) AS m FROM notes WHERE deletedAt IS NULL AND groupId = ?",
    [groupId],
  );
  const expiredRemind =
    row.remindAt != null && Number(row.remindAt) <= Date.now() ? null : (row.remindAt ?? null);
  run(
    `UPDATE notes SET deletedAt = NULL, groupId = ?, sortOrder = ?, remindAt = ?, updatedAt = ?
     WHERE id = ?`,
    [groupId, (max?.m ?? -1) + 1, expiredRemind, now(), id],
  );
  persist();
  return getNote(id);
}

export function purgeNote(id) {
  const row = one("SELECT id FROM notes WHERE id = ? AND deletedAt IS NOT NULL", [id]);
  if (!row) return false;
  run("DELETE FROM notes WHERE id = ?", [id]);
  persist();
  return true;
}

export function createGroup(name) {
  const created = now();
  const max = one("SELECT COALESCE(MAX(sortOrder), -1) AS m FROM groups WHERE deletedAt IS NULL");
  const group = {
    id: randomUUID(),
    name: name.trim() || "Neue Gruppe",
    sortOrder: (max?.m ?? -1) + 1,
    createdAt: created,
    updatedAt: created,
  };
  run(
    "INSERT INTO groups (id, name, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    [group.id, group.name, group.sortOrder, created, created],
  );
  persist();
  return group;
}

export function renameGroup(id, name) {
  run("UPDATE groups SET name = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL", [
    name.trim() || "Gruppe",
    now(),
    id,
  ]);
  persist();
}

export function deleteGroup(id) {
  if (id === defaultGroupId()) return false;
  const others = getBoard().groups.filter((group) => group.id !== id);
  if (!others.length) return false;
  const target = others.find((group) => group.id === defaultGroupId())?.id ?? others[0].id;
  const ts = now();
  run("UPDATE notes SET groupId = ?, updatedAt = ? WHERE groupId = ? AND deletedAt IS NULL", [
    target,
    ts,
    id,
  ]);
  run("UPDATE groups SET deletedAt = ?, updatedAt = ? WHERE id = ?", [ts, ts, id]);
  persist();
  return true;
}

export function reorderGroups(ids) {
  const defaultId = defaultGroupId();
  const rest = ids.filter((id) => id !== defaultId);
  const ordered = defaultId ? [defaultId, ...rest] : rest;
  ordered.forEach((id, index) => {
    run("UPDATE groups SET sortOrder = ?, updatedAt = ? WHERE id = ?", [index, now(), id]);
  });
  persist();
}

export function moveNote(id, groupId, index) {
  const note = getNote(id);
  if (!note) return;
  const targetGroup = groupId || defaultGroupId();
  run("UPDATE notes SET groupId = ? WHERE id = ?", [targetGroup, id]);
  const siblings = all(
    "SELECT id FROM notes WHERE deletedAt IS NULL AND groupId = ? AND id != ? ORDER BY sortOrder ASC",
    [targetGroup, id],
  );
  const ids = siblings.map((row) => row.id);
  const clamped = Math.max(0, Math.min(index, ids.length));
  ids.splice(clamped, 0, id);
  const ts = now();
  ids.forEach((noteId, sortOrder) => {
    if (noteId === id) {
      run("UPDATE notes SET sortOrder = ?, updatedAt = ? WHERE id = ?", [sortOrder, ts, noteId]);
    } else {
      run("UPDATE notes SET sortOrder = ? WHERE id = ?", [sortOrder, noteId]);
    }
  });
  persist();
}

export function exportSnapshot() {
  return {
    version: 1,
    exportedAt: now(),
    groups: all("SELECT * FROM groups"),
    notes: all("SELECT * FROM notes"),
    meta: {
      defaultGroupId: getMeta("seed.defaultGroupId") || null,
      welcomeNoteId: getMeta("seed.welcomeNoteId") || null,
    },
  };
}

function applySnapshotMeta(meta) {
  if (!meta || typeof meta !== "object") return;
  if (meta.defaultGroupId) setMeta("seed.defaultGroupId", String(meta.defaultGroupId));
  if (meta.welcomeNoteId) setMeta("seed.welcomeNoteId", String(meta.welcomeNoteId));
}

export function replaceFromSnapshot(snapshot) {
  skipNotify = true;
  try {
    db.run("DELETE FROM groups");
    db.run("DELETE FROM notes");
    for (const group of snapshot.groups ?? []) {
      run(
        `INSERT INTO groups (id, name, sortOrder, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          group.id,
          group.name,
          group.sortOrder,
          group.createdAt,
          group.updatedAt,
          group.deletedAt ?? null,
        ],
      );
    }
    for (const note of snapshot.notes ?? []) {
      run(
        `INSERT INTO notes (id, groupId, title, titleIsManual, body, sortOrder, createdAt, updatedAt, deletedAt, color, icon, highlight, remindAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          note.id,
          note.groupId ?? null,
          note.title,
          note.titleIsManual ? 1 : 0,
          note.body ?? "",
          note.sortOrder,
          note.createdAt,
          note.updatedAt,
          note.deletedAt ?? null,
          normalizeNoteColor(note.color),
          normalizeNoteIcon(note.icon),
          note.highlight ? 1 : 0,
          note.remindAt == null ? null : Number(note.remindAt) || null,
        ],
      );
    }
    applySnapshotMeta(snapshot.meta);
    persist();
  } finally {
    skipNotify = false;
  }
}

export function mergeSnapshot(remote, { prefer = "newer" } = {}) {
  const local = exportSnapshot();
  const groups = mergeById(local.groups, remote.groups ?? [], prefer);
  const notes = mergeById(local.notes, remote.notes ?? [], prefer);
  replaceFromSnapshot({
    groups,
    notes,
    meta: {
      defaultGroupId:
        remote.meta?.defaultGroupId || local.meta?.defaultGroupId || null,
      welcomeNoteId: remote.meta?.welcomeNoteId || local.meta?.welcomeNoteId || null,
    },
  });
}

export function findNoteConflicts(remoteNotes) {
  const conflicts = [];
  for (const raw of remoteNotes ?? []) {
    if (raw.deletedAt) continue;
    const local = getNote(raw.id);
    if (!local) continue;
    const sameContent =
      local.title === (raw.title ?? "") &&
      local.body === (raw.body ?? "") &&
      (local.groupId ?? null) === (raw.groupId ?? null) &&
      (local.color ?? null) === (raw.color ?? null) &&
      (local.icon ?? null) === (raw.icon ?? null) &&
      Boolean(local.highlight) === Boolean(raw.highlight) &&
      (local.remindAt ?? null) === (raw.remindAt == null ? null : Number(raw.remindAt) || null);
    if (sameContent) continue;
    conflicts.push({
      id: local.id,
      title: local.title || raw.title || "Notiz",
      localUpdatedAt: local.updatedAt,
      remoteUpdatedAt: raw.updatedAt ?? 0,
    });
  }
  return conflicts;
}

function mergeById(localItems, remoteItems, prefer = "newer") {
  const map = new Map();
  for (const item of localItems) map.set(item.id, item);
  for (const item of remoteItems) {
    const current = map.get(item.id);
    if (!current) {
      // Auch Tombstones übernehmen, damit Soft-Deletes synchron bleiben.
      map.set(item.id, item);
      continue;
    }
    const remoteAt = Number(item.updatedAt) || 0;
    const localAt = Number(current.updatedAt) || 0;
    if (remoteAt === localAt) {
      // Bei Gleichstand gewinnt die Löschung (Tombstone).
      if (item.deletedAt && !current.deletedAt) map.set(item.id, item);
      continue;
    }
    const remoteIsNewer = remoteAt > localAt;
    const takeRemote = prefer === "newer" ? remoteIsNewer : !remoteIsNewer;
    if (takeRemote) map.set(item.id, item);
  }
  return [...map.values()];
}
