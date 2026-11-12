import ExcelJS from 'exceljs'
import { isParentsExpense, type Category, type Group, type Label } from '../db'
import { toCsv } from './backup'
import { formatDate, monthLabel, monthShort, today } from './dates'
import { formatEuro } from './format'
import { statementReport } from './pdf'
import { periodTitle, type Statement } from './statement'

export interface ExportContext {
  statement: Statement
  categories: Category[]
  groups: Group[]
  labels: Label[]
  name: string
  photos?: boolean
  hiddenParents?: boolean
}

export const statementPdf = (c: ExportContext, onProgress?: (done: number, total: number) => void) =>
  statementReport(c.statement, { name: c.name, created: formatDate(today()), categories: c.categories, groups: c.groups, labels: c.labels, photos: !!c.photos, hiddenParents: c.hiddenParents }, onProgress)

/** All entries of the period with their labels; semicolons and a byte order mark for German Excel and Numbers */
export const statementCsv = (c: ExportContext) => toCsv(c.statement.entries, c.categories, c.groups, c.labels)

// ---- Excel ----

const TINT = 'FF1F66E0'
const TINT_SOFT = 'FFE8F0FD'
const EURO = '#,##0.00 "€";-#,##0.00 "€"'
const PERCENT = '0.0 %'
const DATE = 'dd.mm.yyyy'
const TYPES = { expense: 'Ausgabe', saving: 'Sparen', income: 'Einnahme' } as const

/** A real date for Excel, without a time zone shift */
const excelDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const money = (cents: number) => Math.round(cents) / 100

function header(sheet: ExcelJS.Worksheet, row: number, values: string[], widths?: number[]) {
  const r = sheet.getRow(row)
  r.values = values
  r.height = 22
  r.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } }
    cell.alignment = { vertical: 'middle' }
  })
  widths?.forEach((w, i) => { sheet.getColumn(i + 1).width = w })
  sheet.views = [{ state: 'frozen', ySplit: row }]
}

function title(sheet: ExcelJS.Worksheet, text: string, sub: string) {
  sheet.getCell('A1').value = text
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: TINT } }
  sheet.getCell('A2').value = sub
  sheet.getCell('A2').font = { color: { argb: 'FF6E6E73' } }
}

function totalRow(sheet: ExcelJS.Worksheet, row: number, label: string, columns: { col: string; from: number; to: number }[]) {
  const r = sheet.getRow(row)
  r.getCell(1).value = label
  for (const c of columns) {
    const cell = sheet.getCell(`${c.col}${row}`)
    // SUBTOTAL leaves rows hidden by the filter out of the sum
    cell.value = { formula: `SUBTOTAL(109,${c.col}${c.from}:${c.col}${c.to})` }
    cell.numFmt = EURO
  }
  r.font = { bold: true }
  r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT_SOFT } } })
}

