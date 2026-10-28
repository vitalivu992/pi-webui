import { useEffect, useState } from "react"
import { Composer } from "./Composer.jsx"
import { PiIcon } from "./PiIcon.jsx"
import { useRuns } from "./Runs.jsx"

/**
 * The main column for a new conversation in the selected project: the model
 * and prompt. Once sent it opens the conversation at once (pi takes the new
 * session's id, so it is known before pi starts).
 */
export function NewConversation({ project, onStarted, onCancel, onOpenSettings }) {
  const runs = useRuns()
  const [runId, setRunId] = useState("")
  const run = runs.runs.find((r) => r.id === runId) || null

  useEffect(() => {
    if (run?.session) onStarted(run.session)
  }, [run?.session, onStarted])

  const cwd = project?.exists ? project.path : ""
  const disabledReason = !project
    ? "Select a project first."
    : !cwd
      ? "This project's folder doesn't exist any more: there is nowhere to run the agent."
      : ""

  return (
    <div className="pw-view pw-new" id="pwNewConversation">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title">
            <i className="fa-regular fa-pen-to-square" aria-hidden="true"></i> New conversation
          </h1>
          <div className="pw-view__meta">
            {project ? (
              <span className="pw-chip" title={project.path}>
                <i className="fa-regular fa-folder" aria-hidden="true"></i> {project.path || project.name}
              </span>
            ) : null}
          </div>
        </div>
        <div className="pw-view__actions">
          <button type="button" className="pw-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </header>
      <div className="pw-new__body">
        <div className="pw-new__intro">
          <PiIcon size={36} />
          <p className="pw-new__lead">
            What should pi do in <strong>{project?.name || "this project"}</strong>?
          </p>
          <p className="pw-new__hint">
            It runs on the server as <code>pi -p</code> and shows up in the conversation list. Type <kbd>/</kbd> for prompt templates and
            skills.
          </p>
        </div>
        <Composer
          cwd={cwd}
          disabledReason={disabledReason}
          autoFocus
          onSent={(r) => setRunId(r.id)}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  )
}
