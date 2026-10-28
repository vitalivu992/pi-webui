import { useEffect, useRef, useState } from "react"
import { readPrefs, writePref } from "../lib/prefs.js"
import { configuredModels, effortsFor, launchRequest } from "../lib/settings.js"
import { useSettings } from "../hooks/useSettings.js"
import { useModels, usePi } from "../hooks/usePiData.js"
import { CommandPreview } from "./Composer.jsx"
import { PiIcon } from "./PiIcon.jsx"

function EffortSelect({ value, efforts, onChange, id, label }) {
  const options = value && !efforts.includes(value) ? [...efforts, value] : efforts
  return (
    <label className="pw-select pw-select--small">
      <span className="pw-visually-hidden">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Default thinking</option>
        {options.map((e) => (
          <option key={e} value={e}>
            {e}
            {efforts.includes(e) ? "" : " (not supported)"}
          </option>
        ))}
      </select>
      <i className="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </label>
  )
}

/**
 * How prompts run pi: the models (each with a thinking level; none = pi's
 * default model), the default model's thinking level, and the command a
 * prompt would run with these settings.
 */
function PiSettings({ info, settings, update, cwd }) {
  const [refresh, setRefresh] = useState(0)
  const suggestions = useModels({ version: refresh })
  const known = new Map((suggestions.data || []).map((m) => [m.id, m]))
  const [previewModel, setPreviewModel] = useState("")
  const models = configuredModels(settings)
  const listId = "pwModels"
  useEffect(() => {
    if (previewModel && !models.some((m) => m.id.trim() === previewModel)) setPreviewModel("")
  }, [models, previewModel])

  const setModels = (next) => update({ models: next })
  const setRow = (i, patch) => setModels(settings.models.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const move = (i, step) => {
    const next = [...settings.models]
    const [row] = next.splice(i, 1)
    next.splice(i + step, 0, row)
    setModels(next)
  }

  return (
    <section className="pw-hset is-open" aria-labelledby="pwHset">
      <div className="pw-hset__head" id="pwHset">
        <PiIcon size={18} />
        <span className="pw-hset__name">pi</span>
        <span className="pw-hset__summary">
          {models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "default model"}
        </span>
        {info && !info.found ? (
          <span className="pw-hset__missing" title={`${info.cli} isn't on the server's PATH`}>
            not installed
          </span>
        ) : null}
      </div>
      <div className="pw-hset__body">
        <p className="pw-hset__cli">
          <code>{info?.cli || "pi"}</code>{" "}
          {info ? info.found ? <span title={info.found}>{info.found}</span> : <span className="pw-hset__missing">not found on PATH</span> : null}
        </p>

        <h4 className="pw-hset__label">Models</h4>
        <p className="pw-hset__hint">The prompt box offers these, first one first. Leave the list empty to use pi's default model.</p>
        {settings.models.length ? (
          <ol className="pw-models">
            {settings.models.map((m, i) => (
              <li key={i} className="pw-models__row">
                <input
                  type="text"
                  className="pw-input"
                  list={listId}
                  value={m.id}
                  placeholder="provider/model"
                  aria-label={`Model ${i + 1}`}
                  spellCheck="false"
                  autoFocus={!m.id && i === settings.models.length - 1}
                  onChange={(e) => setRow(i, { id: e.target.value })}
                />
                {info?.efforts?.length ? (
                  <EffortSelect
                    label={`Thinking for model ${i + 1}`}
                    value={m.effort}
                    efforts={effortsFor(info, known.get(m.id.trim()))}
                    onChange={(effort) => setRow(i, { effort })}
                  />
                ) : null}
                <span className="pw-models__tools">
                  <button type="button" className="pw-icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">
                    <i className="fa-solid fa-arrow-up" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    className="pw-icon-btn"
                    onClick={() => setModels(settings.models.filter((_, j) => j !== i))}
                    aria-label={`Remove ${m.id || "model"}`}
                    title="Remove"
                  >
                    <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <datalist id={listId}>
          {(suggestions.data || []).map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
        <div className="pw-hset__row">
          <button type="button" className="pw-btn pw-btn--small" onClick={() => setModels([...settings.models, { id: "", effort: "" }])}>
            <i className="fa-solid fa-plus" aria-hidden="true"></i> Add model
          </button>
          <span className="pw-hset__suggest">
            {suggestions.loading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Asking pi for its models…
              </>
            ) : suggestions.error ? (
              <span className="pw-hset__missing">{suggestions.error.message}</span>
            ) : suggestions.data ? (
              <>
                {suggestions.data.length ? `${suggestions.data.length} models to pick from` : "pi listed no models"}{" "}
                <button type="button" className="pw-link-btn" onClick={() => setRefresh((n) => n + 1)}>
                  Refresh
                </button>
              </>
            ) : null}
          </span>
        </div>

        {info?.efforts?.length ? (
          <div className="pw-hset__field">
            <h4 className="pw-hset__label">Thinking level of the default model</h4>
            <EffortSelect
              id="pwDefaultEffort"
              label="Thinking level of the default model"
              value={settings.effort}
              efforts={info.efforts}
              onChange={(effort) => update({ effort })}
            />
          </div>
        ) : null}

        <p className="pw-hset__note">
          <i className="fa-solid fa-shield-halved" aria-hidden="true"></i> pi doesn't ask for permissions: a prompt sent from here runs
          every tool it calls.
        </p>

        <div className="pw-hset__field">
          <div className="pw-hset__preview-head">
            <h4 className="pw-hset__label">Command preview</h4>
            <label className="pw-select pw-select--small">
              <span className="pw-visually-hidden">Preview with model</span>
              <select value={previewModel} onChange={(e) => setPreviewModel(e.target.value)} aria-label="Preview with model">
                <option value="">Default model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id.trim()}>
                    {m.id.trim()}
                  </option>
                ))}
              </select>
              <i className="fa-solid fa-chevron-down" aria-hidden="true"></i>
            </label>
          </div>
          <p className="pw-hset__hint">A new conversation {cwd ? "in the selected project" : "in your home folder"} runs:</p>
          <CommandPreview req={launchRequest(settings, { model: previewModel, prompt: "Your prompt", cwd })} id="pwPreview" />
        </div>
      </div>
    </section>
  )
}

/**
 * The Settings panel on the right: how prompts are sent to pi. Saved in this
 * browser as it is edited. It can widen (remembered) and closes with Esc or ×.
 */
export function SettingsPanel({ onClose, cwd }) {
  const [settings, save] = useSettings()
  const pi = usePi()
  const [wide, setWide] = useState(() => Boolean(readPrefs().settingsWide))
  const panel = useRef(null)

  useEffect(() => {
    panel.current?.focus()
  }, [])

  const update = (patch) => save((s) => ({ ...s, ...patch }))

  const toggleWide = () => {
    writePref("settingsWide", !wide)
    setWide(!wide)
  }

  return (
    <aside
      className={`pw-settings${wide ? " is-wide" : ""}`}
      id="pwSettings"
      aria-labelledby="pwSettingsTitle"
      tabIndex={-1}
      ref={panel}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) onClose()
      }}
    >
      <header className="pw-panel-head pw-settings__head">
        <h2 className="pw-settings__title" id="pwSettingsTitle">
          <i className="fa-solid fa-gear" aria-hidden="true"></i> Settings
        </h2>
        <div className="pw-panel-head__actions">
          <button
            type="button"
            className="pw-icon-btn"
            id="pwSettingsWide"
            onClick={toggleWide}
            aria-pressed={wide}
            title={wide ? "Narrower" : "Wider"}
            aria-label={wide ? "Make the settings narrower" : "Make the settings wider"}
          >
            <i className={`fa-solid ${wide ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}`} aria-hidden="true"></i>
          </button>
          <button type="button" className="pw-icon-btn" id="pwSettingsClose" onClick={onClose} title="Close (Esc)" aria-label="Close the settings">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      </header>
      <div className="pw-settings__scroll">
        <section className="pw-settings__section">
          <h3 className="pw-settings__heading">Prompts</h3>
          <p className="pw-hset__hint">Prompts run <code>pi -p</code> on the server, in the conversation's folder. Saved in this browser.</p>
          {pi.error ? <p className="pw-error">Could not ask the server about pi: {pi.error.message}</p> : null}
          <PiSettings info={pi.data} settings={settings} update={update} cwd={cwd} />
        </section>
      </div>
    </aside>
  )
}
