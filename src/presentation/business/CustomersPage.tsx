import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { container } from '../../shared/container'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'
import type { Business } from '../../domain/business/Business'
import { CustomerId } from '../../domain/shared/EntityId'

const nameSchema = z.string().min(1, 'Customer name is required')
const optionalEmailSchema = z.email('Enter a valid email address').or(z.literal(''))

interface FormState {
  displayName: string
  email: string
  phone: string
  taxId: string
}

const emptyForm: FormState = { displayName: '', email: '', phone: '', taxId: '' }

export function CustomersPage({ business }: { business: Business }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)

  const invalidateCustomers = () => void queryClient.invalidateQueries({ queryKey: ['customers', business.id.toString()] })

  const customers = useQuery({
    queryKey: ['customers', business.id.toString()],
    queryFn: () => container.customerRepository.listActive(business.id),
    enabled: !showDeleted,
  })
  const deletedCustomers = useQuery({
    queryKey: ['customers', business.id.toString(), 'deleted'],
    queryFn: () => container.customerRepository.listDeleted(business.id),
    enabled: showDeleted,
  })

  const create = useMutation({
    mutationFn: (input: FormState) =>
      container.customerRepository.create({
        businessId: business.id,
        displayName: input.displayName.trim(),
        email: input.email.trim() || null,
        phone: input.phone.trim() || null,
        taxId: input.taxId.trim() || null,
      }),
    onSuccess: () => {
      setForm(emptyForm)
      invalidateCustomers()
    },
  })

  const remove = useMutation({
    mutationFn: (id: CustomerId) => container.customerRepository.softDelete(id, null),
    onSuccess: invalidateCustomers,
  })

  const restore = useMutation({
    mutationFn: (id: CustomerId) => container.customerRepository.restore(id),
    onSuccess: () => {
      invalidateCustomers()
      void queryClient.invalidateQueries({ queryKey: ['customers', business.id.toString(), 'deleted'] })
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    try {
      nameSchema.parse(form.displayName.trim())
      optionalEmailSchema.parse(form.email.trim())
      create.mutate(form)
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to save that customer')
    }
  }

  return (
    <div className="members-page">
      <div>
        <span className="eyebrow">Customers</span>
        <h1>Customers</h1>
      </div>

      <form className="invite-form" onSubmit={submit}>
        <span className="step-label">Add a customer</span>
        <div className="form-grid customer-form-grid">
          <label>
            Name
            <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Customer or company name" required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Optional" />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional" />
          </label>
          <label>
            Tax ID
            <input value={form.taxId} onChange={(event) => setForm((current) => ({ ...current, taxId: event.target.value }))} placeholder="Optional" />
          </label>
          <button className="primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add customer'}</button>
        </div>
        {formError && <Banner tone="error">{formError}</Banner>}
        {create.error && <Banner tone="error">{create.error instanceof Error ? create.error.message : 'Could not save that customer'}</Banner>}
      </form>

      <div>
        <div className="section-head">
          <span className="step-label">{showDeleted ? 'Deleted customers' : 'All customers'}</span>
          <button className="quiet" onClick={() => setShowDeleted((current) => !current)}>
            {showDeleted ? 'Back to customers' : 'Show deleted'}
          </button>
        </div>

        {!showDeleted && (
          <>
            {customers.isLoading && <Loader fullRegion label="Loading customers…" />}
            {customers.error && <Banner tone="error">Could not load customers for this business.</Banner>}
            {customers.data && customers.data.length === 0 && <Banner tone="info">No customers yet. Add your first one above.</Banner>}
            {customers.data && customers.data.length > 0 && (
              <div className="member-list">
                {customers.data.map((customer) => (
                  <div className="member-row" key={customer.id.toString()}>
                    <div>
                      <strong>{customer.displayName}</strong>
                      <div className="member-role">{[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
                    </div>
                    <div className="member-actions">
                      <button
                        onClick={() => {
                          if (window.confirm(`Remove ${customer.displayName}? You can restore them later from "Show deleted".`)) remove.mutate(customer.id)
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
            {remove.error && <Banner tone="error">Could not remove that customer.</Banner>}
          </>
        )}

        {showDeleted && (
          <>
            {deletedCustomers.isLoading && <Loader fullRegion label="Loading deleted customers…" />}
            {deletedCustomers.error && <Banner tone="error">Could not load deleted customers.</Banner>}
            {deletedCustomers.data && deletedCustomers.data.length === 0 && <Banner tone="info">No deleted customers.</Banner>}
            {deletedCustomers.data && deletedCustomers.data.length > 0 && (
              <div className="member-list">
                {deletedCustomers.data.map((customer) => (
                  <div className="member-row" key={customer.id.toString()}>
                    <div>
                      <strong>{customer.displayName}</strong>
                      <div className="member-role">{[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
                    </div>
                    <div className="member-actions">
                      <button onClick={() => restore.mutate(customer.id)} disabled={restore.isPending}>
                        {restore.isPending ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {restore.error && <Banner tone="error">Could not restore that customer.</Banner>}
          </>
        )}
      </div>
    </div>
  )
}
