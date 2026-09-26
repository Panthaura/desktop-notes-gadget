import { useEffect, useRef, useState } from "react";
import type { Note } from "../types";
import RichText from "../RichText";
import { useConfirm } from "../ConfirmDialog";
import { dateLocale, setLocale, useT } from "../i18n";

function formatStamp(ms: number) {
  return new Date(ms).toLocaleString(dateLocale());
}

export default function EditorApp({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingBody, setEditingBody] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const t = useT();
  const [askConfirm, confirmDialog] = useConfirm();
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const titleTouched = useRef(false);
  const loaded = useRef(false);
  const dirty = useRef(false);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    dirty.current = false;
    void (async () => {
      const loadedNote = await window.notesApi.getNote(noteId);
      if (cancelled) return;
      if (!loadedNote) {
        setMissing(true);
        return;
      }
      titleTouched.current = loadedNote.titleIsManual;
      titleRef.current = loadedNote.title;
      bodyRef.current = loadedNote.body;
      loaded.current = true;
      setNote(loadedNote);
      setTitle(loadedNote.title);
      setBody(loadedNote.body);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    void window.notesApi.getSettings().then((next) => setLocale(next.locale));
    return window.notesApi.onLocaleChanged((locale) => setLocale(locale));
  }, []);

  useEffect(() => {
    return window.notesApi.onBoardChanged(() => {
      void (async () => {
        const loadedNote = await window.notesApi.getNote(noteId);
        if (!loadedNote) {
          window.close();
          return;
        }
        setNote((current) => {
          if (!current) return loadedNote;
          return {
            ...loadedNote,
            title: dirty.current ? current.title : loadedNote.title,
            body: dirty.current ? current.body : loadedNote.body,
            titleIsManual: dirty.current ? current.titleIsManual : loadedNote.titleIsManual,
          };
        });
        if (!dirty.current) {
          titleTouched.current = loadedNote.titleIsManual;
          setTitle(loadedNote.title);
          setBody(loadedNote.body);
        }
      })();
    });
  }, [noteId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (!loaded.current || !dirty.current) return;
      void window.notesApi.updateNote({
        id: noteId,
        title: titleRef.current,
        body: bodyRef.current,
        titleIsManual: titleTouched.current,
      });
    };
  }, [noteId]);

  function queueSave(nextTitle: string, nextBody: string) {
    if (!loaded.current) return;
    dirty.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.notesApi
        .updateNote({
          id: noteId,
          title: nextTitle,
          body: nextBody,
          titleIsManual: titleTouched.current,
        })
        .then((saved) => {
          if (!saved) {
            window.close();
            return;
          }
          if (titleRef.current === nextTitle && bodyRef.current === nextBody) {
            dirty.current = false;
          }
          setNote(saved);
        });
    }, 400);
  }

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (missing) {
    return (
      <div className="editor-shell">
        <p className="empty-hint">{t("noteDeleted", "Notiz wurde gelöscht.")}</p>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="editor-shell">
        <p className="empty-hint">{t("noteLoading", "Notiz wird geladen…")}</p>
      </div>
    );
  }

  const noteColor = note.color?.trim() || "";

  return (
    <div
      className={`editor-shell${noteColor ? " has-color" : ""}`}
      style={noteColor ? { ["--note-color" as string]: noteColor } : undefined}
    >
      <div className="editor-bar">
        <input
          value={title}
          placeholder={t("titlePlaceholder", "Titel (leer = aus den ersten Zeilen)")}
          onChange={(e) => {
            const value = e.target.value;
            titleTouched.current = value.trim().length > 0;
            setTitle(value);
            queueSave(value, body);
          }}
        />
        <div className="editor-meta">
          <span>{t("created", "Erstellt {date}", { date: formatStamp(note.createdAt) })}</span>
          <span>{t("updated", "Geändert {date}", { date: formatStamp(note.updatedAt) })}</span>
          <button
            className="ghost-btn"
            onClick={async () => {
              const ok = await askConfirm({
                title: t("deleteNote", "Notiz löschen"),
                message: t("deleteNoteSimple", "Diese Notiz wirklich löschen?"),
                ok: t("delete", "Löschen"),
              });
              if (!ok) return;
              await window.notesApi.deleteNote(noteId);
            }}
          >
            {t("delete", "Löschen")}
          </button>
        </div>
      </div>
      {editingBody || !body.trim() ? (
        <textarea
          value={body}
          autoFocus={editingBody}
          placeholder={t("bodyPlaceholder", "Notiz schreiben…")}
          onChange={(e) => {
            const value = e.target.value;
            setBody(value);
            queueSave(title, value);
          }}
          onBlur={() => setEditingBody(false)}
        />
      ) : (
        <div className="editor-rich" onClick={() => setEditingBody(true)}>
          <RichText text={body} onCopied={setCopied} />
          <div className="editor-rich-hint">{t("editHint", "Zum Bearbeiten in den Text klicken")}</div>
        </div>
      )}
      {confirmDialog}
      {copied ? <div className="toast">{copied}</div> : null}
    </div>
  );
}
