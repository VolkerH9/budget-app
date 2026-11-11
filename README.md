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

## Face ID und App-Code

Beim ersten Start legst du einen App-Code fest (mindestens 6 Zeichen). Alle Daten liegen damit verschlüsselt auf dem iPhone (AES-256, Schlüssel aus dem Code über PBKDF2). Danach richtest du Face ID ein und das iPhone bleibt angemeldet: Budget öffnet sich mit Face ID, klappt das nicht, mit dem iPhone-Code.

- **Angemeldetes iPhone**: Der Schlüssel liegt zusätzlich auf dem Gerät. Wo das iPhone es anbietet, ist er an Face ID gebunden (WebAuthn PRF), sonst als nicht exportierbarer Schlüssel gespeichert, den die App erst nach Face ID verwendet.
- **Einstellungen › Face ID & Code**: Face ID ein oder aus (aus: Budget öffnet sich ohne Abfrage), „Dieses Gerät abmelden“ (danach ist der App-Code nötig), App-Code ändern (im entsperrten Zustand ohne den alten Code).
- **App-Code nötig**: beim ersten Einrichten und wenn das iPhone abgemeldet ist. Auf einem neuen iPhone oder nach gelöschten Website-Daten sind die Daten selbst weg, dann hilft nur das Backup.
- **Falsche Codes**: Ab dem fünften Fehlversuch wartet die App, zuerst 30 Sekunden, am Ende bis zu einer Stunde.
- **Sperren im Hintergrund**: standardmäßig nie, sonst sofort, nach 1, 5 oder 15 Minuten.
- **App-Code vergessen**: Solange Face ID funktioniert, legst du einfach einen neuen fest. Sonst kann niemand die Daten entschlüsseln, und es bleibt nur „App-Code vergessen?“ auf dem Sperrbildschirm: Die App wird zurückgesetzt und du spielst dein letztes Backup ein.

## Belegfotos

Bei jeder Buchung (neu oder beim Bearbeiten) tippst du auf **Foto anhängen** und nimmst ein Foto auf oder wählst eins oder mehrere aus der Mediathek. Das klappt ohne Internet und ohne KI. Die App verkleinert jedes Foto auf höchstens 1800 Pixel (meist 100 bis 450 KB) und speichert es verschlüsselt. In der Liste zeigt eine Büroklammer Buchungen mit Beleg. Antippen öffnet das Foto groß, zum Vergrößern zwei Finger spreizen oder doppelt tippen. Im Buchungsformular tippst du ein Foto an, um es zu ersetzen oder zu löschen. Ein gescannter Beleg wird ebenfalls als Foto angehängt (abschaltbar unter Einstellungen › Belegscan).

## Monatsabrechnung als PDF

**Einstellungen › Monatsabrechnung als PDF** oder unten in der **Auswertung**. Monat wählen, dann eine von zwei Varianten:

- **Eltern-Abrechnung**: alle Buchungen in „Eltern“ im Monat mit Status offen oder erstattet, was schon bezahlt ist (mit jeder Zahlung) und der offene Betrag. Im Anhang alle Belegfotos, nummeriert wie in der Tabelle. Unter „Zahlung deiner Eltern“ buchst du eine Zahlung für genau diese Abrechnung, für eine Teilzahlung änderst du den Betrag.
- **Monatsbericht**: alle Buchungen nach Über- und Unterkategorie mit Summen, Einnahmen, Ausgaben, Sparen, Rest und Sparquote, auf Wunsch mit Belegfotos.

Das PDF entsteht auf dem iPhone und geht über das Teilen-Menü an WhatsApp, Mail oder Dateien. Am Monatsende zeigt die Übersicht die fertige Eltern-Abrechnung zum Teilen (abschaltbar unter Einstellungen › Abrechnung).

## Labels

Mit Labels markierst du Buchungen zusätzlich zu ihrer Kategorie, z. B. alles vom „🏔️ Skiurlaub Tirol 2026“. Eine Buchung kann mehrere Labels tragen.

- **Anlegen**: Einstellungen › Labels › Neues Label. Name, Farbe, Emoji oder Icon, Art (Urlaub, Event, Projekt, Geschenke, Sonstiges), optional ein Zeitraum und ein Budget.
- **Automatisch im Zeitraum**: Liegt das Datum einer neuen Buchung im Zeitraum, ist das Label schon ausgewählt. Ein Tipp auf den Chip nimmt es nur für diese Buchung heraus. Nach dem Enddatum wird es nicht mehr gesetzt. Solange ein Label läuft, zeigt die Übersicht oben „aktiv · noch X Tage“.
- **Von Hand**: im Eintragsformular über „Label“ bzw. „Labels“.
- **Label-Übersicht**: Summe, Aufteilung nach Bereichen und Kategorien, Betrag pro Tag, Budget-Fortschritt und alle Buchungen.
- **Für alle Buchungen eines Labels**: als Eltern-Kosten markieren oder die Markierung entfernen, Kategorie ändern, ein weiteres Label hinzufügen oder entfernen. Vorher siehst du, wie viele Buchungen betroffen sind, danach kannst du es rückgängig machen.
- **Filter**: In den Einträgen nach Label filtern. Die CSV-Datei enthält eine Spalte „Labels“.

