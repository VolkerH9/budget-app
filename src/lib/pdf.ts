import type { jsPDF as JsPdf } from 'jspdf'
import type { Category, Entry, EntryType, Group } from '../db'
import { formatDate, monthLabel } from './dates'
import { formatEuro, formatPercent } from './format'
import type { ParentsStatement } from './parents'
import { summarize } from './stats'
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
export async function parentsReport(statement: ParentsStatement, options: ReportOptions, onProgress?: (done: number, total: number) => void): Promise<Blob> {
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
    statement.items.forEach((e, i) => {
      const label = labels.get(e.id)
      const text = label ? `${describe(e)}  (${label})` : describe(e)
      w.row(columns, [formatDate(e.date), text, euro(e.amount), e.refunded ? 'erstattet' : 'offen'], {
        zebra: i % 2 === 1,
        rgb: [INK, INK, INK, e.refunded ? MUTED : TINT],
      })
    })
  }

  w.y += 6
  w.line(`Summe der Eltern-Ausgaben im ${monthName}`, euro(statement.spent), { bold: true })
  w.line(`Im ${monthName} erhaltene Rückzahlungen`, statement.refunds > 0 ? `- ${euro(statement.refunds)}` : euro(0))
  if (statement.carry !== 0) {
    w.line(statement.carry > 0 ? 'Offen aus den Vormonaten' : 'Guthaben aus den Vormonaten', statement.carry > 0 ? euro(statement.carry) : `- ${euro(-statement.carry)}`)
  }
  w.y += 3
  w.highlight(statement.open >= 0 ? 'Offener Betrag' : 'Zu viel erstattet', euro(Math.abs(statement.open)))
  w.note('Offener Betrag = alle Ausgaben in „Eltern“ bis Monatsende minus alle Rückzahlungen bis Monatsende. „Erstattet“ markiert Posten, die schon zurückgezahlt sind.')
  if (pages.length > 0) w.note(`Im Anhang: ${pages.length} ${pages.length === 1 ? 'Beleg' : 'Belege'}, nummeriert wie in der Tabelle.`)

  await appendPhotos(w, pages, onProgress)
  w.footers()
  return doc.output('blob')
}

const TYPE_TITLES: [EntryType, string][] = [['income', 'Einnahmen'], ['expense', 'Ausgaben'], ['saving', 'Sparen']]

/** Everything of a month, by overcategory and category, with sums and the savings rate. */
export async function monthReport(
  month: string,
  entries: Entry[],
  categories: Category[],
  groups: Group[],
  options: ReportOptions & { photos: boolean; hiddenParents: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const title = `Monatsbericht ${monthLabel(month)}`
  const doc = await createDoc()
  doc.setProperties({ title, author: options.name, creator: 'Budget' })
  const w = new Writer(doc, title)
  w.title(title, options)

  const sum = summarize(entries)
  w.tiles([
    ['Einnahmen', euro(sum.income)],
    ['Ausgaben', euro(sum.expense)],
    ['Gespart', euro(sum.saving)],
    ['Rest', `${sum.rest < 0 ? '-' : ''}${euro(Math.abs(sum.rest))}`],
    ['Sparquote', sum.savingsRate === null ? '–' : pdfText(formatPercent(sum.savingsRate))],
  ])
  if (options.hiddenParents) w.note('„Eltern“ und „Kostenrückzahlung Eltern“ sind ausgeblendet, wie in der App eingestellt.')

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  const { pages, labels } = numberPhotos(options.photos ? sorted : [])
  const columns: Column[] = [
    { label: 'Datum', width: 24 },
    { label: 'Beschreibung', width: WIDTH - 24 - 32 },
    { label: 'Betrag', width: 32, align: 'right' },
  ]
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

  await appendPhotos(w, pages, onProgress)
  w.footers()
  return doc.output('blob')
}
