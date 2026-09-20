import { useEffect, useMemo, useState } from "react";
import type { Board, Note, Settings } from "../types";
import RichText from "../RichText";
import { dateLocale, setLocale, useT } from "../i18n";

export default function OverlayApp() {
  const [board, setBoard] = useState<Board>({ groups: [], notes: [] });
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    openAtLogin: false,
    jsonPath: "",
    autoSave: true,
    opacity: 1,
    locale: "de",
  });
  const [toast, setToast] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    noteId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const t = useT();

  async function refresh() {
    const next = await window.notesApi.getBoard();
    setBoard(next);
  }

  useEffect(() => {
    void refresh();
    void window.notesApi.getSettings().then((next) => {
      setSettings((current) => ({ ...current, ...next }));
      setLocale(next.locale);
    });
    const offBoard = window.notesApi.onBoardChanged(() => {
      void refresh();
    });
    const offLocale = window.notesApi.onLocaleChanged((locale) => {
      setLocale(locale);
      setSettings((current) => ({ ...current, locale }));
    });
    return () => {
      offBoard();
      offLocale();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    if (selectedId && !board.notes.some((note) => note.id === selectedId)) {
      setSelectedId(null);
    }
  }, [board.notes, selectedId]);

  const selectedNote = useMemo(
    () => board.notes.find((note) => note.id === selectedId) ?? null,
    [board.notes, selectedId],
  );

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

  async function showSettings() {
    const next = await window.notesApi.getSettings();
    setSettings((current) => ({ ...current, ...next }));
    setLocale(next.locale);
    setSettingsOpen((v) => !v);
  }

  async function pickJsonPath(createNew: boolean) {
    const next = await window.notesApi.chooseJsonPath(createNew);
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

  return (
    <div
      className="overlay-shell"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (menu && !target.closest(".note-menu")) setMenu(null);
        if (!settingsOpen) return;
        if (target.closest(".settings-panel") || target.closest("[data-settings-btn]")) return;
        setSettingsOpen(false);
      }}
    >
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
            onClick={() => void window.notesApi.hideOverlay()}
            title={t("hideOverlayTitle", "Am Desktop verankern")}
          >
            {t("hideOverlay", "Ausblenden")}
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <aside className="settings-panel">
          <h3>{t("settingsTitle", "Einstellungen")}</h3>
          <label className="lang-row">
            {t("language", "Sprache")}
            <select
              value={settings.locale || "de"}
              onChange={async (e) => {
                const locale = e.target.value === "en" ? "en" : "de";
                setLocale(locale);
                const next = await window.notesApi.setLocale(locale);
                setSettings((current) => ({ ...current, ...next }));
              }}
            >
              <option value="de">{t("languageDe", "Deutsch")}</option>
              <option value="en">{t("languageEn", "English")}</option>
            </select>
          </label>
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
                    ? t("autostartOn", "Autostart aktiv – startet mit Windows")
                    : t("autostartOff", "Autostart deaktiviert"),
                );
              }}
            />
            {t("openAtLogin", "Mit Windows starten")}
          </label>
          <p>{t("autostartHint", "Im Entwicklungsmodus startet Windows die Datei start.bat (ein Terminal-Fenster ist normal).")}</p>
          <div className="slider-row">
            <div className="slider-head">
              <span>{t("opacity", "Deckkraft")}</span>
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
            <p>{t("opacityHint", "Niedriger macht das Fenster durchsichtiger.")}</p>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={async (e) => {
                const next = await window.notesApi.setAutoSave(e.target.checked);
                setSettings((current) => ({ ...current, ...next }));
                setToast(
                  next.autoSave
                    ? t("autoSaveOn", "Automatisches Speichern aktiv")
                    : t("autoSaveOff", "Automatisches Speichern aus"),
                );
              }}
            />
            {t("autoSave", "Bei jeder Änderung in JSON speichern")}
          </label>
          <p>
            {t(
              "backupHint",
              "Im gleichen Ordner entstehen automatisch Backups: eine wöchentliche und eine monatliche Datei (jeweils überschrieben) sowie alle sechs Monate eine neue, datierte Datei.",
            )}
          </p>
          <p>
            {t(
              "jsonHint",
              "Lege den Speicherort z. B. in deinen Google-Drive-Ordner, dann wird die Datei dort laufend aktualisiert und in der Cloud gesichert. Existiert die Datei bereits, werden die Notizen importiert und mit den vorhandenen abgeglichen.",
            )}
          </p>
          <p className="path-line">{settings.jsonPath || t("jsonNone", "Kein Pfad gewählt")}</p>
          <div className="settings-row">
            <button className="ghost-btn" onClick={() => void pickJsonPath(false)}>
              {t("jsonOpen", "JSON-Datei öffnen (Import)")}
            </button>
            <button className="ghost-btn" onClick={() => void pickJsonPath(true)}>
              {t("jsonCreate", "Neue JSON-Datei anlegen")}
            </button>
          </div>
        </aside>
      ) : null}

      <div className="workspace">
      <div className="board">
        {board.groups.map((group) => (
          <GroupColumn
            key={group.id}
            groupId={group.id}
            title={group.name}
            notes={notesIn(group.id)}
            dropActive={dropGroup === group.id}
            draggingId={draggingId}
            selectedId={selectedId}
            canDelete={board.groups.length > 1}
            onRename={async (name) => {
              await window.notesApi.renameGroup(group.id, name);
              await refresh();
            }}
            onDelete={async () => {
              if (board.groups.length <= 1) {
                setToast(t("lastGroup", "Mindestens eine Gruppe muss bleiben"));
                return;
              }
              const fallback =
                board.groups.find((item) => item.id !== group.id && item.name === "Allgemein")
                  ?.name ??
                board.groups.find((item) => item.id !== group.id)?.name ??
                "Allgemein";
              const ok = await window.notesApi.confirm({
                title: t("deleteGroup", "Gruppe löschen"),
                message: t(
                  "deleteGroupMessage",
                  "Gruppe „{name}“ löschen? Notizen landen in „{fallback}“.",
                  { name: group.name, fallback },
                ),
                ok: t("delete", "Löschen"),
              });
              if (!ok) return;
              const removed = await window.notesApi.deleteGroup(group.id);
              if (!removed) {
                setToast(t("lastGroup", "Mindestens eine Gruppe muss bleiben"));
                return;
              }
              await refresh();
            }}
            onAddNote={async () => {
              const note = await window.notesApi.createNote(group.id);
              setSelectedId(note.id);
              await window.notesApi.openEditor(note.id);
            }}
            onSelect={setSelectedId}
            onDragStart={(id) => {
              setDraggingGroup(null);
              setDraggingId(id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDraggingGroup(null);
              setDropGroup(null);
            }}
            onDragOver={() => setDropGroup(group.id)}
            onDropCard={(index) => void onDrop(group.id, index)}
            onDropGroup={() => void onDropGroup(group.id)}
            onGroupDragStart={setDraggingGroup}
            onOpenMenu={(note, x, y) => {
              setSettingsOpen(false);
              setMenu({ noteId: note.id, title: note.title, x, y });
            }}
          />
        ))}
      </div>
      <NotePreview
        note={selectedNote}
        onCopied={(message) => setToast(message)}
      />
      </div>
      {menu ? (
        <div
          className="note-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={async () => {
              setMenu(null);
              const ok = await window.notesApi.confirm({
                title: t("deleteNote", "Notiz löschen"),
                message: t("deleteNoteMessage", "„{title}“ wirklich löschen?", {
                  title: menu.title,
                }),
                ok: t("delete", "Löschen"),
              });
              if (!ok) return;
              await window.notesApi.deleteNote(menu.noteId);
              await refresh();
            }}
          >
            {t("delete", "Löschen")}
          </button>
          <button
            type="button"
            onClick={async () => {
              const copied = await window.notesApi.copyNote(menu.noteId);
              setMenu(null);
              setToast(
                copied
                  ? t("noteCopied", "Notiz kopiert")
                  : t("copyFailed", "Kopieren fehlgeschlagen"),
              );
            }}
          >
            {t("copy", "Kopieren")}
          </button>
          <button type="button" onClick={() => setMenu(null)}>
            {t("cancel", "Abbrechen")}
          </button>
        </div>
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
      <div className="resize-grip" title={t("resize", "Größe ändern")} />
    </div>
  );
}

