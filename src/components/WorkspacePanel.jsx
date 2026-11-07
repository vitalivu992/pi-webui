import { useEffect, useState } from "react"
import { fetchFiles, fetchGit, gitOp } from "../lib/api.js"
import { plural } from "../lib/format.js"
import { fileKey, findChange } from "../lib/git.js"
import { readPrefs, writePref } from "../lib/prefs.js"
import { changeCount, fileSize, joinPath } from "../lib/workspace.js"
import { useFetch } from "../hooks/useFetch.js"
import { useConfirm } from "./ConfirmDialog.jsx"
import { GitPanel } from "./GitPanel.jsx"
import { Viewer } from "./Viewer.jsx"

const TABS = [
  { id: "files", label: "Files", icon: "fa-regular fa-folder" },
  { id: "git", label: "Git", icon: "fa-solid fa-code-branch" },
]

const SIDE_MIN = 260
const VIEW_MIN = 320

/**
 * The right-hand column: the selected project's folder as a tree, and its git
 * repository the way VS Code's Source Control shows it (GitPanel: stage,
 * unstage, discard, commit, sync, resolve conflicts). A click on a file opens
 * the viewer to the left of the panel: a file of the tree, or a change's diff.
 * The panel and the viewer drag wider (widths in prefs); the viewer expands
 * over the page and closes with × or Esc. Collapses to a rail of the two tabs'
 * icons; the git icon carries the number of changed files.
 */
