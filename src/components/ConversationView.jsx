import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { copyText } from "../lib/clipboard.js"
import { agentLabel, clockTime, duration, longDateTime, plural, statusMeta, tokenCount, tokenPct } from "../lib/format.js"
import { atBottom, isWorking } from "../lib/live.js"
import { Composer } from "./Composer.jsx"
import { PiIcon } from "./PiIcon.jsx"
import { Markdown } from "./Markdown.jsx"
import { ResumeButton } from "./ResumeButton.jsx"
import { RunningBar, WorkingWord } from "./Running.jsx"
import { StatusIcon } from "./StatusIcon.jsx"
import { Step } from "./Step.jsx"

/** "14 tool calls · 3 thoughts · 2 notes" for a turn's steps. */
export function workSummary(steps) {
  const n = { tool: 0, thinking: 0, text: 0 }
  for (const s of steps || []) n[s.kind] = (n[s.kind] || 0) + 1
  return [
    n.tool && plural(n.tool, "tool call"),
    n.thinking && plural(n.thinking, "thought"),
    n.text && plural(n.text, "note"),
  ]
    .filter(Boolean)
    .join(" · ")
}

function UserMessage({ entry }) {
  const [open, setOpen] = useState(false)
  if (!entry.prompt) return null
  const long = entry.prompt.length > 1200 || entry.prompt.split("\n").length > 18
  return (
    <div className="pw-msg pw-msg--user">
      <div className="pw-msg__meta">
        <span className="pw-msg__who">You</span>
        {entry.promptAt ? (
          <time dateTime={entry.promptAt} title={longDateTime(entry.promptAt)}>
            {clockTime(entry.promptAt)}
          </time>
        ) : null}
      </div>
      <div className={`pw-bubble pw-bubble--user${long && !open ? " is-clamped" : ""}`}>{entry.prompt}</div>
      {long ? (
        <button type="button" className="pw-link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </div>
  )
}

/** A prompt sent from here that the transcript doesn't have yet. */
function PendingMessage({ run }) {
  return (
    <div className="pw-turn pw-turn--pending" id="pwPending">
      <div className="pw-msg pw-msg--user">
        <div className="pw-msg__meta">
          <span className="pw-msg__who">You</span>
          <span className="pw-msg__sending">Sent</span>
        </div>
        <div className="pw-bubble pw-bubble--user">{run.prompt}</div>
      </div>
      <p className="pw-turn-status pw-turn-status--live">
        <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Waiting for the agent…
      </p>
    </div>
  )
}

/** How the last prompt sent from here failed, until dismissed. */
function RunError({ run, onDismiss }) {
  return (
    <div className="pw-run-error" role="alert" id="pwRunError">
      <p>
        <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> The prompt failed
        {run.exitCode ? ` (exit code ${run.exitCode})` : ""}.
        <button type="button" className="pw-link-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </p>
      <pre className="pw-code">{run.error}</pre>
    </div>
  )
}

/** Under the final answer: copies its markdown source; shown while the footer is hovered. */
function AnswerFooter({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <div className="pw-msg__foot">
      <button type="button" className="pw-copy-btn" onClick={copy} title="Copy the answer as markdown">
        <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true"></i> {copied ? "Copied" : "Copy as markdown"}
      </button>
    </div>
  )
}

/** `live`: the turn the agent is still working on. */
function AssistantMessage({ entry, index, expandAll, live }) {
  const [open, setOpen] = useState(expandAll)
  useEffect(() => setOpen(expandAll), [expandAll])
  const steps = entry.steps || []
  const took = duration(entry.promptAt, entry.endedAt)
  const status = entry.status || "done"
  if (!steps.length && !entry.final && status === "done" && !live) return null
  return (
    <div className="pw-msg pw-msg--agent" data-turn={index}>
      <div className="pw-avatar" aria-hidden="true">
        <PiIcon size={18} />
      </div>
      <div className="pw-msg__main">
        <div className="pw-msg__meta">
          <span className="pw-msg__who">{agentLabel(entry.model)}</span>
          {entry.effort ? (
            <span className="pw-effort" title="Thinking effort">
              {entry.effort}
            </span>
          ) : null}
          {entry.endedAt ? (
            <time dateTime={entry.endedAt} title={longDateTime(entry.endedAt)}>
              {clockTime(entry.endedAt)}
            </time>
          ) : null}
        </div>
        {steps.length ? (
          <div className={`pw-work${open ? " is-open" : ""}`}>
            <button type="button" className="pw-work__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <i className={`fa-solid fa-chevron-right pw-work__chev${open ? " is-open" : ""}`} aria-hidden="true"></i>
              <span>{live ? (took ? `Working for ${took}` : "Working") : took ? `Worked for ${took}` : "Work details"}</span>
              <span className="pw-work__summary">{workSummary(steps)}</span>
            </button>
            {open ? (
              <ol className="pw-steps" aria-label="Work details">
                {steps.map((step, i) => (
                  <Step key={i} step={step} />
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        {entry.final ? (
          <div className="pw-bubble pw-bubble--agent">
            <Markdown docId={`turn-${index}`}>{entry.final}</Markdown>
          </div>
        ) : null}
        {entry.final && !live ? <AnswerFooter text={entry.final} /> : null}
        {live ? (
          <p className="pw-turn-status pw-turn-status--live">
            <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> <WorkingWord />
          </p>
        ) : status !== "done" ? (
          <p className={`pw-turn-status pw-turn-status--${status}`}>
            <StatusIcon status={status} /> {statusMeta(status).label}
            {entry.error ? <span className="pw-turn-status__error">: {entry.error}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function EventRow({ entry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pw-event">
      <button
        type="button"
        className="pw-event__pill"
        disabled={!entry.detail}
        aria-expanded={entry.detail ? open : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span>{entry.text}</span>
        {entry.at ? <time dateTime={entry.at}>{clockTime(entry.at)}</time> : null}
        {entry.detail ? <i className={`fa-solid fa-chevron-down pw-event__chev${open ? " is-open" : ""}`} aria-hidden="true"></i> : null}
      </button>
      {open && entry.detail ? <pre className="pw-code pw-event__detail">{entry.detail}</pre> : null}
    </div>
  )
}

/** Multi-line tooltip for the tokens chip: every count and its share of the total. */
function tokensTitle(t) {
  const row = (label, n) => `${label}: ${Number(n).toLocaleString()} (${tokenPct(n, t.total)})`
  return [
    row("Input", t.input),
    row("Output", t.output),
    row("Cache read", t.cacheRead),
    row("Cache write", t.cacheWrite),
    row("Reasoning", t.reasoning),
    t.cost ? `Cost: $${t.cost.toFixed(4)}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

function Header({ conversation, working, expandAll, onExpandAll }) {
  const c = conversation
  const models = (c.models || []).length ? c.models : [""]
  return (
    <header className="pw-view__head">
      <div className="pw-view__titles">
        <h1 className="pw-view__title" title={c.title}>
          {c.active ? null : <StatusIcon status={c.status} />} {c.title}
        </h1>
        <div className="pw-view__meta">
          {models.map((m) => (
            <span key={m} className="pw-chip">
              <PiIcon size={12} /> {agentLabel(m)}
            </span>
          ))}
          {c.active && !working ? (
            <span className="pw-chip pw-chip--live" title="Updates as pi writes to the session file">
              <i className="fa-solid fa-tower-broadcast" aria-hidden="true"></i> Live
            </span>
          ) : null}
          {c.gitBranch ? (
            <span className="pw-chip" title="Git branch">
              <i className="fa-solid fa-code-branch" aria-hidden="true"></i> {c.gitBranch}
            </span>
          ) : null}
          <span className="pw-chip" title={`Started ${longDateTime(c.startedAt)}\nUpdated ${longDateTime(c.updatedAt)}`}>
            <i className="fa-regular fa-clock" aria-hidden="true"></i> {longDateTime(c.startedAt || c.updatedAt)}
          </span>
          <span className="pw-chip">
            {plural(c.turns, "prompt")} · {plural(c.toolCalls, "tool call")}
          </span>
          {c.tokens?.total ? (
            <span className="pw-chip pw-chip--mono" title={tokensTitle(c.tokens)}>
              <i className="fa-solid fa-coins" aria-hidden="true"></i>
              {`in ${tokenCount(c.tokens.input)} ${tokenPct(c.tokens.input, c.tokens.total)} · out ${tokenCount(c.tokens.output)} ${tokenPct(c.tokens.output, c.tokens.total)} · cache ${tokenCount(c.tokens.cacheRead + c.tokens.cacheWrite)} ${tokenPct(c.tokens.cacheRead + c.tokens.cacheWrite, c.tokens.total)}`}
            </span>
          ) : null}
          <span className="pw-chip pw-chip--mono" title="Session id">
            {c.id}
          </span>
        </div>
      </div>
      <div className="pw-view__actions">
        <button
          type="button"
          className="pw-btn"
          id="pwExpandAll"
          aria-pressed={expandAll}
          onClick={() => onExpandAll(!expandAll)}
          title="Show or hide the tool calls and thinking of every answer"
        >
          <i className={`fa-solid ${expandAll ? "fa-compress" : "fa-expand"}`} aria-hidden="true"></i>
          {expandAll ? "Hide work" : "Show work"}
        </button>
        <ResumeButton conversation={c} />
      </div>
      {working ? <RunningBar /> : null}
    </header>
  )
}

/** Why a prompt can't be sent to the conversation from here, or "". */
function composerBlocked(c, ours) {
  if (isWorking(c) && !ours) return "The agent is working on this conversation elsewhere: wait for it to finish."
  return ""
}

/**
 * Main column: the conversation as a chat, work details collapsed by default,
 * and the prompt box under it. While the agent is working the work is shown,
 * and the chat follows new messages when it is scrolled to the bottom; once
 * the turn ends the work collapses and the final answer is left. `run` is the
 * newest prompt sent from here (`sentTurns`: the turns there were then).
 */
export function ConversationView({ conversation, loading, error, run = null, sentTurns = 0, onDismissRun, onOpenSettings }) {
  const running = Boolean(run?.running)
  const working = isWorking(conversation) || running
  const [expandAll, setExpandAll] = useState(working)
  useEffect(() => setExpandAll(working), [conversation?.id, working])

  const scrollRef = useRef(null)
  const follow = useRef(false)
  const shownId = useRef("")
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !conversation) return
    const opened = shownId.current !== conversation.id
    shownId.current = conversation.id
    if ((opened && working) || (!opened && follow.current)) el.scrollTop = el.scrollHeight
    follow.current = atBottom(el)
  }, [conversation, working, expandAll])

  const failed = run && !run.running && run.error && !run.stopped ? run : null
  if (error && !failed) return <div className="pw-view pw-view--empty"><p className="pw-error">Could not load the conversation: {error.message}</p></div>
  if (!conversation) {
    // A new conversation whose transcript isn't written yet (or whose CLI failed first).
    if (run) {
      return (
        <div className="pw-view">
          <div className="pw-view__scroll" id="pwChat">
            <div className="pw-chat">
              {running ? <PendingMessage run={run} /> : null}
              {failed ? <RunError run={failed} onDismiss={() => onDismissRun?.(failed.id)} /> : null}
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="pw-view pw-view--empty">
        <p className="pw-empty pw-empty--center">
          {loading ? "Loading conversation…" : "Select a conversation to read it."}
        </p>
      </div>
    )
  }
  const c = conversation
  const pending = running && c.turns <= sentTurns
  const onSent = () => {
    follow.current = true
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }
  return (
    <div className="pw-view" aria-busy={loading || undefined}>
      <Header conversation={c} working={working} expandAll={expandAll} onExpandAll={setExpandAll} />
      <div className="pw-view__scroll" id="pwChat" ref={scrollRef} onScroll={(e) => (follow.current = atBottom(e.currentTarget))}>
        <div className="pw-chat">
          {c.entries.map((entry, i) =>
            entry.kind === "event" ? (
              <EventRow key={i} entry={entry} />
            ) : (
              <div key={i} className="pw-turn">
                <UserMessage entry={entry} />
                <AssistantMessage
                  entry={entry}
                  index={i}
                  expandAll={expandAll}
                  live={working && !pending && i === c.entries.length - 1}
                />
              </div>
            )
          )}
          {!c.entries.length && !pending ? <p className="pw-empty pw-empty--center">This conversation has no messages.</p> : null}
          {pending ? <PendingMessage run={run} /> : null}
          {failed ? <RunError run={failed} onDismiss={() => onDismissRun?.(failed.id)} /> : null}
        </div>
      </div>
      <div className="pw-view__composer">
        <Composer
          key={c.id}
          cwd={c.cwd || c.projectPath}
          session={c.id}
          turns={c.turns}
          run={running ? run : null}
          disabledReason={composerBlocked(c, running)}
          onSent={onSent}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  )
}
