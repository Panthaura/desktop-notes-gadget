# Desktop Notes

Windows-Desktop-Gadget als Alternative zu Windows 11 Notes. Gelbe Notizkarten liegen als Overlay auf dem Desktop, mit Gruppen, Suche, Vorschau und einem eigenen Editor-Fenster.

Notizen bleiben lokal in SQLite und können fortlaufend in eine JSON-Datei geschrieben werden. Standard ist der Installationsordner bzw. der Ordner der portablen EXE; der Speicherort lässt sich unter **Datenbank speichern unter…** ändern.

## Installation

Nach `npm run dist` liegen die Dateien im Ordner `release/` (und zusätzlich unter `%LOCALAPPDATA%\desktop-notes-release`, falls der Desktop-Ordner gesperrt ist):

- **Setup:** `Desktop Notes Setup 1.0.3.exe` – Installer mit Startmenü- und Desktop-Verknüpfung, Verzeichniswahl und deutscher Oberfläche
- **Portable EXE:** `Desktop Notes 1.0.3.exe` – startet ohne Installation

Das Overlay passt sich beim Vergrößern und Verkleinern an: Die Notizen bleiben immer sichtbar. Menü und Vorschau blenden sich im Kompaktmodus aus. Gruppen liegen eingerückt unter dem Tab **Notes**. Beim ersten Start der EXE kannst du Deutsch oder English wählen.

Während der Entwicklung:

```powershell
npm install
npm run dev
```

Oder Doppelklick auf `start.bat`. Voraussetzung ist Node.js.

## Bedienung

- Overlay einblenden: Linksklick auf das gelbe Tray-Icon, `Strg+Alt+N` oder `Strg+Umschalt+N`
- Overlay am Desktop halten: daneben klicken
- Kompaktmodus: Button **Nur Notizen** oder das Fenster stark verkleinern – dann bleiben nur die Karten sichtbar
- Beenden: Tray-Menü → **Beenden**
- Doppelklick auf eine Karte öffnet den Editor
- Rechtsklick auf eine Karte: löschen oder gesamten Inhalt kopieren
- `https://`- und `mailto:`-Links in der Vorschau sind anklickbar
- Zahlenfolgen mit mehr als zwei Ziffern haben ein Kopier-Symbol; Bindestriche und ähnliche Zeichen dazwischen gehören zur gleichen Folge
- Gruppen erscheinen eingerückt unter **Notes**; Karten per Drag-and-Drop hinein- und herausziehen

## Einstellungen

- Mit Windows starten
- Immer im Vordergrund
- Transparenz
- Datenbank speichern unter…
- Backup: Intervall, Anzahl, wiederherstellen
- Sprache: DE / EN

Beim Öffnen einer vorhandenen JSON-Datei werden Notizen importiert und mit den lokalen abgeglichen. Bei Duplikaten kannst du die neuere oder ältere Version behalten.

Backups liegen im gleichen Ordner wie die JSON-Datei (`notes.backup-JJJJ-MM-TT.json`). Ältere weekly/monthly/6months-Dateien bleiben auswählbar. Es werden nur geänderte Stände gespeichert, und ältere Archive über der eingestellten Anzahl entfallen.

## Build

```powershell
npm install
npm run dist
```

Das erzeugt Icon, Renderer-Build, portable EXE und den Windows-Installer unter `release/`.

## Technik

Electron, React, Vite, TypeScript. Daten in `sql.js`. Desktop-Pin über `GadgetPin.exe` (Win32).
