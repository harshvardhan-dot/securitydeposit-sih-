import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, errorMessage } from './api'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Small data-loading helper. `path` may be null to skip the request until the
 * caller has everything it needs (e.g. a route param).
 */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  })
  const sequence = useRef(0)

  const load = useCallback(async () => {
    if (!path) {
      setState({ data: null, loading: false, error: null })
      return
    }
    const ticket = ++sequence.current
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await apiGet<T>(path)
      if (ticket === sequence.current) setState({ data, loading: false, error: null })
    } catch (error) {
      if (ticket === sequence.current) {
        setState({ data: null, loading: false, error: errorMessage(error) })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  return { ...state, reload: load, setData: (data: T) => setState({ data, loading: false, error: null }) }
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const handler = () => setMatches(media.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])
  return matches
}
