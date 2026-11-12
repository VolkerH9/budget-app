import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Copy, CreditCard, Trash2 } from 'lucide-react'
import { db, getMeta, newId, setMeta, type Entry } from '../db'
import { useApp, useCategories, useLabels, useMeta } from '../context'
import { confirmFetched, EINGANG_URL, fetchPayments, setupApplePay, type ApplePayConfig, type Pending } from '../lib/applepay'
import { formatDate, formatTime } from '../lib/dates'
import { formatEuro, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { autoLabels } from '../lib/labels'
import { merchantKey, suggestCategory } from '../lib/suggest'
import { whenSaved } from '../lib/vault'
import { CategoryIcon } from './CategoryIcon'
import { useSortedCategories } from './EntrySheet'
import { Sheet } from './ui'

/**
 * Fetches new Apple Pay payments from the inbox when the app opens or comes back.
 * They are first stored (encrypted) on the iPhone, only then removed from the inbox.
 */
export async function syncApplePay(): Promise<number> {
  const config = await getMeta<ApplePayConfig | null>('applePay', null)
  if (!config || !navigator.onLine) return 0
  const fetched = await fetchPayments(config)
  const pending = await getMeta<Pending[]>('applePayPending', [])
  // Ids already taken, so a payment can never come twice, even if deleting it in the inbox failed
  const seen = await getMeta<string[]>('applePaySeen', [])
  const fresh = fetched.filter((p) => !seen.includes(p.id) && !pending.some((x) => x.id === p.id))
  if (fresh.length > 0) {
    await setMeta('applePayPending', [...pending, ...fresh])
    await setMeta('applePaySeen', [...seen, ...fresh.map((p) => p.id)].slice(-500))
  }
  await setMeta('applePay', { ...config, lastFetch: Date.now() })
  await whenSaved()
  await confirmFetched(config, fetched.map((p) => p.id))
  return fresh.length
}

export function ApplePaySync() {
  useEffect(() => {
    const run = () => { syncApplePay().catch((error) => console.error(error)) }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', run)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', run)
    }
  }, [])
  return null
}

interface Draft {
  note: string
  categoryId: string | null
  amount: string
  picking: boolean
}