function GroupColumn(props: {
  title: string;
  groupId?: string;
  locked?: boolean;
  canDelete?: boolean;
  notes: Note[];
  dropActive: boolean;
  draggingId: string | null;
  selectedId: string | null;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddNote: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDropCard: (index: number) => void;
  onDropGroup: () => void;
  onGroupDragStart: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenMenu: (note: Note, x: number, y: number) => void;
}) {
  const [name, setName] = useState(props.title);
  useEffect(() => setName(props.title), [props.title]);
  const t = useT();

  return (
    <section
      className={`column${props.dropActive ? " drop-target" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (props.locked) {
          props.onDropCard(props.notes.length);
          return;
        }
        if (props.draggingId) props.onDropCard(props.notes.length);
        else props.onDropGroup();
      }}
    >
      <div
        className="column-head"
        draggable={!props.locked}
        onDragStart={(e) => {
          if (props.locked) return;
          e.dataTransfer.effectAllowed = "move";
          props.onGroupDragStart(props.groupId ?? "");
        }}
      >
        <input
          className="column-title"
          value={name}
          disabled={props.locked}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!props.locked && name.trim() && name !== props.title) {
              props.onRename(name.trim());
            } else {
              setName(props.title);
            }
          }}
        />
        <span className="column-count">{props.notes.length}</span>
        {!props.locked && props.canDelete !== false ? (
          <button className="icon-btn danger" onClick={props.onDelete} title={t("deleteGroup", "Gruppe löschen")}>
            ×
          </button>
        ) : null}
      </div>
      <div className="cards">
        {props.notes.length === 0 ? (
          <div className="empty-hint">{t("dropHint", "Karten hierher ziehen")}</div>
        ) : null}
        {props.notes.map((note, index) => (
          <article
            key={note.id}
            className={`note-card${props.draggingId === note.id ? " dragging" : ""}${
              props.selectedId === note.id ? " selected" : ""
            }`}
            style={{ zIndex: index + 1 }}
            draggable
            onClick={() => props.onSelect(note.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", note.id);
              e.dataTransfer.effectAllowed = "move";
              props.onDragStart(note.id);
            }}
            onDragEnd={props.onDragEnd}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDropCard(index);
            }}
            onDoubleClick={() => void window.notesApi.openEditor(note.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onSelect(note.id);
              const shell = (e.currentTarget.closest(".overlay-shell") as HTMLElement | null);
              const rect = shell?.getBoundingClientRect();
              const x = rect ? e.clientX - rect.left : e.clientX;
              const y = rect ? e.clientY - rect.top : e.clientY;
              const maxX = Math.max(8, (rect?.width ?? 320) - 180);
              const maxY = Math.max(8, (rect?.height ?? 240) - 140);
              props.onOpenMenu(
                note,
                Math.min(Math.max(8, x), maxX),
                Math.min(Math.max(8, y), maxY),
              );
            }}
          >
            <div className="note-title">{note.title || t("emptyNote", "Leere Notiz")}</div>
          </article>
        ))}
      </div>
      <button className="ghost-btn column-add" onClick={props.onAddNote}>
        {t("addNote", "+ Notiz")}
      </button>
    </section>
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

function NotePreview({
  note,
  onCopied,
}: {
  note: Note | null;
  onCopied: (message: string) => void;
}) {
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

  const body = note.body.trim();

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
      <div className="preview-paper">
        <h2>
          <RichText text={note.title || t("emptyNote", "Leere Notiz")} onCopied={onCopied} />
        </h2>
        <div className="preview-meta">
          <span>{t("created", "Erstellt {date}", { date: formatStamp(note.createdAt) })}</span>
          <span>{t("updated", "Geändert {date}", { date: formatStamp(note.updatedAt) })}</span>
        </div>
        <div className="preview-body">
          {body ? <RichText text={note.body} onCopied={onCopied} /> : t("noText", "Noch kein Text.")}
        </div>
      </div>
    </aside>
  );
}

