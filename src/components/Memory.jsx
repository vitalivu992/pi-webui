import { useMemo, useState } from "react"
import { longDateTime, shortDateTime } from "../lib/format.js"
import { filterBy } from "../lib/views.js"
import { ColumnHead } from "./ColumnHead.jsx"
import { Markdown } from "./Markdown.jsx"

const STORE_ICONS = {
  project: "fa-solid fa-folder-open",
  "project-failures": "fa-solid fa-triangle-exclamation",
  memory: "fa-solid fa-brain",
  user: "fa-regular fa-user",
  failures: "fa-solid fa-triangle-exclamation",
  standing: "fa-solid fa-thumbtack",
}

/** Second column: pi-hermes-memory's stores, the project's first (`memory`: `{ project, stores }`). */
export function MemoryList({ project, view, tabs, memory, loading, error, selectedId, onSelect, onRefresh }) {
  const stores = memory?.stores
  return (
    <section className="pw-convs" aria-label="Memory">
      <ColumnHead project={project} view={view} loading={loading} onRefresh={onRefresh} />
      {tabs}
      {memory && !memory.project ? <p className="pw-note">This folder has no project memory: only the global stores apply.</p> : null}
      {error ? <p className="pw-error">Could not load the memory: {error.message}</p> : null}
      {loading && !memory ? <p className="pw-empty">Loading memory…</p> : null}
      <ul className="pw-list" id="pwMemoryStores">
        {(stores || []).map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`pw-conv${s.id === selectedId ? " is-active" : ""}${s.entries.length ? "" : " is-disabled"}`}
              aria-current={s.id === selectedId ? "true" : undefined}
              data-store={s.id}
              onClick={() => onSelect(s.id)}
            >
              <span className="pw-conv__top">
                <i className={`${STORE_ICONS[s.id] || "fa-solid fa-brain"} pw-conv__icon`} aria-hidden="true"></i>
                <span className="pw-conv__title">{s.title}</span>
                <span className="pw-count">{s.entries.length}</span>
              </span>
              <span className="pw-conv__meta">
                <span className="pw-conv__agent">{s.scope === "project" ? `project ${memory.project}` : "all projects"}</span>
                {s.updatedAt ? (
                  <time className="pw-conv__when" dateTime={s.updatedAt} title={`Updated ${longDateTime(s.updatedAt)}`}>
                    {shortDateTime(s.updatedAt)}
                  </time>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Main column: one store's entries, filterable. */
export function MemoryView({ store, loading }) {
  const [text, setText] = useState("")
  const entries = useMemo(() => filterBy(store?.entries, text, ["text", "category", "project"]), [store, text])
  if (!store) {
    return (
      <div className="pw-view pw-view--empty">
        <p className="pw-empty pw-empty--center">{loading ? "Loading memory…" : "Select a memory store to read it."}</p>
      </div>
    )
  }
  return (
    <div className="pw-view" id="pwMemory">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title">
            <i className={STORE_ICONS[store.id] || "fa-solid fa-brain"} aria-hidden="true"></i> {store.title}
          </h1>
          <div className="pw-view__meta">
            <span className="pw-chip">{store.scope === "project" ? "Project" : "Global"}</span>
            <span className="pw-chip">{store.entries.length} entries</span>
            {store.updatedAt ? <span className="pw-chip">updated {longDateTime(store.updatedAt)}</span> : null}
            <span className="pw-chip pw-chip--mono" title="File">
              {store.path}
            </span>
          </div>
        </div>
      </header>
      <div className="pw-view__scroll">
        <div className="pw-doc">
          {store.entries.length > 3 ? (
            <div className="pw-search pw-search--doc">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input type="search" placeholder="Filter entries" aria-label="Filter entries" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          ) : null}
          <ol className="pw-memory" id="pwMemoryEntries">
            {entries.map((e, i) => (
              <li key={i} className="pw-memory__entry">
                {e.category || e.project ? (
                  <div className="pw-memory__tags">
                    {e.category ? <span className={`pw-chip pw-memory__cat pw-memory__cat--${e.category}`}>{e.category}</span> : null}
                    {e.project && store.scope !== "project" ? <span className="pw-chip">project {e.project}</span> : null}
                  </div>
                ) : null}
                <Markdown className="pw-memory__text">{e.text}</Markdown>
                {e.created ? (
                  <div className="pw-memory__dates">
                    created {e.created}
                    {e.last && e.last !== e.created ? ` · last used ${e.last}` : ""}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {!store.entries.length ? <p className="pw-empty">Nothing remembered here yet.</p> : null}
          {store.entries.length && !entries.length ? <p className="pw-empty">No entries match.</p> : null}
        </div>
      </div>
    </div>
  )
}
