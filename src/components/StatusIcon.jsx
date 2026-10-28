import { statusMeta } from "../lib/format.js"

/** Conversation / turn status icon, coloured by status (styles: .pw-status--*). */
export function StatusIcon({ status }) {
  const key = status || "done"
  const meta = statusMeta(key)
  return (
    <i
      className={`fa-solid ${meta.icon} pw-status pw-status--${key}`}
      title={meta.label}
      aria-label={meta.label}
      role="img"
    ></i>
  )
}
