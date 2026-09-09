import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import { Currency, resolveCurrencyExponent } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'
import { PaymentId } from '../../domain/shared/EntityId'
import type { PaymentMethod } from '../../application/ports/PaymentRepository'

export function PaymentsPage({ business }: { business: Business }) {
  const queryClient = useQueryClient()
  const queryKey = ['business-payments', business.id.toString()]
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const currency = new Currency({
    code: business.defaultCurrencyCode,
    name: business.defaultCurrencyCode,
    symbol: business.defaultCurrencyCode,
    exponent: resolveCurrencyExponent(business.defaultCurrencyCode),
  })

  const payments = useQuery({
    queryKey,
    queryFn: () => container.paymentRepository.listForBusiness(business.id),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey })

  const record = useMutation({
    mutationFn: () => {
      const money = Money.parse(amount || '0', currency)
      if (money.minorUnits <= 0n) throw new Error('Enter an amount greater than zero')
      if (!name.trim()) throw new Error('Customer name is required')
      return container.paymentRepository.recordStandalone({
        businessId: business.id,
        customerDisplayName: name.trim(),
        customerEmail: null,
        customerPhone: null,
        amountMinorUnits: money.minorUnits,
        currencyCode: currency.code,
        currencyExponent: currency.exponent,
        paymentMethod: method,
        reference: reference.trim() || null,
        notes: null,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: () => {
      setName('')
      setAmount('')
      setReference('')
      invalidate()
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Could not record that payment'),
  })

  const issueReceipt = useMutation({
    mutationFn: (paymentId: PaymentId) => container.receiptRepository.issue(paymentId),
    onSuccess: invalidate,
  })

  function submit() {
    setFormError(null)
    record.mutate()
  }

  return (
    <div className="members-page">
      <div>
        <span className="eyebrow">Payments</span>
        <h1>Payments</h1>
      </div>

      <form className="invite-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <span className="step-label">Record a payment without an invoice</span>
        <p className="form-hint">For a walk-in customer who pays on the spot — this creates a payment you can immediately turn into a receipt, no invoice required.</p>
        <div className="form-grid customer-form-grid">
          <label>Customer<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer or company" /></label>
          <label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`Amount in ${currency.code}`} /></label>
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
          <button className="primary" disabled={record.isPending}>{record.isPending ? 'Recording…' : 'Record payment'}</button>
        </div>
        {formError && <Banner tone="error">{formError}</Banner>}
      </form>

      <div>
        <span className="step-label">All payments</span>
        {payments.isLoading && <Loader fullRegion label="Loading payments…" />}
        {payments.error && <Banner tone="error">Could not load payments for this business.</Banner>}
        {issueReceipt.error && <Banner tone="error">{issueReceipt.error instanceof Error ? issueReceipt.error.message : 'Could not issue that receipt'}</Banner>}
        {payments.data && payments.data.length === 0 && <Banner tone="info">No payments recorded yet.</Banner>}
        {payments.data && payments.data.length > 0 && (
          <div className="member-list">
            {payments.data.map((payment) => {
              const paymentCurrency = new Currency({ code: payment.currencyCode, name: payment.currencyCode, symbol: payment.currencyCode, exponent: payment.currencyExponent })
              return (
                <div className="member-row" key={payment.id.toString()}>
                  <div>
                    <span className={`status-pill ${payment.status === 'reversed' ? 'suspended' : 'active'}`}>{payment.status}</span>
                    <div className="member-role">
                      {Money.fromMinorUnits(payment.amountMinorUnits, paymentCurrency).format(business.locale)} · {payment.customerDisplayName}
                      {payment.invoiceNumber ? ` · Invoice #${payment.invoiceNumber}` : ' · Standalone'}
                    </div>
                  </div>
                  {payment.status === 'recorded' && (
                    <div className="member-actions">
                      {payment.activeReceiptId ? (
                        <Link className="link-button" to={`/app/businesses/${business.id.toString()}/receipts/${payment.activeReceiptId}`}>View receipt</Link>
                      ) : (
                        <button onClick={() => issueReceipt.mutate(payment.id)} disabled={issueReceipt.isPending}>
                          {issueReceipt.isPending ? 'Issuing…' : 'Issue receipt'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
