import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import type { InvoiceId } from '../../domain/shared/EntityId'
import { Currency } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'

export function InvoicesListPage({ business }: { business: Business }) {
  const base = `/app/businesses/${business.id.toString()}`
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)

  const invoices = useQuery({
    queryKey: ['invoices', business.id.toString()],
    queryFn: () => container.invoiceRepository.listActive(business.id),
    enabled: !showDeleted,
  })
  const deletedInvoices = useQuery({
    queryKey: ['invoices', business.id.toString(), 'deleted'],
    queryFn: () => container.invoiceRepository.listDeleted(business.id),
    enabled: showDeleted,
  })

  const restore = useMutation({
    mutationFn: (id: InvoiceId) => container.invoiceRepository.restoreDraft(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices', business.id.toString()] })
      void queryClient.invalidateQueries({ queryKey: ['invoices', business.id.toString(), 'deleted'] })
    },
  })

  return (
    <div className="members-page">
      <header>
        <div><span className="eyebrow">Invoices</span><h1>Invoices</h1></div>
        <Link className="primary link-button" to={`${base}/invoices/new`}>New invoice</Link>
      </header>

      <div className="section-head">
        <span className="step-label">{showDeleted ? 'Deleted drafts' : 'All invoices'}</span>
        <button className="quiet" onClick={() => setShowDeleted((current) => !current)}>
          {showDeleted ? 'Back to invoices' : 'Show deleted'}
        </button>
      </div>

      {!showDeleted && (
        <>
          {invoices.isLoading && <Loader fullRegion label="Loading invoices…" />}
          {invoices.error && <Banner tone="error">Could not load invoices for this business.</Banner>}
          {invoices.data && invoices.data.length === 0 && <Banner tone="info">No invoices yet. Create your first one above.</Banner>}
          {invoices.data && invoices.data.length > 0 && (
            <div className="member-list">
              {invoices.data.map((invoice) => {
                const currency = new Currency({ code: invoice.currencyCode, name: invoice.currencyCode, symbol: invoice.currencyCode, exponent: invoice.currencyExponent })
                return (
                  <Link className="member-row invoice-row" key={invoice.id.toString()} to={`${base}/invoices/${invoice.id.toString()}`}>
                    <div>
                      <span className={`status-pill ${invoice.status === 'draft' ? 'invited' : invoice.status === 'void' ? 'suspended' : 'active'}`}>{invoice.status}</span>
                      <div className="member-role">{invoice.invoiceNumber ? `#${invoice.invoiceNumber} · ` : ''}{invoice.customerDisplayName}</div>
                    </div>
                    <strong>{Money.fromMinorUnits(invoice.totalMinorUnits, currency).format(business.locale)}</strong>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}

      {showDeleted && (
        <>
          {deletedInvoices.isLoading && <Loader fullRegion label="Loading deleted invoices…" />}
          {deletedInvoices.error && <Banner tone="error">Could not load deleted invoices.</Banner>}
          {deletedInvoices.data && deletedInvoices.data.length === 0 && (
            <Banner tone="info">No deleted drafts. Only draft invoices can be deleted, so this list stays empty unless one was.</Banner>
          )}
          {deletedInvoices.data && deletedInvoices.data.length > 0 && (
            <div className="member-list">
              {deletedInvoices.data.map((invoice) => {
                const currency = new Currency({ code: invoice.currencyCode, name: invoice.currencyCode, symbol: invoice.currencyCode, exponent: invoice.currencyExponent })
                return (
                  <div className="member-row" key={invoice.id.toString()}>
                    <div>
                      <span className="status-pill invited">{invoice.status}</span>
                      <div className="member-role">{invoice.customerDisplayName} · {Money.fromMinorUnits(invoice.totalMinorUnits, currency).format(business.locale)}</div>
                    </div>
                    <div className="member-actions">
                      <button onClick={() => restore.mutate(invoice.id)} disabled={restore.isPending}>
                        {restore.isPending ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {restore.error && <Banner tone="error">Could not restore that invoice.</Banner>}
        </>
      )}
    </div>
  )
}
