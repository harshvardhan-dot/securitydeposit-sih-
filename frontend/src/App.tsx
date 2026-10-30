import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import type { Role } from './lib/types'

import AdminPage from './pages/AdminPage'
import DashboardPage from './pages/DashboardPage'
import InstitutionDetailPage from './pages/InstitutionDetailPage'
import InstitutionsPage from './pages/InstitutionsPage'
import InstrumentDetailPage from './pages/InstrumentDetailPage'
import InstrumentsPage from './pages/InstrumentsPage'
import LedgerPage from './pages/LedgerPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import RemindersPage from './pages/RemindersPage'
import ReportsPage from './pages/ReportsPage'
import RequestDetailPage from './pages/RequestDetailPage'
import RequestsPage from './pages/RequestsPage'
import ReviewPage from './pages/ReviewPage'
import SecurityPage from './pages/SecurityPage'
import TrackerPage from './pages/TrackerPage'
import UploadPage from './pages/UploadPage'
import VaultPage from './pages/VaultPage'

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-950">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-mint-400/30 bg-mint-400/10 text-mint-300">
          <ShieldCheck size={24} />
        </span>
        <p className="text-xs uppercase tracking-[0.2em] text-mist-500">Opening the vault…</p>
      </div>
    </div>
  )
}

function RequireAuth() {
  const { user, ready } = useAuth()
  if (!ready) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <NotFoundPage />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/track" element={<TrackerPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="instruments" element={<InstrumentsPage />} />
          <Route path="instruments/:id" element={<InstrumentDetailPage />} />
          <Route
            path="submit"
            element={
              <RoleGate roles={['institution', 'admin']}>
                <UploadPage />
              </RoleGate>
            }
          />
          <Route
            path="review"
            element={
              <RoleGate roles={['scrutiny_officer', 'verification_officer', 'competent_authority', 'admin', 'auditor']}>
                <ReviewPage />
              </RoleGate>
            }
          />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="requests/:id" element={<RequestDetailPage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="audit" element={<Navigate to="/ledger" replace />} />
          <Route path="audit-ledger" element={<Navigate to="/ledger" replace />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="institutions" element={<InstitutionsPage />} />
          <Route path="institutions/:id" element={<InstitutionDetailPage />} />
          <Route
            path="admin"
            element={
              <RoleGate roles={['admin']}>
                <AdminPage />
              </RoleGate>
            }
          />
          <Route
            path="security"
            element={
              <RoleGate roles={['admin', 'auditor', 'competent_authority']}>
                <SecurityPage />
              </RoleGate>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
