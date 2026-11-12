-- Waiting payments, each encrypted for the app, and the setup (public key and key hashes)
CREATE TABLE zahlungen (
  id TEXT PRIMARY KEY,
  daten TEXT NOT NULL,
  erstellt INTEGER NOT NULL
);
CREATE TABLE einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert TEXT NOT NULL
);
