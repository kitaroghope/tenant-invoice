import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from './AuthContext'
import { cooldownRemainingMs, startCooldown } from './resendCooldown'

type Mode = 'login' | 'register' | 'otp' | 'verify-otp' | 'reset'
const emailSchema = z.email('Enter a valid email address')
const passwordSchema = z.string().min(8, 'Use at least 8 characters')

// Actions that send an email/code and should therefore be throttled client-side.
const COOLDOWN_ACTIONS: Partial<Record<Mode, string>> = { register: 'register', otp: 'otp', reset: 'reset' }
const MAX_OTP_ATTEMPTS = 5

function friendlyAuthError(caught: unknown): string {
  const status = (caught as { status?: number } | null)?.status
  const code = (caught as { code?: string } | null)?.code
  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many attempts. Please wait a few minutes before trying again.'
  }
  return caught instanceof Error ? caught.message : 'Unable to complete that request'
}

export function AuthPage() {
  const { user, gateway } = useAuth()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [otpAttempts, setOtpAttempts] = useState(0)
  const [cooldownMs, setCooldownMs] = useState(0)

  const cooldownAction = COOLDOWN_ACTIONS[mode]

  // Re-check the persisted cooldown whenever the action or email changes, and tick it
  // down once a second while active so the button can show a live "Resend in Ns" state.
  useEffect(() => {
    if (!cooldownAction) {
      setCooldownMs(0)
      return
    }
    const update = () => setCooldownMs(cooldownRemainingMs(cooldownAction, email))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [cooldownAction, email])

  if (user) return <Navigate to={returnTo && returnTo.startsWith('/') ? returnTo : '/app'} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (cooldownAction && cooldownRemainingMs(cooldownAction, email) > 0) return
    if (mode === 'verify-otp' && otpAttempts >= MAX_OTP_ATTEMPTS) {
      setToken('')
      setOtpAttempts(0)
      setError(null)
      setMode('otp')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const validEmail = emailSchema.parse(email.trim().toLowerCase())
      if (mode === 'login') {
        await gateway.signInWithPassword(validEmail, passwordSchema.parse(password))
      } else if (mode === 'register') {
        const result = await gateway.register(validEmail, passwordSchema.parse(password))
        startCooldown('register', validEmail)
        setCooldownMs(cooldownRemainingMs('register', validEmail))
        if (result === 'verification-required') setMessage('Check your inbox to verify your email, then return to sign in.')
      } else if (mode === 'otp') {
        await gateway.requestPasswordlessCode(validEmail)
        startCooldown('otp', validEmail)
        setCooldownMs(cooldownRemainingMs('otp', validEmail))
        setOtpAttempts(0)
        setMode('verify-otp')
        setMessage('We sent a six-digit sign-in code if this account exists.')
      } else if (mode === 'verify-otp') {
        if (!/^\d{6}$/.test(token)) throw new Error('Enter the six-digit code')
        try {
          await gateway.verifyPasswordlessCode(validEmail, token)
        } catch (verifyError) {
          setOtpAttempts((count) => count + 1)
          throw verifyError
        }
      } else {
        await gateway.requestPasswordReset(validEmail, `${window.location.origin}/auth`)
        startCooldown('reset', validEmail)
        setCooldownMs(cooldownRemainingMs('reset', validEmail))
        setMessage('If this account exists, password recovery instructions have been sent.')
      }
    } catch (caught) {
      setError(friendlyAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'register' ? 'Create your account' : mode === 'otp' || mode === 'verify-otp' ? 'Sign in with a code' : mode === 'reset' ? 'Recover your account' : 'Welcome back'
  const cooldownSeconds = Math.ceil(cooldownMs / 1000)
  const otpLockedOut = mode === 'verify-otp' && otpAttempts >= MAX_OTP_ATTEMPTS
  const submitDisabled = busy || (!otpLockedOut && Boolean(cooldownAction) && cooldownMs > 0)

  function submitLabel(): string {
    if (busy) return 'Please wait…'
    if (otpLockedOut) return 'Request a new code'
    if (cooldownAction && cooldownMs > 0) return `Resend in ${cooldownSeconds}s`
    if (mode === 'register') return 'Create account'
    if (mode === 'verify-otp') return 'Verify code'
    if (mode === 'reset') return 'Send recovery email'
    if (mode === 'otp') return 'Email me a code'
    return 'Sign in'
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <span className="eyebrow">Kita Invoice</span>
        <h1>Run every business from one calm workspace.</h1>
        <p>Invoices, receipts, customers and payments—kept independent for each business you manage.</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <span className="step-label">Secure access</span>
            <h2>{title}</h2>
          </div>
          <label>Email<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          {(mode === 'login' || mode === 'register') && <label>Password<input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>}
          {mode === 'verify-otp' && <label>Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, ''))} disabled={otpLockedOut} required /></label>}
          {mode === 'verify-otp' && otpAttempts > 0 && !otpLockedOut && (
            <p className="form-hint">{MAX_OTP_ATTEMPTS - otpAttempts} attempt{MAX_OTP_ATTEMPTS - otpAttempts === 1 ? '' : 's'} left before you'll need a new code.</p>
          )}
          {otpLockedOut && <p className="notice warning" role="alert">Too many incorrect attempts. Request a fresh code to continue.</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          {message && <p className="notice success" role="status">{message}</p>}
          <button className="primary" disabled={submitDisabled}>{submitLabel()}</button>
          <nav className="auth-actions" aria-label="Authentication options">
            {mode !== 'login' && <button type="button" onClick={() => setMode('login')}>Password login</button>}
            {mode !== 'register' && <button type="button" onClick={() => setMode('register')}>Create account</button>}
            {mode !== 'otp' && mode !== 'verify-otp' && <button type="button" onClick={() => setMode('otp')}>Use email code</button>}
            {mode !== 'reset' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}
          </nav>
        </form>
      </section>
    </main>
  )
}
