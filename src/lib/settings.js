// How prompts are sent to pi (the Settings panel), in localStorage
// `pw_settings` (per browser). Reads and writes never throw. The models the
// prompt box offers (none: pi's default model), each with its thinking level,
// and the thinking level for the default model.

const KEY = "pw_settings"
export const SETTINGS_EVENT = "pw:settings"

/** Fills what a stored (or partial) settings object lacks. */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {}
  return {
    models: (Array.isArray(src.models) ? src.models : [])
      .filter((m) => m && typeof m.id === "string")
      .map((m) => ({ id: m.id, effort: typeof m.effort === "string" ? m.effort : "" })),
    effort: typeof src.effort === "string" ? src.effort : "",
  }
}

export function readSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) || "{}"))
  } catch {
    return normalizeSettings({})
  }
}

/** Saves and tells every mounted reader (useSettings) about it. */
export function writeSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // ignore: the settings last until the page reloads
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }))
}

/** The configured models with an id ("" rows are being typed). */
export function configuredModels(settings) {
  return (settings.models || []).filter((m) => m.id.trim())
}

/**
 * The run request for a prompt: the model's thinking level (or the one for
 * pi's default model) from the settings.
 */
export function launchRequest(settings, { model = "", prompt, session = "", cwd = "" }) {
  const row = model ? settings.models.find((m) => m.id.trim() === model) : null
  return { session, cwd, prompt, model, effort: row ? row.effort : settings.effort }
}

/** The thinking levels to offer for a model: what it supports when known, else pi's. */
export function effortsFor(piInfo, modelInfo) {
  if (modelInfo && Array.isArray(modelInfo.efforts)) return modelInfo.efforts
  return piInfo?.efforts || []
}