/** One payment to confirm: a note, the category that follows from it, and Übernehmen */
function PaymentCard({ payment, draft, onDraft, onAccept, onDiscard, suggestion }: {
  payment: Pending
  draft: Draft
  onDraft: (d: Draft) => void
  onAccept: () => void
  onDiscard: () => void
  suggestion: { categoryId: string; reason: string } | null
}) {
  const categories = useSortedCategories(payment.refund ? 'income' : 'expense')
  const chosen = draft.categoryId ?? suggestion?.categoryId ?? null
  const category = categories.find((c) => c.id === chosen)
  const cents = payment.amount ?? parseAmount(draft.amount)
  return (
    <div className="card pay-card">
      <div className="pay-head">
        <span className="pay-icon" aria-hidden="true"><CreditCard size={18} /></span>
        <span className="row-main">
          <b className="pay-merchant">{payment.merchant}</b>
          <span className="row-sub" style={{ display: 'block' }}>{formatDate(payment.date)}{payment.card ? ` · ${payment.card}` : ''}{payment.refund ? ' · Erstattung' : ''}</span>
        </span>
        {payment.amount !== null
          ? <b className="pay-amount num">{payment.refund ? '+' : '−'}{formatEuro(payment.amount)}</b>
          : <input className="pay-amount-input" type="text" inputMode="decimal" placeholder="Betrag" aria-label={`Betrag für ${payment.merchant}`} value={draft.amount} onChange={(e) => onDraft({ ...draft, amount: e.target.value })} />}
      </div>
      <label className="field pay-note">
        <input type="text" placeholder="Was war das? z. B. Döner, Wocheneinkauf" aria-label={`Notiz zu ${payment.merchant}`} value={draft.note} maxLength={200} onChange={(e) => onDraft({ ...draft, note: e.target.value, categoryId: null })} />
      </label>
      <button className="pay-category" onClick={() => onDraft({ ...draft, picking: !draft.picking })} aria-expanded={draft.picking}>
        {category ? <CategoryIcon category={category} size={26} /> : <span className="pay-none" aria-hidden="true">?</span>}
        <span className="row-main">
          <span style={{ display: 'block' }}>{category ? category.name : 'Kategorie wählen'}</span>
          <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{draft.categoryId ? 'von dir gewählt' : suggestion?.reason ?? 'Schreib dazu, was es war, oder tippe hier'}</span>
        </span>
        <span className="link-btn">{draft.picking ? 'Fertig' : 'Ändern'}</span>
      </button>
      {draft.picking && (
        <div className="cat-strip pay-strip" role="group" aria-label="Kategorie">
          {categories.map((c) => (
            <button key={c.id} className="cat-pick" aria-pressed={c.id === chosen} onClick={() => onDraft({ ...draft, categoryId: c.id, picking: false })}>
              <CategoryIcon category={c} size={30} />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="pay-actions">
        <button className="icon-btn" aria-label={`${payment.merchant} verwerfen`} onClick={onDiscard}><Trash2 size={18} /></button>
        <button className="primary-btn small-primary" disabled={!chosen || cents === null} onClick={onAccept}><Check size={18} aria-hidden="true" /> Übernehmen</button>
      </div>
    </div>
  )
}

/** All Apple Pay payments waiting for confirmation */
export function PaymentsSheet({ onClose }: { onClose: () => void }) {
  const { toast, alert } = useApp()
  // Undefined while loading, so the sheet does not close before the list is there
  const loaded = useLiveQuery(async () => ((await db.meta.get('applePayPending'))?.value as Pending[] | undefined) ?? [], [])
  const pending = useMemo(() => loaded ?? [], [loaded])
  const learned = useMeta<Record<string, string>>('merchantCategories', {})
  const categories = useCategories()
  const labels = useLabels()
  const entries = useLiveQuery(() => db.entries.toArray(), [], [] as Entry[])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const draftOf = (p: Pending): Draft => drafts[p.id] ?? { note: '', categoryId: null, amount: '', picking: false }
  const suggestions = useMemo(() => Object.fromEntries(pending.map((p) => {
    const d = drafts[p.id]
    return [p.id, p.refund ? null : suggestCategory({ merchant: p.merchant, note: d?.note ?? '' }, entries, categories, learned)]
  })), [pending, drafts, entries, categories, learned])

  useEffect(() => { if (loaded && loaded.length === 0) onClose() }, [loaded, onClose])

  const book = async (list: Pending[]) => {
    const made: Entry[] = []
    const done = new Set<string>()
    const learnedNext = { ...learned }
    for (const p of list) {
      const d = draftOf(p)
      const categoryId = d.categoryId ?? suggestions[p.id]?.categoryId
      const amount = p.amount ?? parseAmount(d.amount)
      if (!categoryId || amount === null) continue
      const auto = autoLabels(labels, p.date)
      made.push({
        id: newId(), type: p.refund ? 'income' : 'expense', amount, categoryId, date: p.date, merchant: p.merchant,
        note: d.note.trim() || undefined, labels: auto.length > 0 ? auto : undefined, createdAt: Date.now(),
      })
      done.add(p.id)
      if (!p.refund && merchantKey(p.merchant)) learnedNext[merchantKey(p.merchant)] = categoryId
    }
    if (made.length === 0) return
    await db.entries.bulkAdd(made)
    await setMeta('merchantCategories', learnedNext)
    await setMeta('applePayPending', pending.filter((p) => !done.has(p.id)))
    haptic()
    toast(made.length === 1 ? 'Zahlung übernommen' : `${made.length} Zahlungen übernommen`)
  }

  const discard = (p: Pending) => alert({
    title: 'Zahlung verwerfen?',
    message: `${p.merchant}${p.amount !== null ? `, ${formatEuro(p.amount)}` : ''} wird nicht gebucht.`,
    buttons: [
      { label: 'Verwerfen', style: 'destructive', onClick: () => { setMeta('applePayPending', pending.filter((x) => x.id !== p.id)) } },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  const ready = pending.filter((p) => (draftOf(p).categoryId ?? suggestions[p.id]?.categoryId) && (p.amount !== null || parseAmount(draftOf(p).amount) !== null))
  return (
    <Sheet title="Apple Pay" onClose={onClose} full action={{ label: ready.length > 1 ? 'Alle übernehmen' : 'Übernehmen', disabled: ready.length === 0, onClick: () => book(ready) }}>
      <p className="section-foot" style={{ margin: '0 4px 12px' }}>Schreib kurz dazu, was es war. Die Kategorie passt sich an, und den Händler merkt sich die App fürs nächste Mal.</p>
      <div className="stack">
        {pending.map((p) => (
          <PaymentCard
            key={p.id} payment={p} draft={draftOf(p)} suggestion={suggestions[p.id] ?? null}
            onDraft={(d) => setDrafts({ ...drafts, [p.id]: d })}
            onAccept={() => book([p])}
            onDiscard={() => discard(p)}
          />
        ))}
      </div>
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

export function PaymentsCard() {
  const pending = useMeta<Pending[]>('applePayPending', [])
  const [open, setOpen] = useState(false)
  if (pending.length === 0) return null
  const sum = pending.reduce((s, p) => s + (p.amount ?? 0), 0)
  return (
    <>
      <button className="card reminder pay-reminder" onClick={() => setOpen(true)}>
        <CreditCard size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="row-main" style={{ textAlign: 'left' }}>
          <b>{pending.length === 1 ? '1 neue Apple-Pay-Zahlung' : `${pending.length} neue Apple-Pay-Zahlungen`}</b>
          <span className="row-sub" style={{ display: 'block' }}>{formatEuro(sum)} · Antippen zum Bestätigen</span>
        </span>
        <span className="chevron" aria-hidden="true">›</span>
      </button>
      {open && <PaymentsSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/** Einstellungen › Apple Pay: connect the inbox, the key for the shortcut, the steps */
export function ApplePayPage() {
  const { alert, toast } = useApp()
  const config = useMeta<ApplePayConfig | null>('applePay', null)
  const pending = useMeta<Pending[]>('applePayPending', [])
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(false)

  const setup = async () => {
    setBusy(true)
    try {
      const url = await getMeta('eingangUrl', EINGANG_URL)
      const next = await setupApplePay(url, config ?? undefined)
      await setMeta('applePay', next)
      setShown(true)
      toast('Apple Pay verbunden')
    } catch (error) {
      alert({ title: 'Verbinden nicht möglich', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setBusy(false)
    }
  }

  const fetchNow = async () => {
    setBusy(true)
    try {
      const n = await syncApplePay()
      toast(n === 0 ? 'Keine neuen Zahlungen' : n === 1 ? '1 neue Zahlung' : `${n} neue Zahlungen`)
    } catch (error) {
      alert({ title: 'Abrufen nicht möglich', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!config) return
    await navigator.clipboard.writeText(config.shortcutToken)
    toast('Schlüssel kopiert')
  }

  if (!config) {
    return (
      <>
        <div className="card">
          <b>Apple-Pay-Zahlungen automatisch erfassen</b>
          <p className="row-sub" style={{ whiteSpace: 'normal', marginTop: 6 }}>
            Bei jeder Zahlung mit Apple Pay schickt ein Kurzbefehl Händler und Betrag an deinen Eingang bei Cloudflare.
            Der Eingang verschlüsselt sie sofort so, dass nur diese App sie lesen kann. Beim Öffnen holt Budget sie ab, du bestätigst sie mit einem Tipp.
          </p>
        </div>
        <div style={{ height: 14 }} />
        <button className="primary-btn" disabled={busy} onClick={setup}>{busy ? 'Wird verbunden …' : 'Apple Pay verbinden'}</button>
      </>
    )
  }
  return (
    <>
      <h2 className="section-title">Status</h2>
      <div className="group">
        <div className="row"><span className="row-main">Verbunden seit</span><span className="row-value">{formatTime(config.since)}</span></div>
        <div className="row"><span className="row-main">Zuletzt abgerufen</span><span className="row-value">{config.lastFetch ? formatTime(config.lastFetch) : 'Noch nie'}</span></div>
        <div className="row"><span className="row-main">Warten auf Bestätigung</span><span className="row-value">{pending.length}</span></div>
        <button className="row tint" disabled={busy} onClick={fetchNow}>Jetzt abrufen</button>
      </div>

      <h2 className="section-title">Schlüssel für den Kurzbefehl</h2>
      <div className="group">
        <div className="row">
          <span className="row-main key-text num">{shown ? config.shortcutToken : `${config.shortcutToken.slice(0, 6)}••••••••••••`}</span>
          <button className="link-btn" onClick={() => setShown(!shown)}>{shown ? 'Verbergen' : 'Zeigen'}</button>
        </div>
        <button className="row tint" onClick={copy}><Copy size={18} aria-hidden="true" /> Schlüssel kopieren</button>
      </div>
      <p className="section-foot">Der Schlüssel darf nur Zahlungen einliefern, nichts lesen. Füge ihn beim Hinzufügen des Kurzbefehls „Budget Apple Pay“ ein.</p>

      <h2 className="section-title">So richtest du es ein</h2>
      <div className="card setup-steps">
        <ol>
          <li>Schlüssel oben kopieren.</li>
          <li>In der App <b>Dateien</b>: iCloud Drive › Claude Projekte › Budget › Kurzbefehle › <b>Budget Apple Pay</b> öffnen, „Kurzbefehl hinzufügen“ und den Schlüssel einfügen.</li>
          <li>App <b>Kurzbefehle</b> › Automation › <b>+</b> › <b>Wallet</b>: deine Karte wählen, „Sofort ausführen“ an.</li>
          <li>Als Aktion <b>Kurzbefehl ausführen</b> › „Budget Apple Pay“ wählen und bei Eingabe <b>Kurzbefehleingabe</b> angeben.</li>
          <li>Einmal mit Apple Pay bezahlen und Budget öffnen: Die Zahlung erscheint in der Übersicht.</li>
        </ol>
      </div>

      <div className="group" style={{ marginTop: 24 }}>
        <button className="row tint" disabled={busy} onClick={() => alert({
          title: 'Neu verbinden?',
          message: 'Es gibt neue Schlüssel. Danach musst du den Kurzbefehl mit dem neuen Schlüssel neu hinzufügen.',
          buttons: [{ label: 'Neu verbinden', onClick: () => { setup() } }, { label: 'Abbrechen', style: 'strong' }],
        })}>Neu verbinden</button>
      </div>
      <div style={{ height: 24 }} />
    </>
  )
}

