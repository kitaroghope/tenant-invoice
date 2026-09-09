import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import { ProductId } from '../../domain/shared/EntityId'
import { Currency, resolveCurrencyExponent } from '../../domain/money/Currency'
import { Money } from '../../domain/money/Money'

const nameSchema = z.string().min(1, 'Product name is required')

interface FormState {
  name: string
  description: string
  unit: string
  price: string
  stock: string
}

const emptyForm: FormState = { name: '', description: '', unit: 'unit', price: '', stock: '' }

export function ProductsPage({ business }: { business: Business }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const currency = new Currency({
    code: business.defaultCurrencyCode,
    name: business.defaultCurrencyCode,
    symbol: business.defaultCurrencyCode,
    exponent: resolveCurrencyExponent(business.defaultCurrencyCode),
  })

  const [showDeleted, setShowDeleted] = useState(false)
  const invalidateProducts = () => void queryClient.invalidateQueries({ queryKey: ['products', business.id.toString()] })

  const products = useQuery({
    queryKey: ['products', business.id.toString()],
    queryFn: () => container.productRepository.listActive(business.id),
    enabled: !showDeleted,
  })
  const deletedProducts = useQuery({
    queryKey: ['products', business.id.toString(), 'deleted'],
    queryFn: () => container.productRepository.listDeleted(business.id),
    enabled: showDeleted,
  })

  const create = useMutation({
    mutationFn: (input: FormState) => {
      const trimmedPrice = input.price.trim()
      const money = trimmedPrice ? Money.parse(trimmedPrice, currency) : null
      const trimmedStock = input.stock.trim()
      return container.productRepository.create({
        businessId: business.id,
        name: input.name.trim(),
        description: input.description.trim() || null,
        unit: input.unit.trim() || 'unit',
        priceMinorUnits: money?.minorUnits ?? null,
        priceCurrencyCode: money ? currency.code : null,
        stockQuantity: trimmedStock || null,
      })
    },
    onSuccess: () => {
      setForm(emptyForm)
      invalidateProducts()
    },
  })

  const adjustStock = useMutation({
    mutationFn: ({ id, stockQuantity }: { id: ProductId; stockQuantity: string | null }) => container.productRepository.setStock(id, stockQuantity),
    onSuccess: invalidateProducts,
  })

  const remove = useMutation({
    mutationFn: (id: ProductId) => container.productRepository.softDelete(id, null),
    onSuccess: invalidateProducts,
  })

  const restore = useMutation({
    mutationFn: (id: ProductId) => container.productRepository.restore(id),
    onSuccess: () => {
      invalidateProducts()
      void queryClient.invalidateQueries({ queryKey: ['products', business.id.toString(), 'deleted'] })
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    try {
      nameSchema.parse(form.name.trim())
      create.mutate(form)
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save that product')
    }
  }

  return (
    <div className="members-page">
      <div>
        <span className="eyebrow">Products</span>
        <h1>Products &amp; services</h1>
      </div>

      <form className="invite-form" onSubmit={submit}>
        <span className="step-label">Add a product or service</span>
        <div className="form-grid customer-form-grid">
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Item name" required />
          </label>
          <label>
            Unit
            <input value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="unit, hour, kg…" />
          </label>
          <label>
            Price ({business.defaultCurrencyCode})
            <input inputMode="decimal" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} placeholder="Optional" />
          </label>
          <label>
            Stock on hand
            <input inputMode="decimal" value={form.stock} onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))} placeholder="Leave blank to not track" />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Optional" />
          </label>
          <button className="primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add product'}</button>
        </div>
        {formError && <Banner tone="error">{formError}</Banner>}
        {create.error && <Banner tone="error">{create.error instanceof Error ? create.error.message : 'Could not save that product'}</Banner>}
      </form>

      <div>
        <div className="section-head">
          <span className="step-label">{showDeleted ? 'Deleted products' : 'All products'}</span>
          <button className="quiet" onClick={() => setShowDeleted((current) => !current)}>
            {showDeleted ? 'Back to products' : 'Show deleted'}
          </button>
        </div>

        {!showDeleted && (
          <>
            {products.isLoading && <Loader fullRegion label="Loading products…" />}
            {products.error && <Banner tone="error">Could not load products for this business.</Banner>}
            {products.data && products.data.length === 0 && <Banner tone="info">No products yet. Add your first one above.</Banner>}
            {products.data && products.data.length > 0 && (
              <div className="member-list">
                {products.data.map((product) => (
                  <div className="member-row" key={product.id.toString()}>
                    <div>
                      <strong>{product.name}</strong>
                      <div className="member-role">
                        {product.priceMinorUnits !== null && product.priceCurrencyCode
                          ? Money.fromMinorUnits(
                              product.priceMinorUnits,
                              new Currency({ code: product.priceCurrencyCode, name: product.priceCurrencyCode, symbol: product.priceCurrencyCode, exponent: resolveCurrencyExponent(product.priceCurrencyCode) }),
                            ).format(business.locale) + ` / ${product.unit}`
                          : `No price set · ${product.unit}`}
                        {' · '}
                        {product.stockQuantity !== null ? `${product.stockQuantity} in stock` : 'Stock not tracked'}
                      </div>
                    </div>
                    <div className="member-actions">
                      <button
                        onClick={() => {
                          const input = window.prompt(`Set stock on hand for ${product.name} (leave blank to stop tracking):`, product.stockQuantity ?? '')
                          if (input !== null) adjustStock.mutate({ id: product.id, stockQuantity: input.trim() || null })
                        }}
                        disabled={adjustStock.isPending}
                      >
                        Adjust stock
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${product.name}? You can restore it later from "Show deleted".`)) remove.mutate(product.id)
                        }}
                        disabled={remove.isPending}
                      >
                        {remove.isPending ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {remove.error && <Banner tone="error">Could not remove that product.</Banner>}
            {adjustStock.error && <Banner tone="error">Could not update stock for that product.</Banner>}
          </>
        )}

        {showDeleted && (
          <>
            {deletedProducts.isLoading && <Loader fullRegion label="Loading deleted products…" />}
            {deletedProducts.error && <Banner tone="error">Could not load deleted products.</Banner>}
            {deletedProducts.data && deletedProducts.data.length === 0 && <Banner tone="info">No deleted products.</Banner>}
            {deletedProducts.data && deletedProducts.data.length > 0 && (
              <div className="member-list">
                {deletedProducts.data.map((product) => (
                  <div className="member-row" key={product.id.toString()}>
                    <div>
                      <strong>{product.name}</strong>
                      <div className="member-role">{product.unit}</div>
                    </div>
                    <div className="member-actions">
                      <button onClick={() => restore.mutate(product.id)} disabled={restore.isPending}>
                        {restore.isPending ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {restore.error && <Banner tone="error">Could not restore that product.</Banner>}
          </>
        )}
      </div>
    </div>
  )
}
