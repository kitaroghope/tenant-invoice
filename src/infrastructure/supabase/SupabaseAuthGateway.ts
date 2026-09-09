import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AuthGateway, AuthStateListener, AuthenticatedUser } from '../../application/ports/AuthGateway'

export class SupabaseAuthGateway implements AuthGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async currentUser(): Promise<AuthenticatedUser | null> {
    const { data, error } = await this.client.auth.getUser()
    if (error) return null
    return data.user ? this.toUser(data.user) : null
  }

  public onAuthStateChange(listener: AuthStateListener): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(session?.user ? this.toUser(session.user) : null)
    })
    return () => data.subscription.unsubscribe()
  }

  public async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  public async register(email: string, password: string): Promise<'signed-in' | 'verification-required'> {
    const { data, error } = await this.client.auth.signUp({ email, password })
    if (error) throw error
    return data.session ? 'signed-in' : 'verification-required'
  }

  public async requestPasswordlessCode(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) throw error
  }

  public async verifyPasswordlessCode(email: string, token: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({ email, token, type: 'email' })
    if (error) throw error
  }

  public async requestPasswordReset(email: string, redirectUrl: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl })
    if (error) throw error
  }

  public async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: 'local' })
    if (error) throw error
  }

  private toUser(user: User): AuthenticatedUser {
    return { id: user.id, email: user.email ?? '' }
  }
}
