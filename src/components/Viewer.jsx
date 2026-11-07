import { useMemo, useState } from "react"
import hljs from "highlight.js/lib/common"
import { fetchDiff, fetchFile } from "../lib/api.js"
import { CONFLICT_KINDS, conflictSides, diffStats, fileRef, isDeleteConflict, languageOf, parseConflicts, parseDiff, resolveConflict, splitHighlighted } from "../lib/git.js"
import { GIT_STATUS, fileSize, splitPath } from "../lib/workspace.js"
import { useFetch } from "../hooks/useFetch.js"

const GROUP_LABELS = { merge: "Merge conflict", staged: "Staged", changes: "Working tree" }
// Larger files are shown without colours.
const MAX_HIGHLIGHT = 300_000

/**
 * The pane left of the workspace panel: a changed file's diff (or the file
 * itself), or a file of the tree. A conflicted file opens as the file, with
 * Accept current / incoming / both on each conflict block, Take mine / theirs
 * for the whole file and Mark resolved. `version` reloads it.
 *
 * target: { kind: "change", group, change } | { kind: "file", path, repo }
 */
export function Viewer({ projectKey, target, state, version, busy, run, expanded, onExpand, onClose }) {
  const isChange = target.kind === "change"
  const change = isChange ? target.change : null
  const group = isChange ? target.group : ""
  const path = isChange ? change.path : target.path
  const deleted = isChange && (change.status === "D" || (group === "merge" && change.xy?.includes("D")))
  const [mode, setMode] = useState(() => (isChange && !(group === "merge" && !isDeleteConflict(change.xy)) ? "diff" : "file"))
  const shown = deleted ? "diff" : mode
  const { name, dir } = splitPath(path)
  const meta = isChange ? GIT_STATUS[change.status] : null

  return (
    <section className={`pw-viewer${expanded ? " is-expanded" : ""}`} aria-label={`${shown === "diff" ? "Diff" : "File"} ${path}`} id="pwViewer" data-path={path} data-mode={shown}>
      <header className="pw-viewer__head">
        <i className={`fa-regular ${shown === "diff" ? "fa-file-lines" : "fa-file"}`} aria-hidden="true"></i>
        <span className="pw-viewer__title" title={change?.from ? `${change.from} → ${path}` : path}>
          <strong>{name}</strong>
          <span className="pw-viewer__dir">{change?.from ? `${change.from} → ` : ""}{dir}</span>
        </span>
        {isChange ? (
          <span className={`pw-viewer__badge is-${group}`} title={meta?.label}>
            {GROUP_LABELS[group]}
          </span>
        ) : null}
        <span className="pw-viewer__actions">
          {isChange && !deleted ? (
            <button type="button" className="pw-icon-btn" id="pwViewerMode" onClick={() => setMode(shown === "diff" ? "file" : "diff")} title={shown === "diff" ? "Open the file" : "Open the changes"} aria-label={shown === "diff" ? "Open the file" : "Open the changes"}>
              <i className={`fa-solid ${shown === "diff" ? "fa-file-code" : "fa-code-compare"}`} aria-hidden="true"></i>
            </button>
          ) : null}
          <button type="button" className="pw-icon-btn" id="pwViewerExpand" onClick={onExpand} title={expanded ? "Restore" : "Expand"} aria-label={expanded ? "Restore the viewer" : "Expand the viewer"} aria-pressed={expanded}>
            <i className={`fa-solid ${expanded ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}`} aria-hidden="true"></i>
          </button>
          <button type="button" className="pw-icon-btn" id="pwViewerClose" onClick={onClose} title="Close (Esc)" aria-label="Close the viewer">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </span>
      </header>
      {group === "merge" ? <ConflictBar change={change} state={state} busy={busy} run={run} /> : null}
      {shown === "diff" ? (
        <DiffBody projectKey={projectKey} change={change} group={group} version={version} />
      ) : (
        <FileBody projectKey={projectKey} path={path} repo={isChange || target.repo} conflict={group === "merge"} version={version} busy={busy} run={run} />
      )}
    </section>
  )
}

