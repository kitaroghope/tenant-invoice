import { useState } from 'react'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { downloadCsv, toCsv } from '../shared/csv'
import type { Business } from '../../domain/business/Business'
import { Currency, resolveCurrencyExponent } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'

type ExportKind = 'customers' | 'products' | 'invoices' | 'payments' | 'receipts'

// Lets an owner pull their own business's data out as CSV — the plan's export
// requirement (§18), useful standalone and as the eventual prerequisite for account
// closure. Runs entirely client-side against the same repositories the rest of the app
// already uses (all business-scoped, same RLS as everywhere else): no new backend
// surface, so there's nothing extra here to secure or get wrong.
export function ExportSection({ business }: { business: Business }) {
  const [pending, setPending] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const businessId = business.id
  const fileStamp = new Date().toISOString().slice(0, 10)

  async function exportCustomers() {
    const rows = await container.customerRepository.listActive(businessId)
    return toCsv(
      ['Name', 'Email', 'Phone', 'Tax ID'],
      rows.map((row) => [row.displayName, row.email, row.phone, row.taxId]),
    )
  }

  async function exportProducts() {
    const rows = await container.productRepository.listActive(businessId)
    return toCsv(
      ['Name', 'Description', 'Unit', 'Price', 'Currency', 'Stock quantity'],
      rows.map((row) => [
        row.name,
        row.description,
        row.unit,
        row.priceMinorUnits !== null && row.priceCurrencyCode
          ? Money.fromMinorUnits(row.priceMinorUnits, currencyFor(row.priceCurrencyCode)).toPlainDecimalString()
          : null,
        row.priceCurrencyCode,
        row.stockQuantity,
      ]),
    )
  }

  async function exportInvoices() {
    const rows = await container.invoiceRepository.listActive(businessId)
    return toCsv(
      ['Invoice number', 'Status', 'Customer', 'Currency', 'Total', 'Amount paid', 'Issued at', 'Due at', 'Created at'],
      rows.map((row) => {
        const currency = currencyFor(row.currencyCode, row.currencyExponent)
        return [
          row.invoiceNumber,
          row.status,
          row.customerDisplayName,
          row.currencyCode,
          Money.fromMinorUnits(row.totalMinorUnits, currency).toPlainDecimalString(),
          Money.fromMinorUnits(row.amountPaidMinorUnits, currency).toPlainDecimalString(),
          row.issuedAt?.toISOString() ?? null,
          row.dueAt?.toISOString() ?? null,
          row.createdAt.toISOString(),
        ]
      }),
    )
  }

  async function exportPayments() {
    const rows = await container.paymentRepository.listForBusiness(businessId)
    return toCsv(
      ['Invoice number', 'Customer', 'Amount', 'Currency', 'Method', 'Reference', 'Status', 'Paid at'],
      rows.map((row) => [
        row.invoiceNumber,
        row.customerDisplayName,
        Money.fromMinorUnits(row.amountMinorUnits, currencyFor(row.currencyCode, row.currencyExponent)).toPlainDecimalString(),
        row.currencyCode,
        row.paymentMethod,
        row.reference,
        row.status,
        row.paidAt.toISOString(),
      ]),
    )
  }

  async function exportReceipts() {
    const rows = await container.receiptRepository.listForBusiness(businessId)
    return toCsv(
      ['Receipt number', 'Status', 'Customer', 'Amount', 'Currency', 'Method', 'Issued at'],
      rows.map((row) => [
        row.receiptNumber,
        row.status,
        row.payment.customerDisplayName,
        Money.fromMinorUnits(row.payment.amountMinorUnits, currencyFor(row.payment.currencyCode, row.payment.currencyExponent)).toPlainDecimalString(),
        row.payment.currencyCode,
        row.payment.paymentMethod,
        row.issuedAt.toISOString(),
      ]),
    )
  }

  const exporters: Record<ExportKind, { label: string; run: () => Promise<string> }> = {
    customers: { label: 'Customers', run: exportCustomers },
    products: { label: 'Products', run: exportProducts },
    invoices: { label: 'Invoices', run: exportInvoices },
    payments: { label: 'Payments', run: exportPayments },
    receipts: { label: 'Receipts', run: exportReceipts },
  }

  async function handleExport(kind: ExportKind) {
    setError(null)
    setPending(kind)
    try {
      const csv = await exporters[kind].run()
      downloadCsv(`${business.tradingName || business.legalName}-${kind}-${fileStamp}.csv`, csv)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not export ${exporters[kind].label.toLowerCase()}`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="export-section">
      <span className="step-label">Data export</span>
      <p className="form-hint">Download your own records as CSV — one file per type, ready to open in Excel or Sheets.</p>
      <div className="export-buttons">
        {(Object.keys(exporters) as ExportKind[]).map((kind) => (
          <button key={kind} className="secondary" disabled={pending !== null} onClick={() => void handleExport(kind)}>
            {pending === kind ? 'Preparing…' : exporters[kind].label}
          </button>
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  )
}

function currencyFor(code: string, exponent?: number): Currency {
  return new Currency({ code, name: code, symbol: code, exponent: exponent ?? resolveCurrencyExponent(code) })
}
