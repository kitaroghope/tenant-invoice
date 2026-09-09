export interface AuthenticatedUser {
  id: string
  email: string
}

export type AuthStateListener = (user: AuthenticatedUser | null) => void

export interface AuthGateway {
  currentUser(): Promise<AuthenticatedUser | null>
  onAuthStateChange(listener: AuthStateListener): () => void
  signInWithPassword(email: string, password: string): Promise<void>
  register(email: string, password: string): Promise<'signed-in' | 'verification-required'>
  requestPasswordlessCode(email: string): Promise<void>
  verifyPasswordlessCode(email: string, token: string): Promise<void>
  requestPasswordReset(email: string, redirectUrl: string): Promise<void>
  signOut(): Promise<void>
}
