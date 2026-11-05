import { useState } from "react"
import { fetchFiles, fetchGit } from "../lib/api.js"
import { plural } from "../lib/format.js"
import { readPrefs, writePref } from "../lib/prefs.js"
import { GIT_STATUS, changeCount, fileSize, gitGroups, joinPath, splitPath } from "../lib/workspace.js"
import { useFetch } from "../hooks/useFetch.js"

const TABS = [
  { id: "files", label: "Files", icon: "fa-regular fa-folder" },
  { id: "git", label: "Git", icon: "fa-solid fa-code-branch" },
]

/**
 * The right-hand column: the selected project's folder as a tree, and its git
 * status the way VS Code's Source Control lists it (merge, staged, changes;
 * status letter and +/- lines per file). Collapses to a rail of the two tabs'
 * icons; the git icon carries the number of changed files.
 */
export function WorkspacePanel({ project, collapsed, onToggle }) {
  const [tab, setTab] = useState(() => (readPrefs().workspaceTab === "git" ? "git" : "files"))
  const [reload, setReload] = useState(0)
  const key = project?.exists && project.path ? project.key : ""
  const git = useFetch((signal) => fetchGit(key, { signal }), [key, reload], {
    enabled: Boolean(key),
    poll: () => (!collapsed && tab === "git" ? 4000 : 15000),
  })
  const changed = changeCount(git.data)

  const select = (id) => {
    writePref("workspaceTab", id)
    setTab(id)
  }

  if (collapsed) {
    return (
      <aside className="pw-side pw-side--collapsed" aria-label="Workspace" id="pwWorkspace">
        <button type="button" className="pw-icon-btn" onClick={onToggle} title="Expand workspace" aria-label="Expand workspace">
          <i className="fa-solid fa-angles-left" aria-hidden="true"></i>
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pw-side__rail-btn"
            data-tab={t.id}
            title={t.id === "git" && changed ? `${t.label}: ${plural(changed, "changed file")}` : t.label}
            aria-label={t.label}
            onClick={() => {
              select(t.id)
              onToggle()
            }}
          >
            <i className={t.icon} aria-hidden="true"></i>
            {t.id === "git" && changed ? <span className="pw-side__badge">{changed > 99 ? "99+" : changed}</span> : null}
          </button>
        ))}
      </aside>
    )
  }

  return (
    <aside className="pw-side" aria-label="Workspace" id="pwWorkspace">
      <header className="pw-panel-head">
        <div className="pw-segmented pw-segmented--side" role="tablist" aria-label="Workspace view">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={t.id === tab ? "is-active" : ""}
              aria-selected={t.id === tab}
              data-tab={t.id}
              onClick={() => select(t.id)}
            >
              <i className={t.icon} aria-hidden="true"></i>
              {t.label}
              {t.id === "git" && changed ? <span className="pw-count">{changed}</span> : null}
            </button>
          ))}
        </div>
        <div className="pw-panel-head__actions">
          <button type="button" className="pw-icon-btn" onClick={() => setReload((n) => n + 1)} title="Reload" aria-label="Reload workspace">
            <i className={`fa-solid fa-rotate${tab === "git" && git.loading ? " fa-spin" : ""}`} aria-hidden="true"></i>
          </button>
          <button type="button" className="pw-icon-btn" onClick={onToggle} title="Collapse workspace" aria-label="Collapse workspace">
            <i className="fa-solid fa-angles-right" aria-hidden="true"></i>
          </button>
        </div>
      </header>
      {!key ? (
        <p className="pw-empty">{project?.path ? "The project's folder no longer exists." : "This project has no folder."}</p>
      ) : tab === "files" ? (
        <div className="pw-side__body" id="pwFiles">
          <Folder key={key} projectKey={key} path="" depth={0} version={reload} />
        </div>
      ) : (
        <GitStatus key={key} status={git.data} loading={git.loading} error={git.error} />
      )}
    </aside>
  )
}

/** One folder's entries, loaded when it is opened. */
function Folder({ projectKey, path, depth, version }) {
  const list = useFetch((signal) => fetchFiles(projectKey, path, { signal }), [projectKey, path, version])
  const pad = { paddingLeft: 8 + depth * 14 }
  if (list.error) {
    return (
      <p className="pw-error pw-tree__note" style={pad}>
        Could not list {path || "the folder"}: {list.error.message}
      </p>
    )
  }
  if (!list.data) {
    return list.loading ? (
      <p className="pw-empty pw-tree__note" style={pad}>
        Loading…
      </p>
    ) : null
  }
  const { entries, truncated } = list.data
  return (
    <ul className="pw-tree" data-folder={path}>
      {entries.map((e) => (
        <TreeItem key={e.name} projectKey={projectKey} entry={e} path={joinPath(path, e.name)} depth={depth} version={version} />
      ))}
      {!entries.length ? (
        <li className="pw-empty pw-tree__note" style={pad}>
          Empty folder
        </li>
      ) : null}
      {truncated ? (
        <li className="pw-empty pw-tree__note" style={pad}>
          Only the first {entries.length} entries are shown.
        </li>
      ) : null}
    </ul>
  )
}

