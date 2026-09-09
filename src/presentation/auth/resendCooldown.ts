// Client-side resend throttling for OTP/password-reset/verification emails. This is a
// UX safety net (matches the plan's "persistent resend countdown" / "progressive
// cooldowns" requirements) — it stops a single browser from hammering the resend button,
// but it is NOT a substitute for server-side rate limiting. Supabase Auth already applies
// its own project-wide email-send limits regardless of this; genuine per-IP/per-account
// throttling and CAPTCHA-after-suspicious-activity both require server-side configuration
// (Supabase Auth rate limit settings and a CAPTCHA provider in the dashboard) that no
// amount of client code can provide, since a malicious caller can simply skip the client.
//
// "Persistent" here means survives a page reload — backed by localStorage, keyed per
// email + action so switching accounts or actions doesn't inherit someone else's cooldown.

const STORAGE_PREFIX = 'kita.auth.cooldown.'
const BASE_COOLDOWN_MS = 30_000
const MAX_COOLDOWN_MS = 300_000
const COOLDOWN_RESET_AFTER_MS = 60 * 60_000 // an hour of inactivity resets progressive backoff

interface CooldownState {
  nextAllowedAt: number
  streak: number
}

function keyFor(action: string, email: string): string {
  return `${STORAGE_PREFIX}${action}:${email.trim().toLowerCase()}`
}

function readState(key: string): CooldownState | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CooldownState
    if (typeof parsed.nextAllowedAt !== 'number' || typeof parsed.streak !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/** Milliseconds remaining before another send is allowed for this action+email; 0 if none. */
export function cooldownRemainingMs(action: string, email: string): number {
  if (!email.trim()) return 0
  const state = readState(keyFor(action, email))
  if (!state) return 0
  return Math.max(0, state.nextAllowedAt - Date.now())
}

/** Call after a successful send to start (or extend) the cooldown for this action+email. */
export function startCooldown(action: string, email: string): void {
  if (!email.trim()) return
  const key = keyFor(action, email)
  const previous = readState(key)
  const now = Date.now()
  const streakStillWarm = previous && now - (previous.nextAllowedAt - durationForStreak(previous.streak)) < COOLDOWN_RESET_AFTER_MS
  const streak = streakStillWarm ? previous!.streak + 1 : 1
  const duration = durationForStreak(streak)
  try {
    localStorage.setItem(key, JSON.stringify({ nextAllowedAt: now + duration, streak } satisfies CooldownState))
  } catch {
    // Storage unavailable (private mode, quota) — the cooldown just won't persist across reloads.
  }
}

function durationForStreak(streak: number): number {
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.max(0, streak - 1))
}
