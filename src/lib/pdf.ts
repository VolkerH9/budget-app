import type { jsPDF as JsPdf } from 'jspdf'
import type { Category, Entry, EntryType, Group, Label } from '../db'
import { formatDate, monthLabel, monthShort } from './dates'
import { formatEuro, formatPercent } from './format'
import { STATUS_LABEL, type Statement } from './parents'
import type { Comparison, Statement as PeriodStatement } from './statement'
import { loadPhoto } from './vault'

// A4 in millimetres
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const WIDTH = PAGE_W - 2 * MARGIN
const BOTTOM = PAGE_H - 16

// The app's colours
const INK: Rgb = [28, 28, 30]
const MUTED: Rgb = [110, 110, 115]
const LINE: Rgb = [222, 222, 228]
const TINT: Rgb = [51, 104, 201]
const TINT_SOFT: Rgb = [232, 239, 250]
const ZEBRA: Rgb = [247, 247, 249]
const RED: Rgb = [196, 55, 45]
const AMBER: Rgb = [168, 90, 6]
const GREEN: Rgb = [42, 131, 80]
const EXPENSE: Rgb = [200, 111, 48]

type Rgb = [number, number, number]

/**
 * The built-in PDF fonts know only the Western European characters. Typographic
 * minus and narrow spaces become their plain forms, emoji and the like are dropped.
 */
