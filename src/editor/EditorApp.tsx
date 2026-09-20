import { useEffect, useRef, useState } from "react";
import type { Note } from "../types";
import RichText from "../RichText";
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
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  const titleTouched = useRef(false);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    void (async () => {
      const loaded = await window.notesApi.getNote(noteId);
      if (!loaded) {
        setMissing(true);
        return;
      }
      titleTouched.current = loaded.titleIsManual;
      setNote(loaded);
      setTitle(loaded.title);
      setBody(loaded.body);
    })();
  }, [noteId]);

  useEffect(() => {
    void window.notesApi.getSettings().then((next) => setLocale(next.locale));
    return window.notesApi.onLocaleChanged((locale) => setLocale(locale));
  }, []);

  useEffect(() => {
    return window.notesApi.onBoardChanged(() => {
      void (async () => {
        const loaded = await window.notesApi.getNote(noteId);
        if (!loaded) window.close();
      })();
    });
  }, [noteId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void window.notesApi.updateNote({
        id: noteId,
        title: titleRef.current,
        body: bodyRef.current,
        titleIsManual: titleTouched.current,
      });
    };
  }, [noteId]);

  function queueSave(nextTitle: string, nextBody: string) {
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

  return (
    <div className="editor-shell">
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
              const ok = await window.notesApi.confirm({
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
      {copied ? <div className="toast">{copied}</div> : null}
    </div>
  );
}
