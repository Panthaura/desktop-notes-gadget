import OverlayApp from "./overlay/OverlayApp";
import EditorApp from "./editor/EditorApp";
import { t, useT } from "./i18n";

export default function App() {
  useT();
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
  const params = new URLSearchParams(window.location.search);
  if (params.get("window") === "editor") {
    return <EditorApp noteId={params.get("id") ?? ""} />;
  }
  return <OverlayApp />;
}
