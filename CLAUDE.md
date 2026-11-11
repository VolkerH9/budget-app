# Budget-App

Personal iPhone budget app (PWA) for one user, Volker. He is not a developer: explain anything he has to do himself briefly and simply in German. The whole UI is German; code comments are English.

Live at https://volkerh9.github.io/budget-app/. Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows`). Before a bigger change, tag the current state (`pre-<topic>-<date>`) and push the tag.

## Commands

```bash
npm run dev     # Vite dev server
npm test        # Vitest, all src/**/*.test.ts
npm run build   # tsc --noEmit, then vite build
```

## Architecture

- Vite, React 19, TypeScript, Dexie. No server; everything stays on the device.
- `src/db.ts`: the app works on an in-memory Dexie copy (fake-indexeddb). Types of all records live here.
- `src/lib/vault.ts`: the only code that writes to the device. Every record is AES-GCM encrypted with a data key; the key is wrapped by the access code (PBKDF2), and on a signed-in device by Face ID (WebAuthn PRF) or a non-extractable device key. Never add a code path that stores data unencrypted.
- Receipt photos live encrypted in the store table `photos`, outside the in-memory copy; `Entry.photos` holds their ids. Unreferenced photos are pruned when the app opens.
- `src/lib/migrate.ts`: `DATA_VERSION` and one step per version in `migrateData`. Every change to the data layout needs a step there. Older backups go through the same steps.
- `src/lib/backup.ts`: backups are sealed with the data key and carry the code wrapping, so they open only with the code valid at export. Old unencrypted backups stay importable. API key and access code are never in a backup.
- The repo name and `base` in `vite.config.ts` must stay: a new address would strand the user's data and passkey.

## Data model (version 7)

- `categories` (optional monthly `budget`), `groups` (overcategories, optional monthly `budget`), `entries`, `recurring` (standing orders and Abos), `meta` (settings), `labels`, `budgets` (period budgets: quarter, year or from–to for a category or group), `goals` (savings goals), `wishes` (wish list of the affordability check).
- `Entry`: amount in cents (always positive), `type` expense/saving/income, `date` 'YYYY-MM-DD', optional `note`, `merchant`, `photos`, `labels` (label ids), `refunded`, `forParents`, `forMonth`.
- `Label`: name, colour, emoji or icon, optional kind, optional budget, optional period `from`–`to`, `archived`. While a date lies in the period, new entries of that date get the label preselected (`lib/labels.ts`, `autoLabels` / `chosenLabels`); taking it off counts for that one entry only.
- Parents costs: an expense in category `exp-eltern` or any expense with `forParents`. Repayments are income in `inc-rueckzahlung`. Use `isParentsExpense` / `isParentsRefund` / `isParentsEntry` from `db.ts`, never the category id alone. Monthly statements are derived in `lib/parents.ts` (nothing stored): a repayment with `forMonth` pays that month first, everything else pays the oldest open statement.

Pure logic, each with tests: `lib/labels.ts` (auto labels, summaries, bulk actions), `lib/selection.ts` (entry filter and sums for the selection mode), `lib/statement.ts` (monthly and yearly statement; derived, nothing stored), `lib/afford.ts` (affordability check and month forecast), `lib/wrapped.ts` (review cards with a version without amounts). `lib/exports.ts` builds PDF (via `lib/pdf.ts`), Excel (ExcelJS) and CSV; it is imported lazily, the service worker caches it for offline use.

Budget and goal maths is in `lib/budgets.ts` (pure functions): progress, levels (yellow from 80 %, red over), forecasts from the pace so far, shown from day 5 of a window (`MIN_DAYS`).

## Testing

Unit tests in `src/lib/*.test.ts` use fake-indexeddb and run the real vault. For changes the user will see, also test in a mobile-sized browser (light and dark), including an update from the live build with sample data, so no data is lost.
