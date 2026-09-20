import { useEffect, useMemo, useRef, useState } from "react";
import type { Board, Group, Note, Settings } from "../types";
import RichText from "../RichText";
import { useConfirm } from "../ConfirmDialog";
import { dateLocale, setLocale, useT } from "../i18n";

export default function OverlayApp() {
  const [board, setBoard] = useState<Board>({ groups: [], notes: [], defaultGroupId: null });
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    openAtLogin: false,
    jsonPath: "",
    autoSave: true,
    opacity: 1,
    alwaysOnTop: false,
    previewSplit: 38,
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
  const [splitDragging, setSplitDragging] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const previewSplitRef = useRef(38);
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

  const previewSplit = Math.min(70, Math.max(22, settings.previewSplit ?? 38));
  previewSplitRef.current = previewSplit;

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

  async function showSettings() {
    const next = await window.notesApi.getSettings();
    setSettings((current) => ({ ...current, ...next }));
    setLocale(next.locale);
    setSettingsOpen((v) => !v);
  }

  const defaultGroupId = board.defaultGroupId ?? board.groups[0]?.id ?? null;
  const defaultGroup = board.groups.find((group) => group.id === defaultGroupId) ?? null;
  const nestedGroups = board.groups.filter((group) => group.id !== defaultGroupId);

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

  return (
    <div
      className="overlay-shell"
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".confirm-backdrop") || target.closest(".confirm-dialog")) return;
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
                    ? t("alwaysOnTopOn", "Dauerhaft im Vordergrund")
                    : t("alwaysOnTopOff", "Vordergrund nur bis zum nächsten Klick daneben"),
                );
              }}
            />
            {t("alwaysOnTop", "Overlay dauerhaft im Vordergrund halten")}
          </label>
          <p>{t("alwaysOnTopHint", "Bleibt über anderen Fenstern. Ein Klick daneben verankert es dann nicht am Desktop.")}</p>
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
              "Standard ist der Ordner der App bzw. der portablen EXE. Mit „Datenbank speichern unter…“ wählst du z. B. einen Google-Drive-Ordner. Existiert die Datei bereits, werden die Notizen importiert und abgeglichen.",
            )}
          </p>
          <p className="path-line">{settings.jsonPath || t("jsonNone", "Kein Pfad gewählt")}</p>
          <div className="settings-row">
            <button className="ghost-btn" onClick={() => void pickJsonPath()}>
              {t("jsonSaveAs", "Datenbank speichern unter…")}
            </button>
          </div>
        </aside>
      ) : null}

      <div
        className={`workspace${splitDragging ? " splitting" : ""}`}
        ref={workspaceRef}
        style={{ ["--preview-size" as string]: `${previewSplit}%` }}
      >
      <div className="board">
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
            onDragOverGroup={setDropGroup}
            onDropCard={(groupId, index) => void onDrop(groupId, index)}
            onDropGroup={(targetId) => void onDropGroup(targetId)}
            onGroupDragStart={(id) => {
              setDraggingId(null);
              setDraggingGroup(id);
            }}
            onOpenMenu={(note, x, y) => {
              setSettingsOpen(false);
              setMenu({ noteId: note.id, title: note.title, x, y });
            }}
          />
        ) : (
          <p className="empty-hint">{t("dropHint", "Karten hierher ziehen")}</p>
        )}
      </div>
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
              const ok = await askConfirm({
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
  onOpenMenu: (note: Note, x: number, y: number) => void;
};

function NotesColumn(props: NotesColumnProps) {
  const t = useT();
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
      <div className="column-head">
        <span className="column-title locked">{props.title}</span>
        <span className="column-count">{total}</span>
      </div>
      <div className="cards">
        {props.rootNotes.length === 0 && props.groups.length === 0 ? (
          <div className="empty-hint">{t("dropHint", "Karten hierher ziehen")}</div>
        ) : null}
        {props.rootNotes.map((note, index) => (
          <NoteCard
            key={note.id}
            note={note}
            index={index}
            draggingId={props.draggingId}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onDropCard={() => props.onDropCard(props.defaultGroupId, index)}
            onOpenMenu={props.onOpenMenu}
          />
        ))}
        {props.groups.map(({ group, notes }) => (
          <NestedGroup
            key={group.id}
            group={group}
            notes={notes}
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
          />
        ))}
      </div>
      <button className="ghost-btn column-add" onClick={() => props.onAddNote(props.defaultGroupId)}>
        {t("addNote", "+ Notiz")}
      </button>
    </section>
  );
}

function NestedGroup(props: {
  group: Group;
  notes: Note[];
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
  onOpenMenu: (note: Note, x: number, y: number) => void;
}) {
  const [name, setName] = useState(props.group.name);
  useEffect(() => setName(props.group.name), [props.group.name]);
  const t = useT();

  return (
    <div
      className={`note-group${props.dropActive ? " drop-target" : ""}`}
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
        <button className="icon-btn danger" onClick={props.onDelete} title={t("deleteGroup", "Gruppe löschen")}>
          ×
        </button>
      </div>
      {props.notes.length === 0 ? (
        <div className="empty-hint nested">{t("dropHint", "Karten hierher ziehen")}</div>
      ) : null}
      {props.notes.map((note, index) => (
        <NoteCard
          key={note.id}
          note={note}
          index={index}
          draggingId={props.draggingId}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          onDropCard={() => props.onDropCard(index)}
          onOpenMenu={props.onOpenMenu}
        />
      ))}
    </div>
  );
}

function NoteCard(props: {
  note: Note;
  index: number;
  draggingId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropCard: () => void;
  onOpenMenu: (note: Note, x: number, y: number) => void;
}) {
  const t = useT();
  return (
    <article
      className={`note-card${props.draggingId === props.note.id ? " dragging" : ""}${
        props.selectedId === props.note.id ? " selected" : ""
      }`}
      style={{ zIndex: props.index + 1 }}
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
        const shell = e.currentTarget.closest(".overlay-shell") as HTMLElement | null;
        const rect = shell?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : e.clientX;
        const y = rect ? e.clientY - rect.top : e.clientY;
        const maxX = Math.max(8, (rect?.width ?? 320) - 180);
        const maxY = Math.max(8, (rect?.height ?? 240) - 140);
        props.onOpenMenu(
          props.note,
          Math.min(Math.max(8, x), maxX),
          Math.min(Math.max(8, y), maxY),
        );
      }}
    >
      <div className="note-title">{props.note.title || t("emptyNote", "Leere Notiz")}</div>
    </article>
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

