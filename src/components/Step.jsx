import { Fragment, useState } from "react"
import { clockTime, duration } from "../lib/format.js"
import { editPairs, shellCommand, toolIcon, toolLabel, toolSummary } from "../lib/tools.js"

function prettyInput(input) {
  if (input == null) return ""
  if (typeof input === "string") return input
  return JSON.stringify(input, null, 2)
}

/** The parts of a tool input worth showing as text blocks instead of JSON. */
function ToolInput({ tool, input }) {
  const i = input && typeof input === "object" ? input : null
  const name = String(tool || "").toLowerCase()
  const command = shellCommand(i)
  if (command && name === "bash") {
    return (
      <>
        {i.description ? <p className="pw-step__desc">{i.description}</p> : null}
        <pre className="pw-code pw-code--shell">
          <code>{command}</code>
        </pre>
      </>
    )
  }
  const path = i?.path || i?.file_path || i?.filePath
  const edits = editPairs(i)
  if (edits.length) {
    return (
      <>
        <p className="pw-step__desc">{path}</p>
        {edits.map((e, k) => (
          <Fragment key={k}>
            <pre className="pw-code pw-code--del">
              <code>{e.oldText}</code>
            </pre>
            <pre className="pw-code pw-code--add">
              <code>{e.newText}</code>
            </pre>
          </Fragment>
        ))}
      </>
    )
  }
  if (i && typeof i.content === "string" && path) {
    return (
      <>
        <p className="pw-step__desc">{path}</p>
        <pre className="pw-code pw-code--add">
          <code>{i.content}</code>
        </pre>
      </>
    )
  }
  return (
    <pre className="pw-code">
      <code>{prettyInput(input)}</code>
    </pre>
  )
}

function ToolStep({ step }) {
  const [open, setOpen] = useState(false)
  const summary = toolSummary(step.tool, step.input)
  const took = duration(step.at, step.outputAt)
  return (
    <div className={`pw-step pw-step--tool${step.isError ? " is-error" : ""}`}>
      <button type="button" className="pw-step__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <i className={`fa-solid ${toolIcon(step.tool)} pw-step__icon`} aria-hidden="true"></i>
        <span className="pw-step__tool">{toolLabel(step.tool)}</span>
        <span className="pw-step__summary">{summary}</span>
        {step.isError ? <span className="pw-step__badge">error</span> : null}
        {took ? <span className="pw-step__took">{took}</span> : null}
        <i className={`fa-solid fa-chevron-down pw-step__chev${open ? " is-open" : ""}`} aria-hidden="true"></i>
      </button>
      {open ? (
        <div className="pw-step__body">
          <div className="pw-step__label">Input</div>
          <ToolInput tool={step.tool} input={step.input} />
          {step.output !== undefined && step.output !== "" ? (
            <>
              <div className="pw-step__label">
                {step.isError ? "Error" : "Output"}
                {step.outputAt ? <time dateTime={step.outputAt}> · {clockTime(step.outputAt)}</time> : null}
              </div>
              <pre className={`pw-code pw-code--output${step.isError ? " is-error" : ""}`}>
                <code>{step.output}</code>
              </pre>
            </>
          ) : null}
          {step.truncated ? <p className="pw-step__note">Long values were cut for display.</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function TextStep({ step }) {
  const [open, setOpen] = useState(false)
  const thinking = step.kind === "thinking"
  const long = step.text.length > 420 || step.text.split("\n").length > 6
  return (
    <div className={`pw-step pw-step--${step.kind}`}>
      <div className="pw-step__line">
        <i className={`fa-solid ${thinking ? "fa-brain" : "fa-comment-dots"} pw-step__icon`} aria-hidden="true"></i>
        <span className="pw-step__tool">{thinking ? "Thinking" : "Note"}</span>
      </div>
      <div className={`pw-step__text${long && !open ? " is-clamped" : ""}`}>{step.text}</div>
      {long ? (
        <button type="button" className="pw-link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  )
}

/** One step of a turn's work: a thought, a note, or a tool call (click for input/output). */
export function Step({ step }) {
  const time = clockTime(step.at)
  return (
    <li className={`pw-step-row${time ? "" : " pw-step-row--untimed"}`}>
      {time ? (
        <time className="pw-step-row__time" dateTime={step.at} title={step.at}>
          {time}
        </time>
      ) : null}
      <div className="pw-step-row__body">{step.kind === "tool" ? <ToolStep step={step} /> : <TextStep step={step} />}</div>
    </li>
  )
}