/** The app's bar chart, drawn on a canvas for the overview sheet */
function chartImage(s: Statement): string | null {
  if (typeof document === 'undefined') return null
  const rows = s.months
    ? s.months.map((m) => ({ label: monthShort(m.month), a: m.income, b: m.expense }))
    : s.groups.slice(0, 8).map((g) => ({ label: g.label.length > 12 ? `${g.label.slice(0, 11)}…` : g.label, a: 0, b: g.amount }))
  if (rows.length === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 560
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const left = 90
  const top = 70
  const height = 380
  const width = canvas.width - left - 40
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]))
  ctx.font = 'bold 30px -apple-system, Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#1c1c1e'
  ctx.fillText(s.months ? 'Einnahmen und Ausgaben pro Monat' : 'Ausgaben nach Bereichen', left, 42)
  ctx.font = '20px -apple-system, Helvetica, Arial, sans-serif'
  ctx.strokeStyle = '#e5e5ea'
  ctx.lineWidth = 2
  for (let i = 0; i <= 4; i++) {
    const y = top + (height * i) / 4
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke()
    ctx.fillStyle = '#8e8e93'
    ctx.textAlign = 'right'
    ctx.fillText(new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format((max * (4 - i)) / 4 / 100), left - 12, y + 7)
  }
  const slot = width / rows.length
  const bar = Math.min(34, s.months ? slot / 3 : slot / 2)
  rows.forEach((r, i) => {
    const x = left + i * slot + slot / 2
    const draw = (value: number, color: string, offset: number) => {
      const h = (value / max) * height
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x + offset, top + height - h, bar, h, [6, 6, 0, 0])
      ctx.fill()
    }
    if (s.months) { draw(r.a, '#4a76c8', -bar - 3); draw(r.b, '#c86f30', 3) } else draw(r.b, '#c86f30', -bar / 2)
    ctx.fillStyle = '#6e6e73'
    ctx.textAlign = 'center'
    ctx.fillText(r.label, x, top + height + 32)
  })
  if (s.months) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#4a76c8'; ctx.fillRect(left, canvas.height - 40, 18, 18)
    ctx.fillStyle = '#1c1c1e'; ctx.fillText('Einnahmen', left + 26, canvas.height - 24)
    ctx.fillStyle = '#c86f30'; ctx.fillRect(left + 170, canvas.height - 40, 18, 18)
    ctx.fillStyle = '#1c1c1e'; ctx.fillText('Ausgaben', left + 196, canvas.height - 24)
  }
  return canvas.toDataURL('image/png').split(',')[1]
}

/**
 * The statement as a formatted workbook: overview with chart, all entries,
 * categories, overcategories, labels, budgets and goals, parents costs.
 * Sums are real formulas; budgets over 100 % turn red.
 */
