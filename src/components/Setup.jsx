import { useState } from "react"
import { fetchSetupItem } from "../lib/api.js"
import { groupItems, insertFor, kindMeta, packageItems, packageOf, sourceBadge } from "../lib/setup.js"
import { useFetch } from "../hooks/useFetch.js"
import { ColumnHead } from "./ColumnHead.jsx"
import { Markdown } from "./Markdown.jsx"

function SourceBadge({ item }) {
  const b = sourceBadge(item)
  return (
    <span className={`pw-source${b.tone ? ` pw-source--${b.tone}` : ""}`} title={b.title}>
      {b.label}
    </span>
  )
}

/** Second column: what pi loads in the project, grouped by kind. */
export function SetupList({ project, view, tabs, setup, loading, error, selectedId, onSelect, onRefresh }) {
  const [text, setText] = useState("")
  const groups = groupItems(setup?.items, text)
  return (
    <section className="pw-convs" aria-label="Setup">
      <ColumnHead project={project} view={view} loading={loading} onRefresh={onRefresh} />
      {tabs}
      <div className="pw-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" placeholder="Filter by name, description, package" aria-label="Filter the setup" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error ? <p className="pw-error">Could not load the setup: {error.message}</p> : null}
      {loading && !setup ? <p className="pw-empty">Loading the setup…</p> : null}
      {setup?.error ? (
        <p className="pw-note" id="pwSetupScan" title={setup.error}>
          <i className="fa-solid fa-circle-info" aria-hidden="true"></i> Only the skills and prompts in pi's folders: {setup.error}.
        </p>
      ) : null}
      {setup?.failures?.length ? (
        <p className="pw-note pw-tone--attention">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Not installed, so not loaded:{" "}
          {setup.failures.map((f) => f.source).join(", ")}
        </p>
      ) : null}
      <div className="pw-list" id="pwSetup">
        {groups.map((g) => (
          <section key={g.id} className="pw-group" data-kind={g.id}>
            <h2 className="pw-group__head">
              <i className={g.icon} aria-hidden="true"></i> {g.label} <span className="pw-group__count">{g.items.length}</span>
            </h2>
            <ul className="pw-group__items">
              {g.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className={`pw-conv${it.id === selectedId ? " is-active" : ""}${it.enabled ? "" : " is-disabled"}`}
                    aria-current={it.id === selectedId ? "true" : undefined}
                    data-item={it.id}
                    onClick={() => onSelect(it.id)}
                  >
                    <span className="pw-conv__top">
                      <span className="pw-conv__title">{it.name}</span>
                      {it.enabled ? null : <span className="pw-conv__when">{it.kind === "package" ? "not installed" : "disabled"}</span>}
                      <SourceBadge item={it} />
                    </span>
                    {it.description ? <span className="pw-conv__desc">{it.description}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {setup && !setup.items.length ? <p className="pw-empty">pi loads nothing extra in this project.</p> : null}
        {setup?.items.length && !groups.length ? <p className="pw-empty">Nothing matches.</p> : null}
      </div>
    </section>
  )
}

function ItemLink({ item, onSelect }) {
  const k = kindMeta(item.kind)
  return (
    <button type="button" className="pw-link-btn" data-item={item.id} onClick={() => onSelect(item.id)}>
      <i className={k.icon} aria-hidden="true"></i> {item.name}
    </button>
  )
}

/** Main column: one item, with its SKILL.md, prompt or README rendered. */
export function SetupView({ id, projectKey, setup, onSelect }) {
  const item = setup?.items.find((it) => it.id === id)
  const { data, error, loading } = useFetch((signal) => fetchSetupItem(id, projectKey, { signal }), [id, projectKey], { enabled: Boolean(item) })
  if (!id || (setup && !item)) {
    return (
      <div className="pw-view pw-view--empty">
        <p className="pw-empty pw-empty--center">{id ? "pi doesn't load that here." : "Select a package, extension, skill or prompt to read about it."}</p>
      </div>
    )
  }
  if (!item) return <div className="pw-view pw-view--empty"><p className="pw-empty pw-empty--center">Loading…</p></div>
  const k = kindMeta(item.kind)
  const pkg = packageOf(setup.items, item)
  const ships = item.kind === "package" ? packageItems(setup.items, item) : []
  const insert = insertFor(item)
  return (
    <div className="pw-view" id="pwSetupItem">
      <header className="pw-view__head">
        <div className="pw-view__titles">
          <h1 className="pw-view__title">
            <i className={k.icon} aria-hidden="true"></i> {item.name}
          </h1>
          <div className="pw-view__meta">
            <span className="pw-chip">{k.one}</span>
            <SourceBadge item={item} />
            {item.version ? <span className="pw-chip pw-chip--mono">v{item.version}</span> : null}
            {item.enabled ? null : <span className="pw-chip">{item.kind === "package" ? "not installed" : "disabled"}</span>}
            {insert ? (
              <span className="pw-chip pw-chip--mono" title="Type it in the prompt box">
                {insert}
              </span>
            ) : null}
            {item.manual ? <span className="pw-chip" title="disable-model-invocation: pi loads it only when you type it">manual only</span> : null}
            {item.filtered ? <span className="pw-chip" title="The settings pick which of its resources load">filtered</span> : null}
            {item.path ? (
              <span className="pw-chip pw-chip--mono" title="Path">
                {item.path}
              </span>
            ) : null}
            {item.homepage ? (
              <a className="pw-chip" href={item.homepage} target="_blank" rel="noreferrer">
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Homepage
              </a>
            ) : null}
          </div>
        </div>
      </header>
      <div className="pw-view__scroll">
        <div className="pw-doc">
          {item.description ? <p className="pw-doc__lead">{item.description}</p> : null}
          {pkg ? (
            <p className="pw-doc__note">
              From the package <ItemLink item={pkg} onSelect={onSelect} />
            </p>
          ) : null}
          {item.kind === "package" ? (
            <>
              <h2 className="pw-doc__heading">Ships</h2>
              {ships.length ? (
                <ul className="pw-ships" id="pwSetupShips">
                  {ships.map((it) => (
                    <li key={it.id}>
                      <span className="pw-ships__kind">{kindMeta(it.kind).one}</span> <ItemLink item={it} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pw-doc__note">{item.enabled ? "Nothing pi loads here." : "pi installs it on its next start."}</p>
              )}
            </>
          ) : null}
          {error ? <p className="pw-error">Could not load it: {error.message}</p> : null}
          {loading && !data ? <p className="pw-doc__note">Loading…</p> : null}
          {data?.body ? (
            <>
              {item.kind === "package" ? <h2 className="pw-doc__heading">README</h2> : null}
              <Markdown docId={`setup-${item.id}`}>{data.body}</Markdown>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