## Überkategorien, Eltern-Kosten und Auswertung

- **Überkategorien**: Einstellungen › Kategorien. Überkategorien anlegen, umbenennen, löschen; eine Kategorie verschiebst du, indem du sie antippst und eine andere Überkategorie wählst.
- **Eltern-Kosten**: Ausgaben für deine Eltern buchst du in „Eltern“ oder markierst sie in ihrer eigenen Kategorie mit dem Schalter „Eltern-Kosten“ (z. B. ein Restaurantbesuch). Ihre Rückzahlungen buchst du in „Kostenrückzahlung Eltern“. „Offen von Eltern“ ist die Differenz. Jeder Monat mit Eltern-Ausgaben hat automatisch eine eigene Abrechnung (Übersicht › Offen von Eltern › Abrechnungen) mit Status offen, teilweise bezahlt oder bezahlt. Nach einer neuen Rückzahlung fragt die App, für welche Abrechnung sie ist, und schlägt die älteste offene vor. Eine Zahlung ohne Zuordnung bezahlt die älteste offene Abrechnung, ein Überschuss die nächste. Ist eine Abrechnung ganz bezahlt, gelten ihre Posten als erstattet; einzelne Ausgaben hakst du zusätzlich von Hand ab. „Eltern-Kosten ausblenden“ nimmt beide Kategorien aus allen Summen.
- **Auswertung**: Jahr gegen Vergleichsjahr oder zwei beliebige Monate nebeneinander.

## Abos

**Einstellungen › Abos**. Jedes Abo bucht sich am Abbuchungstag selbst als Ausgabe in „Abos“. Vor einer Verlängerung oder dem Ende der Kündigungsfrist zeigt die Übersicht einen Hinweis. Weil eine Web-App ohne Server keine Mitteilungen schicken kann, legt „Erinnerung in den Kalender“ zusätzlich einen Kalendertermin mit Erinnerung an.

## Design

**Einstellungen › Design**: Standard (hell oder dunkel wie das iPhone) oder HUD (dunkel mit leuchtenden Linien).

## Daueraufträge

**Einstellungen › Daueraufträge › Neuer Dauerauftrag**. Fällige Buchungen entstehen beim Öffnen der App, auch rückwirkend und nie doppelt. Gibt es den Buchungstag in einem Monat nicht, wird am letzten Tag des Monats gebucht. Eine Pause wird nicht nachgebucht.

## Backup

**Einstellungen › Backup exportieren** und die Datei über das Teilen-Menü in iCloud Drive sichern. Das Backup enthält alle Einträge, Kategorien, Labels, Daueraufträge, Abos und Belegfotos und ist mit deinem App-Code verschlüsselt (AES-256). API-Schlüssel und App-Code selbst stehen nicht darin. Am eingestellten Tag jedes Monats (Standard: der 1.) erinnert die Übersicht an das Backup, ein Tipp startet es. Ist das letzte Backup älter als 30 Tage, steht ein Hinweis in der Übersicht.

**Auf einem neuen iPhone wiederherstellen**

1. Budget in Safari öffnen und zum Home-Bildschirm hinzufügen.
2. Die App starten und einen App-Code festlegen (gern derselbe wie vorher).
3. **Einstellungen › Backup importieren**, die Datei in iCloud Drive wählen.
4. Den App-Code eingeben, der beim Erstellen des Backups galt, und „Ersetzen“ tippen.

Ohne diesen Code lässt sich das Backup nicht öffnen. Hast du den Code später geändert, brauchst du für ältere Backups den alten. Backups der früheren Versionen (ohne Verschlüsselung) lassen sich weiterhin einspielen. Die CSV-Datei für Excel ist nicht verschlüsselt und enthält keine Fotos.

## Für die Entwicklung

```bash
npm install
npm run dev
npm test
npm run build
```

Jeder Push auf `main` testet die App und veröffentlicht sie über GitHub Actions auf GitHub Pages. Heißt das Repository nicht `budget-app`, muss `base` in `vite.config.ts` angepasst werden.
