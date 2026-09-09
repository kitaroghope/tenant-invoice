import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import { DocumentPaper } from '../shared/DocumentPaper'
import { EmailSendPanel } from '../shared/EmailSendPanel'
import type { Business } from '../../domain/business/Business'
import { InvoiceId, InvoiceLineId, PaymentId, ProductId } from '../../domain/shared/EntityId'
import { Currency } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'
import type { Product } from '../../domain/product/Product'
import type { InvoiceLineItem } from '../../application/ports/InvoiceRepository'
import type { Payment, PaymentMethod } from '../../application/ports/PaymentRepository'
import type { DiscountType } from '../../domain/invoice/InvoiceDraft'

export function InvoiceDetailPage({ business, invoiceId }: { business: Business; invoiceId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const id = InvoiceId.from(invoiceId)
  const queryKey = ['invoice', invoiceId]

  const invoice = useQuery({
    queryKey,
    queryFn: () => container.invoiceRepository.findById(id),
  })

  const products = useQuery({
    queryKey: ['products', business.id.toString()],
    queryFn: () => container.productRepository.listActive(business.id),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey })

  const updateDraft = useMutation({
    mutationFn: (fields: { customerDisplayName: string; customerEmail: string | null; customerPhone: string | null; taxBasisPoints: number; discountType: DiscountType; discountValue: bigint; notes: string | null }) =>
      container.invoiceRepository.updateDraft(id, {
        customerId: invoice.data?.customerId ?? null,
        dueAt: invoice.data?.dueAt ?? null,
        ...fields,
      }),
    onSuccess: invalidate,
  })

  const addLine = useMutation({
    mutationFn: (position: number) =>
      container.invoiceRepository.addLine(id, business.id, { description: 'New item', quantity: '1', unitPriceMinorUnits: 0n, position, productId: null }),
    onSuccess: invalidate,
  })

  const updateLine = useMutation({
    mutationFn: (input: { lineId: InvoiceLineId; description: string; quantity: string; unitPriceMinorUnits: bigint; position: number; productId: ProductId | null }) =>
      container.invoiceRepository.updateLine(input.lineId, input),
    onSuccess: invalidate,
  })

  const removeLine = useMutation({
    mutationFn: (lineId: InvoiceLineId) => container.invoiceRepository.removeLine(lineId),
    onSuccess: invalidate,
  })

  const issue = useMutation({
    mutationFn: () => container.invoiceRepository.issue(id, crypto.randomUUID()),
    onSuccess: invalidate,
  })

  const voidInvoice = useMutation({
    mutationFn: (reason: string | null) => container.invoiceRepository.voidInvoice(id, reason),
    onSuccess: invalidate,
  })

  const deleteDraft = useMutation({
    mutationFn: () => container.invoiceRepository.softDeleteDraft(id, null),
    onSuccess: () => navigate(`/app/businesses/${business.id.toString()}/invoices`),
  })

  const isDraft = invoice.data?.status === 'draft'
  const canTakePayments = invoice.data ? ['issued', 'sent', 'partially_paid'].includes(invoice.data.status) : false
  const payments = useQuery({
    queryKey: ['payments', invoiceId],
    queryFn: () => container.paymentRepository.listForInvoice(id),
    enabled: !isDraft,
  })
  const invalidatePayments = () => {
    invalidate()
    void queryClient.invalidateQueries({ queryKey: ['payments', invoiceId] })
  }

  const recordPayment = useMutation({
    mutationFn: (fields: { amountMinorUnits: bigint; paymentMethod: PaymentMethod; reference: string | null; notes: string | null }) =>
      container.paymentRepository.record({ invoiceId: id, idempotencyKey: crypto.randomUUID(), ...fields }),
    onSuccess: invalidatePayments,
  })

  const reversePayment = useMutation({
    mutationFn: (paymentId: PaymentId) => container.paymentRepository.reverse(paymentId, null),
    onSuccess: invalidatePayments,
  })

  const issueReceipt = useMutation({
    mutationFn: (paymentId: PaymentId) => container.receiptRepository.issue(paymentId),
    onSuccess: invalidatePayments,
  })

  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal'>('a4')

  if (invoice.isLoading) return <Loader fullRegion label="Loading invoice…" />
  if (invoice.error || !invoice.data) return <Banner tone="error">Could not load this invoice.</Banner>

  const data = invoice.data
  const currency = new Currency({ code: data.currencyCode, name: data.currencyCode, symbol: data.currencyCode, exponent: data.currencyExponent })
  const canVoid = data.status !== 'draft' && data.status !== 'void'
  const balanceDue = data.totalMinorUnits - data.amountPaidMinorUnits

  return <div className="invoice-workbench">
    <section className="invoice-form no-print">
      <div><span className="eyebrow">Invoice{data.invoiceNumber ? ` #${data.invoiceNumber}` : ''}</span><h1>{isDraft ? 'Edit draft' : data.status}</h1></div>

      {isDraft ? (
        <>
          <DraftFields data={data} currency={currency} onSave={(fields) => updateDraft.mutate(fields)} saving={updateDraft.isPending} />
          <div className="line-editor">
            <div className="line-head has-product"><span>Product</span><span>Description</span><span>Qty</span><span>Unit price</span><span /></div>
            {data.lines.map((line) => (
              <LineRow
                key={line.id.toString()}
                line={line}
                currency={currency}
                products={products.data ?? []}
                onSave={(patch) => updateLine.mutate({ lineId: line.id, position: line.position, ...patch })}
                onRemove={() => {
                  if (window.confirm('Remove this line?')) removeLine.mutate(line.id)
                }}
              />
            ))}
          </div>
          <button className="quiet add-line" onClick={() => addLine.mutate(data.lines.length)} disabled={addLine.isPending}>＋ Add line</button>
          {(updateLine.error || removeLine.error || addLine.error) && <Banner tone="error">Could not save that change.</Banner>}
          <div className="invoice-actions">
            <button className="secondary" onClick={() => window.print()}>Print preview</button>
            <button
              className="quiet"
              onClick={() => {
                if (window.confirm('Delete this draft? You can restore it later from "Show deleted" on the invoices list.')) deleteDraft.mutate()
              }}
            >
              Delete draft
            </button>
            <button
              className="primary"
              disabled={issue.isPending || data.lines.length === 0}
              onClick={() => {
                if (window.confirm('Issue this invoice? It will be assigned a permanent invoice number and can no longer be edited.')) issue.mutate()
              }}
            >
              {issue.isPending ? 'Issuing…' : 'Issue invoice'}
            </button>
          </div>
          {issue.error && <Banner tone="error">{issue.error instanceof Error ? issue.error.message : 'Could not issue this invoice'}</Banner>}
        </>
      ) : (
        <div className="invoice-actions">
          <button className="secondary" onClick={() => window.print()}>Print</button>
          {canVoid && (
            <button
              className="quiet"
              disabled={voidInvoice.isPending}
              onClick={() => {
                const reason = window.prompt('Reason for voiding this invoice (optional):')
                if (reason !== null) voidInvoice.mutate(reason || null)
              }}
            >
              {voidInvoice.isPending ? 'Voiding…' : 'Void invoice'}
            </button>
          )}
        </div>
      )}

      {!isDraft && (
        <PaymentsSection
          currency={currency}
          locale={business.locale}
          balanceDue={balanceDue}
          canTakePayments={canTakePayments}
          payments={payments.data ?? []}
          onRecord={(fields) => recordPayment.mutate(fields)}
          recording={recordPayment.isPending}
          recordError={recordPayment.error}
          onReverse={(paymentId) => {
            if (window.confirm('Reverse this payment? The invoice balance will increase again.')) reversePayment.mutate(paymentId)
          }}
          reversing={reversePayment.isPending}
          onIssueReceipt={(paymentId) => issueReceipt.mutate(paymentId)}
          issuingReceipt={issueReceipt.isPending}
          issueReceiptError={issueReceipt.error}
          businessId={business.id.toString()}
        />
      )}
      {!isDraft && (
        <EmailSendPanel
          businessId={business.id.toString()}
          resourceType="invoice"
          resourceId={invoiceId}
          defaultRecipientEmail={data.customerEmail}
        />
      )}
      <div className="print-format-toggle no-print">
        <button className={printFormat === 'a4' ? 'active' : ''} onClick={() => setPrintFormat('a4')}>A4</button>
        <button className={printFormat === 'thermal' ? 'active' : ''} onClick={() => setPrintFormat('thermal')}>80mm receipt</button>
      </div>
    </section>
    <DocumentPaper
      business={business}
      documentType="INVOICE"
      statusLabel={data.status.toUpperCase()}
      billToLabel="Bill to"
      billToName={data.customerDisplayName}
      numberLabel={data.invoiceNumber ? 'Invoice number' : 'Currency'}
      numberValue={data.invoiceNumber ? `${business.invoicePrefix ?? ''}${data.invoiceNumber}` : data.currencyCode}
      printFormat={printFormat}
    >
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.id.toString()}>
              <td>{line.description}</td>
              <td>{line.quantity}</td>
              <td>{Money.fromMinorUnits(line.unitPriceMinorUnits, currency).format(business.locale)}</td>
              <td>{Money.fromMinorUnits(line.lineTotalMinorUnits, currency).format(business.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <p><span>Subtotal</span><strong>{Money.fromMinorUnits(data.subtotalMinorUnits, currency).format(business.locale)}</strong></p>
        {data.discountType !== 'none' && <p><span>Discount</span><strong>-{Money.fromMinorUnits(data.discountMinorUnits, currency).format(business.locale)}</strong></p>}
        <p><span>Tax ({(data.taxBasisPoints / 100).toString()}%)</span><strong>{Money.fromMinorUnits(data.taxMinorUnits, currency).format(business.locale)}</strong></p>
        <p className="grand"><span>Total</span><strong>{Money.fromMinorUnits(data.totalMinorUnits, currency).format(business.locale)}</strong></p>
        {!isDraft && (
          <>
            <p><span>Paid</span><strong>{Money.fromMinorUnits(data.amountPaidMinorUnits, currency).format(business.locale)}</strong></p>
            <p><span>Balance due</span><strong>{Money.fromMinorUnits(balanceDue, currency).format(business.locale)}</strong></p>
          </>
        )}
      </div>
    </DocumentPaper>
  </div>
}

function DraftFields({
  data,
  currency,
  onSave,
  saving,
}: {
  data: { customerDisplayName: string; customerEmail: string | null; customerPhone: string | null; taxBasisPoints: number; discountType: DiscountType; discountValue: bigint; notes: string | null }
  currency: Currency
  onSave: (fields: { customerDisplayName: string; customerEmail: string | null; customerPhone: string | null; taxBasisPoints: number; discountType: DiscountType; discountValue: bigint; notes: string | null }) => void
  saving: boolean
}) {
  const [name, setName] = useState(data.customerDisplayName)
  const [email, setEmail] = useState(data.customerEmail ?? '')
  const [taxPercent, setTaxPercent] = useState(String(data.taxBasisPoints / 100))
  const [discountType, setDiscountType] = useState<DiscountType>(data.discountType)
  const [discountInput, setDiscountInput] = useState(
    data.discountType === 'percentage' ? String(Number(data.discountValue) / 100)
      : data.discountType === 'fixed' ? (Number(data.discountValue) / 10 ** currency.exponent).toString()
      : '0',
  )

  return (
    <>
      <div className="form-grid">
        <label>Customer name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" /></label>
      </div>
      <div className="form-grid discount-field-grid">
        <label>Discount
          <select value={discountType} onChange={(event) => { setDiscountType(event.target.value as DiscountType); setDiscountInput('0') }}>
            <option value="none">None</option>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </label>
        {discountType !== 'none' && (
          <label>{discountType === 'percentage' ? 'Discount (%)' : `Discount (${currency.code})`}
            <input inputMode="decimal" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} />
          </label>
        )}
        <label className="tax-field">Tax rate (%)<input inputMode="decimal" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></label>
      </div>
      <button
        className="secondary"
        disabled={saving}
        onClick={() => {
          let discountValue = 0n
          if (discountType === 'percentage') discountValue = BigInt(Math.round((Number(discountInput) || 0) * 100))
          else if (discountType === 'fixed') {
            try { discountValue = Money.parse(discountInput || '0', currency).minorUnits } catch { discountValue = 0n }
          }
          onSave({
            customerDisplayName: name.trim(),
            customerEmail: email.trim() || null,
            customerPhone: data.customerPhone,
            taxBasisPoints: Math.round((Number(taxPercent) || 0) * 100),
            discountType,
            discountValue,
            notes: data.notes,
          })
        }}
      >
        {saving ? 'Saving…' : 'Save details'}
      </button>
    </>
  )
}

function LineRow({
  line,
  currency,
  products,
  onSave,
  onRemove,
}: {
  line: InvoiceLineItem
  currency: Currency
  products: readonly Product[]
  onSave: (patch: { description: string; quantity: string; unitPriceMinorUnits: bigint; productId: ProductId | null }) => void
  onRemove: () => void
}) {
  const [description, setDescription] = useState(line.description)
  const [quantity, setQuantity] = useState(line.quantity)
  const [price, setPrice] = useState((Number(line.unitPriceMinorUnits) / 10 ** currency.exponent).toString())
  const [productId, setProductId] = useState(line.productId?.toString() ?? '')

  function commit(nextProductId = productId, nextDescription = description, nextPrice = price) {
    try {
      const money = Money.parse(nextPrice || '0', currency)
      onSave({
        description: nextDescription.trim() || 'Item',
        quantity: quantity || '1',
        unitPriceMinorUnits: money.minorUnits,
        productId: nextProductId ? ProductId.from(nextProductId) : null,
      })
    } catch {
      // Invalid amount typed; leave saved state unchanged rather than sending garbage.
    }
  }

  function selectProduct(value: string) {
    setProductId(value)
    const found = products.find((row) => row.id.toString() === value)
    let nextDescription = description
    let nextPrice = price
    if (found) {
      nextDescription = found.name
      setDescription(nextDescription)
      if (found.priceCurrencyCode === currency.code && found.priceMinorUnits !== null) {
        nextPrice = (Number(found.priceMinorUnits) / 10 ** currency.exponent).toString()
        setPrice(nextPrice)
      }
    }
    commit(value, nextDescription, nextPrice)
  }

  return (
    <div className="edit-line has-product">
      <select aria-label="Line product" value={productId} onChange={(event) => selectProduct(event.target.value)}>
        <option value="">Type in manually…</option>
        {products.map((row) => <option key={row.id.toString()} value={row.id.toString()}>{row.name}</option>)}
      </select>
      <input placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => commit()} />
      <input placeholder="Qty" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} onBlur={() => commit()} />
      <input placeholder="Unit price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} onBlur={() => commit()} />
      <button aria-label="Remove line" onClick={onRemove}>×</button>
    </div>
  )
}

