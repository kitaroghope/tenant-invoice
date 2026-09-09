import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import { Currency } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'

export function ReceiptsListPage({ business }: { business: Business }) {
  const base = `/app/businesses/${business.id.toString()}`
  const receipts = useQuery({
    queryKey: ['receipts', business.id.toString()],
    queryFn: () => container.receiptRepository.listForBusiness(business.id),
  })

  return (
    <div className="members-page">
      <div>
        <span className="eyebrow">Receipts</span>
        <h1>Receipts</h1>
      </div>

      {receipts.isLoading && <Loader fullRegion label="Loading receipts…" />}
      {receipts.error && <Banner tone="error">Could not load receipts for this business.</Banner>}
      {receipts.data && receipts.data.length === 0 && (
        <Banner tone="info">No receipts yet. Issue one from a payment on an invoice, or record a standalone payment from Payments.</Banner>
      )}
      {receipts.data && receipts.data.length > 0 && (
        <div className="member-list">
          {receipts.data.map((receipt) => {
            const currency = new Currency({ code: receipt.payment.currencyCode, name: receipt.payment.currencyCode, symbol: receipt.payment.currencyCode, exponent: receipt.payment.currencyExponent })
            return (
              <Link className="member-row invoice-row" key={receipt.id} to={`${base}/receipts/${receipt.id}`}>
                <div>
                  <span className={`status-pill ${receipt.status === 'void' ? 'suspended' : 'active'}`}>{receipt.status}</span>
                  <div className="member-role">{receipt.receiptNumber ? `#${receipt.receiptNumber} · ` : ''}{receipt.payment.customerDisplayName}</div>
                </div>
                <strong>{Money.fromMinorUnits(receipt.payment.amountMinorUnits, currency).format(business.locale)}</strong>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