export function WorkspacePanel({ project, collapsed, onToggle }) {
  const [tab, setTab] = useState(() => (readPrefs().workspaceTab === "git" ? "git" : "files"))
  const [filesReload, setFilesReload] = useState(0)
  const [gitReload, setGitReload] = useState(0)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState(null)
  const [open, setOpen] = useState(null) // the viewer's target
  const [expanded, setExpanded] = useState(false)
  const [sideW, setSideW] = useState(() => Number(readPrefs().workspaceWidth) || 300)
  const [viewW, setViewW] = useState(() => Number(readPrefs().viewerWidth) || 560)
  const [dialog, confirm] = useConfirm()
  const key = project?.exists && project.path ? project.key : ""
  const git = useFetch((signal) => fetchGit(key, { signal }), [key, gitReload], {
    enabled: Boolean(key),
    poll: () => (!collapsed && (tab === "git" || open?.kind === "change") ? 4000 : 15000),
  })
  const changed = changeCount(git.data)

  // Another project: nothing of the last one stays open.
  useEffect(() => {
    setOpen(null)
    setFailure(null)
    setExpanded(false)
  }, [key])

  // The open change follows its file after a reload: staged → Staged, gone → closed.
  useEffect(() => {
    if (!git.data || open?.kind !== "change") return
    const found = findChange(git.data, open.group, open.change.path)
    if (!found) setOpen(null)
    else if (found.group !== open.group || found.change !== open.change) setOpen({ kind: "change", ...found })
  }, [git.data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined
    const esc = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.target.closest?.("input, textarea, select, dialog, .xterm")) return
      if (expanded) setExpanded(false)
      else setOpen(null)
    }
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  }, [open, expanded])

  const select = (id) => {
    writePref("workspaceTab", id)
    setTab(id)
  }

  /** Runs a git operation (after `ask`, a confirmation); resolves true when git succeeded. */
  const run = async (req, ask) => {
    if (busy || !key) return false
    if (ask && !(await confirm(ask))) return false
    setBusy(req.op)
    setFailure(null)
    try {
      const { result } = await gitOp(key, req)
      if (!result.ok) setFailure({ title: req.op, steps: result.steps })
      return result.ok
    } catch (err) {
      setFailure({ title: `git ${req.op}`, error: err.message })
      return false
    } finally {
      setBusy("")
      setGitReload((n) => n + 1)
      if (req.op !== "commit" && req.op !== "fetch" && req.op !== "push") setFilesReload((n) => n + 1)
    }
  }

  const startResize = (ev, width, setWidth, pref, min, others) => {
    ev.preventDefault()
    const startX = ev.clientX
    let next = width
    const move = (e) => {
      next = Math.round(Math.max(min, Math.min(window.innerWidth - others() - 360, width + startX - e.clientX)))
      setWidth(next)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("is-resizing-side")
      writePref(pref, next)
    }
    document.body.classList.add("is-resizing-side")
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
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

  const openKey = open ? (open.kind === "change" ? fileKey(open.group, open.change.path) : `file:${open.path}`) : ""
  // A change's diff reloads when its counts change or after an operation.
  const version = open?.kind === "change" ? `${gitReload}:${open.change.status}:${open.change.added}:${open.change.deleted}:${open.change.xy || ""}` : `${filesReload}`

  return (
    <aside className="pw-side" aria-label="Workspace" id="pwWorkspace" style={{ "--pw-pane-w": `${sideW}px` }}>
      {dialog}
      {open ? (
        <div className={`pw-side__view${expanded ? " is-expanded" : ""}`} style={expanded ? undefined : { width: viewW }}>
          {!expanded ? (
            <div className="pw-side__resize" role="separator" aria-orientation="vertical" aria-label="Resize the viewer" onPointerDown={(e) => startResize(e, viewW, setViewW, "viewerWidth", VIEW_MIN, () => sideW)} />
          ) : null}
          <Viewer
            key={openKey}
            projectKey={key}
            target={open}
            state={git.data?.state || ""}
            version={version}
            busy={busy}
            run={run}
            expanded={expanded}
            onExpand={() => setExpanded((v) => !v)}
            onClose={() => {
              setOpen(null)
              setExpanded(false)
            }}
          />
        </div>
      ) : null}
      <div className="pw-side__pane" style={{ width: sideW }}>
        <div className="pw-side__resize" role="separator" aria-orientation="vertical" aria-label="Resize the workspace" onPointerDown={(e) => startResize(e, sideW, setSideW, "workspaceWidth", SIDE_MIN, () => (open && !expanded ? viewW : 0))} />
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
            <button
              type="button"
              className="pw-icon-btn"
              onClick={() => {
                setFilesReload((n) => n + 1)
                setGitReload((n) => n + 1)
              }}
              title="Reload"
              aria-label="Reload workspace"
            >
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
            <Folder key={key} projectKey={key} path="" depth={0} version={filesReload} current={open?.kind === "file" && !open.repo ? open.path : ""} onOpen={(path) => setOpen({ kind: "file", path })} />
          </div>
        ) : (
          <GitPanel
            key={key}
            status={git.data}
            loading={git.loading}
            error={git.error}
            busy={busy}
            failure={failure}
            onDismiss={() => setFailure(null)}
            run={run}
            current={openKey}
            onOpen={(target) => setOpen({ kind: "change", ...target })}
            onOpenFile={(path) => setOpen({ kind: "file", path, repo: true })}
          />
        )}
      </div>
    </aside>
  )
}

/** One folder's entries, loaded when it is opened. */
function Folder({ projectKey, path, depth, version, current, onOpen }) {
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
        <TreeItem key={e.name} projectKey={projectKey} entry={e} path={joinPath(path, e.name)} depth={depth} version={version} current={current} onOpen={onOpen} />
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

function TreeItem({ projectKey, entry, path, depth, version, current, onOpen }) {
  const [open, setOpen] = useState(false)
  const pad = { paddingLeft: 8 + depth * 14 }
  if (entry.kind !== "dir") {
    const title = entry.kind === "link" ? `${path} (symbolic link)` : `${path} · ${fileSize(entry.size)}`
    const active = current === path
    return (
      <li>
        <button
          type="button"
          className={`pw-tree__row pw-tree__row--${entry.kind}${active ? " is-active" : ""}`}
          style={pad}
          title={title}
          data-path={path}
          aria-current={active ? "true" : undefined}
          onClick={() => onOpen(path)}
        >
          <span className="pw-tree__chev" aria-hidden="true"></span>
          <i className={entry.kind === "link" ? "fa-solid fa-link" : "fa-regular fa-file"} aria-hidden="true"></i>
          <span className="pw-tree__name">{entry.name}</span>
        </button>
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
      {open ? <Folder projectKey={projectKey} path={path} depth={depth + 1} version={version} current={current} onOpen={onOpen} /> : null}
    </li>
  )
}