/** Whole-file resolutions of a conflict: take one side, keep or delete, mark resolved. */
function ConflictBar({ change, state, busy, run }) {
  const sides = conflictSides(change.xy, state)
  const ref = [fileRef(change, "merge")]
  const take = (label, side) =>
    run(
      { op: side.op, files: ref },
      { title: `Take ${label} for "${change.path}"?`, body: `The whole file becomes ${side.hint}'s version (git checkout --${side.op}) and is marked resolved (git add). Edits made in the file are lost.`, confirm: `Take ${label}`, danger: true }
    )
  return (
    <div className="pw-viewer__resolve" id="pwResolve">
      <span className="pw-viewer__kind">{CONFLICT_KINDS[change.xy] || "conflict"}</span>
      {sides ? (
        <>
          <button type="button" className="pw-btn pw-btn--small" data-take="mine" disabled={Boolean(busy)} onClick={() => take("mine", sides.mine)} title={`git checkout --${sides.mine.op}: ${sides.mine.hint}`}>
            Take mine
          </button>
          <button type="button" className="pw-btn pw-btn--small" data-take="theirs" disabled={Boolean(busy)} onClick={() => take("theirs", sides.theirs)} title={`git checkout --${sides.theirs.op}: ${sides.theirs.hint}`}>
            Take theirs
          </button>
        </>
      ) : null}
      {isDeleteConflict(change.xy) ? (
        <button
          type="button"
          className="pw-btn pw-btn--small pw-btn--danger"
          data-op="remove"
          disabled={Boolean(busy)}
          onClick={() => run({ op: "remove", files: ref }, { title: `Delete "${change.path}"?`, body: "git rm accepts the deletion: the file is removed and the conflict resolved.", confirm: "Delete file", danger: true })}
          title="git rm: accept the deletion"
        >
          Delete file
        </button>
      ) : null}
      <button type="button" className="pw-btn pw-btn--small pw-btn--primary" data-op="stage" disabled={Boolean(busy)} onClick={() => run({ op: "stage", files: ref })} title="git add: the file as it is now is the resolution">
        {isDeleteConflict(change.xy) && change.xy !== "DD" ? "Keep file" : "Mark resolved"}
      </button>
    </div>
  )
}

function DiffBody({ projectKey, change, group, version }) {
  const ref = fileRef(change, group)
  const diff = useFetch((signal) => fetchDiff(projectKey, ref, { signal }), [projectKey, ref.path, ref.from, group, ref.status, version])
  const files = useMemo(() => parseDiff(diff.data?.diff || ""), [diff.data])
  const lang = languageOf(change.path)
  const stats = diffStats(files)
  if (diff.error) return <p className="pw-error">Could not read the diff: {diff.error.message}</p>
  if (!diff.data) return diff.loading ? <p className="pw-empty">Loading…</p> : null
  return (
    <div className="pw-viewer__body pw-hl" id="pwDiff">
      {stats.add || stats.del ? (
        <p className="pw-viewer__stats">
          <span className="pw-git__add">+{stats.add}</span> <span className="pw-git__del">−{stats.del}</span>
        </p>
      ) : null}
      {!diff.data.diff ? <p className="pw-empty">No textual changes (a mode change or an empty file).</p> : null}
      {files.map((f, i) => (
        <DiffFile key={i} file={f} lang={lang} />
      ))}
      {diff.data.truncated ? <p className="pw-empty">The diff is too large and was cut.</p> : null}
    </div>
  )
}

const isMarker = (text) => /^(<{7}|={7}|>{7}|\|{7})( |$)/.test(text || "")

