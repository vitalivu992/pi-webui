import { useMemo, useState } from "react"
import { fetchSkill } from "../lib/api.js"
import { filterBy } from "../lib/views.js"
import { useFetch } from "../hooks/useFetch.js"
import { ColumnHead } from "./ColumnHead.jsx"
import { Markdown } from "./Markdown.jsx"

// Where a skill comes from: the project's .pi/.agents folders, the user's, or pi-hermes-memory.
const SOURCES = {
  project: { label: "project", title: "From the project's .pi/skills or .agents/skills" },
  user: { label: "user", title: "From ~/.pi/agent/skills or ~/.agents/skills" },
  memory: { label: "memory", title: "Saved by pi-hermes-memory" },
}

/** Second column: the skills pi loads in the project, by name. */
export function SkillList({ project, view, tabs, skills, loading, error, selectedId, onSelect, onRefresh }) {
  const [text, setText] = useState("")
  const shown = useMemo(() => filterBy(skills, text, ["name", "description"]), [skills, text])
  return (
    <section className="pw-convs" aria-label="Skills">
      <ColumnHead project={project} view={view} loading={loading} onRefresh={onRefresh} />
      {tabs}
      <div className="pw-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" placeholder="Filter by name, description" aria-label="Filter skills" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error ? <p className="pw-error">Could not load the skills: {error.message}</p> : null}
      {loading && !skills ? <p className="pw-empty">Loading skills…</p> : null}
      <ul className="pw-list" id="pwSkills">
        {shown.map((s) => (
          <li key={s.name}>
            <button
              type="button"
              className={`pw-conv${s.name === selectedId ? " is-active" : ""}`}
              aria-current={s.name === selectedId ? "true" : undefined}
              data-skill={s.name}
              onClick={() => onSelect(s.name)}
            >
              <span className="pw-conv__top">
                <span className="pw-conv__title">{s.name}</span>
                <span className={`pw-source pw-source--${s.source}`} title={SOURCES[s.source]?.title}>
                  {SOURCES[s.source]?.label || s.source}
                </span>
              </span>
              {s.description ? <span className="pw-conv__desc">{s.description}</span> : null}
            </button>
          </li>
        ))}
        {skills && !skills.length ? <li className="pw-empty">pi loads no skills in this project.</li> : null}
        {skills?.length && !shown.length ? <li className="pw-empty">No skills match.</li> : null}
      </ul>
    </section>
  )
}

/** Main column: one skill's SKILL.md, rendered. */
export function SkillView({ name, projectKey }) {
  const { data, error, loading } = useFetch((signal) => fetchSkill(name, projectKey, { signal }), [name, projectKey], { enabled: Boolean(name) })
  if (!name) {
    return (
      <div className="pw-view pw-view--empty">
        <p className="pw-empty pw-empty--center">Select a skill to read it.</p>
      </div>
    )
  }
  if (error) return <div className="pw-view pw-view--empty"><p className="pw-error">Could not load the skill: {error.message}</p></div>
  if (!data) return <div className="pw-view pw-view--empty"><p className="pw-empty pw-empty--center">{loading ? "Loading the skill…" : ""}</p></div>
  const { skill: s, body } = data
  return (
    <div className="pw-view" id="pwSkill">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title">
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> {s.name}
          </h1>
          <div className="pw-view__meta">
            <span className="pw-chip" title={SOURCES[s.source]?.title}>
              {SOURCES[s.source]?.label || s.source}
            </span>
            <span className="pw-chip pw-chip--mono" title={s.invocable ? "Type it in the prompt box" : "Marked user-invocable: false: pi uses it, the prompt box doesn't offer it"}>
              {s.invocable ? `/skill:${s.name}` : "not invocable"}
            </span>
            <span className="pw-chip pw-chip--mono" title="File">
              {s.path}
            </span>
          </div>
        </div>
      </header>
      <div className="pw-view__scroll">
        <div className="pw-doc">
          {s.description ? <p className="pw-doc__lead">{s.description}</p> : null}
          <Markdown docId={`skill-${s.name}`}>{body}</Markdown>
        </div>
      </div>
    </div>
  )
}
