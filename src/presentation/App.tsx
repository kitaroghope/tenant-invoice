import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ArchitecturePage } from './ArchitecturePage'
import { AuthProvider } from './auth/AuthContext'

const AuthPage = lazy(() => import('./auth/AuthPage').then((module) => ({ default: module.AuthPage })))
const BusinessOnboardingPage = lazy(() => import('./business/BusinessOnboardingPage').then((module) => ({ default: module.BusinessOnboardingPage })))
const BusinessWorkspacePage = lazy(() => import('./business/BusinessWorkspacePage').then((module) => ({ default: module.BusinessWorkspacePage })))
const AcceptInvitationPage = lazy(() => import('./invitations/AcceptInvitationPage').then((module) => ({ default: module.AcceptInvitationPage })))
const PlatformAdminPage = lazy(() => import('./platform-admin/PlatformAdminPage').then((module) => ({ default: module.PlatformAdminPage })))

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<main className="centered">Loading…</main>}>
        <Routes>
          <Route path="/" element={<ArchitecturePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
          <Route path="/app" element={<BusinessOnboardingPage />} />
          <Route path="/app/businesses/:businessId/*" element={<BusinessWorkspacePage />} />
          <Route path="/platform-admin" element={<PlatformAdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
