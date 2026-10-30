import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost, cacheUser, getToken, readCachedUser, setToken } from '../lib/api'
import type { LoginResponse, Role, User } from '../lib/types'

const IDLE_LIMIT_MS = 30 * 60 * 1000

interface LoginResult {
  mfaRequired: boolean
  challengeToken?: string
  demoHint?: { code: string; note: string }
  user?: User
}

interface AuthContextValue {
  user: User | null
  ready: boolean
  notice: string | null
  clearNotice: () => void
  login: (email: string, password: string) => Promise<LoginResult>
  verifyMfa: (code: string, challengeToken: string) => Promise<User>
  logout: (reason?: string) => Promise<void>
  refreshUser: () => Promise<void>
  setLanguage: (language: 'en' | 'hi') => Promise<void>
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(() => (getToken() ? readCachedUser<User>() : null))
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const lastActivity = useRef(Date.now())

  const clearSession = useCallback(
    (message?: string) => {
      setToken(null)
      cacheUser(null)
      setUser(null)
      if (message) setNotice(message)
      navigate('/login' + (message ? '?reason=session' : ''), { replace: true })
    },
    [navigate],
  )

  const refreshUser = useCallback(async () => {
    const next = await apiGet<User>('/api/auth/me')
    setUser(next)
    cacheUser(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      if (!getToken()) {
        setReady(true)
        return
      }
      try {
        await refreshUser()
      } catch {
        if (!cancelled) {
          setToken(null)
          cacheUser(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [refreshUser])

  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now()
    }
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, touch, { passive: true }))
    const timer = window.setInterval(() => {
      if (!getToken()) return
      if (Date.now() - lastActivity.current > IDLE_LIMIT_MS) {
        clearSession('You were signed out after 30 minutes of inactivity.')
      }
    }, 30_000)
    return () => {
      events.forEach((event) => window.removeEventListener(event, touch))
      window.clearInterval(timer)
    }
  }, [clearSession])

  useEffect(() => {
    const handler = () => {
      setToken(null)
      cacheUser(null)
      setUser(null)
      setNotice('Your session expired. Please sign in again.')
      navigate('/login?reason=session', { replace: true })
    }
    window.addEventListener('aicte:session-expired', handler)
    return () => window.removeEventListener('aicte:session-expired', handler)
  }, [navigate])

  const applySession = useCallback((response: LoginResponse) => {
    if (response.access_token && response.user) {
      setToken(response.access_token)
      cacheUser(response.user)
      setUser(response.user)
      return response.user
    }
    throw new Error('The server did not return a session.')
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const response = await apiPost<LoginResponse>('/api/auth/login', { email, password })
      if (response.mfa_required) {
        return {
          mfaRequired: true,
          challengeToken: response.challenge_token,
          demoHint: response.demo_hint,
        }
      }
      lastActivity.current = Date.now()
      const nextUser = applySession(response)
      return { mfaRequired: false, user: nextUser }
    },
    [applySession],
  )

  const verifyMfa = useCallback(
    async (code: string, challengeToken: string) => {
      const response = await apiPost<LoginResponse>('/api/auth/mfa/verify', {
        challenge_token: challengeToken,
        code,
      })
      lastActivity.current = Date.now()
      return applySession(response)
    },
    [applySession],
  )

  const logout = useCallback(
    async (reason?: string) => {
      try {
        await apiPost('/api/auth/logout')
      } catch {
        // local session is cleared regardless
      }
      setToken(null)
      cacheUser(null)
      setUser(null)
      if (reason) setNotice(reason)
      navigate('/login', { replace: true })
    },
    [navigate],
  )

  const setLanguage = useCallback(async (language: 'en' | 'hi') => {
    localStorage.setItem('aicte.language', language)
    try {
      await apiPost('/api/auth/language', { language })
    } catch {
      // language still applies locally
    }
    setUser((current) => (current ? { ...current, language } : current))
  }, [])

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        notice,
        clearNotice: () => setNotice(null),
        login,
        verifyMfa,
        logout,
        refreshUser,
        setLanguage,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
