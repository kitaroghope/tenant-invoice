// Minimal RFC 4180-ish CSV writer: quote any field containing a comma, quote, or newline,
// and double up embedded quotes. No external library needed for something this small.
//
// Cells are also guarded against CSV/formula injection: several of the exported fields
// (customer name, notes, reference) are attacker-controllable text — record_standalone_payment
// lets any authenticated member set an arbitrary customer_display_name — so a value starting
// with =, +, -, @, or a tab/CR gets a leading apostrophe. Excel/Sheets otherwise treat a
// leading =/+/-/@ as a formula, which is a known vector (OWASP "CSV Injection") for running
// arbitrary formulas — including DDE launches of local commands in legacy Excel — the moment
// someone opens the exported file.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/
function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (FORMULA_TRIGGER.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  return lines.join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  // Leading BOM so Excel (still the primary consumer of a bare .csv download) reliably
  // detects UTF-8 instead of guessing a local codepage and mangling non-ASCII names.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
