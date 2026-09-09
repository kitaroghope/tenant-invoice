import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { container } from '../../shared/container'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import { Currency } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'
import type { InvoiceSummary } from '../../application/ports/InvoiceRepository'
import type { Payment } from '../../application/ports/PaymentRepository'
import type { Receipt } from '../../application/ports/ReceiptRepository'

type Preset = 'today' | 'week' | 'month' | 'custom'

interface CurrencyTotals {
  currencyCode: string
  currencyExponent: number
  issuedMinorUnits: bigint
  paidMinorUnits: bigint
  outstandingMinorUnits: bigint
  overdueMinorUnits: bigint
}

function windowFor(preset: Preset, customStart: string, customEnd: string): { start: Date; end: Date } {
  const now = new Date()
  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { start, end: now }
  }
  if (preset === 'week') {
    const start = new Date(now)
    start.setDate(start.getDate() - 7)
    return { start, end: now }
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start, end: now }
  }
  const start = customStart ? new Date(customStart) : new Date(0)
  const end = customEnd ? new Date(new Date(customEnd).getTime() + 24 * 60 * 60 * 1000) : now
  return { start, end }
}

// A single report driven by a date-range preset rather than separate daily/weekly/monthly
// screens — one code path for every window, per the plan's reporting design. Filtered
// client-side against already-fetched data; no new DB infrastructure needed at this scale.
function summarize(invoices: readonly InvoiceSummary[], payments: readonly Payment[], receipts: readonly Receipt[], start: Date, end: Date) {
  const now = new Date()
  const byCurrency = new Map<string, CurrencyTotals>()
  const entryFor = (code: string, exponent: number) => {
    const existing = byCurrency.get(code)
    if (existing) return existing
    const created: CurrencyTotals = { currencyCode: code, currencyExponent: exponent, issuedMinorUnits: 0n, paidMinorUnits: 0n, outstandingMinorUnits: 0n, overdueMinorUnits: 0n }
    byCurrency.set(code, created)
    return created
  }

  const windowedInvoices = invoices.filter((invoice) => invoice.issuedAt && invoice.issuedAt >= start && invoice.issuedAt < end && invoice.status !== 'draft' && invoice.status !== 'void')
  for (const invoice of windowedInvoices) {
    const entry = entryFor(invoice.currencyCode, invoice.currencyExponent)
    entry.issuedMinorUnits += invoice.totalMinorUnits
    if (invoice.status === 'issued' || invoice.status === 'sent' || invoice.status === 'partially_paid') {
      const balance = invoice.totalMinorUnits - invoice.amountPaidMinorUnits
      entry.outstandingMinorUnits += balance
      if (invoice.dueAt && invoice.dueAt < now) entry.overdueMinorUnits += balance
    }
  }

  const windowedPayments = payments.filter((payment) => payment.status === 'recorded' && payment.paidAt >= start && payment.paidAt < end)
  for (const payment of windowedPayments) {
    const entry = entryFor(payment.currencyCode, payment.currencyExponent)
    entry.paidMinorUnits += payment.amountMinorUnits
  }

  const windowedReceipts = receipts.filter((receipt) => receipt.status === 'issued' && receipt.issuedAt >= start && receipt.issuedAt < end)

  const recent = [...windowedInvoices].sort((a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0)).slice(0, 5)

  return {
    totals: [...byCurrency.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    invoiceCount: windowedInvoices.length,
    receiptCount: windowedReceipts.length,
    recent,
  }
}

export function OverviewPage({ business }: { business: Business }) {
  const base = `/app/businesses/${business.id.toString()}`
  const [preset, setPreset] = useState<Preset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const invoices = useQuery({
    queryKey: ['invoices', business.id.toString()],
    queryFn: () => container.invoiceRepository.listActive(business.id),
  })
  const payments = useQuery({
    queryKey: ['business-payments', business.id.toString()],
    queryFn: () => container.paymentRepository.listForBusiness(business.id),
  })
  const receipts = useQuery({
    queryKey: ['receipts', business.id.toString()],
    queryFn: () => container.receiptRepository.listForBusiness(business.id),
  })

  const isLoading = invoices.isLoading || payments.isLoading || receipts.isLoading
  const hasAnyIssuedInvoice = invoices.data?.some((invoice) => invoice.status !== 'draft') ?? false

  const { start, end } = useMemo(() => windowFor(preset, customStart, customEnd), [preset, customStart, customEnd])
  const report = useMemo(
    () => (invoices.data && payments.data && receipts.data ? summarize(invoices.data, payments.data, receipts.data, start, end) : null),
    [invoices.data, payments.data, receipts.data, start, end],
  )

  return (
    <>
      <header><div><span className="eyebrow">Overview</span><h1>Good to see you.</h1></div><Link className="primary link-button" to={`${base}/invoices/new`}>New invoice</Link></header>

      <div className="report-range no-print">
        <div className="print-format-toggle">
          <button className={preset === 'today' ? 'active' : ''} onClick={() => setPreset('today')}>Today</button>
          <button className={preset === 'week' ? 'active' : ''} onClick={() => setPreset('week')}>This week</button>
          <button className={preset === 'month' ? 'active' : ''} onClick={() => setPreset('month')}>This month</button>
          <button className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>Custom</button>
        </div>
        {preset === 'custom' && (
          <div className="report-range-inputs">
            <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            <span>to</span>
            <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
          </div>
        )}
      </div>

      {isLoading && <Loader fullRegion label="Loading overview…" />}

      {report && report.totals.length === 0 && (
        <section className="metric-grid">
          <article><span>Issued</span><strong>—</strong><small>No invoices in this period</small></article>
          <article><span>Paid</span><strong>—</strong><small>No payments in this period</small></article>
          <article><span>Outstanding</span><strong>—</strong><small>Nothing owed from this period</small></article>
        </section>
      )}

      {report?.totals.map((entry) => {
        const currency = new Currency({ code: entry.currencyCode, name: entry.currencyCode, symbol: entry.currencyCode, exponent: entry.currencyExponent })
        const suffix = report.totals.length > 1 ? ` (${entry.currencyCode})` : ''
        return (
          <section className="metric-grid" key={entry.currencyCode}>
            <article><span>Issued{suffix}</span><strong>{Money.fromMinorUnits(entry.issuedMinorUnits, currency).format(business.locale)}</strong><small>{report.invoiceCount} invoice{report.invoiceCount === 1 ? '' : 's'}</small></article>
            <article><span>Paid{suffix}</span><strong>{Money.fromMinorUnits(entry.paidMinorUnits, currency).format(business.locale)}</strong><small>{report.receiptCount} receipt{report.receiptCount === 1 ? '' : 's'}</small></article>
            <article><span>Outstanding{suffix}</span><strong>{Money.fromMinorUnits(entry.outstandingMinorUnits, currency).format(business.locale)}</strong><small>{entry.overdueMinorUnits > 0n ? `${Money.fromMinorUnits(entry.overdueMinorUnits, currency).format(business.locale)} overdue` : 'None overdue'}</small></article>
          </section>
        )
      })}

      {report && report.recent.length > 0 && (
        <section>
          <span className="step-label">Recent in this period</span>
          <div className="member-list">
            {report.recent.map((invoice) => {
              const currency = new Currency({ code: invoice.currencyCode, name: invoice.currencyCode, symbol: invoice.currencyCode, exponent: invoice.currencyExponent })
              return (
                <Link className="member-row invoice-row" key={invoice.id.toString()} to={`${base}/invoices/${invoice.id.toString()}`}>
                  <div>
                    <span className={`status-pill ${invoice.status === 'paid' ? 'active' : 'invited'}`}>{invoice.status}</span>
                    <div className="member-role">#{invoice.invoiceNumber} · {invoice.customerDisplayName}</div>
                  </div>
                  <strong>{Money.fromMinorUnits(invoice.totalMinorUnits, currency).format(business.locale)}</strong>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {!hasAnyIssuedInvoice && (
        <section className="empty-state"><div className="empty-icon">＋</div><h2>Create your first invoice</h2><p>Add a customer, line items and payment terms. The document will use {business.defaultCurrencyCode} by default.</p><Link className="secondary link-button" to={`${base}/invoices/new`}>Start an invoice</Link></section>
      )}
    </>
  )
}
