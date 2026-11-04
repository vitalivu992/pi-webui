import { useMemo, useState } from "react"
import { fetchCronRun, fetchCronTask } from "../lib/api.js"
import { duration, longDateTime, plural, shortDateTime } from "../lib/format.js"
import { listPollDelay } from "../lib/live.js"
import { filterBy, runStatusMeta, scheduleLabel } from "../lib/views.js"
import { useFetch } from "../hooks/useFetch.js"
import { ColumnHead } from "./ColumnHead.jsx"
import { Transcript } from "./ConversationView.jsx"
import { Markdown } from "./Markdown.jsx"

const taskTitle = (t) => t.name || t.prompt.split("\n")[0] || t.id

function RunStatus({ status }) {
  const meta = runStatusMeta(status)
  return <i className={`${meta.icon} pw-run-status pw-tone--${meta.tone}`} title={meta.label} aria-label={meta.label} role="img"></i>
}

/** Second column: the agents-cron tasks bound to the project. */
export function CronList({ project, view, tabs, tasks, loading, error, selectedId, onSelect, onRefresh }) {
  const [text, setText] = useState("")
  const shown = useMemo(() => filterBy(tasks, text, ["name", "prompt", "id"]), [tasks, text])
  return (
    <section className="pw-convs" aria-label="Cron jobs">
      <ColumnHead project={project} view={view} loading={loading} onRefresh={onRefresh} />
      {tabs}
      <div className="pw-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" placeholder="Filter by name, prompt" aria-label="Filter cron jobs" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error ? <p className="pw-error">Could not load the cron jobs: {error.message}</p> : null}
      {loading && !tasks ? <p className="pw-empty">Loading cron jobs…</p> : null}
      <ul className="pw-list" id="pwCronTasks">
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`pw-conv${t.id === selectedId ? " is-active" : ""}${t.enabled ? "" : " is-disabled"}`}
              aria-current={t.id === selectedId ? "true" : undefined}
              data-task={t.id}
              onClick={() => onSelect(t.id)}
            >
              <span className="pw-conv__top">
                <span className="pw-conv__title">{taskTitle(t)}</span>
                <RunStatus status={t.lastStatus} />
              </span>
              <span className="pw-conv__meta">
                <span className="pw-conv__agent">
                  <i className="fa-regular fa-clock" aria-hidden="true"></i> {scheduleLabel(t.schedule)}
                </span>
                {t.enabled ? (
                  t.nextRunAt ? (
                    <time className="pw-conv__when" dateTime={t.nextRunAt} title={`Next run ${longDateTime(t.nextRunAt)}`}>
                      next {shortDateTime(t.nextRunAt)}
                    </time>
                  ) : null
                ) : (
                  <span className="pw-conv__when">disabled</span>
                )}
              </span>
            </button>
          </li>
        ))}
        {tasks && !tasks.length ? (
          <li className="pw-empty">
            No cron jobs in this project. Schedule one from pi with <code>/loop</code>, <code>/remind</code> or <code>/schedule</code>.
          </li>
        ) : null}
        {tasks?.length && !shown.length ? <li className="pw-empty">No cron jobs match.</li> : null}
      </ul>
    </section>
  )
}

/** Main column: a task, its prompt and its runs; or one run (`runId`) with its transcript. */
export function CronView({ taskId, runId, onSelectRun }) {
  if (!taskId) {
    return (
      <div className="pw-view pw-view--empty">
        <p className="pw-empty pw-empty--center">Select a cron job to see its runs.</p>
      </div>
    )
  }
  return runId ? <CronRun key={runId} taskId={taskId} runId={runId} onBack={() => onSelectRun("")} /> : <CronTask key={taskId} id={taskId} onSelectRun={onSelectRun} />
}