export function pdfText(value: string): string {
  return value
    .replace(/−/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[^ -~ -ÿ€–—„“”‚‘’•…·]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const euro = (cents: number) => pdfText(formatEuro(cents))

const describe = (e: Entry) => [e.merchant, e.note].filter(Boolean).join(' · ') || '–'

export interface ReportOptions {
  name: string
  /** "08.11.2026", the day the report is made */
  created: string
}

interface Column {
  label: string
  width: number
  align?: 'left' | 'right'
}

class Writer {
  doc: JsPdf
  y = MARGIN
  page = 1

  constructor(doc: JsPdf, private footer: string) {
    this.doc = doc
  }

  color(rgb: Rgb) {
    this.doc.setTextColor(...rgb)
  }

  font(size: number, style: 'normal' | 'bold' = 'normal', rgb: Rgb = INK) {
    this.doc.setFont('helvetica', style)
    this.doc.setFontSize(size)
    this.color(rgb)
  }

  newPage() {
    this.doc.addPage()
    this.page++
    this.y = MARGIN
  }

  /** Starts a new page when less than `height` mm are left */
  need(height: number): boolean {
    if (this.y + height <= BOTTOM) return false
    this.newPage()
    return true
  }

  text(value: string, x: number, y: number, options: { align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}) {
    this.doc.text(pdfText(value), x, y, { align: options.align ?? 'left', maxWidth: options.maxWidth, baseline: 'alphabetic' })
  }

  /** Text cut to one line with an ellipsis */
  fit(value: string, width: number): string {
    const clean = pdfText(value)
    if (this.doc.getTextWidth(clean) <= width) return clean
    let cut = clean
    while (cut.length > 1 && this.doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}…`
  }

  title(title: string, options: ReportOptions) {
    this.font(20, 'bold')
    this.text(title, MARGIN, this.y + 7)
    this.font(10, 'normal', MUTED)
    this.text([options.name.trim(), `erstellt am ${options.created}`].filter(Boolean).join(' · '), MARGIN, this.y + 14)
    this.doc.setDrawColor(...TINT)
    this.doc.setLineWidth(0.8)
    this.doc.line(MARGIN, this.y + 18, MARGIN + 24, this.y + 18)
    this.y += 28
  }

  heading(text: string) {
    this.need(16)
    this.font(12, 'bold')
    this.text(text, MARGIN, this.y + 5)
    this.y += 9
  }

  tableHead(columns: Column[]) {
    this.font(8.5, 'bold', MUTED)
    let x = MARGIN
    for (const c of columns) {
      this.text(c.label.toUpperCase(), c.align === 'right' ? x + c.width - 2 : x + 2, this.y + 4, { align: c.align === 'right' ? 'right' : 'left' })
      x += c.width
    }
    this.doc.setDrawColor(...LINE)
    this.doc.setLineWidth(0.3)
    this.doc.line(MARGIN, this.y + 6.5, MARGIN + WIDTH, this.y + 6.5)
    this.y += 8
  }

  /** One table row. Repeats the head on a new page. */
  row(columns: Column[], cells: string[], options: { zebra?: boolean; bold?: boolean; rgb?: Rgb[] } = {}) {
    const height = 7
    if (this.need(height + 2)) this.tableHead(columns)
    if (options.zebra) {
      this.doc.setFillColor(...ZEBRA)
      this.doc.rect(MARGIN, this.y, WIDTH, height, 'F')
    }
    let x = MARGIN
    columns.forEach((c, i) => {
      this.font(9.5, options.bold ? 'bold' : 'normal', options.rgb?.[i] ?? INK)
      const value = this.fit(cells[i] ?? '', c.width - 4)
      this.text(value, c.align === 'right' ? x + c.width - 2 : x + 2, this.y + 4.8, { align: c.align === 'right' ? 'right' : 'left' })
      x += c.width
    })
    this.y += height
  }

  /** Label and amount in one line, for sums */
  line(label: string, value: string, options: { bold?: boolean; rgb?: Rgb } = {}) {
    this.need(8)
    this.font(10.5, options.bold ? 'bold' : 'normal', options.rgb ?? INK)
    this.text(label, MARGIN + 2, this.y + 5)
    this.text(value, MARGIN + WIDTH - 2, this.y + 5, { align: 'right' })
    this.y += 7
  }

  /** The tinted box with the amount that matters */
  highlight(label: string, value: string) {
    this.need(22)
    this.doc.setFillColor(...TINT_SOFT)
    this.doc.roundedRect(MARGIN, this.y, WIDTH, 18, 3, 3, 'F')
    this.font(12, 'bold', TINT)
    this.text(label, MARGIN + 6, this.y + 11.5)
    this.font(17, 'bold', TINT)
    this.text(value, MARGIN + WIDTH - 6, this.y + 12, { align: 'right' })
    this.y += 24
  }

  /** Small boxes side by side, e.g. Einnahmen, Ausgaben, … */
  tiles(items: [string, string][]) {
    const gap = 3
    const w = (WIDTH - gap * (items.length - 1)) / items.length
    this.need(20)
    items.forEach(([label, value], i) => {
      const x = MARGIN + i * (w + gap)
      this.doc.setFillColor(...ZEBRA)
      this.doc.roundedRect(x, this.y, w, 17, 2.5, 2.5, 'F')
      this.font(8, 'normal', MUTED)
      this.text(label, x + 3.5, this.y + 6)
      this.font(11, 'bold')
      this.text(this.fit(value, w - 7), x + 3.5, this.y + 13)
    })
    this.y += 23
  }

  note(text: string) {
    this.font(9, 'normal', MUTED)
    const lines = this.doc.splitTextToSize(pdfText(text), WIDTH) as string[]
    this.need(lines.length * 4.5 + 2)
    this.doc.text(lines, MARGIN, this.y + 4)
    this.y += lines.length * 4.5 + 3
  }

  /** Grouped bar chart, e.g. income and expenses per month */
  bars(rows: { label: string; a: number; b: number }[], names: [string, string]) {
    const height = 46
    this.need(height + 16)
    const top = this.y + 4
    const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]))
    const slot = WIDTH / rows.length
    const bar = Math.min(5, slot / 3)
    this.doc.setDrawColor(...LINE)
    this.doc.setLineWidth(0.2)
    for (let i = 0; i <= 4; i++) this.doc.line(MARGIN, top + (height * i) / 4, MARGIN + WIDTH, top + (height * i) / 4)
    rows.forEach((r, i) => {
      const x = MARGIN + i * slot + slot / 2
      const ha = (r.a / max) * height
      const hb = (r.b / max) * height
      this.doc.setFillColor(...TINT)
      if (ha > 0) this.doc.roundedRect(x - bar - 0.4, top + height - ha, bar, ha, 0.8, 0.8, 'F')
      this.doc.setFillColor(...EXPENSE)
      if (hb > 0) this.doc.roundedRect(x + 0.4, top + height - hb, bar, hb, 0.8, 0.8, 'F')
      this.font(7.5, 'normal', MUTED)
      this.text(r.label, x, top + height + 4.5, { align: 'center' })
    })
    this.font(7.5, 'normal', MUTED)
    this.text(euro(max), MARGIN, top - 1.2)
    const legend = top + height + 10
    this.doc.setFillColor(...TINT)
    this.doc.rect(MARGIN, legend - 2.5, 3, 3, 'F')
    this.text(names[0], MARGIN + 4.5, legend)
    this.doc.setFillColor(...EXPENSE)
    this.doc.rect(MARGIN + 30, legend - 2.5, 3, 3, 'F')
    this.text(names[1], MARGIN + 34.5, legend)
    this.y = legend + 5
  }

  /** One stacked bar with the share of each part, and a small legend below */
  shares(parts: { label: string; amount: number; share: number; color: string }[]) {
    this.need(22)
    let x = MARGIN
    const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    for (const p of parts) {
      const width = p.share * WIDTH
      if (width <= 0) continue
      this.doc.setFillColor(...rgb(p.color))
      this.doc.rect(x, this.y, Math.max(0.3, width - 0.4), 6, 'F')
      x += width
    }
    this.y += 9
    let lx = MARGIN
    this.font(7.5, 'normal', MUTED)
    for (const p of parts.slice(0, 8)) {
      const text = `${pdfText(p.label)} ${Math.round(p.share * 100)} %`
      const width = this.doc.getTextWidth(text) + 8
      if (lx + width > MARGIN + WIDTH) { lx = MARGIN; this.y += 4.5 }
      this.doc.setFillColor(...rgb(p.color))
      this.doc.rect(lx, this.y - 2.4, 2.8, 2.8, 'F')
      this.text(text, lx + 4, this.y)
      lx += width
    }
    this.y += 5
  }

  /** Page numbers and the report name at the bottom of every page */
  footers() {
    const total = this.doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i)
      this.font(8, 'normal', MUTED)
      this.text(this.footer, MARGIN, PAGE_H - 9)
      this.text(`Seite ${i} von ${total}`, PAGE_W - MARGIN, PAGE_H - 9, { align: 'right' })
    }
  }
}

export interface PhotoPage {
  id: string
  /** e.g. "Beleg 3 · 12.11.2026 · 23,40 €" */
  caption: string
  detail: string
}

/** One page per photo, as large as fits, with its caption above. Missing photos are listed. */
async function appendPhotos(w: Writer, photos: PhotoPage[], onProgress?: (done: number, total: number) => void) {
  if (photos.length === 0) return
  const missing: string[] = []
  for (const [i, p] of photos.entries()) {
    onProgress?.(i, photos.length)
    const blob = await loadPhoto(p.id)
    if (!blob) {
      missing.push(p.caption)
      continue
    }
    const data = new Uint8Array(await blob.arrayBuffer())
    w.newPage()
    w.font(12, 'bold')
    w.text(p.caption, MARGIN, w.y + 5)
    w.font(9.5, 'normal', MUTED)
    w.text(w.fit(p.detail, WIDTH), MARGIN, w.y + 10.5)
    w.y += 15
    const { width, height } = w.doc.getImageProperties(data)
    const boxH = BOTTOM - w.y - 2
    const scale = Math.min(WIDTH / width, boxH / height)
    const imgW = width * scale
    const imgH = height * scale
    w.doc.addImage(data, 'JPEG', MARGIN + (WIDTH - imgW) / 2, w.y, imgW, imgH, `photo-${i}`, 'NONE')
    w.doc.setDrawColor(...LINE)
    w.doc.setLineWidth(0.2)
    w.doc.rect(MARGIN + (WIDTH - imgW) / 2, w.y, imgW, imgH)
  }
  onProgress?.(photos.length, photos.length)
  if (missing.length > 0) {
    w.newPage()
    w.heading('Nicht gefundene Belege')
    w.note(missing.join(', '))
  }
}

async function createDoc(): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf')
  return new jsPDF({ unit: 'mm', format: 'a4', compress: true })
}

/** Photo numbers per entry, counted through the whole report */
function numberPhotos(entries: Entry[]): { pages: PhotoPage[]; labels: Map<string, string> } {
  const pages: PhotoPage[] = []
  const labels = new Map<string, string>()
  for (const e of entries) {
    const numbers: number[] = []
    for (const id of e.photos ?? []) {
      pages.push({ id, caption: `Beleg ${pages.length + 1} · ${formatDate(e.date)} · ${euro(e.amount)}`, detail: describe(e) })
      numbers.push(pages.length)
    }
    // Numbers of one entry follow each other: "Belege 3–26"
    if (numbers.length > 0) labels.set(e.id, numbers.length === 1 ? `Beleg ${numbers[0]}` : numbers.length === 2 ? `Belege ${numbers.join(', ')}` : `Belege ${numbers[0]}–${numbers.at(-1)}`)
  }
  return { pages, labels }
}

/** "Abrechnung Eltern – November 2026" with all expenses for the parents, the open amount and the receipts. */
export async function parentsReport(
  statement: Statement,
  options: ReportOptions & { earlierOpen: number; settled: Set<string> },
  onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const month = monthLabel(statement.month)
  const monthName = month.split(' ')[0]
  const title = `Abrechnung Eltern – ${month}`
  const doc = await createDoc()
  doc.setProperties({ title, author: options.name, creator: 'Budget' })
  const w = new Writer(doc, title)
  w.title(title, options)

  const { pages, labels } = numberPhotos(statement.items)
  const columns: Column[] = [
    { label: 'Datum', width: 24 },
    { label: 'Beschreibung', width: WIDTH - 24 - 30 - 26 },
    { label: 'Betrag', width: 30, align: 'right' },
    { label: 'Status', width: 26, align: 'right' },
  ]
  w.heading(`Ausgaben im ${monthName}`)
  if (statement.items.length === 0) {
    w.note('In diesem Monat gibt es keine Ausgaben in der Kategorie „Eltern“.')
  } else {
    w.tableHead(columns)
    statement.items.forEach((e: Entry, i: number) => {
      const label = labels.get(e.id)
      const text = label ? `${describe(e)}  (${label})` : describe(e)
      const settled = options.settled.has(e.id)
      w.row(columns, [formatDate(e.date), text, euro(e.amount), settled ? 'erstattet' : 'offen'], {
        zebra: i % 2 === 1,
        rgb: [INK, INK, INK, settled ? MUTED : TINT],
      })
    })
  }

  w.y += 6
  w.line(`Summe der Eltern-Ausgaben im ${monthName}`, euro(statement.total), { bold: true })
  w.line('Bereits bezahlt', statement.paid > 0 ? `- ${euro(statement.paid)}` : euro(0))
  for (const p of statement.payments) w.line(`    Zahlung vom ${formatDate(p.refund.date)}`, euro(p.amount), { rgb: MUTED })
  w.y += 3
  if (statement.status === 'paid') w.highlight('Ganz bezahlt', euro(statement.paid))
  else w.highlight('Offener Betrag', euro(statement.open))
  const status = statement.running && statement.status !== 'paid' ? 'Der Monat läuft noch.' : `Status: ${STATUS_LABEL[statement.status]}.`
  w.note(`${status} „Erstattet“ markiert Posten, die schon zurückgezahlt sind. Ist die Abrechnung ganz bezahlt, gelten alle ihre Posten als erstattet.`)
  if (options.earlierOpen > 0) w.line('Aus früheren Abrechnungen noch offen', euro(options.earlierOpen))
  if (options.earlierOpen > 0) w.line('Insgesamt offen', euro(options.earlierOpen + statement.open), { bold: true })
  if (options.earlierOpen > 0) w.y += 3
  if (pages.length > 0) w.note(`Im Anhang: ${pages.length} ${pages.length === 1 ? 'Beleg' : 'Belege'}, nummeriert wie in der Tabelle.`)

  await appendPhotos(w, pages, onProgress)
  w.footers()
  return doc.output('blob')
}

const TYPE_TITLES: [EntryType, string][] = [['income', 'Einnahmen'], ['expense', 'Ausgaben'], ['saving', 'Sparen']]

const signed = (cents: number) => `${cents < 0 ? '-' : ''}${euro(Math.abs(cents))}`

/** "+12,30 € (+8 %)" against the previous period */
function changeText(c: Comparison, percent = false): string {
  if (c.current === 0 && c.previous === 0) return '–'
  if (c.diff === 0) return '± 0'
  const sign = c.diff > 0 ? '+' : '-'
  if (percent) return `${sign}${String(Math.round(Math.abs(c.diff) * 1000) / 10).replace('.', ',')} Pkt.`
  return `${sign}${euro(Math.abs(c.diff))}${c.ratio !== null ? ` (${sign}${Math.round(Math.abs(c.ratio) * 100)} %)` : ''}`
}

/** All entries of the period, by type, overcategory and category, with the photo numbers */
function listEntries(w: Writer, entries: Entry[], categories: Category[], groups: Group[], labels: Map<string, string>) {
  const columns: Column[] = [
    { label: 'Datum', width: 24 },
    { label: 'Beschreibung', width: WIDTH - 24 - 32 },
    { label: 'Betrag', width: 32, align: 'right' },
  ]
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  const byCategory = (c: Category) => sorted.filter((e) => e.categoryId === c.id)
  const total = (list: Entry[]) => list.reduce((s, e) => s + e.amount, 0)

  for (const [type, heading] of TYPE_TITLES) {
    const ofType = sorted.filter((e) => e.type === type)
    if (ofType.length === 0) continue
    w.y += 2
    w.need(30)
    w.font(14, 'bold', TINT)
    w.text(heading, MARGIN, w.y + 6)
    w.font(14, 'bold', TINT)
    w.text(euro(total(ofType)), MARGIN + WIDTH, w.y + 6, { align: 'right' })
    w.y += 11

    // Overcategories in their order, then categories without one
    const groupIds = new Set(groups.map((g) => g.id))
    const blocks: { label: string | null; members: Category[] }[] = [
      ...groups.filter((g) => g.type === type).map((g) => ({ label: g.name, members: categories.filter((c) => c.groupId === g.id) })),
      { label: null, members: categories.filter((c) => c.type === type && !(c.groupId && groupIds.has(c.groupId))) },
    ]
    const known = new Set(categories.map((c) => c.id))
    const unknown = ofType.filter((e) => !known.has(e.categoryId))

    for (const block of blocks) {
      const used = block.members.filter((c) => byCategory(c).length > 0)
      if (used.length === 0) continue
      if (block.label) {
        w.need(24)
        w.doc.setFillColor(...TINT_SOFT)
        w.doc.rect(MARGIN, w.y, WIDTH, 7.5, 'F')
        w.font(10.5, 'bold', INK)
        w.text(block.label, MARGIN + 2, w.y + 5.2)
        w.text(euro(used.reduce((s, c) => s + total(byCategory(c)), 0)), MARGIN + WIDTH - 2, w.y + 5.2, { align: 'right' })
        w.y += 9
      }
      for (const c of used) {
        const list = byCategory(c)
        w.need(22)
        w.font(10, 'bold', INK)
        w.text(c.name, MARGIN + (block.label ? 4 : 2), w.y + 5)
        w.text(euro(total(list)), MARGIN + WIDTH - 2, w.y + 5, { align: 'right' })
        w.y += 7
        list.forEach((e, i) => {
          const label = labels.get(e.id)
          w.row(columns, [formatDate(e.date), label ? `${describe(e)}  (${label})` : describe(e), euro(e.amount)], { zebra: i % 2 === 1, rgb: [MUTED, INK, INK] })
        })
        w.y += 3
      }
    }
    if (unknown.length > 0) {
      w.font(10, 'bold')
      w.text('Ohne Kategorie', MARGIN + 2, w.y + 5)
      w.y += 7
      unknown.forEach((e, i) => w.row(columns, [formatDate(e.date), describe(e), euro(e.amount)], { zebra: i % 2 === 1 }))
    }
  }
  if (sorted.length === 0) w.note('In diesem Monat gibt es keine Buchungen.')

}

export interface StatementReportOptions extends ReportOptions {
  categories: Category[]
  groups: Group[]
  labels: Label[]
  photos: boolean
  hiddenParents?: boolean
}

/**
 * The monthly or yearly statement: key figures with the comparison, the year's course,
 * spending by area, budgets and goals, labels, the largest expenses, Abos, parents costs,
 * then every entry and, if wanted, the receipts.
 */
export async function statementReport(s: PeriodStatement, options: StatementReportOptions, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const yearly = s.period.kind === 'year'
  const title = yearly ? `Jahresabrechnung ${s.period.key}` : `Monatsabrechnung ${monthLabel(s.period.key)}`
  const prevName = yearly ? String(Number(s.period.key) - 1) : 'Vormonat'
  const doc = await createDoc()
  doc.setProperties({ title, author: options.name, creator: 'Budget' })
  const w = new Writer(doc, title)
  w.title(title, options)

  const sum = s.summary
  w.tiles([
    ['Einnahmen', euro(sum.income)],
    ['Ausgaben', euro(sum.expense)],
    ['Gespart', euro(sum.saving)],
    ['Rest', signed(sum.rest)],
    ['Sparquote', sum.savingsRate === null ? '–' : pdfText(formatPercent(sum.savingsRate))],
  ])
  const kpi: Column[] = [{ label: 'Kennzahl', width: 50 }, { label: 'Betrag', width: 40, align: 'right' }, { label: prevName, width: 40, align: 'right' }, { label: 'Veränderung', width: WIDTH - 130, align: 'right' }]
  w.tableHead(kpi)
  const c = s.comparison
  w.row(kpi, ['Einnahmen', euro(sum.income), euro(s.previous.income), changeText(c.income)])
  w.row(kpi, ['Ausgaben', euro(sum.expense), euro(s.previous.expense), changeText(c.expense)], { zebra: true })
  w.row(kpi, ['Gespart', euro(sum.saving), euro(s.previous.saving), changeText(c.saving)])
  w.row(kpi, ['Rest', signed(sum.rest), signed(s.previous.rest), changeText(c.rest)], { zebra: true })
  w.row(kpi, ['Sparquote', pdfText(formatPercent(sum.savingsRate ?? 0)), pdfText(formatPercent(s.previous.savingsRate ?? 0)), changeText(c.savingsRate, true)])
  if (options.hiddenParents) w.note('„Eltern“ und „Kostenrückzahlung Eltern“ sind ausgeblendet, wie in der App eingestellt.')

  if (s.months) {
    w.y += 4
    w.heading(`Verlauf ${s.period.key}`)
    w.bars(s.months.map((m) => ({ label: monthShort(m.month), a: m.income, b: m.expense })), ['Einnahmen', 'Ausgaben'])
    const avg: Column[] = [{ label: '', width: 70 }, { label: '', width: WIDTH - 70, align: 'right' }]
    w.row(avg, ['Durchschnittliche Ausgaben pro Monat', euro(s.averageExpense ?? 0)])
    if (s.dearest) w.row(avg, ['Teuerster Monat', `${monthLabel(s.dearest.month)} · ${euro(s.dearest.expense)}`], { zebra: true })
    if (s.cheapest) w.row(avg, ['Günstigster Monat', `${monthLabel(s.cheapest.month)} · ${euro(s.cheapest.expense)}`])
  }

  if (s.groups.length > 0) {
    w.y += 4
    w.heading('Ausgaben nach Bereichen')
    w.shares(s.groups.map((g) => ({ label: g.label, amount: g.amount, share: g.share, color: g.color })))
    const cols: Column[] = [{ label: 'Bereich / Kategorie', width: 66 }, { label: 'Anteil', width: 20, align: 'right' }, { label: 'Anz.', width: 14, align: 'right' }, { label: 'Betrag', width: 30, align: 'right' }, { label: `zu ${prevName}`, width: WIDTH - 130, align: 'right' }]
    w.tableHead(cols)
    for (const g of s.groups) {
      w.row(cols, [g.label, pdfText(formatPercent(g.share)), String(g.count), euro(g.amount), changeText({ current: g.amount, previous: g.previous, diff: g.amount - g.previous, ratio: g.previous ? (g.amount - g.previous) / g.previous : null })], { bold: true })
      if (g.lines.length > 1) for (const l of g.lines) w.row(cols, [`    ${l.category.name}`, pdfText(formatPercent(l.share)), String(l.count), euro(l.amount), changeText({ current: l.amount, previous: l.previous, diff: l.amount - l.previous, ratio: l.previous ? (l.amount - l.previous) / l.previous : null })], { rgb: [MUTED, MUTED, MUTED, INK, MUTED] })
    }
  }

  if (s.budgets.length > 0 || s.goals.length > 0) {
    w.y += 4
    w.heading('Budgets & Ziele')
    const cols: Column[] = [{ label: 'Budget', width: 62 }, { label: 'Ausgegeben', width: 30, align: 'right' }, { label: 'Budget', width: 30, align: 'right' }, { label: 'Stand', width: WIDTH - 122, align: 'right' }]
    if (s.budgets.length > 0) w.tableHead(cols)
    s.budgets.forEach((b, i) => {
      const state = b.kept ? `${b.kept.months} von ${b.kept.of} Monaten eingehalten` : b.progress.level === 'over' ? `${euro(-b.progress.rest)} drüber` : `${Math.round(b.progress.ratio * 100)} % · ${euro(b.progress.rest)} übrig`
      w.row(cols, [`${b.name} (${b.kind === 'group' ? 'Überkategorie' : b.kind === 'period' ? 'Zeitraum' : b.kind === 'label' ? 'Label' : 'Kategorie'})`, euro(b.progress.spent), euro(b.progress.budget), state], {
        zebra: i % 2 === 1, rgb: [INK, INK, INK, b.progress.level === 'over' ? RED : b.progress.level === 'warn' ? AMBER : MUTED],
      })
    })
    if (s.goals.length > 0) {
      const gcols: Column[] = [{ label: 'Sparziel', width: 62 }, { label: 'Gespart', width: 30, align: 'right' }, { label: 'Ziel', width: 30, align: 'right' }, { label: 'Stand', width: WIDTH - 122, align: 'right' }]
      w.y += 2
      w.tableHead(gcols)
      s.goals.forEach(({ goal, progress }, i) => w.row(gcols, [`${goal.name} bis ${formatDate(goal.due)}`, euro(progress.saved), euro(goal.target), progress.reached ? 'erreicht' : progress.onTrack ? 'im Plan' : progress.overdue ? 'verpasst' : 'hinter dem Plan'], {
        zebra: i % 2 === 1, rgb: [INK, INK, INK, progress.level === 'over' ? RED : progress.level === 'warn' ? AMBER : GREEN],
      }))
    }
  }

  if (s.labels.length > 0) {
    w.y += 4
    w.heading('Labels')
    const cols: Column[] = [{ label: 'Label', width: WIDTH - 70 }, { label: 'Buchungen', width: 30, align: 'right' }, { label: 'Summe', width: 40, align: 'right' }]
    w.tableHead(cols)
    s.labels.forEach((l, i) => w.row(cols, [l.label.name, String(l.count), euro(l.amount)], { zebra: i % 2 === 1 }))
  }

  if (s.top.length > 0) {
    w.y += 4
    w.heading('Größte Ausgaben')
    const cols: Column[] = [{ label: '#', width: 8 }, { label: 'Datum', width: 24 }, { label: 'Beschreibung', width: WIDTH - 8 - 24 - 46 - 30 }, { label: 'Kategorie', width: 46 }, { label: 'Betrag', width: 30, align: 'right' }]
    w.tableHead(cols)
    s.top.forEach((e, i) => w.row(cols, [String(i + 1), formatDate(e.date), describe(e), options.categories.find((x) => x.id === e.categoryId)?.name ?? '', euro(e.amount)], { zebra: i % 2 === 1 }))
  }

  const recurring = [...s.subscriptions.map((l) => ({ ...l, tag: 'Abo' })), ...s.standing.map((l) => ({ ...l, tag: 'Dauerauftrag' }))]
  if (recurring.length > 0) {
    w.y += 4
    w.heading('Abos und Daueraufträge')
    const cols: Column[] = [{ label: 'Name', width: WIDTH - 90 }, { label: 'Art', width: 36 }, { label: 'Anzahl', width: 20, align: 'right' }, { label: 'Summe', width: 34, align: 'right' }]
    w.tableHead(cols)
    recurring.forEach((l, i) => w.row(cols, [l.recurring.name, l.tag, String(l.count), euro(l.amount)], { zebra: i % 2 === 1 }))
  }

  if (s.parents.spent > 0 || s.parents.refunded > 0) {
    w.y += 4
    w.heading('Eltern-Kosten')
    w.line(`Ausgaben (${s.parents.count})`, euro(s.parents.spent))
    w.line('Rückzahlungen', euro(s.parents.refunded))
    w.line(`Offen am ${formatDate(s.to)}`, signed(s.parents.openAtEnd), { bold: true })
  }

  const sorted = [...s.entries]
  const { pages, labels } = numberPhotos(options.photos ? sorted : [])
  w.newPage()
  w.heading('Alle Buchungen')
  listEntries(w, sorted, options.categories, options.groups, labels)

  await appendPhotos(w, pages, onProgress)
  w.footers()
  return doc.output('blob')
}
