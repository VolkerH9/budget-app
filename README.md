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

## Zugangscode und Face ID

Beim ersten Start legst du einen Zugangscode fest (mindestens 6 Zeichen). Alle Daten liegen damit verschlüsselt auf dem iPhone (AES-256, Schlüssel aus dem Code über PBKDF2). Ohne Code öffnet sich die App nicht.

- **Face ID**: Einstellungen › Zugangscode und Face ID. Der Code bleibt immer als Ersatz.
- **Falsche Codes**: Ab dem fünften Fehlversuch wartet die App, zuerst 30 Sekunden, am Ende bis zu einer Stunde.
- **Sperren im Hintergrund**: sofort, nach 1, 5 oder 15 Minuten.
- **Code vergessen**: Niemand kann die Daten dann entschlüsseln. Es bleibt nur „Code vergessen?“ auf dem Sperrbildschirm: Die App wird zurückgesetzt und du spielst dein letztes Backup ein. Bewahre den Code deshalb sicher auf, zum Beispiel in der Passwörter-App.

## Überkategorien, Eltern-Kosten und Auswertung

- **Überkategorien**: Einstellungen › Kategorien. Überkategorien anlegen, umbenennen, löschen; eine Kategorie verschiebst du, indem du sie antippst und eine andere Überkategorie wählst.
- **Eltern-Kosten**: Ausgaben für deine Eltern buchst du in „Eltern“, ihre Rückzahlungen in „Kostenrückzahlung Eltern“. „Offen von Eltern“ ist die Differenz. Einzelne Ausgaben hakst du in der Übersicht als erstattet ab. „Eltern-Kosten ausblenden“ nimmt beide Kategorien aus allen Summen.
- **Auswertung**: Jahr gegen Vergleichsjahr oder zwei beliebige Monate nebeneinander.

## Abos

**Einstellungen › Abos**. Jedes Abo bucht sich am Abbuchungstag selbst als Ausgabe in „Abos“. Vor einer Verlängerung oder dem Ende der Kündigungsfrist zeigt die Übersicht einen Hinweis. Weil eine Web-App ohne Server keine Mitteilungen schicken kann, legt „Erinnerung in den Kalender“ zusätzlich einen Kalendertermin mit Erinnerung an.

## Design

**Einstellungen › Design**: Standard (hell oder dunkel wie das iPhone) oder HUD (dunkel mit leuchtenden Linien).

## Daueraufträge

**Einstellungen › Daueraufträge › Neuer Dauerauftrag**. Fällige Buchungen entstehen beim Öffnen der App, auch rückwirkend und nie doppelt. Gibt es den Buchungstag in einem Monat nicht, wird am letzten Tag des Monats gebucht. Eine Pause wird nicht nachgebucht.

## Backup

**Einstellungen › Backup exportieren** und die Datei über das Teilen-Menü in iCloud Drive sichern. Das Backup ist der einzige Weg zurück, wenn du den Code vergisst oder das Handy wechselst. Die Datei selbst ist nicht verschlüsselt. API-Schlüssel und Zugangscode sind bewusst nicht enthalten. Backups der ersten App-Version lassen sich weiterhin einspielen und werden dabei umgestellt.

## Für die Entwicklung

```bash
npm install
npm run dev
npm test
npm run build
```

Jeder Push auf `main` testet die App und veröffentlicht sie über GitHub Actions auf GitHub Pages. Heißt das Repository nicht `budget-app`, muss `base` in `vite.config.ts` angepasst werden.
