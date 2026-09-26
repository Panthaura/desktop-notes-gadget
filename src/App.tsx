import OverlayApp from "./overlay/OverlayApp";
import EditorApp from "./editor/EditorApp";
import CtxMenuApp from "./ctxmenu/CtxMenuApp";
import { t, useT } from "./i18n";
import { applyPalette } from "./themeColors";
import { useEffect } from "react";

export default function App() {
  useT();
  const params = new URLSearchParams(window.location.search);
  const windowKind = params.get("window");

  useEffect(() => {
    if (!window.notesApi) return;
    // Ctx menu applies theme synchronously from present payload — skip async paint flash.
    if (windowKind === "ctxmenu") return;
    function paint(next: { colorBg?: string; colorAccent?: string; colorBlink?: string }) {
      applyPalette(next.colorBg, next.colorAccent, next.colorBlink);
    }
    void window.notesApi.getSettings().then(paint);
    return window.notesApi.onThemeChanged(paint);
  }, [windowKind]);

  if (!window.notesApi) {
    return (
      <div className="overlay-shell">
        <p className="empty-hint">
          {t(
            "gadgetOnly",
            "Desktop Notes läuft als Windows-Gadget. Bitte mit npm run dev starten, nicht im Browser öffnen.",
          )}
        </p>
      </div>
    );
  }
  if (windowKind === "editor") {
    return <EditorApp noteId={params.get("id") ?? ""} />;
  }
  if (windowKind === "ctxmenu") {
    return <CtxMenuApp />;
  }
  return <OverlayApp />;
}
