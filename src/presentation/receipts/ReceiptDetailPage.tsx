import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import { DocumentPaper } from '../shared/DocumentPaper'
import { EmailSendPanel } from '../shared/EmailSendPanel'
import type { Business } from '../../domain/business/Business'
import { Currency } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'

export function ReceiptDetailPage({ business, receiptId }: { business: Business; receiptId: string }) {
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal'>('thermal')

  const receipt = useQuery({
    queryKey: ['receipt', receiptId],
    queryFn: () => container.receiptRepository.findById(receiptId),
  })

  if (receipt.isLoading) return <Loader fullRegion label="Loading receipt…" />
  if (receipt.error || !receipt.data) return <Banner tone="error">Could not load this receipt.</Banner>

  const data = receipt.data
  const currency = new Currency({ code: data.payment.currencyCode, name: data.payment.currencyCode, symbol: data.payment.currencyCode, exponent: data.payment.currencyExponent })
  const numberValue = data.receiptNumber ? `${business.receiptPrefix ?? ''}${data.receiptNumber}` : '—'

  return <div className="invoice-workbench">
    <section className="invoice-form no-print">
      <div><span className="eyebrow">Receipt{data.receiptNumber ? ` #${data.receiptNumber}` : ''}</span><h1>{data.status}</h1></div>
      {data.status === 'void' && data.voidReason && <Banner tone="warning">Voided: {data.voidReason}</Banner>}
      <div className="invoice-actions">
        <button className="primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="print-format-toggle no-print">
        <button className={printFormat === 'thermal' ? 'active' : ''} onClick={() => setPrintFormat('thermal')}>80mm receipt</button>
        <button className={printFormat === 'a4' ? 'active' : ''} onClick={() => setPrintFormat('a4')}>A4</button>
      </div>
      {data.status === 'issued' && (
        <EmailSendPanel
          businessId={business.id.toString()}
          resourceType="receipt"
          resourceId={receiptId}
          defaultRecipientEmail={data.payment.customerEmail}
        />
      )}
    </section>

    <DocumentPaper
      business={business}
      documentType="RECEIPT"
      statusLabel={data.status.toUpperCase()}
      billToLabel="Received from"
      billToName={data.payment.customerDisplayName}
      numberLabel="Receipt number"
      numberValue={numberValue}
      printFormat={printFormat}
    >
      <table>
        <thead><tr><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
        <tbody>
          <tr>
            <td>{data.payment.paymentMethod.replace('_', ' ')}</td>
            <td>{data.payment.reference || '—'}</td>
            <td>{Money.fromMinorUnits(data.payment.amountMinorUnits, currency).format(business.locale)}</td>
          </tr>
        </tbody>
      </table>
      <div className="totals">
        <p className="grand"><span>Total received</span><strong>{Money.fromMinorUnits(data.payment.amountMinorUnits, currency).format(business.locale)}</strong></p>
      </div>
      <p className="receipt-issued-at">Issued {data.issuedAt.toLocaleString(business.locale)}</p>
    </DocumentPaper>
  </div>
}
