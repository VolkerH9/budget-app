# Budget

Persönliche Budget-App für das iPhone. Alle Daten bleiben auf dem Gerät, es gibt keinen Server und kein Login.

## Auf dem iPhone installieren

1. Öffne die App-Adresse in **Safari**.
2. Tippe auf das Teilen-Symbol und dann auf **Zum Home-Bildschirm**.
3. Starte die App ab jetzt immer über das neue Icon. Die Daten gehören zur installierten App, nicht zum Safari-Tab.

## Belegscan einrichten

1. Erstelle ein Konto auf [console.anthropic.com](https://console.anthropic.com) und lade unter **Billing** ein kleines Guthaben auf.
2. Erstelle unter **API Keys** einen Schlüssel und kopiere ihn.
3. Füge ihn in der App ein: **Einstellungen › Belegscan**.

Ein Scan kostet etwa 0,05 bis 0,1 Cent (Modell Claude Haiku 5.5). Fünf Dollar reichen also für mehrere Tausend Scans. Das verkleinerte Foto geht beim Scan an Anthropic. Der Schlüssel bleibt auf dem iPhone und steht nie in diesem Projekt.

## Face ID einschalten

**Einstellungen › Face ID und PIN**: Schalte die App-Sperre ein, wähle eine 6-stellige PIN und schalte dann Face ID ein. Die PIN ist der Fallback, falls Face ID nicht klappt.

Die Sperre schützt vor neugierigen Blicken, ist aber keine Verschlüsselung. Daten und API-Schlüssel liegen unverschlüsselt im Speicher der App.

## Daueraufträge

**Einstellungen › Daueraufträge › Neuer Dauerauftrag**. Fällige Buchungen entstehen beim Öffnen der App, auch rückwirkend und nie doppelt. Gibt es den Buchungstag in einem Monat nicht, wird am letzten Tag des Monats gebucht. Eine Pause wird nicht nachgebucht.

## Backup

**Einstellungen › Backup exportieren** und die Datei über das Teilen-Menü in iCloud Drive sichern. API-Schlüssel und PIN sind bewusst nicht enthalten.

## Für die Entwicklung

```bash
npm install
npm run dev
npm test
npm run build
```

Jeder Push auf `main` testet die App und veröffentlicht sie über GitHub Actions auf GitHub Pages. Heißt das Repository nicht `budget-app`, muss `base` in `vite.config.ts` angepasst werden.
