import { useEffect, useMemo, useRef, useState } from "react";
import type { BackupInfo, Board, Group, Note, Settings } from "../types";
import { useConfirm } from "../ConfirmDialog";
import { dateLocale, setLocale, useT } from "../i18n";
import { applyPalette, DEFAULT_COLOR_ACCENT, DEFAULT_COLOR_BG, DEFAULT_COLOR_BLINK } from "../themeColors";
import { formatRemindShort } from "../ctxmenu/menuShared";

type NoteDensity = "full" | "small" | "initial";

export default function OverlayApp() {
  const [board, setBoard] = useState<Board>({ groups: [], notes: [], defaultGroupId: null });
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    openAtLogin: false,
    jsonPath: "",
    opacity: 1,
    alwaysOnTop: false,
    previewSplit: 38,
    compact: false,
    compactLocked: false,
    locale: "de",
    appVersion: "",
    colorBg: DEFAULT_COLOR_BG,
    colorAccent: DEFAULT_COLOR_ACCENT,
    colorBlink: DEFAULT_COLOR_BLINK,
    backupIntervalDays: 7,
    backupKeepCount: 8,
  });
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupId, setBackupId] = useState("");
  const [archived, setArchived] = useState<Note[]>([]);
  const [archiveId, setArchiveId] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const [noteDensity, setNoteDensity] = useState<NoteDensity>("full");
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const previewSplitRef = useRef(38);
  const compactRef = useRef(false);
  const compactLockedRef = useRef(false);
  const noteCountRef = useRef(0);
  const wasCompactRef = useRef(false);
  const t = useT();
  const [askConfirm, confirmDialog] = useConfirm();

  async function refresh() {
    const next = await window.notesApi.getBoard();
    setBoard(next);
  }

  useEffect(() => {
    void refresh();
    void window.notesApi.getSettings().then((next) => {
      setSettings((current) => ({ ...current, ...next }));
      setLocale(next.locale);
      if (next.compactLocked || next.compact) setCompact(true);
    });
    const offBoard = window.notesApi.onBoardChanged(() => {
      void refresh();
    });
    const offReminders = window.notesApi.onRemindersFired((payload) => {
      const title = payload.title?.trim() || t("emptyNote", "Leere Notiz");
      setToast(
        payload.count === 1
          ? t("remindFired", "Erinnerung: {title}", { title })
          : t("remindFiredMany", "{n} Erinnerungen fällig", { n: payload.count }),
      );
    });
    const offLocale = window.notesApi.onLocaleChanged((locale) => {
      setLocale(locale);
      setSettings((current) => ({ ...current, locale }));
    });
    const offSettings = window.notesApi.onOpenSettings(() => {
      setSettingsOpen(true);
      void window.notesApi.getSettings().then((next) => {
        setSettings((current) => ({ ...current, ...next }));
      });
    });
    return () => {
      offBoard();
      offReminders();
      offLocale();
      offSettings();
    };
  }, [t]);

  useEffect(() => {
    if (!toast) return;
    const longer = /Erinnerung|Reminder|Erinnerungen|reminders/i.test(toast);
    const id = window.setTimeout(() => setToast(null), longer ? 6500 : 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (selectedId && !board.notes.some((note) => note.id === selectedId)) {
      setSelectedId(null);
    }
  }, [board.notes, selectedId]);

  const selectedNote = useMemo(
    () => board.notes.find((note) => note.id === selectedId) ?? null,
    [board.notes, selectedId],
  );

  const previewSplit = Math.min(70, Math.max(22, settings.previewSplit ?? 38));
  previewSplitRef.current = previewSplit;

  compactRef.current = compact;
  compactLockedRef.current = Boolean(settings.compactLocked);

  useEffect(() => {
    let expanding = false;
    let liveRaf = 0;

    function applyAutoCompactState() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w < 400 || h < 300) {
        if (!compactRef.current) setCompact(true);
        return;
      }
      if (compactRef.current && w >= 520 && h >= 400) {
        if (expanding) return;
        expanding = true;
        compactLockedRef.current = false;
        setCompact(false);
        void window.notesApi
          .clearCompact()
          .then((next) => {
            setSettings((current) => ({ ...current, ...next }));
          })
          .finally(() => {
            expanding = false;
          });
      }
    }

    function onLiveResize() {
      if (liveRaf) return;
      liveRaf = window.requestAnimationFrame(() => {
        liveRaf = 0;
        // Live UI only — main process skips setBounds while the user is dragging.
        applyAutoCompactState();
      });
    }

    const offResized = window.notesApi.onOverlayResized(() => {
      applyAutoCompactState();
    });

    applyAutoCompactState();
    window.addEventListener("resize", onLiveResize);
    return () => {
      offResized();
      window.removeEventListener("resize", onLiveResize);
      if (liveRaf) window.cancelAnimationFrame(liveRaf);
    };
  }, []);

  useEffect(() => {
    if (compact) setSettingsOpen(false);
  }, [compact]);

  noteCountRef.current = board.notes.length;

  useEffect(() => {
    if (!compact) {
      wasCompactRef.current = false;
      setNoteDensity("full");
      return;
    }
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const count = noteCountRef.current;
      wasCompactRef.current = true;
      const size = {
        ...measureCompactSize(count),
        // Never snap-shrink height on auto-enter (resize); explicit collapse passes forceHeight itself.
        forceHeight: false,
      };
      void window.notesApi.setCompact(true, compactLockedRef.current, size).then((next) => {
        setSettings((current) => ({ ...current, ...next }));
      });
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        const cards = boardRef.current?.querySelector(".cards") as HTMLElement | null;
        if (!cards) return;
        const rect = cards.getBoundingClientRect();
        setNoteDensity(pickNoteDensity(count, rect.width, rect.height));
      });
    };
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(apply);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [compact, board.notes.length]);

  useEffect(() => {
    const cards = boardRef.current?.querySelector(".cards");
    if (!cards) return;
    const ro = new ResizeObserver((entries) => {
      if (!compactRef.current) {
        setNoteDensity("full");
        return;
      }
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const density = pickNoteDensity(noteCountRef.current, width, height);
      setNoteDensity(density);
    });
    ro.observe(cards);
    return () => ro.disconnect();
  }, [compact, board.groups.length]);

  useEffect(() => {
    if (!splitDragging) return;
    function onMove(e: PointerEvent) {
      const el = workspaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const stacked = window.matchMedia("(max-width: 640px)").matches;
      const ratio = stacked
        ? (rect.bottom - e.clientY) / Math.max(1, rect.height)
        : (rect.right - e.clientX) / Math.max(1, rect.width);
      const next = Math.min(70, Math.max(22, Math.round(ratio * 100)));
      previewSplitRef.current = next;
      setSettings((current) =>
        current.previewSplit === next ? current : { ...current, previewSplit: next },
      );
    }
    function onUp() {
      setSplitDragging(false);
      void window.notesApi.setPreviewSplit(previewSplitRef.current);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [splitDragging]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return board.notes;
    return board.notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q),
    );
  }, [board.notes, query]);

  function notesIn(groupId: string) {
    return filteredNotes
      .filter((note) => note.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async function onDrop(groupId: string, index: number) {
    if (!draggingId) return;
    const column = notesIn(groupId);
    const from = column.findIndex((note) => note.id === draggingId);
    let target = index;
    if (from !== -1 && from < target) target -= 1;
    await window.notesApi.moveNote(draggingId, groupId, Math.max(0, target));
    setDraggingId(null);
    setDropGroup(null);
    await refresh();
  }

  async function onDropGroup(targetId: string) {
    if (!draggingGroup || draggingGroup === targetId) {
      setDraggingGroup(null);
      return;
    }
    const ids = board.groups.map((group) => group.id);
    const from = ids.indexOf(draggingGroup);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggingGroup);
    await window.notesApi.reorderGroups(ids);
    setDraggingGroup(null);
    await refresh();
  }

  async function loadBackups() {
    try {
      const list = await window.notesApi.listBackups();
      setBackups(list);
      setBackupId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
    } catch {
      setBackups([]);
      setBackupId("");
    }
  }

  async function loadArchived() {
    try {
      const list = await window.notesApi.listArchivedNotes();
      setArchived(list);
      setArchiveId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
    } catch {
      setArchived([]);
      setArchiveId("");
    }
  }

  useEffect(() => {
    if (!settingsOpen) return;
    void loadBackups();
    void loadArchived();
  }, [settingsOpen, settings.jsonPath]);

  async function showSettings() {
    const next = await window.notesApi.getSettings();
    setSettings((current) => ({ ...current, ...next }));
    setLocale(next.locale);
    setSettingsOpen((v) => !v);
  }

  async function selectNote(id: string) {
    setSelectedId(id);
  }

  const defaultGroupId = board.defaultGroupId ?? board.groups[0]?.id ?? null;
  const defaultGroup = board.groups.find((group) => group.id === defaultGroupId) ?? null;
  const nestedGroups = board.groups.filter((group) => group.id !== defaultGroupId);

  async function collapseToNotes() {
    compactLockedRef.current = true;
    setCompact(true);
    const size = {
      ...measureCompactSize(noteCountRef.current),
      forceHeight: true,
    };
    const next = await window.notesApi.setCompact(true, true, size);
    setSettings((current) => ({ ...current, ...next }));
  }

  async function deleteNote(note: { id: string; title?: string }) {
    const ok = await askConfirm({
      title: t("deleteNote", "Notiz löschen"),
      message: t("deleteNoteMessage", "„{title}“ wirklich löschen?", {
        title: note.title || t("emptyNote", "Leere Notiz"),
      }),
      ok: t("delete", "Löschen"),
    });
    if (!ok) return;
    await window.notesApi.deleteNote(note.id);
    await refresh();
    if (settingsOpen) await loadArchived();
  }

  async function restoreArchived() {
    if (!archiveId) return;
    const restored = await window.notesApi.restoreNote(archiveId);
    if (!restored) {
      setToast(t("archiveRestoreFailed", "Notiz konnte nicht wiederhergestellt werden"));
      return;
    }
    await refresh();
    await loadArchived();
    setSelectedId(restored.id);
    setToast(t("archiveRestored", "Notiz wiederhergestellt"));
  }

  async function purgeArchived() {
    if (!archiveId) return;
    const item = archived.find((note) => note.id === archiveId);
    const title = item?.title?.trim() || t("emptyNote", "Leere Notiz");
    const ok = await askConfirm({
      title: t("archivePurgeTitle", "Endgültig löschen"),
      message: t("archivePurgeMessage", "„{title}“ endgültig löschen? Das lässt sich nicht rückgängig machen.", {
        title,
      }),
      ok: t("archivePurge", "Endgültig löschen"),
    });
    if (!ok) return;
    const purged = await window.notesApi.purgeNote(archiveId);
    if (!purged) {
      setToast(t("archivePurgeFailed", "Notiz konnte nicht gelöscht werden"));
      return;
    }
    await loadArchived();
    setToast(t("archivePurged", "Notiz endgültig gelöscht"));
  }

  async function expandChrome() {
    compactLockedRef.current = false;
    setCompact(false);
    const next = await window.notesApi.expandChrome();
    setSettings((current) => ({ ...current, ...next }));
  }

  async function pickJsonPath() {
    const next = await window.notesApi.chooseJsonPath();
    if (next.cancelled) return;
    setSettings((current) => ({ ...current, ...next }));
    setToast(
      next.imported
        ? next.conflicts
          ? t("jsonImportedConflicts", "JSON importiert, Duplikate abgeglichen")
          : t("jsonImported", "JSON importiert und zusammengeführt")
        : t("jsonSaved", "Speicherort gespeichert"),
    );
  }

  async function restoreSelectedBackup() {
    if (!backupId) return;
    const item = backups.find((backup) => backup.id === backupId);
    const date = item ? formatBackupDate(item.date) : backupId;
    const ok = await askConfirm({
      title: t("restoreBackup", "Backup wiederherstellen"),
      message: t("restoreBackupMessage", "Aktuelle Notizen durch das Backup vom {date} ersetzen?", {
        date,
      }),
      ok: t("restore", "Wiederherstellen"),
    });
    if (!ok) return;
    const result = await window.notesApi.restoreBackup(backupId);
    if (!result.ok) {
      setToast(t("restoreBackupFailed", "Backup konnte nicht gelesen werden"));
      return;
    }
    await refresh();
    await loadBackups();
    setToast(t("restoreBackupDone", "Backup vom {date} wiederhergestellt", { date }));
  }

  return (
    <div
      className={`overlay-shell${compact ? " compact" : ""}`}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".confirm-backdrop") || target.closest(".confirm-dialog")) return;
        if (!settingsOpen) return;
        if (target.closest(".settings-panel") || target.closest("[data-settings-btn]")) return;
        setSettingsOpen(false);
      }}
    >
      {compact ? (
        <div className="compact-bar">
          <button
            type="button"
            className="icon-btn compact-expand"
            onClick={() => void expandChrome()}
            title={t("expandChromeTitle", "Menü und Vorschau einblenden")}
          >
            <ExpandIcon />
            <span>{t("expandChrome", "Erweitern")}</span>
          </button>
          <button
            type="button"
            className="ghost-btn compact-add"
            onClick={async () => {
              const note = await window.notesApi.createNote(null);
              setSelectedId(note.id);
              await window.notesApi.openEditor(note.id);
            }}
            title={t("addNoteTitle", "Neue Notiz erstellen")}
          >
            {t("addNote", "+ Notiz")}
          </button>
        </div>
      ) : (
      <header className="overlay-header">
        <div className="brand">
          <span className="brand-mark" />
          Notes
        </div>
        <div className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder", "Notizen durchsuchen…")}
          />
        </div>
        <div className="header-actions">
          <button
            className="ghost-btn"
            onClick={async () => {
              await window.notesApi.createGroup(t("newGroup", "Neue Gruppe"));
              await refresh();
            }}
          >
            {t("addGroup", "+ Gruppe")}
          </button>
          <button
            className="ghost-btn"
            onClick={async () => {
              const note = await window.notesApi.createNote(null);
              setSelectedId(note.id);
              await window.notesApi.openEditor(note.id);
            }}
          >
            {t("addNote", "+ Notiz")}
          </button>
          <button
            className="icon-btn"
            data-settings-btn
            onClick={() => void showSettings()}
            title={t("settings", "Einstellungen")}
          >
            {t("settings", "Einstellungen")}
          </button>
          <button
            className="icon-btn"
            onClick={() => void collapseToNotes()}
            title={t("compactTitle", "Nur Notizen anzeigen")}
          >
            <CompactIcon />
          </button>
        </div>
      </header>
      )}

      {settingsOpen ? (
        <aside className="settings-panel">
          <h3>{t("settingsTitle", "Einstellungen")}</h3>
          <div className="lang-row">
            <span>{t("language", "Sprache")}</span>
            <div className="lang-switch">
              {(["de", "en"] as const).map((locale) => (
                <button
                  key={locale}
                  type="button"
                  className={(settings.locale || "de") === locale ? "active" : ""}
                  onClick={async () => {
                    if ((settings.locale || "de") === locale) return;
                    setLocale(locale);
                    const next = await window.notesApi.setLocale(locale);
                    setSettings((current) => ({ ...current, ...next }));
                  }}
                >
                  {locale.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.openAtLogin}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setSettings((current) => ({ ...current, openAtLogin: enabled }));
                const next = await window.notesApi.setOpenAtLogin(enabled);
                setSettings((current) => ({ ...current, ...next }));
                setToast(
                  next.openAtLogin
                    ? t("autostartOn", "Autostart aktiv")
                    : t("autostartOff", "Autostart aus"),
                );
              }}
            />
            {t("openAtLogin", "Mit Windows starten")}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={Boolean(settings.alwaysOnTop)}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setSettings((current) => ({ ...current, alwaysOnTop: enabled }));
                const next = await window.notesApi.setAlwaysOnTop(enabled);
                setSettings((current) => ({ ...current, ...next }));
                setToast(
                  next.alwaysOnTop
                    ? t("alwaysOnTopOn", "Immer im Vordergrund")
                    : t("alwaysOnTopOff", "Vordergrund aus"),
                );
              }}
            />
            {t("alwaysOnTop", "Immer im Vordergrund")}
          </label>
          <div className="settings-block">
            <span className="settings-label">{t("colors", "Farben")}</span>
            <label className="settings-inline">
              <span>{t("colorBg", "Hintergrund")}</span>
              <input
                type="color"
                value={settings.colorBg || DEFAULT_COLOR_BG}
                onChange={async (e) => {
                  const colorBg = e.target.value;
                  setSettings((current) => ({ ...current, colorBg }));
                  applyPalette(
                    colorBg,
                    settings.colorAccent || DEFAULT_COLOR_ACCENT,
                    settings.colorBlink || DEFAULT_COLOR_BLINK,
                  );
                  const next = await window.notesApi.setColors({ colorBg });
                  setSettings((current) => ({ ...current, ...next }));
                }}
              />
            </label>
            <label className="settings-inline">
              <span>{t("colorAccent", "Akzent")}</span>
              <input
                type="color"
                value={settings.colorAccent || DEFAULT_COLOR_ACCENT}
                onChange={async (e) => {
                  const colorAccent = e.target.value;
                  setSettings((current) => ({ ...current, colorAccent }));
                  applyPalette(
                    settings.colorBg || DEFAULT_COLOR_BG,
                    colorAccent,
                    settings.colorBlink || DEFAULT_COLOR_BLINK,
                  );
                  const next = await window.notesApi.setColors({ colorAccent });
                  setSettings((current) => ({ ...current, ...next }));
                }}
              />
            </label>
            <label className="settings-inline">
              <span>{t("colorBlink", "Blinkfarbe")}</span>
              <input
                type="color"
                value={settings.colorBlink || DEFAULT_COLOR_BLINK}
                onChange={async (e) => {
                  const colorBlink = e.target.value;
                  setSettings((current) => ({ ...current, colorBlink }));
                  applyPalette(
                    settings.colorBg || DEFAULT_COLOR_BG,
                    settings.colorAccent || DEFAULT_COLOR_ACCENT,
                    colorBlink,
                  );
                  const next = await window.notesApi.setColors({ colorBlink });
                  setSettings((current) => ({ ...current, ...next }));
                }}
              />
            </label>
            <button
              className="ghost-btn"
              onClick={async () => {
                applyPalette(DEFAULT_COLOR_BG, DEFAULT_COLOR_ACCENT, DEFAULT_COLOR_BLINK);
                const next = await window.notesApi.setColors({
                  colorBg: DEFAULT_COLOR_BG,
                  colorAccent: DEFAULT_COLOR_ACCENT,
                  colorBlink: DEFAULT_COLOR_BLINK,
                });
                setSettings((current) => ({ ...current, ...next }));
              }}
            >
              {t("colorReset", "Farben zurücksetzen")}
            </button>
          </div>
          <div className="slider-row">
            <div className="slider-head">
              <span>{t("opacity", "Transparenz")}</span>
              <span>{Math.round((settings.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={40}
              max={100}
              value={Math.round((settings.opacity ?? 1) * 100)}
              onChange={async (e) => {
                const opacity = Number(e.target.value) / 100;
                setSettings((current) => ({ ...current, opacity }));
                const next = await window.notesApi.setOpacity(opacity);
                setSettings((current) => ({ ...current, ...next }));
              }}
            />
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("database", "Datenbank")}</span>
            <p className="path-line">{settings.jsonPath || t("jsonNone", "Kein Pfad")}</p>
            <button className="ghost-btn" onClick={() => void pickJsonPath()}>
              {t("jsonSaveAs", "Speichern unter…")}
            </button>
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("backup", "Backup")}</span>
            <label className="settings-inline">
              <span>{t("backupEvery", "Alle")}</span>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.backupIntervalDays ?? 7}
                onChange={(e) => {
                  const backupIntervalDays = Number(e.target.value);
                  setSettings((current) => ({ ...current, backupIntervalDays }));
                }}
                onBlur={async (e) => {
                  const next = await window.notesApi.setBackupSchedule({
                    backupIntervalDays: Number(e.currentTarget.value),
                  });
                  setSettings((current) => ({ ...current, ...next }));
                }}
              />
              <span>{t("backupDays", "Tage")}</span>
            </label>
            <label className="settings-inline">
              <span>{t("backupKeep", "Behalten")}</span>
              <input
                type="number"
                min={2}
                max={20}
                value={settings.backupKeepCount ?? 8}
                onChange={(e) => {
                  const backupKeepCount = Number(e.target.value);
                  setSettings((current) => ({ ...current, backupKeepCount }));
                }}
                onBlur={async (e) => {
                  const next = await window.notesApi.setBackupSchedule({
                    backupKeepCount: Number(e.currentTarget.value),
                  });
                  setSettings((current) => ({ ...current, ...next }));
                  await loadBackups();
                }}
              />
            </label>
            <button
              className="ghost-btn"
              onClick={async () => {
                const result = await window.notesApi.createBackup();
                await loadBackups();
                setToast(
                  result.created
                    ? t("backupCreated", "Backup gespeichert")
                    : result.skipped === "unchanged"
                      ? t("backupUnchanged", "Keine Änderung, Backup übersprungen")
                      : t("backupCreated", "Backup gespeichert"),
                );
              }}
            >
              {t("backupNow", "Jetzt sichern")}
            </button>
            <select
              value={backupId}
              disabled={!backups.length}
              onChange={(e) => setBackupId(e.target.value)}
            >
              {backups.length ? (
                backups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatBackupOption(item, t)}
                  </option>
                ))
              ) : (
                <option value="">{t("backupNone", "Keine Backups")}</option>
              )}
            </select>
            <button
              className="ghost-btn"
              disabled={!backupId}
              onClick={() => void restoreSelectedBackup()}
            >
              {t("restore", "Wiederherstellen")}
            </button>
          </div>
          <div className="settings-block">
            <span className="settings-label">{t("archive", "Archiv")}</span>
            <select
              value={archiveId}
              disabled={!archived.length}
              onChange={(e) => setArchiveId(e.target.value)}
            >
              {archived.length ? (
                archived.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatArchiveOption(item, t)}
                  </option>
                ))
              ) : (
                <option value="">{t("archiveNone", "Keine gelöschten Notizen")}</option>
              )}
            </select>
            <div className="settings-row">
              <button
                className="ghost-btn"
                disabled={!archiveId}
                onClick={() => void restoreArchived()}
              >
                {t("archiveRestore", "Wiederherstellen")}
              </button>
              <button
                className="ghost-btn danger"
                disabled={!archiveId}
                onClick={() => void purgeArchived()}
              >
                {t("archivePurge", "Endgültig löschen")}
              </button>
            </div>
          </div>
          <p className="settings-version">
            {t("appVersion", "Version {version}", {
              version: settings.appVersion || "…",
            })}
          </p>
        </aside>
      ) : null}

      <div
        className={`workspace${splitDragging ? " splitting" : ""}`}
        ref={workspaceRef}
        style={{ ["--preview-size" as string]: `${previewSplit}%` }}
      >
      <div
        className="board"
        ref={boardRef}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest(".note-card")) return;
          e.preventDefault();
          setSettingsOpen(false);
          void window.notesApi.openCtxMenu({
            kind: "shell",
            x: e.screenX,
            y: e.screenY,
          });
        }}
      >
        {defaultGroup ? (
          <NotesColumn
            title={defaultGroup.name || "Notes"}
            defaultGroupId={defaultGroup.id}
            rootNotes={notesIn(defaultGroup.id)}
            groups={nestedGroups.map((group) => ({
              group,
              notes: notesIn(group.id),
            }))}
            dropGroup={dropGroup}
            draggingId={draggingId}
            selectedId={selectedId}
            onRenameGroup={async (id, name) => {
              await window.notesApi.renameGroup(id, name);
              await refresh();
            }}
            onDeleteGroup={async (group) => {
              const ok = await askConfirm({
                title: t("deleteGroup", "Gruppe löschen"),
                message: t(
                  "deleteGroupMessage",
                  "Gruppe „{name}“ löschen? Die Notizen bleiben unter Notes.",
                  { name: group.name },
                ),
                ok: t("delete", "Löschen"),
              });
              if (!ok) return;
              const removed = await window.notesApi.deleteGroup(group.id);
              if (!removed) {
                setToast(t("lastGroup", "Die Gruppe Notes kann nicht gelöscht werden"));
                return;
              }
              await refresh();
            }}
            onAddNote={async (groupId) => {
              const note = await window.notesApi.createNote(groupId);
              setSelectedId(note.id);
              await window.notesApi.openEditor(note.id);
            }}
            onSelect={(id) => void selectNote(id)}
            onDragStart={(id) => {
              setDraggingGroup(null);
              setDraggingId(id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDraggingGroup(null);
              setDropGroup(null);
            }}
            onDragOverGroup={setDropGroup}
            onDropCard={(groupId, index) => void onDrop(groupId, index)}
            onDropGroup={(targetId) => void onDropGroup(targetId)}
            onGroupDragStart={(id) => {
              setDraggingId(null);
              setDraggingGroup(id);
            }}
            onOpenMenu={(note, _clientX, _clientY, screenX, screenY) => {
              setSettingsOpen(false);
              void window.notesApi.openCtxMenu({
                kind: "note",
                noteId: note.id,
                note,
                x: screenX,
                y: screenY,
              });
            }}
            onDeleteNote={(note) => void deleteNote(note)}
            compact={compact}
            density={noteDensity}
          />
        ) : (
          <p className="empty-hint">{t("dropHint", "Karten hierher ziehen")}</p>
        )}
      </div>
      {!compact ? (
        <>
      <div
        className={`split-gutter${splitDragging ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resizePanes", "Größe von Notizen und Vorschau")}
        aria-valuemin={22}
        aria-valuemax={70}
        aria-valuenow={previewSplit}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setSplitDragging(true);
        }}
      >
        <span className="split-knob" />
      </div>
      <NotePreview note={selectedNote} />
        </>
      ) : null}
      </div>
      {confirmDialog}
      {toast ? <div className="toast">{toast}</div> : null}
      <div className="resize-grip" title={t("resize", "Größe ändern")} />
    </div>
  );
}

type NotesColumnProps = {
  title: string;
  defaultGroupId: string;
  rootNotes: Note[];
  groups: { group: Group; notes: Note[] }[];
  dropGroup: string | null;
  draggingId: string | null;
  selectedId: string | null;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (group: Group) => void;
  onAddNote: (groupId: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverGroup: (id: string) => void;
  onDropCard: (groupId: string, index: number) => void;
  onDropGroup: (targetId: string) => void;
  onGroupDragStart: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenMenu: (note: Note, clientX: number, clientY: number, screenX: number, screenY: number) => void;
  onDeleteNote: (note: Note) => void;
  compact?: boolean;
  density?: NoteDensity;
};

function NotesColumn(props: NotesColumnProps) {
  const t = useT();
  const density = props.density ?? "full";
  const total = props.rootNotes.length + props.groups.reduce((sum, item) => sum + item.notes.length, 0);

  return (
    <section
      className={`column${props.dropGroup === props.defaultGroupId ? " drop-target" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOverGroup(props.defaultGroupId);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (props.draggingId) props.onDropCard(props.defaultGroupId, props.rootNotes.length);
      }}
    >
      {!props.compact ? (
      <div className="column-head">
        <span className="column-title locked">{props.title}</span>
        <span className="column-count">{total}</span>
      </div>
      ) : null}
      <div className={`cards density-${density}`}>
        {props.rootNotes.length === 0 && props.groups.length === 0 ? (
          <div className="empty-hint">{t("dropHint", "Karten hierher ziehen")}</div>
        ) : null}
        {props.rootNotes.map((note, index) => (
          <NoteCard
            key={note.id}
            note={note}
            index={index}
            density={density}
            draggingId={props.draggingId}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onDropCard={() => props.onDropCard(props.defaultGroupId, index)}
            onOpenMenu={props.onOpenMenu}
            onDelete={props.onDeleteNote}
          />
        ))}
        {props.groups.map(({ group, notes }) => (
          <NestedGroup
            key={group.id}
            group={group}
            notes={notes}
            density={density}
            compact={Boolean(props.compact)}
            dropActive={props.dropGroup === group.id}
            draggingId={props.draggingId}
            selectedId={props.selectedId}
            onRename={(name) => props.onRenameGroup(group.id, name)}
            onDelete={() => props.onDeleteGroup(group)}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onDragOver={() => props.onDragOverGroup(group.id)}
            onDropCard={(index) => props.onDropCard(group.id, index)}
            onDropGroup={() => props.onDropGroup(group.id)}
            onGroupDragStart={props.onGroupDragStart}
            onSelect={props.onSelect}
            onOpenMenu={props.onOpenMenu}
            onDeleteNote={props.onDeleteNote}
          />
        ))}
      </div>
      {!props.compact ? (
      <button className="ghost-btn column-add" onClick={() => props.onAddNote(props.defaultGroupId)}>
        {t("addNote", "+ Notiz")}
      </button>
      ) : null}
    </section>
  );
}

function NestedGroup(props: {
  group: Group;
  notes: Note[];
  density?: NoteDensity;
  compact?: boolean;
  dropActive: boolean;
  draggingId: string | null;
  selectedId: string | null;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDropCard: (index: number) => void;
  onDropGroup: () => void;
  onGroupDragStart: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenMenu: (note: Note, clientX: number, clientY: number, screenX: number, screenY: number) => void;
  onDeleteNote: (note: Note) => void;
}) {
  const [name, setName] = useState(props.group.name);
  useEffect(() => setName(props.group.name), [props.group.name]);
  const t = useT();
  const density = props.density ?? "full";

  return (
    <div
      className={`note-group${props.dropActive ? " drop-target" : ""}${
        density === "initial" ? " note-group-initial" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (props.draggingId) props.onDropCard(props.notes.length);
        else props.onDropGroup();
      }}
    >
      {density !== "initial" ? (
      <div
        className="note-group-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          props.onGroupDragStart(props.group.id);
        }}
      >
        <input
          className="note-group-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== props.group.name) props.onRename(name.trim());
            else setName(props.group.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="column-count">{props.notes.length}</span>
        {!props.compact ? (
          <button className="icon-btn danger" onClick={props.onDelete} title={t("deleteGroup", "Gruppe löschen")}>
            ×
          </button>
        ) : null}
      </div>
      ) : null}
      <div className={`note-group-cards density-${density}`}>
      {props.notes.length === 0 && density !== "initial" ? (
        <div className="empty-hint nested">{t("dropHint", "Karten hierher ziehen")}</div>
      ) : null}
      {props.notes.map((note, index) => (
        <NoteCard
          key={note.id}
          note={note}
          index={index}
          density={density}
          draggingId={props.draggingId}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          onDropCard={() => props.onDropCard(index)}
          onOpenMenu={props.onOpenMenu}
          onDelete={props.onDeleteNote}
        />
      ))}
      </div>
    </div>
  );
}

function NoteCard(props: {
  note: Note;
  index: number;
  density?: NoteDensity;
  draggingId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropCard: () => void;
  onOpenMenu: (note: Note, clientX: number, clientY: number, screenX: number, screenY: number) => void;
  onDelete: (note: Note) => void;
}) {
  const t = useT();
  const density = props.density ?? "full";
  const title = props.note.title || t("emptyNote", "Leere Notiz");
  const initial = noteInitial(title);
  const icon = props.note.icon?.trim() || "";
  const color = props.note.color?.trim() || "";
  const highlight = Boolean(props.note.highlight);
  const remindAt = props.note.remindAt ?? null;

  return (
    <article
      className={`note-card density-${density}${props.draggingId === props.note.id ? " dragging" : ""}${
        props.selectedId === props.note.id ? " selected" : ""
      }${highlight ? " highlight" : ""}${color ? " has-color" : ""}`}
      style={{
        zIndex: props.index + 1,
        ...(color ? { ["--note-color" as string]: color } : {}),
      }}
      title={title}
      draggable
      onClick={() => props.onSelect(props.note.id)}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", props.note.id);
        e.dataTransfer.effectAllowed = "move";
        props.onDragStart(props.note.id);
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onDropCard();
      }}
      onDoubleClick={() => void window.notesApi.openEditor(props.note.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onSelect(props.note.id);
        props.onOpenMenu(props.note, e.clientX, e.clientY, e.screenX, e.screenY);
      }}
    >
      {density !== "initial" ? (
        <button
          type="button"
          className="note-card-delete"
          title={t("delete", "Löschen")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onDelete(props.note);
          }}
        >
          ×
        </button>
      ) : null}
      {remindAt ? (
        <span
          className={`note-remind-badge${density === "initial" ? " compact-badge" : ""}`}
          title={formatRemindShort(remindAt, t, dateLocale())}
        >
          {density === "initial" ? "⏰" : `⏰ ${formatRemindShort(remindAt, t, dateLocale())}`}
        </span>
      ) : null}
      {density === "initial" ? (
        <div className="note-initial" aria-label={title}>
          {icon || initial}
        </div>
      ) : (
        <div className="note-title">
          {icon ? <span className="note-icon">{icon}</span> : null}
          <span className="note-title-text">{title}</span>
        </div>
      )}
    </article>
  );
}

function CompactIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 8h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 6v4M6 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function formatStamp(ms: number) {
  return new Date(ms).toLocaleString(dateLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBackupDate(ms: number) {
  return new Date(ms).toLocaleDateString(dateLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatBackupOption(item: BackupInfo, translate: (key: string, german: string) => string) {
  const kind =
    item.kind === "weekly"
      ? translate("backupWeekly", "wöchentlich")
      : item.kind === "monthly"
        ? translate("backupMonthly", "monatlich")
        : item.kind === "scheduled"
          ? translate("backupScheduled", "Backup")
          : translate("backupArchive", "Archiv");
  return `${formatBackupDate(item.date)} · ${kind}`;
}

function formatArchiveOption(item: Note, translate: (key: string, german: string) => string) {
  const title = item.title?.trim() || translate("emptyNote", "Leere Notiz");
  const stamp = formatBackupDate(item.deletedAt || item.updatedAt);
  return `${title} · ${stamp}`;
}

const NOTE_CARD_MAX = 260;
/** Compact window always fits this many full-size notes (or fewer if less exist). */
const COMPACT_FIT_NOTES = 5;
/** App minimum height always fits at least this many full notes. */
const COMPACT_MIN_NOTES = 2;
const FULL_CARD_H = 48;
const SMALL_CARD_H = 34;
const INITIAL_TILE = 40;
const CARD_GAP = 9;
const SMALL_GAP = 6;
/** Shell border 1+1 + board pad 6+6 + cards pad 8+8 — even L/R at min width. */
const COMPACT_SIDE_CHROME = 30;
/** Vertical pad under/above note stack in compact mode. */
const COMPACT_V_PAD = 24;

function noteStackHeight(count: number) {
  const n = Math.max(0, count);
  if (n <= 0) return 0;
  return n * FULL_CARD_H + Math.max(0, n - 1) * CARD_GAP;
}

function measureCompactSize(noteCount: number) {
  const bar = document.querySelector(".compact-bar");
  const barH = bar?.getBoundingClientRect().height ?? 32;
  const fit = Math.min(Math.max(noteCount, COMPACT_MIN_NOTES), COMPACT_FIT_NOTES);
  const minHeight = Math.ceil(barH + noteStackHeight(COMPACT_MIN_NOTES) + COMPACT_V_PAD);
  const height = Math.ceil(barH + noteStackHeight(fit) + COMPACT_V_PAD);
  return {
    width: NOTE_CARD_MAX + COMPACT_SIDE_CHROME,
    height: Math.max(minHeight, height),
    minHeight,
  };
}

function noteInitial(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  const ch = [...trimmed][0] || "?";
  return ch.toLocaleUpperCase();
}

function pickNoteDensity(noteCount: number, width: number, height: number): NoteDensity {
  const n = Math.max(0, noteCount);
  if (n <= COMPACT_FIT_NOTES) return "full";
  if (width < 8 || height < 8) return "full";

  const fullNeed = noteStackHeight(n);
  if (fullNeed <= height) return "full";

  const smallNeed = n * SMALL_CARD_H + Math.max(0, n - 1) * SMALL_GAP;
  if (smallNeed <= height) return "small";

  const cols = Math.max(1, Math.floor((width + SMALL_GAP) / (INITIAL_TILE + SMALL_GAP)));
  const rows = Math.ceil(n / cols);
  const gridNeed = rows * INITIAL_TILE + Math.max(0, rows - 1) * SMALL_GAP;
  if (gridNeed <= height + 8) return "initial";

  // Still cramped: stay on letter tiles so the grid can scroll.
  return "initial";
}

function NotePreview({ note }: { note: Note | null }) {
  const t = useT();
  if (!note) {
    return (
      <aside className="preview-pane">
        <div className="preview-empty">
          <span className="preview-empty-mark" />
          {t("previewEmpty", "Eine Notiz anklicken, um die Vorschau zu sehen.")}
        </div>
      </aside>
    );
  }

  return <PreviewEditor key={note.id} note={note} />;
}

function PreviewEditor({ note }: { note: Note }) {
  const t = useT();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [saved, setSaved] = useState(note);
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const titleTouched = useRef(note.titleIsManual);
  const dirty = useRef(false);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    if (dirty.current) return;
    titleTouched.current = note.titleIsManual;
    setTitle(note.title);
    setBody(note.body);
    setSaved(note);
  }, [note]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (!dirty.current) return;
      void window.notesApi.updateNote({
        id: note.id,
        title: titleRef.current,
        body: bodyRef.current,
        titleIsManual: titleTouched.current,
      });
    };
  }, [note.id]);

  function queueSave(nextTitle: string, nextBody: string) {
    dirty.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.notesApi
        .updateNote({
          id: note.id,
          title: nextTitle,
          body: nextBody,
          titleIsManual: titleTouched.current,
        })
        .then((next) => {
          if (!next) return;
          if (titleRef.current === nextTitle && bodyRef.current === nextBody) {
            dirty.current = false;
          }
          setSaved(next);
        });
    }, 400);
  }

  return (
    <aside className="preview-pane">
      <div className="preview-toolbar">
        <span>{t("preview", "Vorschau")}</span>
        <button
          className="ghost-btn"
          onClick={() => void window.notesApi.openEditor(note.id)}
        >
          {t("open", "Öffnen")}
        </button>
      </div>
      <div
        className={`preview-paper${note.color ? " has-color" : ""}`}
        style={note.color ? { ["--note-color" as string]: note.color } : undefined}
      >
        <input
          className="preview-title"
          value={title}
          placeholder={t("titlePlaceholder", "Titel (leer = aus den ersten Zeilen)")}
          onChange={(e) => {
            const value = e.target.value;
            titleTouched.current = value.trim().length > 0;
            setTitle(value);
            queueSave(value, body);
          }}
        />
        <div className="preview-meta">
          <span>{t("created", "Erstellt {date}", { date: formatStamp(saved.createdAt) })}</span>
          <span>{t("updated", "Geändert {date}", { date: formatStamp(saved.updatedAt) })}</span>
          <span>{t("previewAutoSave", "Änderungen werden automatisch gespeichert.")}</span>
        </div>
        <textarea
          className="preview-editor"
          value={body}
          placeholder={t("bodyPlaceholder", "Notiz schreiben…")}
          onChange={(e) => {
            const value = e.target.value;
            setBody(value);
            queueSave(title, value);
          }}
        />
      </div>
    </aside>
  );
}

