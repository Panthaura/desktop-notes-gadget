import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Note } from "../types";
import { dateLocale, setLocale, useT } from "../i18n";
import { applyPalette } from "../themeColors";
import {
  NOTE_COLOR_PALETTE,
  NOTE_EMOJI_PICKER,
  formatRemindShort,
  toDatetimeLocalValue,
  tomorrowAtNine,
} from "./menuShared";

type Panel = "main" | "icon" | "remind";
type PresentPayload = {
  kind: "note" | "shell";
  note: Note | null;
  colors: { colorBg: string; colorAccent: string; colorBlink: string };
  locale: "de" | "en";
};

export default function CtxMenuApp() {
  const t = useT();
  const [present, setPresent] = useState<PresentPayload | null>(null);
  const [panel, setPanel] = useState<Panel>("main");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const readySent = useRef(0);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
  }, []);

  useEffect(() => {
    function applyPresent(payload: PresentPayload | null | undefined) {
      if (!payload) return;
      if (payload.colors) {
        applyPalette(payload.colors.colorBg, payload.colors.colorAccent, payload.colors.colorBlink);
      }
      if (payload.locale) setLocale(payload.locale);
      setPanel("main");
      readySent.current = 0;
      setPresent({
        kind: payload.kind === "shell" ? "shell" : "note",
        note: payload.note ?? null,
        colors: payload.colors,
        locale: payload.locale === "en" ? "en" : "de",
      });
    }

    void window.notesApi.takeCtxPresent().then((payload) => {
      applyPresent(payload as PresentPayload | null);
    });
    return window.notesApi.onCtxMenuPresent((payload) => {
      applyPresent(payload as PresentPayload);
    });
  }, []);

  useLayoutEffect(() => {
    if (!present) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = {
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    };
    readySent.current += 1;
    const token = readySent.current;
    void window.notesApi.ctxMenuReady(size).then(() => {
      if (token !== readySent.current) return;
    });
  }, [present, panel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") void window.notesApi.closeCtxMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function patchNote(
    patch: Partial<{
      color: string | null;
      icon: string | null;
      highlight: boolean;
      remindAt: number | null;
    }>,
  ) {
    const noteId = present?.note?.id;
    if (!noteId) return;
    await window.notesApi.updateNote({ id: noteId, ...patch });
    await window.notesApi.closeCtxMenu();
  }

  async function close() {
    await window.notesApi.closeCtxMenu();
  }

  // Keep window blank until real payload arrives — avoids theme/note flash.
  if (!present) {
    return <div className="ctx-menu-root" ref={rootRef} />;
  }

  const kind = present.kind;
  const note = present.note;

  if (kind === "shell") {
    return (
      <div className="ctx-menu-root" ref={rootRef}>
        <div className="note-menu shell-menu ctx-menu-panel">
          <button
            type="button"
            onClick={async () => {
              const created = await window.notesApi.createNote(null);
              await window.notesApi.openEditor(created.id);
              await close();
            }}
          >
            {t("addNote", "+ Notiz")}
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.notesApi.createGroup(t("newGroup", "Neue Gruppe"));
              await close();
            }}
          >
            {t("addGroup", "+ Gruppe")}
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.notesApi.openOverlaySettings();
              await close();
            }}
          >
            {t("settings", "Einstellungen")}
          </button>
          <button type="button" onClick={() => void close()}>
            {t("cancel", "Abbrechen")}
          </button>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="ctx-menu-root" ref={rootRef}>
        <div className="note-menu ctx-menu-panel">
          <button type="button" onClick={() => void close()}>
            {t("cancel", "Abbrechen")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ctx-menu-root" ref={rootRef}>
      <div className="note-menu ctx-menu-panel">
        {panel === "main" ? (
          <>
            <div className="menu-section-label">{t("noteColor", "Farbe")}</div>
            <div className="color-swatches">
              <button
                type="button"
                className={`color-swatch default${!note.color ? " active" : ""}`}
                title={t("noteColorDefault", "Standard")}
                onClick={() => void patchNote({ color: null })}
              />
              {NOTE_COLOR_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`color-swatch${note.color === hex ? " active" : ""}`}
                  style={{ background: hex }}
                  title={hex}
                  onClick={() => void patchNote({ color: hex })}
                />
              ))}
            </div>
            <button type="button" onClick={() => setPanel("icon")}>
              {t("noteIcon", "Icon…")}
              {note.icon ? ` ${note.icon}` : ""}
            </button>
            <button
              type="button"
              onClick={() => void patchNote({ highlight: !Boolean(note.highlight) })}
            >
              {note.highlight
                ? t("noteHighlightOff", "Blinken aus")
                : t("noteHighlightOn", "Blinken an")}
            </button>
            <button type="button" onClick={() => setPanel("remind")}>
              {note.remindAt
                ? t("noteRemindEdit", "Erinnerung… ({when})", {
                    when: formatRemindShort(note.remindAt, t, dateLocale()),
                  })
                : t("noteRemind", "Erinnerung…")}
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const title = note.title || t("emptyNote", "Leere Notiz");
                const ok = await window.notesApi.confirm({
                  title: t("deleteNote", "Notiz löschen"),
                  message: t("deleteNoteMessage", "„{title}“ wirklich löschen?", { title }),
                  ok: t("delete", "Löschen"),
                });
                if (!ok) return;
                await window.notesApi.deleteNote(note.id);
                await close();
              }}
            >
              {t("delete", "Löschen")}
            </button>
            <button
              type="button"
              onClick={async () => {
                await window.notesApi.copyNote(note.id);
                await close();
              }}
            >
              {t("copy", "Kopieren")}
            </button>
            <button type="button" onClick={() => void close()}>
              {t("cancel", "Abbrechen")}
            </button>
          </>
        ) : null}
        {panel === "icon" ? (
          <>
            <div className="menu-section-label">{t("noteIcon", "Icon")}</div>
            <div className="emoji-grid">
              {NOTE_EMOJI_PICKER.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`emoji-btn${note.icon === emoji ? " active" : ""}`}
                  onClick={() => void patchNote({ icon: emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void patchNote({ icon: null })}>
              {t("noteIconClear", "Icon entfernen")}
            </button>
            <button type="button" onClick={() => setPanel("main")}>
              {t("back", "Zurück")}
            </button>
          </>
        ) : null}
        {panel === "remind" ? (
          <>
            <div className="menu-section-label">{t("noteRemind", "Erinnerung")}</div>
            <button
              type="button"
              onClick={() => void patchNote({ remindAt: Date.now() + 5 * 60_000 })}
            >
              {t("remindIn5", "In 5 Minuten")}
            </button>
            <button
              type="button"
              onClick={() => void patchNote({ remindAt: Date.now() + 15 * 60_000 })}
            >
              {t("remindIn15", "In 15 Minuten")}
            </button>
            <button
              type="button"
              onClick={() => void patchNote({ remindAt: Date.now() + 60 * 60_000 })}
            >
              {t("remindIn60", "In 1 Stunde")}
            </button>
            <button type="button" onClick={() => void patchNote({ remindAt: tomorrowAtNine() })}>
              {t("remindTomorrow9", "Morgen 09:00")}
            </button>
            <label className="menu-datetime">
              <span>{t("remindCustom", "Datum / Uhrzeit")}</span>
              <input
                type="datetime-local"
                min={toDatetimeLocalValue(Date.now())}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  const ms = new Date(value).getTime();
                  if (!Number.isFinite(ms) || ms <= Date.now()) return;
                  void patchNote({ remindAt: ms });
                }}
              />
            </label>
            {note.remindAt ? (
              <button type="button" onClick={() => void patchNote({ remindAt: null })}>
                {t("remindClear", "Timer löschen")}
              </button>
            ) : null}
            <button type="button" onClick={() => setPanel("main")}>
              {t("back", "Zurück")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
