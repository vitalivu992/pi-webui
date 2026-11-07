import { useEffect, useRef, useState } from "react"
import { plural } from "../lib/format.js"
import { GROUP_OPS, OPS, STATE_LABELS, baseName, buildTree, discardPrompt, fileKey, fileRef, opTitle, treeFiles } from "../lib/git.js"
import { readPrefs, writePref } from "../lib/prefs.js"
import { GIT_STATUS, gitGroups, splitPath } from "../lib/workspace.js"

/**
 * The Git tab, after VS Code's Source Control: the branch with the sync
 * actions, the operation in progress (abort / continue / skip), the commit
 * box, and the merge / staged / changes groups as a tree or a list. Groups,
 * folders and files have inline actions on hover (stage, unstage, discard,
 * mark resolved, open the file); a click on a file opens its diff in the viewer.
 *
 * `run(req, ask?)` runs a git operation (after `ask`, a confirmation) and
 * resolves true when git succeeded; `busy` is the running operation.
 */
export function GitPanel({ status, loading, error, busy, failure, onDismiss, run, current, onOpen, onOpenFile }) {
  const [closed, setClosed] = useState({})
  const [mode, setMode] = useState(() => (readPrefs().gitMode === "list" ? "list" : "tree"))
  if (error && !status) return <p className="pw-error">Could not read the git status: {error.message}</p>
  if (!status) return loading ? <p className="pw-empty">Loading…</p> : null
  if (!status.repo) return <p className="pw-empty">Not a git repository.</p>

  const toggle = (key) => setClosed((c) => ({ ...c, [key]: !c[key] }))
  const switchMode = () => {
    const next = mode === "tree" ? "list" : "tree"
    writePref("gitMode", next)
    setMode(next)
  }
  const files = async (op, group, changes) => {
    const req = { op, files: changes.map((c) => fileRef(c, group)) }
    if (op === "discard") return run(req, { ...discardPrompt(changes), danger: true })
    return run(req)
  }
  const ctx = { closed, toggle, busy, current, onOpen, onOpenFile, files }
  const groups = gitGroups(status)

  return (
    <div className="pw-side__body pw-git" id="pwGit">
      <BranchBar status={status} busy={busy} run={run} mode={mode} onMode={switchMode} />
      {status.state ? <OperationBanner status={status} busy={busy} run={run} /> : null}
      {failure ? <Failure failure={failure} onDismiss={onDismiss} /> : null}
      <CommitBox status={status} busy={busy} run={run} />
      {!groups.length ? <p className="pw-empty">No changes.</p> : null}
      {groups.map((g) => (
        <section key={g.id} className="pw-git__group" data-group={g.id}>
          <div className="pw-git__group-head">
            <button type="button" className="pw-git__group-toggle" aria-expanded={!closed[g.id]} onClick={() => toggle(g.id)}>
              <i className={`fa-solid fa-chevron-${closed[g.id] ? "right" : "down"}`} aria-hidden="true"></i>
              <span>{g.label}</span>
            </button>
            <RowActions group={g.id} changes={g.changes} all ctx={ctx} />
            <span className="pw-count">{g.changes.length}</span>
          </div>
          {closed[g.id] ? null : (
            <ul className="pw-git__files" role="tree" aria-label={g.label}>
              {mode === "tree" ? (
                <TreeNode node={buildTree(g.changes)} depth={0} group={g.id} ctx={ctx} />
              ) : (
                g.changes.map((c) => <GitFile key={c.path} change={c} group={g.id} depth={0} showDir ctx={ctx} />)
              )}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function BranchBar({ status, busy, run, mode, onMode }) {
  const head = status.branch || (status.opBranch ? `rebasing ${status.opBranch}` : status.commit ? `detached at ${status.commit}` : "detached")
  const canPull = Boolean(status.upstream) && !status.state
  const canPush = Boolean(status.remote) && Boolean(status.branch) && !status.state
  const pushTitle = status.upstream ? `git push to ${status.upstream}` : status.remote ? `git push -u ${status.remote} ${status.branch}: publish the branch` : "No remote to push to"
  return (
    <div className="pw-git__branch" title={status.root}>
      <i className="fa-solid fa-code-branch" aria-hidden="true"></i>
      <span className="pw-git__head">{head}</span>
      {status.upstream ? (
        <span className="pw-git__sync" title={`${status.upstream}: ${status.ahead || 0} ahead, ${status.behind || 0} behind`}>
          {status.upstream}
        </span>
      ) : null}
      <span className="pw-git__bar-actions">
        <button type="button" className="pw-git__act" id="pwGitPull" disabled={Boolean(busy) || !canPull} onClick={() => run({ op: "pull" })} title={canPull ? `git pull from ${status.upstream}` : "No upstream to pull from"} aria-label="Pull">
          <i className={`fa-solid ${busy === "pull" || busy === "pull-rebase" ? "fa-spinner fa-spin" : "fa-arrow-down"}`} aria-hidden="true"></i>
          {status.behind ? <span>{status.behind}</span> : null}
        </button>
        <button type="button" className="pw-git__act" id="pwGitPush" disabled={Boolean(busy) || !canPush} onClick={() => run({ op: "push" })} title={pushTitle} aria-label="Push">
          <i className={`fa-solid ${busy === "push" ? "fa-spinner fa-spin" : status.upstream ? "fa-arrow-up" : "fa-cloud-arrow-up"}`} aria-hidden="true"></i>
          {status.ahead ? <span>{status.ahead}</span> : null}
        </button>
        <Menu
          id="pwGitMore"
          label="More git actions"
          disabled={Boolean(busy)}
          items={[
            { id: "fetch", label: "Fetch", hint: "git fetch --all --prune", icon: "fa-cloud-arrow-down", onClick: () => run({ op: "fetch" }), disabled: !status.remote },
            { id: "pull", label: "Pull", hint: "git pull", icon: "fa-arrow-down", onClick: () => run({ op: "pull" }), disabled: !canPull },
            { id: "pull-rebase", label: "Pull (rebase)", hint: "git pull --rebase", icon: "fa-arrow-down-wide-short", onClick: () => run({ op: "pull-rebase" }), disabled: !canPull },
            { id: "push", label: status.upstream ? "Push" : "Publish branch", hint: pushTitle, icon: "fa-arrow-up", onClick: () => run({ op: "push" }), disabled: !canPush },
            { id: "mode", label: mode === "tree" ? "View as list" : "View as tree", icon: mode === "tree" ? "fa-list" : "fa-folder-tree", onClick: onMode },
          ]}
        />
      </span>
    </div>
  )
}

/** A merge, rebase, cherry-pick or revert in progress, with its way out. */
function OperationBanner({ status, busy, run }) {
  const { state } = status
  const label = STATE_LABELS[state] || state
  const conflicts = status.merge.length
  const can = state !== "bisect"
  return (
    <div className="pw-git__state" role="status" id="pwGitState" data-state={state}>
      <p>
        <strong>{label}</strong>
        {status.opBranch ? ` ${status.opBranch}` : ""}
        {" · "}
        {conflicts ? `${plural(conflicts, "conflict")} left: resolve them, then continue.` : "No conflicts left: continue."}
      </p>
      {can ? (
        <div className="pw-git__state-actions">
          <button type="button" className="pw-btn pw-btn--small pw-btn--primary" data-op="continue" disabled={Boolean(busy) || conflicts > 0} onClick={() => run({ op: "continue" })} title={`git ${state} --continue`}>
            Continue
          </button>
          {state === "rebase" || state === "cherry-pick" ? (
            <button type="button" className="pw-btn pw-btn--small" data-op="skip" disabled={Boolean(busy)} onClick={() => run({ op: "skip" }, { title: `Skip this commit?`, body: `git ${state} --skip drops the commit being applied and its changes.`, confirm: "Skip", danger: true })} title={`git ${state} --skip`}>
              Skip
            </button>
          ) : null}
          <button
            type="button"
            className="pw-btn pw-btn--small pw-btn--danger"
            data-op="abort"
            disabled={Boolean(busy)}
            onClick={() => run({ op: "abort" }, { title: `Abort the ${state}?`, body: `git ${state} --abort puts the branch back as it was before the ${state}. Resolutions made so far are lost.`, confirm: "Abort", danger: true })}
            title={`git ${state} --abort`}
          >
            Abort
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The output of the git command that failed last. */
function Failure({ failure, onDismiss }) {
  const step = failure.steps?.findLast((s) => s.exitCode !== 0)
  return (
    <div className="pw-git__fail" role="alert" id="pwGitFail">
      <div className="pw-git__fail-head">
        <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <code>{step ? step.cmd : failure.title}</code>
        <button type="button" className="pw-icon-btn" onClick={onDismiss} title="Dismiss" aria-label="Dismiss the error">
          <i className="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
      <pre>{step ? step.output || `exit code ${step.exitCode}` : failure.error}</pre>
    </div>
  )
}

/** The commit message box: commits the staged files (Ctrl+Enter), or amends / commits and pushes from its menu. */
function CommitBox({ status, busy, run }) {
  const [message, setMessage] = useState("")
  const staged = status.staged.length
  const conflicts = status.merge.length
  const blocked = Boolean(busy) || conflicts > 0
  const ready = !blocked && staged > 0 && message.trim() !== ""
  const commit = async (extra = {}) => {
    if (await run({ op: "commit", message, ...extra })) setMessage("")
  }
  const title = conflicts ? "Resolve the conflicts first" : staged ? `Commit the ${plural(staged, "staged file")}` : "Stage files to commit them"
  return (
    <form
      className="pw-git__commit"
      aria-label="Commit"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) commit()
      }}
    >
      <textarea
        id="pwCommitMsg"
        className="pw-input pw-git__msg"
        rows={2}
        placeholder={`Message (Ctrl+Enter to commit${status.branch ? ` on "${status.branch}"` : ""})`}
        aria-label="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (ready) commit()
          }
        }}
      />
      <div className="pw-git__commit-row">
        <button type="submit" id="pwCommit" className="pw-btn pw-btn--small pw-btn--primary" disabled={!ready} title={title}>
          <i className={`fa-solid ${busy === "commit" ? "fa-spinner fa-spin" : "fa-check"}`} aria-hidden="true"></i> Commit
        </button>
        <Menu
          id="pwCommitMore"
          label="More commit actions"
          disabled={blocked}
          items={[
            { id: "commit-push", label: "Commit & Push", hint: "git commit, then git push", icon: "fa-arrow-up", disabled: !ready || !status.remote || !status.branch, onClick: () => commit({ push: true }) },
            {
              id: "amend",
              label: message.trim() ? "Commit (Amend)" : "Amend, keep the message",
              hint: message.trim() ? "git commit --amend -m" : "git commit --amend --no-edit",
              icon: "fa-pen",
              disabled: !status.commit,
              onClick: () => commit({ amend: true }),
            },
          ]}
        />
      </div>
    </form>
  )
}

/** A small popup menu of actions. */
function Menu({ id, label, items, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false)
    // Captured and marked handled, so the same Esc doesn't also close the viewer.
    const esc = (e) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", esc, true)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", esc, true)
    }
  }, [open])
  return (
    <span className="pw-git__menu" ref={ref}>
      <button type="button" className="pw-git__act" id={id} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <i className="fa-solid fa-ellipsis" aria-hidden="true"></i>
      </button>
      {open ? (
        <ul className="pw-git__menu-list" role="menu">
          {items.map((it) => (
            <li key={it.id} role="none">
              <button
                type="button"
                role="menuitem"
                data-item={it.id}
                disabled={it.disabled}
                title={it.hint}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                <i className={`fa-solid ${it.icon}`} aria-hidden="true"></i>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}

function TreeNode({ node, depth, group, ctx }) {
  return (
    <>
      {node.dirs.map((d) => {
        const key = `${group}/${d.path}`
        const shut = ctx.closed[key]
        return (
          <li key={key} role="none">
            <div className="pw-git__row pw-git__folder" style={{ paddingLeft: 10 + depth * 12 }} title={d.path} data-dir={d.path}>
              <button type="button" className="pw-git__main" role="treeitem" aria-expanded={!shut} onClick={() => ctx.toggle(key)}>
                <i className={`pw-git__chev fa-solid fa-chevron-${shut ? "right" : "down"}`} aria-hidden="true"></i>
                <i className={`fa-regular fa-folder${shut ? "" : "-open"} pw-git__icon`} aria-hidden="true"></i>
                <span className="pw-git__name">{d.name}</span>
              </button>
              <RowActions group={group} changes={treeFiles(d)} ctx={ctx} />
            </div>
            {shut ? null : (
              <ul className="pw-git__files" role="group">
                <TreeNode node={d} depth={depth + 1} group={group} ctx={ctx} />
              </ul>
            )}
          </li>
        )
      })}
      {node.files.map((c) => (
        <GitFile key={c.path} change={c} group={group} depth={depth} ctx={ctx} />
      ))}
    </>
  )
}

function GitFile({ change, group, depth, showDir, ctx }) {
  const name = showDir ? splitPath(change.path).name : baseName(change.path)
  const meta = GIT_STATUS[change.status] || { label: change.status, tone: "modified" }
  const active = ctx.current === fileKey(group, change.path)
  const lines = change.binary ? "binary" : [change.added ? `+${change.added}` : "", change.deleted ? `−${change.deleted}` : ""].filter(Boolean).join(" ")
  return (
    <li
      role="none"
      className={`pw-git__file is-${meta.tone}${change.status === "D" ? " is-gone" : ""}${active ? " is-active" : ""}`}
      data-path={change.path}
      title={`${change.from ? `${change.from} → ` : ""}${change.path} · ${meta.label}${lines ? ` · ${lines}` : ""}`}
    >
      <div className="pw-git__row" style={{ paddingLeft: 10 + depth * 12 + 14 }}>
        <button type="button" className="pw-git__main" role="treeitem" aria-selected={active} onClick={() => ctx.onOpen({ group, change })}>
          <span className="pw-git__name">{name}</span>
          {showDir ? <span className="pw-git__dir">{splitPath(change.path).dir}</span> : <span className="pw-git__dir"></span>}
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
        </button>
        <RowActions group={group} changes={[change]} ctx={ctx} file={change.status !== "D" && !(group === "merge" && change.xy?.includes("D")) ? change.path : ""} />
        <span className="pw-git__status" aria-label={meta.label}>
          {change.status}
        </span>
      </div>
    </li>
  )
}

/** The inline buttons of a group, folder or file row (shown on hover / focus). */
function RowActions({ group, changes, all = false, file = "", ctx }) {
  return (
    <span className="pw-git__actions">
      {file ? (
        <button type="button" className="pw-git__act" data-op="open" title="Open File" aria-label="Open File" onClick={() => ctx.onOpenFile(file)}>
          <i className="fa-regular fa-file-lines" aria-hidden="true"></i>
        </button>
      ) : null}
      {GROUP_OPS[group].map((op) => {
        const title = opTitle(op, group, all)
        return (
          <button key={op} type="button" className="pw-git__act" data-op={op} disabled={Boolean(ctx.busy)} title={title} aria-label={title} onClick={() => ctx.files(op, group, changes)}>
            <i className={`fa-solid ${group === "merge" ? "fa-check" : OPS[op].icon}`} aria-hidden="true"></i>
          </button>
        )
      })}
    </span>
  )
}
