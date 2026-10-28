import { useEffect, useRef, useState } from "react"
import { previewRun } from "../lib/api.js"
import { modelLabel } from "../lib/format.js"
import { readPrefs, writePref } from "../lib/prefs.js"
import { usedCommands } from "../lib/prompt.js"
import { configuredModels, launchRequest } from "../lib/settings.js"
import { useSettings } from "../hooks/useSettings.js"
import { useCommands, usePi } from "../hooks/usePiData.js"
import { PromptBox } from "./PromptBox.jsx"
import { useRuns } from "./Runs.jsx"

/** The model the prompt box starts with: the last one used if still configured, else the first. */
function initialModel(settings) {
  const models = configuredModels(settings).map((m) => m.id.trim())
  const last = readPrefs().composerModel
  if (last !== undefined && (last === "" || models.includes(last))) return last
  return models[0] || ""
}

function effortLabel(effort) {
  return effort ? `${effort[0].toUpperCase()}${effort.slice(1)} thinking` : "Default thinking"
}

/**
 * The command a request would run, asked of the server (which builds it) a
 * moment after the last change.
 */
function useCommandPreview(req, enabled) {
  const [state, setState] = useState({ plan: null, error: "" })
  const key = JSON.stringify(req)
  useEffect(() => {
    if (!enabled) return undefined
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      previewRun(JSON.parse(key), { signal: ctrl.signal }).then(
        (plan) => setState({ plan, error: "" }),
        (err) => !ctrl.signal.aborted && setState({ plan: null, error: err.message })
      )
    }, 200)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [key, enabled])
  return state
}

/** The command line that would run. */
export function CommandPreview({ req, id }) {
  const { plan, error } = useCommandPreview(req, true)
  if (error) return <p className="pw-preview__error">{error}</p>
  return (
    <div className="pw-preview" id={id}>
      <pre className="pw-command">
        <code>{plan ? plan.command : "…"}</code>
      </pre>
    </div>
  )
}

/**
 * Where a prompt is written and sent: to a conversation (`session`) or as a
 * new one in `cwd`. The model list and thinking levels come from the
 * settings; the bar shows them, and "Command" the exact pi command.
 */
export function Composer({
  cwd,
  session = "",
  turns = 0,
  run = null,
  disabledReason = "",
  autoFocus = false,
  onSent,
  onOpenSettings,
}) {
  const [settings] = useSettings()
  const runs = useRuns()
  const pi = usePi()
  const commands = useCommands(cwd)
  const [text, setText] = useState("")
  const [model, setModel] = useState(() => initialModel(settings))
  const [showCommand, setShowCommand] = useState(() => Boolean(readPrefs().showCommand))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const box = useRef(null)

  useEffect(() => setModel(initialModel(settings)), [settings])

  const models = configuredModels(settings)
  const info = pi.data
  const req = launchRequest(settings, { model, prompt: text, session, cwd })
  const running = Boolean(run?.running)
  const disabled = Boolean(disabledReason)
  const used = usedCommands(text, commands.data)
  const placeholder = disabled
    ? disabledReason
    : session
      ? "Message pi… (/ for prompt templates and skills)"
      : "Ask pi to start something… (/ for prompt templates and skills)"

  const pickModel = (id) => {
    setModel(id)
    writePref("composerModel", id)
  }

  const toggleCommand = () => {
    writePref("showCommand", !showCommand)
    setShowCommand(!showCommand)
  }

  const send = async () => {
    if (!text.trim() || sending || running || disabled) return
    setSending(true)
    setError("")
    try {
      const started = await runs.start(req, { turns })
      setText("")
      onSent?.(started)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
      box.current?.focus()
    }
  }

  return (
    <form
      className={`pw-composer${running ? " is-running" : ""}`}
      aria-label={session ? "Send a message" : "Start a conversation"}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {error ? (
        <p className="pw-composer__error" role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {error}
        </p>
      ) : null}
      {info && !info.found ? (
        <p className="pw-composer__warn">
          <i className="fa-solid fa-circle-info" aria-hidden="true"></i> <code>{info.cli}</code> isn't installed on the server (not found on
          PATH).
        </p>
      ) : null}
      <PromptBox
        ref={box}
        id="pwPrompt"
        value={text}
        onChange={setText}
        onSubmit={send}
        commands={commands.data}
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {used.length ? (
        <p className="pw-composer__uses">
          <i className={`fa-solid ${used[0].kind === "skill" ? "fa-wand-magic-sparkles" : "fa-terminal"}`} aria-hidden="true"></i>
          {used.map((c) => (
            <span key={c.insert} title={c.description}>
              Uses the {c.kind} <strong className={c.kind === "skill" ? "is-skill" : ""}>{c.insert}</strong>
              {c.description ? ` — ${c.description}` : ""}
            </span>
          ))}
        </p>
      ) : null}
      <div className="pw-composer__bar">
        <label className="pw-select" title="Model (configure the list in Settings)">
          <span className="pw-visually-hidden">Model</span>
          <select id="pwComposerModel" value={model} onChange={(e) => pickModel(e.target.value)} disabled={disabled}>
            <option value="">Default model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id.trim()}>
                {modelLabel(m.id.trim())} ({m.id.trim()})
              </option>
            ))}
          </select>
          <i className="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </label>
        <button type="button" className="pw-composer__chips" onClick={onOpenSettings} title="Change in Settings">
          {info?.efforts?.length ? <span className="pw-chip">{effortLabel(req.effort)}</span> : null}
        </button>
        <span className="pw-composer__spacer"></span>
        <button
          type="button"
          className={`pw-icon-btn${showCommand ? " is-open" : ""}`}
          id="pwComposerCommand"
          aria-pressed={showCommand}
          aria-controls="pwComposerPreview"
          onClick={toggleCommand}
          title="Show the pi command that will run"
        >
          <i className="fa-solid fa-code" aria-hidden="true"></i> Command
        </button>
        {running ? (
          <button type="button" className="pw-btn pw-btn--danger" id="pwStop" onClick={() => runs.stop(run.id).catch((e) => setError(e.message))}>
            <i className="fa-solid fa-stop" aria-hidden="true"></i> Stop
          </button>
        ) : (
          <button type="submit" className="pw-btn pw-btn--primary" id="pwSend" disabled={!text.trim() || sending || disabled}>
            <i className={`fa-solid ${sending ? "fa-spinner fa-spin" : "fa-paper-plane"}`} aria-hidden="true"></i> Send
          </button>
        )}
      </div>
      {showCommand && !disabled ? <CommandPreview req={{ ...req, prompt: text.trim() ? text : "Your prompt" }} id="pwComposerPreview" /> : null}
    </form>
  )
}
