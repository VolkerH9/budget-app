import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, FileText, FolderDown, Sheet as SheetIcon } from 'lucide-react'
import { db, type Entry, type Goal, type PeriodBudget, type Recurring } from '../db'
import { useApp, useAskToShare, useCategories, useGroups, useLabels, useMeta } from '../context'
import { saveFiles } from '../lib/backup'
import { formatDate, monthLabel, monthOf, today } from '../lib/dates'
import { formatEuro, formatPercent } from '../lib/format'
import { buildStatement, fileBase, periodTitle, type Comparison, type Statement, type StatementPeriod } from '../lib/statement'
import { IncomeVsExpense } from '../pages/Overview'
import { CategoryIcon } from './CategoryIcon'
import { LabelChip } from './Labels'
import { Chevron, Collapse, CountUp, MonthPicker, Segmented, YearPicker } from './ui'

/** All tables a statement needs, live */
const NO_LABELS: string[] = []

export function useStatement(period: StatementPeriod, labelFilter: string[] = NO_LABELS): Statement | null {
  const hideParents = useMeta('hideParents', false)
  const categories = useCategories()
  const groups = useGroups()
  const labels = useLabels()
  const entries = useLiveQuery(() => db.entries.toArray(), [], undefined as Entry[] | undefined)
  const recurring = useLiveQuery(() => db.recurring.toArray(), [], [] as Recurring[])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [] as PeriodBudget[])
  const goals = useLiveQuery(() => db.goals.toArray(), [], [] as Goal[])
  return useMemo(
    () => (entries ? buildStatement(period, { entries, categories, groups, labels, recurring, budgets, goals, now: today(), euro: formatEuro, labelFilter, hideParents }) : null),
    [period, entries, categories, groups, labels, recurring, budgets, goals, labelFilter, hideParents],
  )
}

/** "+12,30 € · +8 %" with an arrow; for expenses a rise is bad, for income it is good */
export function Change({ c, goodWhenUp = false, percent }: { c: Comparison; goodWhenUp?: boolean; percent?: boolean }) {
  if (c.current === 0 && c.previous === 0) return <span className="trend">–</span>
  if (c.diff === 0) return <span className="trend">± 0</span>
  const up = c.diff > 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  const tone = up === goodWhenUp ? 'good' : 'bad'
  const amount = percent ? `${up ? '+' : '−'}${String(Math.round(Math.abs(c.diff) * 1000) / 10).replace('.', ',')} Pkt.` : `${up ? '+' : '−'}${formatEuro(Math.abs(c.diff))}`
  return (
    <span className={`trend change ${tone}`}>
      <Arrow size={13} strokeWidth={2.2} aria-hidden="true" />
      {amount}{!percent && c.ratio !== null && ` · ${up ? '+' : '−'}${Math.round(Math.abs(c.ratio) * 100)} %`}
    </span>
  )
}

