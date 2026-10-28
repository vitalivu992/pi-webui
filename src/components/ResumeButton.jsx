import { useEffect, useRef, useState } from "react"
import { copyText } from "../lib/clipboard.js"
import { resumeCommand } from "../lib/resume.js"
import { useShells } from "./Shells.jsx"

/**
 * "Resume" popover: the pi command that continues the conversation, a copy
 * button and a button that runs it in a new shell of the terminal panel.
 */
export function ResumeButton({ conversation }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shellError, setShellError] = useState("")
  const shells = useShells()
  const ref = useRef(null)
  const command = resumeCommand(conversation)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (ev) => {
      if (!ref.current?.contains(ev.target)) setOpen(false)
    }
    const onKey = (ev) => ev.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  useEffect(() => {
    setCopied(false)
    setShellError("")
  }, [command])

  const copy = async () => {
    if (await copyText(command)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  const runInShell = async () => {
    setShellError("")
    try {
      await shells.openShell({ cwd: conversation.cwd || conversation.projectPath || "", run: command })
      setOpen(false)
    } catch (err) {
      setShellError(err.message)
    }
  }

  return (
    <div className="pw-resume" ref={ref}>
      <button
        type="button"
        className="pw-btn pw-btn--primary"
        id="pwResume"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <i className="fa-solid fa-terminal" aria-hidden="true"></i> Resume
        <i className="fa-solid fa-chevron-down pw-btn__caret" aria-hidden="true"></i>
      </button>
      {open ? (
        <div className="pw-popover" role="dialog" aria-label="Resume in terminal">
          <p className="pw-popover__title">
            Continue in <code>pi</code>
          </p>
          <pre className="pw-command" id="pwResumeCommand">
            <code>{command}</code>
          </pre>
          {shellError ? (
            <p className="pw-popover__warn" role="alert">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Could not open a shell: {shellError}
            </p>
          ) : null}
          <div className="pw-popover__actions">
            {shells ? (
              <button type="button" className="pw-btn" id="pwResumeShell" onClick={runInShell} title="Open a shell in the conversation's folder and run the command">
                <i className="fa-solid fa-terminal" aria-hidden="true"></i> Run in shell
              </button>
            ) : null}
            <button type="button" className="pw-btn pw-btn--primary" id="pwResumeCopy" onClick={copy}>
              <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true"></i> {copied ? "Copied" : "Copy command"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