function PaymentsSection({
  currency,
  locale,
  balanceDue,
  canTakePayments,
  payments,
  onRecord,
  recording,
  recordError,
  onReverse,
  reversing,
  onIssueReceipt,
  issuingReceipt,
  issueReceiptError,
  businessId,
}: {
  currency: Currency
  locale: string
  balanceDue: bigint
  canTakePayments: boolean
  payments: readonly Payment[]
  onRecord: (fields: { amountMinorUnits: bigint; paymentMethod: PaymentMethod; reference: string | null; notes: string | null }) => void
  recording: boolean
  recordError: unknown
  onReverse: (paymentId: PaymentId) => void
  reversing: boolean
  onIssueReceipt: (paymentId: PaymentId) => void
  issuingReceipt: boolean
  issueReceiptError: unknown
  businessId: string
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function submit() {
    setFormError(null)
    try {
      const money = Money.parse(amount || '0', currency)
      if (money.minorUnits <= 0n) throw new Error('Enter an amount greater than zero')
      onRecord({ amountMinorUnits: money.minorUnits, paymentMethod: method, reference: reference.trim() || null, notes: null })
      setAmount('')
      setReference('')
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Enter a valid amount')
    }
  }

  return (
    <div className="payments-section">
      <span className="step-label">Payments</span>

      {canTakePayments && (
        <div className="form-grid customer-form-grid">
          <label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`Up to ${Money.fromMinorUnits(balanceDue, currency).format(locale)}`} /></label>
          <label>Method
            <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" /></label>
          <button className="secondary" disabled={recording} onClick={submit}>{recording ? 'Recording…' : 'Record payment'}</button>
        </div>
      )}
      {formError && <Banner tone="error">{formError}</Banner>}
      {recordError instanceof Error && <Banner tone="error">{recordError.message}</Banner>}
      {issueReceiptError instanceof Error && <Banner tone="error">{issueReceiptError.message}</Banner>}

      {payments.length > 0 && (
        <div className="member-list">
          {payments.map((payment) => (
            <div className="member-row" key={payment.id.toString()}>
              <div>
                <span className={`status-pill ${payment.status === 'reversed' ? 'suspended' : 'active'}`}>{payment.status}</span>
                <div className="member-role">{Money.fromMinorUnits(payment.amountMinorUnits, currency).format(locale)} · {payment.paymentMethod.replace('_', ' ')}{payment.reference ? ` · ${payment.reference}` : ''}</div>
              </div>
              {payment.status === 'recorded' && (
                <div className="member-actions">
                  {payment.activeReceiptId ? (
                    <Link className="link-button" to={`/app/businesses/${businessId}/receipts/${payment.activeReceiptId}`}>View receipt</Link>
                  ) : (
                    <button onClick={() => onIssueReceipt(payment.id)} disabled={issuingReceipt}>{issuingReceipt ? 'Issuing…' : 'Issue receipt'}</button>
                  )}
                  <button onClick={() => onReverse(payment.id)} disabled={reversing}>{reversing ? 'Reversing…' : 'Reverse'}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