function CronTask({ id, onSelectRun }) {
  const { data, error, loading } = useFetch((signal) => fetchCronTask(id, { signal }), [id], {
    poll: (d) => listPollDelay(d?.runs?.some((r) => r.status === "running")),
  })
  if (error) return <div className="pw-view pw-view--empty"><p className="pw-error">Could not load the cron job: {error.message}</p></div>
  if (!data) return <div className="pw-view pw-view--empty"><p className="pw-empty pw-empty--center">{loading ? "Loading the cron job…" : ""}</p></div>
  const { task: t, runs } = data
  return (
    <div className="pw-view" id="pwCronTask">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title" title={taskTitle(t)}>
            <i className="fa-regular fa-clock" aria-hidden="true"></i> {taskTitle(t)}
          </h1>
          <div className="pw-view__meta">
            <span className="pw-chip">{scheduleLabel(t.schedule)}</span>
            <span className={`pw-chip${t.enabled ? " pw-chip--live" : ""}`}>{t.enabled ? "Enabled" : "Disabled"}</span>
            {t.enabled && t.nextRunAt ? (
              <span className="pw-chip" title="Next run">
                next {longDateTime(t.nextRunAt)}
              </span>
            ) : null}
            {t.agent ? <span className="pw-chip">{t.agent}</span> : null}
            {t.model ? <span className="pw-chip">{t.model}</span> : null}
            {t.thinking ? <span className="pw-chip">thinking {t.thinking}</span> : null}
            <span className="pw-chip" title="Runs that succeeded / failed / were missed">
              {t.successCount || 0} ok · {t.errorCount || 0} failed · {t.missedCount || 0} missed
            </span>
            <span className="pw-chip pw-chip--mono" title="Task id">
              {t.id}
            </span>
          </div>
        </div>
      </header>
      <div className="pw-view__scroll">
        <div className="pw-doc">
          <h2 className="pw-doc__heading">Prompt</h2>
          <pre className="pw-code pw-doc__prompt">{t.prompt}</pre>
          {t.cwd ? (
            <p className="pw-doc__note">
              Runs in <code>{t.cwd}</code>
            </p>
          ) : null}
          <h2 className="pw-doc__heading">Runs</h2>
          {runs.length ? (
            <ul className="pw-runs" id="pwCronRuns">
              {runs.map((r) => (
                <li key={r.runId}>
                  <button type="button" className="pw-runs__row" data-run={r.runId} onClick={() => onSelectRun(r.runId)}>
                    <RunStatus status={r.status} />
                    <time dateTime={r.startedAt} title={longDateTime(r.startedAt)}>
                      {shortDateTime(r.startedAt)}
                    </time>
                    <span className="pw-runs__trigger">{r.trigger}</span>
                    <span className="pw-runs__took">{duration(r.startedAt, r.finishedAt)}</span>
                    <span className="pw-runs__summary">{(r.error || r.summary || "").split("\n")[0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pw-empty">No runs yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CronRun({ taskId, runId, onBack }) {
  const { data, error, loading } = useFetch((signal) => fetchCronRun(taskId, runId, { signal }), [taskId, runId], {
    poll: (d) => (d?.run?.status === "running" ? 4000 : 0),
  })
  const [expandAll, setExpandAll] = useState(false)
  const back = (
    <button type="button" className="pw-btn pw-btn--small" onClick={onBack} id="pwCronBack">
      <i className="fa-solid fa-arrow-left" aria-hidden="true"></i> All runs
    </button>
  )
  if (error) return <div className="pw-view pw-view--empty"><p className="pw-error">Could not load the run: {error.message}</p>{back}</div>
  if (!data) return <div className="pw-view pw-view--empty"><p className="pw-empty pw-empty--center">{loading ? "Loading the run…" : ""}</p></div>
  const { task: t, run: r, conversation: c } = data
  const meta = runStatusMeta(r.status)
  return (
    <div className="pw-view" id="pwCronRun">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title" title={taskTitle(t)}>
            <RunStatus status={r.status} /> {taskTitle(t)}
          </h1>
          <div className="pw-view__meta">
            <span className={`pw-chip pw-tone--${meta.tone}`}>{meta.label}</span>
            <span className="pw-chip" title={`Started ${longDateTime(r.startedAt)}${r.finishedAt ? `\nFinished ${longDateTime(r.finishedAt)}` : ""}`}>
              <i className="fa-regular fa-clock" aria-hidden="true"></i> {longDateTime(r.startedAt)}
            </span>
            {r.finishedAt ? <span className="pw-chip">took {duration(r.startedAt, r.finishedAt)}</span> : null}
            <span className="pw-chip">{r.trigger}</span>
            {r.exitCode != null ? <span className="pw-chip">exit {r.exitCode}</span> : null}
            {r.agent ? <span className="pw-chip">{r.agent}</span> : null}
            {c ? <span className="pw-chip">{plural(c.turns, "prompt")} · {plural(c.toolCalls, "tool call")}</span> : null}
            <span className="pw-chip pw-chip--mono" title="Run id">
              {r.runId}
            </span>
          </div>
        </div>
        <div className="pw-view__actions">
          {c ? (
            <button type="button" className="pw-btn" aria-pressed={expandAll} onClick={() => setExpandAll(!expandAll)}>
              <i className={`fa-solid ${expandAll ? "fa-compress" : "fa-expand"}`} aria-hidden="true"></i>
              {expandAll ? "Hide work" : "Show work"}
            </button>
          ) : null}
          {back}
        </div>
      </header>
      <div className="pw-view__scroll">
        <div className="pw-doc">
          {r.error ? (
            <>
              <h2 className="pw-doc__heading">Error</h2>
              <pre className="pw-code pw-code--output is-error">{r.error}</pre>
            </>
          ) : null}
          {r.summary ? (
            <>
              <h2 className="pw-doc__heading">Summary</h2>
              <Markdown>{r.summary}</Markdown>
            </>
          ) : null}
          {!r.error && !r.summary && data.report ? <Markdown>{data.report}</Markdown> : null}
          {c ? <h2 className="pw-doc__heading">Transcript</h2> : null}
        </div>
        {c ? (
          <div className="pw-chat" id="pwChat">
            <Transcript entries={c.entries} expandAll={expandAll} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