export async function statementXlsx(c: ExportContext): Promise<ArrayBuffer> {
  const s = c.statement
  const book = new ExcelJS.Workbook()
  book.creator = 'Budget'
  book.created = new Date()
  const sub = `${c.name ? `${c.name} · ` : ''}erstellt am ${formatDate(today())}`
  const caption = `${s.period.kind === 'year' ? 'Jahresabrechnung' : 'Monatsabrechnung'} ${s.period.kind === 'year' ? s.period.key : monthLabel(s.period.key)}`
  const byCategory = new Map(c.categories.map((x) => [x.id, x]))
  const byGroup = new Map(c.groups.map((x) => [x.id, x]))
  const labelNames = new Map(c.labels.map((x) => [x.id, x.name]))

  // Übersicht
  const overview = book.addWorksheet('Übersicht', { properties: { tabColor: { argb: TINT } } })
  title(overview, caption, sub)
  header(overview, 4, ['Kennzahl', periodTitle(s.period), s.period.kind === 'year' ? String(Number(s.period.key) - 1) : 'Vormonat', 'Veränderung', 'Veränderung %'], [26, 18, 18, 16, 16])
  const kpis: [string, number, number][] = [['Einnahmen', s.summary.income, s.previous.income], ['Ausgaben', s.summary.expense, s.previous.expense], ['Gespart', s.summary.saving, s.previous.saving]]
  kpis.forEach(([label, now, before], i) => {
    const row = 5 + i
    overview.getRow(row).values = [label, money(now), money(before)]
    overview.getCell(`D${row}`).value = { formula: `B${row}-C${row}` }
    overview.getCell(`E${row}`).value = { formula: `IF(C${row}=0,"",B${row}/C${row}-1)` }
  })
  overview.getRow(8).values = ['Rest']
  overview.getCell('B8').value = { formula: 'B5-B6-B7' }
  overview.getCell('C8').value = { formula: 'C5-C6-C7' }
  overview.getCell('D8').value = { formula: 'B8-C8' }
  overview.getRow(9).values = ['Sparquote']
  overview.getCell('B9').value = { formula: 'IF(B5=0,"",B7/B5)' }
  overview.getCell('C9').value = { formula: 'IF(C5=0,"",C7/C5)' }
  overview.getCell('D9').value = { formula: 'IF(OR(B9="",C9=""),"",B9-C9)' }
  for (let row = 5; row <= 9; row++) {
    for (const col of ['B', 'C', 'D']) overview.getCell(`${col}${row}`).numFmt = row === 9 ? PERCENT : EURO
    overview.getCell(`E${row}`).numFmt = PERCENT
  }
  overview.getCell('E8').value = { formula: 'IF(C8=0,"",(B8-C8)/ABS(C8))' }
  overview.getRow(8).font = { bold: true }
  if (s.months) {
    overview.getCell('A11').value = 'Durchschnittliche Ausgaben pro Monat'
    overview.getCell('B11').value = money(s.averageExpense ?? 0)
    overview.getCell('B11').numFmt = EURO
    if (s.dearest) { overview.getCell('A12').value = 'Teuerster Monat'; overview.getCell('B12').value = `${monthLabel(s.dearest.month)}: ${formatEuro(s.dearest.expense)}` }
    if (s.cheapest) { overview.getCell('A13').value = 'Günstigster Monat'; overview.getCell('B13').value = `${monthLabel(s.cheapest.month)}: ${formatEuro(s.cheapest.expense)}` }
  }
  const image = chartImage(s)
  if (image) {
    const id = book.addImage({ base64: image, extension: 'png' })
    overview.addImage(id, { tl: { col: 0, row: s.months ? 14 : 10 }, ext: { width: 720, height: 336 } })
  }

  // Alle Buchungen
  const all = book.addWorksheet('Alle Buchungen')
  title(all, 'Alle Buchungen', caption)
  header(all, 4, ['Datum', 'Art', 'Überkategorie', 'Kategorie', 'Händler', 'Notiz', 'Labels', 'Eltern', 'Betrag'], [12, 11, 20, 22, 20, 30, 24, 8, 14])
  s.entries.forEach((e, i) => {
    const category = byCategory.get(e.categoryId)
    const row = all.getRow(5 + i)
    row.values = [
      excelDate(e.date), TYPES[e.type], byGroup.get(category?.groupId ?? '')?.name ?? '', category?.name ?? '', e.merchant ?? '', e.note ?? '',
      (e.labels ?? []).map((id) => labelNames.get(id)).filter(Boolean).join(', '), isParentsExpense(e) ? 'ja' : '', money(e.amount),
    ]
    row.getCell(1).numFmt = DATE
    row.getCell(9).numFmt = EURO
  })
  const lastEntry = 4 + s.entries.length
  if (s.entries.length > 0) {
    all.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastEntry, column: 9 } }
    totalRow(all, lastEntry + 1, 'Summe (gefilterte Zeilen)', [{ col: 'I', from: 5, to: lastEntry }])
  }

  // Kategorien
  const cats = book.addWorksheet('Kategorien')
  title(cats, 'Ausgaben nach Kategorien', caption)
  header(cats, 4, ['Kategorie', 'Überkategorie', 'Buchungen', 'Betrag', 'Anteil', 'Vorperiode', 'Veränderung'], [24, 22, 12, 14, 10, 14, 14])
  const catLines = s.groups.flatMap((g) => (g.lines.length > 0 ? g.lines : []))
  const catEnd = 4 + catLines.length
  catLines.forEach((l, i) => {
    const row = 5 + i
    cats.getRow(row).values = [l.category.name, byGroup.get(l.category.groupId ?? '')?.name ?? '', l.count, money(l.amount), null, money(l.previous)]
    cats.getCell(`E${row}`).value = { formula: `IF($D$${catEnd + 1}=0,0,D${row}/$D$${catEnd + 1})` }
    cats.getCell(`G${row}`).value = { formula: `D${row}-F${row}` }
    for (const col of ['D', 'F', 'G']) cats.getCell(`${col}${row}`).numFmt = EURO
    cats.getCell(`E${row}`).numFmt = PERCENT
  })
  if (catLines.length > 0) {
    cats.autoFilter = { from: { row: 4, column: 1 }, to: { row: catEnd, column: 7 } }
    cats.getCell(`A${catEnd + 1}`).value = 'Summe'
    cats.getCell(`D${catEnd + 1}`).value = { formula: `SUM(D5:D${catEnd})` }
    cats.getCell(`F${catEnd + 1}`).value = { formula: `SUM(F5:F${catEnd})` }
    cats.getCell(`G${catEnd + 1}`).value = { formula: `D${catEnd + 1}-F${catEnd + 1}` }
    for (const col of ['D', 'F', 'G']) cats.getCell(`${col}${catEnd + 1}`).numFmt = EURO
    cats.getRow(catEnd + 1).font = { bold: true }
  }

  // Überkategorien
  const grp = book.addWorksheet('Überkategorien')
  title(grp, 'Ausgaben nach Überkategorien', caption)
  header(grp, 4, ['Überkategorie', 'Buchungen', 'Betrag', 'Anteil', 'Vorperiode', 'Veränderung'], [26, 12, 14, 10, 14, 14])
  const grpEnd = 4 + s.groups.length
  s.groups.forEach((g, i) => {
    const row = 5 + i
    grp.getRow(row).values = [g.label, g.count, money(g.amount), null, money(g.previous)]
    grp.getCell(`D${row}`).value = { formula: `IF($C$${grpEnd + 1}=0,0,C${row}/$C$${grpEnd + 1})` }
    grp.getCell(`F${row}`).value = { formula: `C${row}-E${row}` }
    for (const col of ['C', 'E', 'F']) grp.getCell(`${col}${row}`).numFmt = EURO
    grp.getCell(`D${row}`).numFmt = PERCENT
  })
  if (s.groups.length > 0) {
    grp.autoFilter = { from: { row: 4, column: 1 }, to: { row: grpEnd, column: 6 } }
    grp.getCell(`A${grpEnd + 1}`).value = 'Summe'
    grp.getCell(`C${grpEnd + 1}`).value = { formula: `SUM(C5:C${grpEnd})` }
    grp.getCell(`E${grpEnd + 1}`).value = { formula: `SUM(E5:E${grpEnd})` }
    grp.getCell(`F${grpEnd + 1}`).value = { formula: `C${grpEnd + 1}-E${grpEnd + 1}` }
    for (const col of ['C', 'E', 'F']) grp.getCell(`${col}${grpEnd + 1}`).numFmt = EURO
    grp.getRow(grpEnd + 1).font = { bold: true }
  }

  // Labels
  const lab = book.addWorksheet('Labels')
  title(lab, 'Labels im Zeitraum', caption)
  header(lab, 4, ['Label', 'Zeitraum', 'Buchungen', 'Summe', 'Budget', 'Rest', 'Auslastung'], [28, 26, 12, 14, 14, 14, 12])
  const labEnd = 4 + s.labels.length
  s.labels.forEach((l, i) => {
    const row = 5 + i
    const period = l.label.from || l.label.to ? `${l.label.from ? formatDate(l.label.from) : ''} – ${l.label.to ? formatDate(l.label.to) : ''}` : ''
    lab.getRow(row).values = [l.label.name, period, l.count, money(l.amount), l.label.budget ? money(l.label.budget) : null]
    if (l.label.budget) {
      lab.getCell(`F${row}`).value = { formula: `E${row}-D${row}` }
      lab.getCell(`G${row}`).value = { formula: `IF(E${row}=0,"",D${row}/E${row})` }
    }
    for (const col of ['D', 'E', 'F']) lab.getCell(`${col}${row}`).numFmt = EURO
    lab.getCell(`G${row}`).numFmt = PERCENT
  })
  if (s.labels.length > 0) {
    lab.autoFilter = { from: { row: 4, column: 1 }, to: { row: labEnd, column: 7 } }
    lab.addConditionalFormatting({ ref: `G5:G${labEnd}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['1'], priority: 1, style: { font: { color: { argb: 'FFC4372D' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE4E1' } } } }] })
  }

  // Budgets & Ziele
  const bud = book.addWorksheet('Budgets & Ziele')
  title(bud, 'Budgets & Ziele', caption)
  header(bud, 4, ['Budget', 'Art', 'Ausgegeben', 'Budget', 'Rest', 'Auslastung', 'Eingehalten'], [26, 16, 14, 14, 14, 12, 18])
  const budEnd = 4 + s.budgets.length
  s.budgets.forEach((b, i) => {
    const row = 5 + i
    bud.getRow(row).values = [b.name, b.kind === 'group' ? 'Überkategorie' : b.kind === 'period' ? 'Zeitraum' : b.kind === 'label' ? 'Label' : 'Kategorie', money(b.progress.spent), money(b.progress.budget), null, null, b.kept ? `${b.kept.months} von ${b.kept.of} Monaten` : '']
    bud.getCell(`E${row}`).value = { formula: `D${row}-C${row}` }
    bud.getCell(`F${row}`).value = { formula: `IF(D${row}=0,"",C${row}/D${row})` }
    for (const col of ['C', 'D', 'E']) bud.getCell(`${col}${row}`).numFmt = EURO
    bud.getCell(`F${row}`).numFmt = PERCENT
  })
  if (s.budgets.length > 0) {
    bud.addConditionalFormatting({
      ref: `F5:F${budEnd}`,
      rules: [
        { type: 'cellIs', operator: 'greaterThan', formulae: ['1'], priority: 1, style: { font: { color: { argb: 'FFC4372D' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE4E1' } } } },
        { type: 'cellIs', operator: 'between', formulae: ['0.8', '1'], priority: 2, style: { font: { color: { argb: 'FFA85A06' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF1DC' } } } },
      ],
    })
    bud.addConditionalFormatting({ ref: `E5:E${budEnd}`, rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 3, style: { font: { color: { argb: 'FFC4372D' } } } }] })
  }
  const goalStart = budEnd + 3
  if (s.goals.length > 0) {
    const r = bud.getRow(goalStart)
    r.values = ['Sparziel', 'Zieldatum', 'Gespart', 'Zielbetrag', 'Fehlt', 'Erreicht', 'Status']
    r.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } } })
    s.goals.forEach(({ goal, progress }, i) => {
      const row = goalStart + 1 + i
      bud.getRow(row).values = [goal.name, excelDate(goal.due), money(progress.saved), money(goal.target), null, null, progress.reached ? 'erreicht' : progress.onTrack ? 'im Plan' : progress.overdue ? 'verpasst' : 'hinter dem Plan']
      bud.getCell(`B${row}`).numFmt = DATE
      bud.getCell(`E${row}`).value = { formula: `MAX(0,D${row}-C${row})` }
      bud.getCell(`F${row}`).value = { formula: `IF(D${row}=0,"",C${row}/D${row})` }
      for (const col of ['C', 'D', 'E']) bud.getCell(`${col}${row}`).numFmt = EURO
      bud.getCell(`F${row}`).numFmt = PERCENT
    })
  }

  // Eltern-Kosten
  const par = book.addWorksheet('Eltern-Kosten')
  title(par, 'Eltern-Kosten', caption)
  header(par, 4, ['Datum', 'Kategorie', 'Beschreibung', 'Betrag'], [12, 24, 36, 14])
  const parents = s.entries.filter(isParentsExpense)
  const parEnd = 4 + parents.length
  parents.forEach((e, i) => {
    const row = par.getRow(5 + i)
    row.values = [excelDate(e.date), byCategory.get(e.categoryId)?.name ?? '', [e.merchant, e.note].filter(Boolean).join(' · '), money(e.amount)]
    row.getCell(1).numFmt = DATE
    row.getCell(4).numFmt = EURO
  })
  const p = parEnd + 2
  par.getCell(`C${p}`).value = 'Summe der Eltern-Ausgaben'
  par.getCell(`D${p}`).value = parents.length > 0 ? { formula: `SUM(D5:D${parEnd})` } : 0
  par.getCell(`C${p + 1}`).value = 'Rückzahlungen im Zeitraum'
  par.getCell(`D${p + 1}`).value = money(s.parents.refunded)
  par.getCell(`C${p + 2}`).value = `Offen am ${formatDate(s.to)} (alle Monate)`
  par.getCell(`D${p + 2}`).value = money(s.parents.openAtEnd)
  for (let r = p; r <= p + 2; r++) par.getCell(`D${r}`).numFmt = EURO
  par.getRow(p + 2).font = { bold: true }

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

