import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { container } from '../../shared/container'
import { useAuth } from '../auth/AuthContext'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'] as const

function isAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('platform admin access required')
}

export function PlatformAdminPage() {
  const { user, loading, gateway } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null)
  const [overridePlanCode, setOverridePlanCode] = useState('free')
  const [overrideStatus, setOverrideStatus] = useState<string>('active')

  const businesses = useQuery({
    queryKey: ['admin-businesses', search],
    queryFn: () => container.platformAdminGateway.listBusinesses(search),
    enabled: Boolean(user),
    retry: false,
  })
  const abuseReports = useQuery({
    queryKey: ['admin-abuse-reports'],
    queryFn: () => container.platformAdminGateway.listAbuseReports('open'),
    enabled: Boolean(user) && !isAccessDenied(businesses.error),
    retry: false,
  })

  const suspend = useMutation({
    mutationFn: ({ businessId, reason }: { businessId: string; reason: string }) =>
      container.platformAdminGateway.suspendBusiness(businessId, reason),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-businesses'] }),
  })
  const reinstate = useMutation({
    mutationFn: (businessId: string) => container.platformAdminGateway.reinstateBusiness(businessId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-businesses'] }),
  })
  const override = useMutation({
    mutationFn: () =>
      container.platformAdminGateway.overrideSubscription({
        businessId: overrideTarget!,
        planCode: overridePlanCode,
        status: overrideStatus,
      }),
    onSuccess: () => {
      setOverrideTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-businesses'] })
    },
  })
  const resolveReport = useMutation({
    mutationFn: ({ reportId, status }: { reportId: string; status: 'resolved' | 'dismissed' }) =>
      container.platformAdminGateway.resolveAbuseReport(reportId, status, ''),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-abuse-reports'] }),
  })

  if (loading) return <main className="centered">Checking access…</main>
  if (!user) return <Navigate to="/auth" replace />

  if (isAccessDenied(businesses.error)) {
    return (
      <main className="centered">
        <div>
          <h2>Not authorized</h2>
          <p>This account does not have platform-admin access.</p>
          <button onClick={() => void gateway.signOut()}>Sign out</button>
        </div>
      </main>
    )
  }

  return (
    <main className="platform-admin-page">
      <header>
        <div>
          <span className="eyebrow">Platform administration</span>
          <h1>Businesses</h1>
        </div>
        <span>{user.email}</span>
      </header>

      <div className="admin-search">
        <input
          type="search"
          placeholder="Search by legal name, trading name, or owner email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {businesses.isLoading && <Loader fullRegion label="Loading businesses…" />}
      {businesses.error && !isAccessDenied(businesses.error) && <Banner tone="error">Could not load businesses.</Banner>}
      {suspend.error && <Banner tone="error">{suspend.error instanceof Error ? suspend.error.message : 'Could not suspend that business.'}</Banner>}
      {reinstate.error && <Banner tone="error">{reinstate.error instanceof Error ? reinstate.error.message : 'Could not reinstate that business.'}</Banner>}
      {override.error && <Banner tone="error">{override.error instanceof Error ? override.error.message : 'Could not override that subscription.'}</Banner>}

      {businesses.data && businesses.data.length === 0 && <Banner tone="info">No businesses match that search.</Banner>}

      {businesses.data && businesses.data.length > 0 && (
        <div className="admin-business-list">
          {businesses.data.map((biz) => (
            <div className="admin-business-row" key={biz.businessId}>
              <div className="admin-business-identity">
                <strong>{biz.tradingName || biz.legalName}</strong>
                <small>{biz.ownerEmail ?? 'unknown owner'}</small>
                <small>Created {new Date(biz.createdAt).toLocaleDateString()} · {biz.memberCount} member{biz.memberCount === 1 ? '' : 's'}</small>
              </div>
              <div className="admin-business-status">
                <span className={`status-pill ${biz.subscriptionStatus ?? 'none'}`}>{biz.subscriptionStatus ?? 'no subscription'}</span>
                <small>{biz.planCode ?? '—'}</small>
                {biz.platformSuspendedAt && <span className="status-pill suspended">suspended</span>}
              </div>
              <div className="admin-business-actions">
                {biz.platformSuspendedAt ? (
                  <button onClick={() => reinstate.mutate(biz.businessId)} disabled={reinstate.isPending}>
                    {reinstate.isPending ? 'Reinstating…' : 'Reinstate'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const reason = window.prompt('Reason for suspending this business?')
                      if (reason) suspend.mutate({ businessId: biz.businessId, reason })
                    }}
                    disabled={suspend.isPending}
                  >
                    {suspend.isPending ? 'Suspending…' : 'Suspend'}
                  </button>
                )}
                <button onClick={() => setOverrideTarget(overrideTarget === biz.businessId ? null : biz.businessId)}>
                  Override plan
                </button>
              </div>
              {overrideTarget === biz.businessId && (
                <form
                  className="admin-override-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    override.mutate()
                  }}
                >
                  <label>
                    Plan code
                    <input value={overridePlanCode} onChange={(event) => setOverridePlanCode(event.target.value)} placeholder="free" />
                  </label>
                  <label>
                    Status
                    <select value={overrideStatus} onChange={(event) => setOverrideStatus(event.target.value)}>
                      {SUBSCRIPTION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <button className="primary" disabled={override.isPending}>{override.isPending ? 'Saving…' : 'Apply override'}</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <span className="step-label">Open abuse reports</span>
        {abuseReports.isLoading && <Loader fullRegion label="Loading reports…" />}
        {abuseReports.data && abuseReports.data.length === 0 && <Banner tone="info">No open abuse reports.</Banner>}
        {abuseReports.data && abuseReports.data.length > 0 && (
          <div className="admin-report-list">
            {abuseReports.data.map((report) => (
              <div className="admin-report-row" key={report.id}>
                <div>
                  <strong>{report.reporterEmail ?? 'anonymous'}</strong>
                  <p>{report.note}</p>
                  <small>{new Date(report.createdAt).toLocaleString()}</small>
                </div>
                <div className="admin-business-actions">
                  <button onClick={() => resolveReport.mutate({ reportId: report.id, status: 'resolved' })} disabled={resolveReport.isPending}>
                    Resolve
                  </button>
                  <button onClick={() => resolveReport.mutate({ reportId: report.id, status: 'dismissed' })} disabled={resolveReport.isPending}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
