const TOKEN_KEY = 'aicte.token'
const USER_KEY = 'aicte.user'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_BASE}${path}`
}

let token: string | null = localStorage.getItem(TOKEN_KEY)

export class ApiError extends Error {
  status: number
  code: string
  detail: unknown

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export function getToken(): string | null {
  return token
}

export function setToken(value: string | null): void {
  token = value
  if (value) localStorage.setItem(TOKEN_KEY, value)
  else localStorage.removeItem(TOKEN_KEY)
}

export function cacheUser(value: unknown): void {
  if (value) localStorage.setItem(USER_KEY, JSON.stringify(value))
  else localStorage.removeItem(USER_KEY)
}

export function readCachedUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

async function parseResponse(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  return await response.text()
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')

  let response: Response
  const primaryUrl = resolveUrl(path)
  try {
    response = await fetch(primaryUrl, { ...init, headers })
  } catch (primaryErr) {
    // If request failed (e.g. Vite proxy drop), try direct backend port 8000 if running locally on dev port
    const isDevClient =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      window.location.port !== '8000'

    if (isDevClient && !primaryUrl.startsWith('http')) {
      const fallbackUrl = `http://127.0.0.1:8000${primaryUrl.startsWith('/') ? '' : '/'}${primaryUrl}`
      try {
        response = await fetch(fallbackUrl, { ...init, headers })
      } catch (fallbackErr) {
        console.error('API fetch failed on primary and fallback:', { primaryUrl, fallbackUrl, primaryErr, fallbackErr })
        throw new ApiError(0, 'network_error', 'Cannot reach the portal. Check that the API server is running.')
      }
    } else {
      console.error('API fetch failed:', { primaryUrl, primaryErr })
      throw new ApiError(0, 'network_error', 'Cannot reach the portal. Check that the API server is running.')
    }
  }

  const payload = await parseResponse(response)

  if (!response.ok) {
    const body = payload as
      | {
          detail?: unknown
          error?: { code?: string; message?: string; failed_items?: string[] }
        }
      | null
    const detailObject =
      body?.detail && typeof body.detail === 'object'
        ? (body.detail as { code?: string; message?: string; failed_items?: string[] })
        : null
    const code =
      body?.error?.code ?? detailObject?.code ?? `http_${response.status}`

    if (response.status === 401) {
      if (code !== 'invalid_credentials' && code !== 'mfa_invalid' && code !== 'mfa_expired') {
        window.dispatchEvent(new CustomEvent('aicte:session-expired'))
      }
    }

    const detail =
      body?.detail ?? body?.error ?? payload
    const message =
      body?.error?.message ??
      detailObject?.message ??
      (typeof body?.detail === 'string' ? body.detail : null) ??
      `Request failed (${response.status})`
    throw new ApiError(response.status, code, message, detail)
  }

  return payload as T
}

export const apiGet = <T,>(path: string) => api<T>(path)
export const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const apiPatch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
export const apiPut = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })

export function uploadFile<T>(path: string, file: File, field = 'file'): Promise<T> {
  const form = new FormData()
  form.append(field, file)
  return api<T>(path, { method: 'POST', body: form })
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(resolveUrl(path), { headers })
  if (!response.ok) throw new ApiError(response.status, 'download_failed', 'Export could not be generated.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
