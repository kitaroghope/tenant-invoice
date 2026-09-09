import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Currency, resolveCurrencyExponent } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'
import { InvoiceDraft, type DiscountType, type DraftLineInput } from '../../domain/invoice/InvoiceDraft'
import type { Business } from '../../domain/business/Business'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { DocumentPaper } from '../shared/DocumentPaper'
import { CustomerId, ProductId } from '../../domain/shared/EntityId'

export function NewInvoicePage({ business }: { business: Business }) {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState('')
  const [customer, setCustomer] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [currencyCode, setCurrencyCode] = useState(business.defaultCurrencyCode)
  const [tax, setTax] = useState('0')
  const [discountType, setDiscountType] = useState<DiscountType>('none')
  const [discountInput, setDiscountInput] = useState('0')
  const [lines, setLines] = useState<DraftLineInput[]>([{ description: '', quantity: '1', unitPrice: '0', productId: null }])
  const [saveError, setSaveError] = useState<string | null>(null)

  const customers = useQuery({
    queryKey: ['customers', business.id.toString()],
    queryFn: () => container.customerRepository.listActive(business.id),
  })

  const products = useQuery({
    queryKey: ['products', business.id.toString()],
    queryFn: () => container.productRepository.listActive(business.id),
  })

  const currency = useMemo(() => new Currency({ code: currencyCode, name: currencyCode, symbol: currencyCode, exponent: resolveCurrencyExponent(currencyCode) }), [currencyCode])

  const discountValueMinorOrBasisPoints = useMemo(() => {
    if (discountType === 'none') return 0n
    if (discountType === 'percentage') return BigInt(Math.round((Number(discountInput) || 0) * 100))
    try { return Money.parse(discountInput || '0', currency).minorUnits } catch { return 0n }
  }, [discountType, discountInput, currency])

  const draft = useMemo(() => {
    try { return new InvoiceDraft(currency, lines, Math.round((Number(tax) || 0) * 100), discountType, discountValueMinorOrBasisPoints) } catch { return null }
  }, [currency, lines, tax, discountType, discountValueMinorOrBasisPoints])

  const save = useMutation({
    mutationFn: async () => {
      if (!customer.trim()) throw new Error('Customer name is required')
      const meaningfulLines = lines.filter((line) => line.description.trim())
      if (meaningfulLines.length === 0) throw new Error('Add at least one line with a description')

      const invoiceId = await container.invoiceRepository.createDraft({
        businessId: business.id,
        customerId: customerId ? CustomerId.from(customerId) : null,
        customerDisplayName: customer.trim(),
        customerEmail: email.trim() || null,
        customerPhone: phone.trim() || null,
        currencyCode: currency.code,
        currencyExponent: currency.exponent,
        taxBasisPoints: Math.round((Number(tax) || 0) * 100),
        discountType,
        discountValue: discountValueMinorOrBasisPoints,
        dueAt: null,
        notes: null,
      })

      for (const [index, line] of meaningfulLines.entries()) {
        await container.invoiceRepository.addLine(invoiceId, business.id, {
          description: line.description.trim(),
          quantity: line.quantity || '1',
          unitPriceMinorUnits: Money.parse(line.unitPrice || '0', currency).minorUnits,
          position: index,
          productId: line.productId ? ProductId.from(line.productId) : null,
        })
      }

      return invoiceId
    },
    onSuccess: (invoiceId) => navigate(`/app/businesses/${business.id.toString()}/invoices/${invoiceId.toString()}`),
    onError: (error) => setSaveError(error instanceof Error ? error.message : 'Could not save that invoice'),
  })

  function updateLine(index: number, patch: Partial<DraftLineInput>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  function selectLineProduct(index: number, productId: string) {
    if (!productId) { updateLine(index, { productId: null }); return }
    const found = products.data?.find((row) => row.id.toString() === productId)
    if (!found) return
    const priceMatchesInvoiceCurrency = found.priceCurrencyCode === currency.code
    updateLine(index, {
      productId,
      description: found.name,
      unitPrice: priceMatchesInvoiceCurrency && found.priceMinorUnits !== null
        ? (Number(found.priceMinorUnits) / 10 ** currency.exponent).toString()
        : lines[index]?.unitPrice ?? '0',
    })
  }

  function selectCustomer(id: string) {
    setCustomerId(id)
    const found = customers.data?.find((row) => row.id.toString() === id)
    if (found) {
      setCustomer(found.displayName)
      setEmail(found.email ?? '')
      setPhone(found.phone ?? '')
    }
  }

  return <div className="invoice-workbench">
    <section className="invoice-form no-print">
      <div><span className="eyebrow">New invoice</span><h1>Create a draft</h1></div>
      <div className="form-grid">
        <label>Existing customer (optional)
          <select value={customerId} onChange={(event) => selectCustomer(event.target.value)}>
            <option value="">Type in manually…</option>
            {customers.data?.map((row) => <option key={row.id.toString()} value={row.id.toString()}>{row.displayName}</option>)}
          </select>
        </label>
        <label>Currency<select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>{['USD','EUR','GBP','KES','UGX','TZS','KWD'].map((code) => <option key={code}>{code}</option>)}</select></label>
      </div>
      <div className="form-grid">
        <label>Customer name<input value={customer} onChange={(event) => { setCustomer(event.target.value); setCustomerId('') }} placeholder="Customer or company" /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" /></label>
      </div>
      <div className="line-editor">
        <div className="line-head has-product"><span>Product</span><span>Description</span><span>Qty</span><span>Unit price</span><span /></div>
        {lines.map((line, index) => (
          <div className="edit-line has-product" key={index}>
            <select aria-label={`Line ${index + 1} product`} value={line.productId ?? ''} onChange={(event) => selectLineProduct(index, event.target.value)}>
              <option value="">Type in manually…</option>
              {products.data?.map((row) => <option key={row.id.toString()} value={row.id.toString()}>{row.name}</option>)}
            </select>
            <input aria-label={`Line ${index + 1} description`} placeholder="Description" value={line.description} onChange={(event) => updateLine(index, {description:event.target.value})} />
            <input aria-label={`Line ${index + 1} quantity`} placeholder="Qty" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, {quantity:event.target.value})} />
            <input aria-label={`Line ${index + 1} price`} placeholder="Unit price" inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(index, {unitPrice:event.target.value})} />
            <button aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
      </div>
      <button className="quiet add-line" onClick={() => setLines((current) => [...current, {description:'', quantity:'1', unitPrice:'0', productId:null}])}>＋ Add line</button>
      <div className="form-grid discount-field-grid">
        <label>Discount
          <select value={discountType} onChange={(event) => { setDiscountType(event.target.value as DiscountType); setDiscountInput('0') }}>
            <option value="none">None</option>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </label>
        {discountType !== 'none' && (
          <label>{discountType === 'percentage' ? 'Discount (%)' : `Discount (${currencyCode})`}
            <input inputMode="decimal" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} />
          </label>
        )}
        <label className="tax-field">Tax rate (%)<input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} /></label>
      </div>
      {saveError && <Banner tone="error">{saveError}</Banner>}
      <div className="invoice-actions"><button className="secondary" onClick={() => window.print()}>Print preview</button><button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save draft'}</button></div>
    </section>
    <DocumentPaper
      business={business}
      documentType="INVOICE"
      statusLabel="DRAFT"
      billToLabel="Bill to"
      billToName={customer || 'Customer name'}
      numberLabel="Currency"
      numberValue={currencyCode}
      printFormat="a4"
    >
      <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{lines.map((line, index) => <tr key={index}><td>{line.description || 'Item description'}</td><td>{line.quantity}</td><td>{safeFormat(line.unitPrice, currency)}</td><td>{draft ? draft.lineTotal(line).format(business.locale) : '—'}</td></tr>)}</tbody></table>
      <div className="totals">
        <p><span>Subtotal</span><strong>{draft?.subtotal().format(business.locale) ?? '—'}</strong></p>
        {discountType !== 'none' && <p><span>Discount</span><strong>-{draft?.discount().format(business.locale) ?? '—'}</strong></p>}
        <p><span>Tax ({tax || 0}%)</span><strong>{draft?.tax().format(business.locale) ?? '—'}</strong></p>
        <p className="grand"><span>Total</span><strong>{draft?.total().format(business.locale) ?? '—'}</strong></p>
      </div>
    </DocumentPaper>
  </div>
}

function safeFormat(value: string, currency: Currency): string {
  try { return (value ? importMoney(value, currency) : importMoney('0', currency)).format('en') } catch { return '—' }
}
function importMoney(value: string, currency: Currency) { return Money.parse(value, currency) }
