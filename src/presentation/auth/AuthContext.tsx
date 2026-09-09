import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { AuthGateway, AuthenticatedUser } from '../../application/ports/AuthGateway'
import { container } from '../../shared/container'

interface AuthContextValue {
  user: AuthenticatedUser | null
  loading: boolean
  gateway: AuthGateway
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const gateway = container.authGateway
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void gateway.currentUser().then(setUser).finally(() => setLoading(false))
    return gateway.onAuthStateChange((nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [gateway])

  const value = useMemo(() => ({ user, loading, gateway }), [user, loading, gateway])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