function Kpi({ label, value, c, goodWhenUp, rate }: { label: string; value: number; c: Comparison; goodWhenUp?: boolean; rate?: boolean }) {
  return (
    <div className="kpi">
      <label>{label}</label>
      {rate ? <strong className="num">{formatPercent(value)}</strong> : <strong><CountUp cents={value} /></strong>}
      <Change c={c} goodWhenUp={goodWhenUp} percent={rate} />
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The statement of a month or year, with export */
export function StatementView({ initial }: { initial?: StatementPeriod }) {
  const { alert, toast, openLabel } = useApp()
  const askToShare = useAskToShare()
  const hideParents = useMeta('hideParents', false)
  const labels = useLabels()
  const groups = useGroups()
  const categories = useCategories()
  const now = today()
  const [kind, setKind] = useState(initial?.kind ?? 'month')
  const [month, setMonth] = useState(initial?.kind === 'month' ? initial.key : monthOf(now))
  const [year, setYear] = useState(initial?.kind === 'year' ? Number(initial.key) : Number(now.slice(0, 4)))
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const period = useMemo<StatementPeriod>(() => (kind === 'month' ? { kind, key: month } : { kind, key: String(year) }), [kind, month, year])
  const s = useStatement(period, labelFilter)
  const prevLabel = kind === 'month' ? monthLabel(period.key.slice(0, 7)).split(' ')[0] : ''

  const exportAs = async (formats: ('pdf' | 'xlsx' | 'csv')[], label: string) => {
    if (!s || busy) return
    setBusy(label)
    try {
      const { statementPdf, statementXlsx, statementCsv } = await import('../lib/exports')
      const context = { statement: s, categories, groups, labels, name: ((await db.meta.get('reportName'))?.value as string | undefined) ?? '', hiddenParents: hideParents }
      const files: File[] = []
      for (const f of formats) {
        if (f === 'pdf') files.push(new File([await statementPdf(context)], `${fileBase(period)}.pdf`, { type: 'application/pdf' }))
        if (f === 'xlsx') files.push(new File([await statementXlsx(context)], `${fileBase(period)}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
        if (f === 'csv') files.push(new File([statementCsv(context)], `${fileBase(period)}.csv`, { type: 'text/csv' }))
      }
      const shared = await saveFiles(files, askToShare)
      if (shared) {
        const done = ((await db.meta.get('statementsDone'))?.value as string[] | undefined) ?? []
        if (!done.includes(period.key)) await db.meta.put({ key: 'statementsDone', value: [...done, period.key].slice(-60) })
        toast(files.length > 1 ? 'PDF und Excel bereit' : 'Datei bereit')
      }
    } catch (error) {
      console.error(error)
      alert({ title: 'Export nicht möglich', message: 'Bitte versuche es noch einmal.', buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (key: string) => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpen(next)
  }

  return (
    <>
      <Segmented value={kind} options={[['month', 'Monat'], ['year', 'Jahr']]} onChange={setKind} />
      <div style={{ height: 6 }} />
      {kind === 'month' ? <MonthPicker month={month} onChange={setMonth} /> : <YearPicker year={year} onChange={setYear} />}
      {labels.length > 0 && (
        <div className="label-row statement-labels" role="group" aria-label="Nach Label filtern">
          {labels.filter((l) => !l.archived || labelFilter.includes(l.id)).map((l) => (
            <LabelChip key={l.id} label={l} small pressed={labelFilter.includes(l.id)} onClick={() => setLabelFilter(labelFilter.includes(l.id) ? labelFilter.filter((x) => x !== l.id) : [...labelFilter, l.id])} />
          ))}
        </div>
      )}
      {!s ? null : (
        <div className="statement" key={period.key}>
          {labelFilter.length > 0 && <p className="section-foot">Nur Buchungen mit {labelFilter.length === 1 ? 'dem gewählten Label' : 'einem der gewählten Labels'}.</p>}
          <div className="card hero">
            <span className="row-sub">{kind === 'month' ? 'Rest im Monat' : `Rest im Jahr ${year}`}</span>
            <CountUp cents={s.summary.rest} className={s.summary.rest < 0 ? 'hero-num over' : 'hero-num'} />
            <Change c={s.comparison.rest} goodWhenUp />
          </div>
          <div className="kpis">
            <Kpi label="Einnahmen" value={s.summary.income} c={s.comparison.income} goodWhenUp />
            <Kpi label="Ausgaben" value={s.summary.expense} c={s.comparison.expense} />
            <Kpi label="Gespart" value={s.summary.saving} c={s.comparison.saving} goodWhenUp />
            <Kpi label="Sparquote" value={s.summary.savingsRate ?? 0} c={s.comparison.savingsRate} goodWhenUp rate />
          </div>
          <p className="section-foot">Vergleich mit {kind === 'month' ? `dem Vormonat` : `${year - 1}`}{prevLabel ? '' : ''}.</p>

          {s.months && (
            <>
              <h2 className="section-title strong">Verlauf {year}</h2>
              <div className="card"><IncomeVsExpense rows={s.months} /></div>
              <div className="kpis three">
                <div className="kpi"><label>Ø Ausgaben pro Monat</label><strong className="num">{formatEuro(s.averageExpense ?? 0)}</strong></div>
                {s.dearest && <div className="kpi"><label>Teuerster Monat</label><strong>{monthLabel(s.dearest.month).split(' ')[0]}</strong><span className="trend">{formatEuro(s.dearest.expense)}</span></div>}
                {s.cheapest && <div className="kpi"><label>Günstigster Monat</label><strong>{monthLabel(s.cheapest.month).split(' ')[0]}</strong><span className="trend">{formatEuro(s.cheapest.expense)}</span></div>}
              </div>
            </>
          )}

          <h2 className="section-title strong">Ausgaben nach Bereichen</h2>
          {s.groups.length === 0
            ? <div className="empty" style={{ padding: '20px 8px' }}><b>Keine Ausgaben</b></div>
            : (
              <div className="card flush">
                {s.groups.map((g) => (
                  <div key={g.key} className="cmp-block">
                    <button className="st-row" aria-expanded={open.has(g.key)} onClick={() => toggle(g.key)}>
                      {g.group ? <span className="dot" style={{ background: g.color }} /> : <CategoryIcon category={g.categories[0]} size={26} />}
                      <span className="row-main">
                        <span className="row-title" style={{ display: 'block' }}>{g.label}</span>
                        <span className="row-sub" style={{ display: 'block' }}>{formatPercent(g.share)} · {plural(g.count, 'Buchung', 'Buchungen')}</span>
                      </span>
                      <span className="st-amount num">
                        <b>{formatEuro(g.amount)}</b>
                        <Change c={{ current: g.amount, previous: g.previous, diff: g.amount - g.previous, ratio: g.previous ? (g.amount - g.previous) / g.previous : null }} />
                      </span>
                      {g.lines.length > 1 && <Chevron open={open.has(g.key)} />}
                    </button>
                    {g.lines.length > 1 && (
                      <Collapse open={open.has(g.key)}>
                        <div className="cmp-children">
                          {g.lines.map((l) => (
                            <div key={l.category.id} className="st-row child">
                              <CategoryIcon category={l.category} size={24} />
                              <span className="row-main">
                                <span className="row-title" style={{ display: 'block' }}>{l.category.name}</span>
                                <span className="row-sub" style={{ display: 'block' }}>{formatPercent(l.share)} · {plural(l.count, 'Buchung', 'Buchungen')}</span>
                              </span>
                              <span className="st-amount num"><b>{formatEuro(l.amount)}</b></span>
                            </div>
                          ))}
                        </div>
                      </Collapse>
                    )}
                  </div>
                ))}
              </div>
            )}

          {(s.budgets.length > 0 || s.goals.length > 0) && (
            <>
              <h2 className="section-title strong">Budgets & Ziele</h2>
              <div className="group">
                {s.budgets.map((b) => (
                  <div key={b.key} className="row compact-budget">
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>{b.name} <span className="row-sub">· {b.kind === 'group' ? 'Überkategorie' : b.kind === 'period' ? 'Zeitraum' : b.kind === 'label' ? 'Label' : 'Kategorie'}</span></span>
                      <span className={`bar thin ${b.progress.level}`}><span style={{ width: `${Math.min(100, b.progress.ratio * 100)}%` }} /></span>
                      <span className={`row-sub ${b.progress.level === 'ok' ? '' : `text-${b.progress.level}`}`} style={{ display: 'block' }}>
                        {formatEuro(b.progress.spent)} von {formatEuro(b.progress.budget)}{b.kept ? ` · in ${b.kept.months} von ${b.kept.of} Monaten eingehalten` : ''}
                      </span>
                    </span>
                    <span className="row-value num">{Math.round(b.progress.ratio * 100)} %</span>
                  </div>
                ))}
                {s.goals.map(({ goal, progress }) => (
                  <div key={goal.id} className="row compact-budget">
                    <span aria-hidden="true" style={{ fontSize: 20 }}>{goal.emoji}</span>
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>{goal.name} <span className="row-sub">· Sparziel</span></span>
                      <span className={`row-sub ${progress.level === 'ok' ? 'text-ok' : `text-${progress.level}`}`} style={{ display: 'block' }}>
                        {formatEuro(progress.saved)} von {formatEuro(goal.target)} · {progress.reached ? 'erreicht' : progress.onTrack ? 'im Plan' : progress.overdue ? 'verpasst' : 'hinter dem Plan'}
                      </span>
                    </span>
                    <span className="row-value num">{Math.round(progress.ratio * 100)} %</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {s.labels.length > 0 && (
            <>
              <h2 className="section-title strong">Labels</h2>
              <div className="group">
                {s.labels.map((l) => (
                  <button key={l.label.id} className="row" onClick={() => openLabel(l.label.id)}>
                    <span className="row-main"><LabelChip label={l.label} /></span>
                    <span className="row-sub">{plural(l.count, 'Buchung', 'Buchungen')}</span>
                    <span className="row-value num" style={{ color: 'var(--label)' }}>{formatEuro(l.amount)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {s.top.length > 0 && (
            <>
              <h2 className="section-title strong">Größte Ausgaben</h2>
              <div className="group">
                {s.top.map((e, i) => {
                  const c = categories.find((x) => x.id === e.categoryId)
                  return (
                    <div key={e.id} className="row">
                      <span className="rank num">{i + 1}</span>
                      <CategoryIcon category={c} size={28} />
                      <span className="row-main">
                        <span className="row-title" style={{ display: 'block' }}>{e.merchant || e.note || c?.name}</span>
                        <span className="row-sub" style={{ display: 'block' }}>{formatDate(e.date)} · {c?.name}</span>
                      </span>
                      <span className="row-value num" style={{ color: 'var(--label)' }}>{formatEuro(e.amount)}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {(s.subscriptions.length > 0 || s.standing.length > 0) && (
            <>
              <h2 className="section-title strong">Abos und Daueraufträge</h2>
              <div className="group">
                {[...s.subscriptions.map((l) => ({ ...l, tag: 'Abo' })), ...s.standing.map((l) => ({ ...l, tag: 'Dauerauftrag' }))].map((l) => (
                  <div key={l.recurring.id} className="row">
                    <span className="row-main">
                      <span className="row-title" style={{ display: 'block' }}>{l.recurring.name}</span>
                      <span className="row-sub" style={{ display: 'block' }}>{l.tag}{l.count > 1 ? ` · ${l.count}×` : ''}</span>
                    </span>
                    <span className="row-value num" style={{ color: 'var(--label)' }}>{l.recurring.type === 'income' ? '+' : ''}{formatEuro(l.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {(s.parents.spent > 0 || s.parents.refunded > 0) && (
            <>
              <h2 className="section-title strong">Eltern-Kosten</h2>
              <div className="card">
                <dl className="report-lines num">
                  <dt>Ausgaben ({s.parents.count})</dt><dd>{formatEuro(s.parents.spent)}</dd>
                  <dt>Rückzahlungen</dt><dd>{formatEuro(s.parents.refunded)}</dd>
                  <dt><b>Offen am {formatDate(s.to < now ? s.to : now)}</b></dt><dd><b>{formatEuro(s.parents.openAtEnd)}</b></dd>
                </dl>
              </div>
            </>
          )}

          <h2 className="section-title strong">Exportieren</h2>
          <button className="primary-btn export-main" disabled={!!busy} onClick={() => exportAs(['pdf', 'xlsx'], 'both')}>
            <FolderDown size={20} aria-hidden="true" /> {busy === 'both' ? 'Wird erstellt …' : 'Exportieren & ablegen'}
          </button>
          <p className="section-foot">PDF und Excel zusammen. Im Teilen-Menü wählst du den Kurzbefehl „Budget ablegen“, der beide in iCloud Drive › Budget › {period.key.slice(0, 4)} sichert.</p>
          <div className="export-row">
            <button className="secondary-btn" disabled={!!busy} onClick={() => exportAs(['pdf'], 'pdf')}><FileText size={18} aria-hidden="true" /> {busy === 'pdf' ? '…' : 'PDF'}</button>
            <button className="secondary-btn" disabled={!!busy} onClick={() => exportAs(['xlsx'], 'xlsx')}><FileSpreadsheet size={18} aria-hidden="true" /> {busy === 'xlsx' ? '…' : 'Excel'}</button>
            <button className="secondary-btn" disabled={!!busy} onClick={() => exportAs(['csv'], 'csv')}><SheetIcon size={18} aria-hidden="true" /> {busy === 'csv' ? '…' : 'CSV'}</button>
          </div>
          <p className="section-foot">{periodTitle(period)}{labelFilter.length > 0 ? ', nur die gewählten Labels' : ''}. Dateiname: {fileBase(period)}</p>
        </div>
      )}
    </>
  )
}
