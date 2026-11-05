// The second column's views and the pure helpers of the cron, memory and setup views.

import { longDateTime } from "./format.js"

/** In tab order; `needs` is the /api/features flag of the pi package the view reads. */
export const VIEWS = [
  { id: "sessions", label: "Sessions", icon: "fa-regular fa-comments" },
  { id: "cron", label: "Cron jobs", icon: "fa-regular fa-clock", needs: "cron" },
  { id: "memory", label: "Memory", icon: "fa-solid fa-brain", needs: "memory" },
  { id: "setup", label: "Setup", icon: "fa-solid fa-puzzle-piece" },
]

/** The views whose package is installed. */
export function viewsFor(features) {
  return VIEWS.filter((v) => !v.needs || features?.[v.needs])
}

/** `id` when it is one of the views shown, else "sessions". */
export function viewOf(id, features) {
  return viewsFor(features).some((v) => v.id === id) ? id : "sessions"
}

/** "Every 5m", "Every 1d 6h", "Cron 0 0 * * * (UTC)", "Once, Thu, Nov 5, 2026, 09:00". */
export function scheduleLabel(s) {
  if (!s) return ""
  if (s.kind === "interval") return `Every ${every(s.everyMs)}`
  if (s.kind === "cron") return `Cron ${s.expression}${s.timezone ? ` (${s.timezone})` : ""}`
  if (s.kind === "once") return `Once, ${longDateTime(s.runAt)}`
  return s.kind || ""
}

function every(ms) {
  const parts = []
  let m = Math.floor((ms || 0) / 60000)
  for (const [unit, size] of [
    ["d", 1440],
    ["h", 60],
    ["m", 1],
  ]) {
    if (m >= size) {
      parts.push(`${Math.floor(m / size)}${unit}`)
      m %= size
    }
  }
  return parts.join(" ") || `${Math.round((ms || 0) / 1000)}s`
}

export const RUN_STATUSES = {
  running: { label: "Running", icon: "fa-solid fa-circle-notch fa-spin", tone: "accent" },
  success: { label: "Succeeded", icon: "fa-solid fa-circle-check", tone: "success" },
  error: { label: "Failed", icon: "fa-solid fa-circle-xmark", tone: "danger" },
  skipped: { label: "Skipped", icon: "fa-solid fa-forward", tone: "muted" },
  missed: { label: "Missed", icon: "fa-regular fa-calendar-xmark", tone: "attention" },
}

export function runStatusMeta(status) {
  return RUN_STATUSES[status] || { label: status || "Not run yet", icon: "fa-regular fa-circle", tone: "muted" }
}

/** Items one of whose `fields` contains `text` (case-insensitive). */
export function filterBy(items, text, fields) {
  const needle = String(text || "").trim().toLowerCase()
  if (!needle) return items || []
  return (items || []).filter((it) => fields.some((f) => String(it[f] || "").toLowerCase().includes(needle)))
}