function TreeItem({ projectKey, entry, path, depth, version }) {
  const [open, setOpen] = useState(false)
  const pad = { paddingLeft: 8 + depth * 14 }
  if (entry.kind !== "dir") {
    const title = entry.kind === "link" ? `${path} (symbolic link)` : `${path} · ${fileSize(entry.size)}`
    return (
      <li>
        <span className={`pw-tree__row pw-tree__row--${entry.kind}`} style={pad} title={title} data-path={path}>
          <span className="pw-tree__chev" aria-hidden="true"></span>
          <i className={entry.kind === "link" ? "fa-solid fa-link" : "fa-regular fa-file"} aria-hidden="true"></i>
          <span className="pw-tree__name">{entry.name}</span>
        </span>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        className="pw-tree__row pw-tree__row--dir"
        style={pad}
        title={path}
        aria-expanded={open}
        data-path={path}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`pw-tree__chev fa-solid fa-chevron-${open ? "down" : "right"}`} aria-hidden="true"></i>
        <i className={`fa-regular fa-folder${open ? "-open" : ""}`} aria-hidden="true"></i>
        <span className="pw-tree__name">{entry.name}</span>
      </button>
      {open ? <Folder projectKey={projectKey} path={path} depth={depth + 1} version={version} /> : null}
    </li>
  )
}

/** The repository's branch and its changed files by group. */
function GitStatus({ status, loading, error }) {
  const [closed, setClosed] = useState({})
  if (error && !status) return <p className="pw-error">Could not read the git status: {error.message}</p>
  if (!status) return loading ? <p className="pw-empty">Loading…</p> : null
  if (!status.repo) return <p className="pw-empty">Not a git repository.</p>
  const groups = gitGroups(status)
  return (
    <div className="pw-side__body pw-git" id="pwGit">
      <p className="pw-git__branch" title={status.root}>
        <i className="fa-solid fa-code-branch" aria-hidden="true"></i>
        <span className="pw-git__head">{status.branch || (status.commit ? `detached at ${status.commit}` : "detached")}</span>
        {status.upstream ? (
          <span className="pw-git__sync" title={`${status.upstream}: ${status.ahead} ahead, ${status.behind} behind`}>
            {status.ahead ? `↑${status.ahead}` : ""}
            {status.behind ? ` ↓${status.behind}` : ""}
          </span>
        ) : null}
      </p>
      {!groups.length ? <p className="pw-empty">No changes.</p> : null}
      {groups.map((g) => (
        <section key={g.id} className="pw-git__group" data-group={g.id}>
          <button
            type="button"
            className="pw-git__group-head"
            aria-expanded={!closed[g.id]}
            onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}
          >
            <i className={`fa-solid fa-chevron-${closed[g.id] ? "right" : "down"}`} aria-hidden="true"></i>
            <span>{g.label}</span>
            <span className="pw-count">{g.changes.length}</span>
          </button>
          {!closed[g.id] ? (
            <ul className="pw-git__files">
              {g.changes.map((c) => (
                <GitFile key={c.path} change={c} />
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  )
}

function GitFile({ change }) {
  const { name, dir } = splitPath(change.path)
  const meta = GIT_STATUS[change.status] || { label: change.status, tone: "modified" }
  const lines = change.binary ? "binary" : [change.added ? `+${change.added}` : "", change.deleted ? `−${change.deleted}` : ""].filter(Boolean).join(" ")
  return (
    <li
      className={`pw-git__file is-${meta.tone}${change.status === "D" ? " is-gone" : ""}`}
      data-path={change.path}
      title={`${change.from ? `${change.from} → ` : ""}${change.path} · ${meta.label}${lines ? ` · ${lines}` : ""}`}
    >
      <span className="pw-git__name">{name}</span>
      <span className="pw-git__dir">{dir}</span>
      <span className="pw-git__lines">
        {change.binary ? (
          <span className="pw-git__bin">bin</span>
        ) : (
          <>
            {change.added ? <span className="pw-git__add">+{change.added}</span> : null}
            {change.deleted ? <span className="pw-git__del">−{change.deleted}</span> : null}
          </>
        )}
      </span>
      <span className="pw-git__status" aria-label={meta.label}>
        {change.status}
      </span>
    </li>
  )
}
