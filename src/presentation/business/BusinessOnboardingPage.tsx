import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { container } from '../../shared/container'
import { useAuth } from '../auth/AuthContext'

export function BusinessOnboardingPage() {
  const { user, loading, gateway } = useAuth()
  const [legalName, setLegalName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const businesses = useQuery({
    queryKey: ['businesses'],
    queryFn: () => container.listBusinesses.execute(),
    enabled: Boolean(user),
  })
  const createBusiness = useMutation({
    mutationFn: () => container.createBusiness.execute({ legalName, tradingName: null, defaultCurrencyCode: currency, locale: navigator.language || 'en', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    onSuccess: () => businesses.refetch(),
  })

  if (loading) return <main className="centered">Loading your workspace…</main>
  if (!user) return <Navigate to="/auth" replace />

  function submit(event: FormEvent) {
    event.preventDefault()
    createBusiness.mutate()
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header"><div><span className="eyebrow">Kita Invoice</span><p>{user.email}</p></div><button className="quiet" onClick={() => void gateway.signOut()}>Sign out</button></header>
      {businesses.data?.length ? (
        <section><h1>Your businesses</h1><div className="business-list">{businesses.data.map((business) => <article key={business.id.toString()} className="business-row"><div><strong>{business.tradingName || business.legalName}</strong><span>{business.defaultCurrencyCode}</span></div><Link className="secondary link-button" to={`/app/businesses/${business.id.toString()}`}>Open workspace</Link></article>)}</div></section>
      ) : (
        <section className="onboarding"><span className="step-label">First workspace</span><h1>Tell us about your business.</h1><p>It will remain an independent tenant. You can create or join more businesses later.</p>
          <form onSubmit={submit}>
            <label>Legal business name<input value={legalName} onChange={(event) => setLegalName(event.target.value)} required /></label>
            <label>Default currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>KES</option><option>UGX</option><option>TZS</option><option>KWD</option></select></label>
            {businesses.error && <p className="notice error">Database foundation is not available yet. Apply the Supabase migration before creating a business.</p>}
            {createBusiness.error && <p className="notice error">{createBusiness.error.message}</p>}
            <button className="primary" disabled={createBusiness.isPending}>{createBusiness.isPending ? 'Creating…' : 'Create business'}</button>
          </form>
        </section>
      )}
    </main>
  )
}
