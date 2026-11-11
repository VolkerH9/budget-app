import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ListPlus, Trash2 } from 'lucide-react'
import { db, newId, type Entry, type Goal, type PeriodBudget, type Recurring, type Wish } from '../db'
import { useApp, useCategories, useGroups, useLabels, useMeta } from '../context'
import { checkPurchase, type AffordQuestion, type AffordResult } from '../lib/afford'
import { formatDate, monthLabel, monthOf, today } from '../lib/dates'
import { amountToInput, formatEuro, formatPercent, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { CategoryIcon } from './CategoryIcon'
import { useSortedCategories } from './EntrySheet'
import { AmountDisplay, Keypad } from './Keypad'
import { LabelChip } from './Labels'
import { MonthPicker, Segmented, Sheet } from './ui'

export interface AffordDraft {
  amount?: number
  name?: string
  categoryId?: string
  labelId?: string
  month?: string
  spread?: number
  wishId?: string
}

const LIGHT = {
  green: 'Passt locker',
  yellow: 'Knapp',
  red: 'Sprengt Budget oder Ziel',
}

const KIND = { category: 'Kategorie', group: 'Überkategorie', period: 'Zeitraum-Budget', label: 'Label-Budget' }

function Result({ result, question, name }: { result: AffordResult; question: AffordQuestion; name: string }) {
  return (
    <div className="afford-result">
      <div className={`light-card ${result.light}`}>
        <span className="light" aria-hidden="true"><i /><i /><i /></span>
        <span>
          <b>{LIGHT[result.light]}</b>
          <span className="light-reason">{result.reason}</span>
        </span>
      </div>
      <p className="section-foot">
        {name ? `${name}: ` : ''}{formatEuro(question.amount)}{question.spread > 1 ? `, ${question.spread} × ${formatEuro(result.monthly)} ab ${monthLabel(question.month)}` : ` im ${monthLabel(question.month)}`}
        {result.hours !== null && ` · Das entspricht ${String(result.hours).replace('.', ',')} Arbeitsstunden.`}
      </p>

      <h3 className="section-title">Vorher → nachher</h3>
      <div className="group">
        <div className="row impact">
          <span className="row-main">Rest im Monat (Prognose)<span className="row-sub" style={{ display: 'block' }}>mit festen Abos, Daueraufträgen und dem bisherigen Tempo</span></span>
          <span className="impact-values num">{formatEuro(result.forecast.rest)} <span aria-hidden="true">→</span> <b className={result.restAfter < 0 ? 'text-over' : ''}>{formatEuro(result.restAfter)}</b></span>
        </div>
        {result.budgets.map((b) => (
          <div key={b.key} className="row impact">
            <span className="row-main">
              {b.name}<span className="row-sub" style={{ display: 'block' }}>{KIND[b.kind]} · {formatEuro(b.budget)}</span>
              <span className={`bar thin ${b.levelAfter}`}><span style={{ width: `${Math.min(100, (b.after / b.budget) * 100)}%` }} /></span>
            </span>
            <span className="impact-values num">{Math.round((b.before / b.budget) * 100)} % <span aria-hidden="true">→</span> <b className={b.levelAfter === 'ok' ? '' : `text-${b.levelAfter}`}>{Math.round((b.after / b.budget) * 100)} %</b></span>
          </div>
        ))}
        {result.savingsRate.before !== null && result.savingsRate.after !== null && (
          <div className="row impact">
            <span className="row-main">Mögliche Sparquote<span className="row-sub" style={{ display: 'block' }}>{result.savingsRate.goal !== null ? `Dein Ziel: ${formatPercent(result.savingsRate.goal)}` : 'Was vom Einkommen zum Sparen bleibt'}</span></span>
            <span className="impact-values num">{formatPercent(result.savingsRate.before)} <span aria-hidden="true">→</span> <b className={result.savingsRate.goal !== null && result.savingsRate.after < result.savingsRate.goal ? 'text-over' : ''}>{formatPercent(result.savingsRate.after)}</b></span>
          </div>
        )}
      </div>

      {result.goals.length > 0 && (
        <>
          <h3 className="section-title">Sparziele, wenn das Geld beim Sparen fehlt</h3>
          <div className="group">
            {result.goals.map((g) => (
              <div key={g.goal.id} className="row impact">
                <span className="row-main">
                  {g.goal.emoji} {g.goal.name}
                  <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                    {g.shiftDays !== null ? `Dein Ziel „${g.goal.name}“ verschiebt sich um ${g.shiftDays} ${g.shiftDays === 1 ? 'Tag' : 'Tage'}.` : 'Noch kein Spartempo bekannt.'}
                  </span>
                </span>
                <span className="impact-values num">{g.rateBefore !== null ? formatEuro(g.rateBefore) : '–'} <span aria-hidden="true">→</span> <b>{g.rateAfter !== null ? formatEuro(g.rateAfter) : '–'}</b><small>pro Monat</small></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** "Kann ich mir das leisten?": checks a purchase, changes nothing until it is booked */
export function AffordSheet({ draft, onClose }: { draft?: AffordDraft; onClose: () => void }) {
  const { openEntry, toast } = useApp()
  const [amount, setAmount] = useState(draft?.amount ? amountToInput(draft.amount) : '')
  const [name, setName] = useState(draft?.name ?? '')
  const [categoryId, setCategoryId] = useState(draft?.categoryId ?? '')
  const [labelId, setLabelId] = useState(draft?.labelId ?? '')
  const [when, setWhen] = useState<'now' | 'month'>(draft?.month && draft.month !== monthOf(today()) ? 'month' : 'now')
  const [month, setMonth] = useState(draft?.month ?? monthOf(today()))
  const [spread, setSpread] = useState(draft?.spread ?? 1)
  const [step, setStep] = useState<'input' | 'result' | 'wishes'>(draft?.amount && draft.categoryId ? 'result' : 'input')
  const [wishId, setWishId] = useState(draft?.wishId)
  const categories = useSortedCategories('expense')
  const allCategories = useCategories()
  const groups = useGroups()
  const labels = useLabels().filter((l) => !l.archived)
  const savingsGoal = useMeta<number | null>('savingsGoal', null)
  const hourlyWage = useMeta<number | null>('hourlyWage', null)
  const entries = useLiveQuery(() => db.entries.toArray(), [], [] as Entry[])
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], [] as Recurring[])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [] as PeriodBudget[])
  const goals = useLiveQuery(() => db.goals.toArray(), [], [] as Goal[])
  const wishes = useLiveQuery(() => db.wishes.toArray().then((l) => l.sort((a, b) => b.createdAt - a.createdAt)), [], [] as Wish[])

  const cents = parseAmount(amount)
  const target = when === 'now' ? monthOf(today()) : month
  const question: AffordQuestion | null = cents !== null && categoryId ? { amount: cents, categoryId, labelId: labelId || undefined, month: target, spread } : null
  const asked = question ? JSON.stringify(question) : ''
  const result = useMemo(() => (asked
    ? checkPurchase(JSON.parse(asked) as AffordQuestion, { entries, categories: allCategories, groups, labels, recurring, budgets, goals, savingsGoal, hourlyWage, now: today() }, formatEuro)
    : null), [asked, entries, allCategories, groups, labels, recurring, budgets, goals, savingsGoal, hourlyWage])

  const book = async () => {
    if (!question) return
    if (wishId) await db.wishes.delete(wishId)
    onClose()
    openEntry(undefined, {
      type: 'expense', amount: question.spread > 1 ? result!.monthly : question.amount, categoryId: question.categoryId,
      note: name.trim() || undefined, labels: question.labelId ? [question.labelId] : undefined,
      date: question.month === monthOf(today()) ? today() : `${question.month}-01`,
    })
  }

  const remember = async () => {
    if (!question) return
    const wish: Wish = { id: wishId ?? newId(), name: name.trim() || allCategories.find((c) => c.id === categoryId)?.name || 'Wunsch', amount: question.amount, categoryId, labelId: question.labelId, month: when === 'month' ? month : undefined, spread, createdAt: Date.now() }
    await db.wishes.put(wish)
    haptic()
    toast('Auf der Wunschliste')
    onClose()
  }

  const openWish = (w: Wish) => {
    setAmount(amountToInput(w.amount))
    setName(w.name)
    setCategoryId(w.categoryId)
    setLabelId(w.labelId ?? '')
    setWhen(w.month && w.month > monthOf(today()) ? 'month' : 'now')
    setMonth(w.month && w.month > monthOf(today()) ? w.month : monthOf(today()))
    setSpread(w.spread ?? 1)
    setWishId(w.id)
    setStep('result')
  }

  if (step === 'wishes') {
    return (
      <Sheet title="Wunschliste" onClose={() => setStep('input')} action={{ label: 'Zurück', onClick: () => setStep('input') }}>
        {wishes.length === 0 && <div className="empty" style={{ padding: '24px 8px' }}><b>Noch keine Wünsche</b>Prüfe einen Kauf und tippe auf „Auf Wunschliste setzen“.</div>}
        <div className="group">
          {wishes.map((w) => (
            <div key={w.id} className="row">
              <CategoryIcon category={allCategories.find((c) => c.id === w.categoryId)} size={30} />
              <span className="row-main">
                <span className="row-title" style={{ display: 'block' }}>{w.name}</span>
                <span className="row-sub" style={{ display: 'block' }}>{formatEuro(w.amount)} · gemerkt am {formatDate(today(new Date(w.createdAt)))}</span>
              </span>
              <button className="secondary-btn small" onClick={() => openWish(w)}>Jetzt leistbar?</button>
              <button className="icon-btn" aria-label={`${w.name} löschen`} onClick={() => db.wishes.delete(w.id)}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
        <div style={{ height: 16 }} />
      </Sheet>
    )
  }

  if (step === 'result' && question && result) {
    return (
      <Sheet title="Kann ich mir das leisten?" onClose={onClose} full action={{ label: 'Ändern', onClick: () => setStep('input') }}>
        <Result result={result} question={question} name={name.trim()} />
        <div className="afford-actions">
          <button className="primary-btn" onClick={book}>Jetzt als Ausgabe buchen</button>
          <button className="secondary-btn" onClick={remember}><ListPlus size={18} aria-hidden="true" /> {wishId ? 'Auf der Wunschliste lassen' : 'Auf Wunschliste setzen'}</button>
          <button className="link-btn" onClick={onClose}>Verwerfen</button>
        </div>
        <p className="section-foot">Der Rechner ändert nichts, solange du nicht buchst.</p>
        <div style={{ height: 24 }} />
      </Sheet>
    )
  }

  return (
    <Sheet title="Kann ich mir das leisten?" onClose={onClose} full action={{ label: 'Prüfen', disabled: !question, onClick: () => setStep('result') }}>
      <button className="link-btn wish-link" onClick={() => setStep('wishes')}>Wunschliste{wishes.length > 0 ? ` (${wishes.length})` : ''} ›</button>
      <AmountDisplay text={amount} />
      <div className="form-row">
        <label className="field grow">
          <input type="text" placeholder="Was? z. B. Schuhe (optional)" aria-label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="cat-strip" role="group" aria-label="Kategorie">
        {categories.map((c) => (
          <button key={c.id} className="cat-pick" aria-pressed={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
            <CategoryIcon category={c} size={32} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
      {labels.length > 0 && (
        <div className="label-row">
          {labels.map((l) => <LabelChip key={l.id} label={l} small pressed={labelId === l.id} onClick={() => setLabelId(labelId === l.id ? '' : l.id)} />)}
        </div>
      )}
      <Segmented value={when} options={[['now', 'Jetzt'], ['month', 'Bestimmter Monat']]} onChange={setWhen} />
      {when === 'month' && <MonthPicker month={month} onChange={(m) => setMonth(m < monthOf(today()) ? monthOf(today()) : m)} />}
      <div className="form-row">
        <label className="field grow">
          <span style={{ flex: 1, color: 'var(--label)' }}>Verteilt auf</span>
          <select aria-label="Verteilt auf" value={spread} onChange={(e) => setSpread(Number(e.target.value))} style={{ border: 0, background: 'none', fontSize: 16, color: 'var(--label)' }}>
            {[1, 2, 3, 4, 6, 9, 12, 18, 24].map((n) => <option key={n} value={n}>{n === 1 ? 'einmal' : `${n} Monate`}</option>)}
          </select>
        </label>
      </div>
      <Keypad onChange={setAmount} />
    </Sheet>
  )
}