function DiffFile({ file, lang }) {
  // The header lines worth showing: binary notices, mode changes, renames.
  const notes = file.header.filter((l) => /^(Binary files|old mode|new mode|deleted file|new file|similarity|rename from|rename to)/.test(l))
  return (
    <table className="pw-diff">
      <tbody>
        {notes.map((l, i) => (
          <tr key={`n${i}`} className="pw-diff__line is-meta">
            <td className="pw-diff__no"></td>
            <td className="pw-diff__no"></td>
            <td className="pw-diff__code">{l}</td>
          </tr>
        ))}
        {file.hunks.map((h, hi) => [
          <tr key={`h${hi}`} className="pw-diff__line is-hunk">
            <td className="pw-diff__no"></td>
            <td className="pw-diff__no"></td>
            <td className="pw-diff__code">{h.header}</td>
          </tr>,
          ...h.lines.map((l, li) => (
            <tr key={`${hi}-${li}`} className={`pw-diff__line is-${l.kind}${isMarker(l.text) ? " is-marker" : ""}`}>
              <td className="pw-diff__no">{l.old ?? ""}</td>
              <td className="pw-diff__no">{l.new ?? ""}</td>
              <td className="pw-diff__code">
                <span className="pw-diff__mark">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                <Code text={l.text} lang={l.kind === "meta" || isMarker(l.text) ? "" : lang} />
              </td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  )
}

function Code({ text, lang }) {
  if (!lang || !hljs.getLanguage(lang)) return <span>{text}</span>
  const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function FileBody({ projectKey, path, repo, conflict, version, busy, run }) {
  const [rev, setRev] = useState(0)
  const file = useFetch((signal) => fetchFile(projectKey, path, { repo, signal }), [projectKey, path, repo, version, rev])
  const f = file.data
  const segments = useMemo(() => (conflict && f && !f.binary ? parseConflicts(f.text) : null), [conflict, f])
  if (file.error) return <p className="pw-error">Could not open the file: {file.error.message}</p>
  if (!f) return file.loading ? <p className="pw-empty">Loading…</p> : null
  if (f.binary) return <p className="pw-empty">A binary file ({fileSize(f.size)}): not shown.</p>
  const blocks = segments ? segments.filter((s) => s.kind === "conflict").length : 0
  const accept = async (index, choice) => {
    if (await run({ op: "write", path, content: resolveConflict(f.text, index, choice), base: f.hash })) setRev((n) => n + 1)
  }
  return (
    <div className="pw-viewer__body pw-hl" id="pwFile">
      {conflict ? (
        <p className="pw-viewer__stats" id="pwConflictCount">
          {blocks ? `${blocks} conflict${blocks > 1 ? "s" : ""} in the file: accept a side on each, or edit the file.` : "No conflict markers left: mark the file resolved."}
        </p>
      ) : null}
      {!f.text ? <p className="pw-empty">An empty file.</p> : null}
      {blocks ? <ConflictFile segments={segments} lang={languageOf(path)} busy={busy} onAccept={accept} /> : <Lines text={f.text} lang={f.text.length <= MAX_HIGHLIGHT ? languageOf(path) : ""} />}
      {f.truncated ? <p className="pw-empty">Only the first {fileSize(f.text.length)} of {fileSize(f.size)} are shown.</p> : null}
    </div>
  )
}

/** A file with line numbers, highlighted as a whole (comments spanning lines keep their colour). */
function Lines({ text, lang, start = 1 }) {
  const lines = useMemo(() => {
    if (!text) return []
    const body = text.endsWith("\n") ? text.slice(0, -1) : text
    if (lang && hljs.getLanguage(lang)) return splitHighlighted(hljs.highlight(body, { language: lang, ignoreIllegals: true }).value)
    return body.split("\n").map(escape)
  }, [text, lang])
  return (
    <table className="pw-diff pw-file">
      <tbody>
        {lines.map((html, i) => (
          <tr key={i} className="pw-diff__line">
            <td className="pw-diff__no">{start + i}</td>
            <td className="pw-diff__code" dangerouslySetInnerHTML={{ __html: html || " " }} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ConflictFile({ segments, lang, busy, onAccept }) {
  let line = 1
  return segments.map((s, i) => {
    const start = line
    if (s.kind === "text") {
      line += s.lines.length
      return <Lines key={i} text={s.lines.join("")} lang={lang} start={start} />
    }
    line += s.raw.length
    return (
      <div key={i} className="pw-conflict" data-conflict={s.index}>
        <div className="pw-conflict__bar">
          <button type="button" className="pw-link-btn" data-accept="ours" disabled={Boolean(busy)} onClick={() => onAccept(s.index, "ours")}>
            Accept current
          </button>
          <button type="button" className="pw-link-btn" data-accept="theirs" disabled={Boolean(busy)} onClick={() => onAccept(s.index, "theirs")}>
            Accept incoming
          </button>
          <button type="button" className="pw-link-btn" data-accept="both" disabled={Boolean(busy)} onClick={() => onAccept(s.index, "both")}>
            Accept both
          </button>
        </div>
        <div className="pw-conflict__side is-ours">
          <span className="pw-conflict__label">Current change{s.oursLabel ? ` (${s.oursLabel})` : ""}</span>
          <Lines text={s.ours.join("")} lang={lang} start={start + 1} />
        </div>
        {s.base ? (
          <div className="pw-conflict__side is-base">
            <span className="pw-conflict__label">Common ancestor</span>
            <Lines text={s.base.join("")} lang={lang} start={start + 2 + s.ours.length} />
          </div>
        ) : null}
        <div className="pw-conflict__side is-theirs">
          <span className="pw-conflict__label">Incoming change{s.theirsLabel ? ` (${s.theirsLabel})` : ""}</span>
          <Lines text={s.theirs.join("")} lang={lang} start={start + s.raw.length - 1 - s.theirs.length} />
        </div>
      </div>
    )
  })
}

function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
