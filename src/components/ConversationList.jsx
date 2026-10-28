import { useMemo, useState } from "react"
import { longDateTime, modelLabel, plural, relativeTime, shortDateTime, statusMeta } from "../lib/format.js"
import { liveState } from "../lib/live.js"
import { LiveIcon } from "./Running.jsx"

/** Conversations whose title, id, branch or model contains `text`. */
export function filterConversations(conversations, text = "") {
  const needle = String(text || "").trim().toLowerCase()
  return (conversations || []).filter((c) => {
    if (!needle) return true
    return [c.title, c.id, c.gitBranch, ...(c.models || []).map(modelLabel)].some((v) =>
      String(v || "").toLowerCase().includes(needle)
    )
  })
}

/**
 * Second column: the selected project's conversations, newest first. The ones an agent is
 * working on, or has just finished, carry a live icon. "New" starts a conversation with
 * pi in the project's folder.
 */
export function ConversationList({ project, conversations, loading, error, selectedId, onSelect, onRefresh, onNew, creating = false }) {
  const [text, setText] = useState("")
  const shown = useMemo(() => filterConversations(conversations, text), [conversations, text])

  if (!project) {
    return (
      <section className="pw-convs" aria-label="Conversations">
        <p className="pw-empty pw-empty--center">Select a project.</p>
      </section>
    )
  }

  return (
    <section className="pw-convs" aria-label="Conversations">
      <header className="pw-panel-head">
        <div className="pw-convs__project" title={project.path}>
          <span className="pw-convs__name">{project.name}</span>
          {project.path ? (
            <span className="pw-convs__path">
              <bdi>{project.path}</bdi>
            </span>
          ) : null}
        </div>
        <div className="pw-panel-head__actions">
          <button type="button" className="pw-icon-btn" onClick={onRefresh} title="Reload" aria-label="Reload conversations">
            <i className={`fa-solid fa-rotate${loading ? " fa-spin" : ""}`} aria-hidden="true"></i>
          </button>
          <button
            type="button"
            className={`pw-icon-btn pw-new-btn${creating ? " is-open" : ""}`}
            id="pwNewConversationBtn"
            onClick={() => onNew?.()}
            disabled={!project.exists}
            title={project.exists ? `New conversation in ${project.name}` : "The project's folder doesn't exist any more"}
            aria-label="New conversation"
          >
            <i className="fa-regular fa-pen-to-square" aria-hidden="true"></i>
          </button>
        </div>
      </header>
      <div className="pw-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input
          type="search"
          placeholder="Filter by title, model, branch"
          aria-label="Filter conversations"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {error ? <p className="pw-error">Could not load conversations: {error.message}</p> : null}
      {loading && !conversations ? <p className="pw-empty">Loading conversations…</p> : null}
      <ul className="pw-list" id="pwConversations">
        {shown.map((c) => {
          const key = c.id
          const model = modelLabel(c.models?.[c.models.length - 1])
          const live = liveState(c)
          return (
            <li key={key}>
              <button
                type="button"
                className={`pw-conv${key === selectedId ? " is-active" : ""}${c.status === "error" ? " is-error" : ""}${live ? ` is-${live}` : ""}`}
                aria-current={key === selectedId ? "true" : undefined}
                data-conversation={key}
                onClick={() => onSelect(key)}
              >
                <span className="pw-conv__top">
                  <span className="pw-conv__title">{c.title}</span>
                  <LiveIcon state={live} title={live === "finished" ? "The agent just finished" : "The agent is working"} />
                  {c.status === "error" ? (
                    <i
                      className="fa-solid fa-circle-exclamation pw-conv__issue"
                      title={statusMeta("error").label}
                      aria-label={statusMeta("error").label}
                      role="img"
                    ></i>
                  ) : null}
                </span>
                <span className="pw-conv__meta">
                  <span className="pw-conv__agent" title={c.models?.[c.models.length - 1] || "pi"}>
                    {model || "pi"}
                  </span>
                  <span title={`${plural(c.turns, "prompt")}, ${plural(c.toolCalls, "tool call")}`}>
                    <i className="fa-regular fa-comment" aria-hidden="true"></i> {c.turns}
                    <i className="fa-solid fa-wrench pw-conv__tools" aria-hidden="true"></i> {c.toolCalls}
                  </span>
                  <time
                    className="pw-conv__when"
                    dateTime={c.updatedAt}
                    title={`Started ${longDateTime(c.startedAt)}\nUpdated ${longDateTime(c.updatedAt)} (${relativeTime(c.updatedAt)})`}
                  >
                    {shortDateTime(c.updatedAt)}
                  </time>
                </span>
              </button>
            </li>
          )
        })}
        {conversations && !shown.length ? <li className="pw-empty">No conversations match.</li> : null}
      </ul>
    </section>
  )
}
