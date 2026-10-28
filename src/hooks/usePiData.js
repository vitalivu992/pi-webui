import { useEffect, useState } from "react"
import { fetchCommands, fetchModels, fetchPi } from "../lib/api.js"

// Asked once per page (pi, models) or per folder (commands); a failed load is asked again next time.
const cache = new Map()

function cached(key, load) {
  if (!cache.has(key)) {
    const p = load()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return cache.get(key)
}

function useLoad(key, load) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(key) })
  useEffect(() => {
    if (!key) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    let live = true
    setState((s) => ({ data: s.data, error: null, loading: true }))
    cached(key, load).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error, loading: false })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

/** The pi CLI (GET /api/pi): `{ cli, efforts, found }`. */
export function usePi() {
  return useLoad("pi", () => fetchPi())
}

/** pi's prompt templates and skills in a folder. */
export function useCommands(cwd) {
  return useLoad(`commands:${cwd || ""}`, () => fetchCommands(cwd))
}

/** The models pi offers; `version` > 0 asks the CLI again (refresh). */
export function useModels({ enabled = true, version = 0 } = {}) {
  return useLoad(enabled ? `models:${version}` : "", () => fetchModels({ refresh: version > 0 }))
}
