import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { container } from '../../shared/container'
import { useAuth } from '../auth/AuthContext'
import { Banner } from '../shared/Banner'
import { Loader } from '../shared/Loader'

export function AcceptInvitationPage() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<'pending' | 'accepted' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)

  useEffect(() => {
    if (loading || !user || !token || status !== 'pending') return
    container.membershipGateway
      .accept(token)
      .then((id) => {
        setBusinessId(id)
        setStatus('accepted')
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'This invitation could not be accepted')
        setStatus('error')
      })
  }, [loading, user, token, status])

  if (!token) {
    return (
      <main className="centered">
        <Banner tone="error">This invitation link is missing its token.</Banner>
      </main>
    )
  }

  if (loading) return <main className="centered">Loading…</main>

  if (!user) {
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(`/accept-invitation?token=${token}`)}`} replace />
  }

  if (status === 'accepted' && businessId) {
    return <Navigate to={`/app/businesses/${businessId}`} replace />
  }

  return (
    <main className="centered">
      {status === 'pending' && <Loader fullRegion label="Accepting your invitation…" />}
      {status === 'error' && (
        <div>
          <Banner tone="error">{error}</Banner>
          <p>If you were expecting this, ask whoever invited you to send a new invitation.</p>
        </div>
      )}
    </main>
  )
}
