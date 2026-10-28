// The prompt box's prompt templates and skills: which token the caret is in,
// what it completes to, and which part of the text is a known command (shown
// highlighted). Commands come from GET /api/commands; their `insert` is what
// the prompt starts with ("/review", "/skill:wiki").

const SPACE = /\s/

/**
 * The command token being typed at `caret`: "/…" at the start of the prompt.
 * `{start, end, query}` or null.
 */
export function completionAt(text, caret) {
  const s = String(text || "")
  let start = caret
  while (start > 0 && !SPACE.test(s[start - 1])) start--
  if (s[start] !== "/" || s.slice(0, start).trim() !== "") return null
  let end = caret
  while (end < s.length && !SPACE.test(s[end])) end++
  return { start, end, query: s.slice(start, caret) }
}

/** Commands matching what was typed: prefix matches first, then the ones containing it. */
export function matchCommands(commands, query, limit = 50) {
  const q = String(query || "").toLowerCase()
  if (q[0] !== "/") return []
  const word = q.slice(1)
  const prefix = []
  const inside = []
  for (const c of commands || []) {
    const name = c.insert.slice(1).toLowerCase()
    if (name.startsWith(word)) prefix.push(c)
    else if (word && (name.includes(word) || (c.description || "").toLowerCase().includes(word))) inside.push(c)
  }
  return [...prefix, ...inside].slice(0, limit)
}

/** Replaces the token with the command (and a space after it): `{text, caret}`. */
export function applyCompletion(text, token, insert) {
  const s = String(text || "")
  const after = s.slice(token.end)
  const gap = after && SPACE.test(after[0]) ? "" : " "
  const next = s.slice(0, token.start) + insert + gap + after
  return { text: next, caret: token.start + insert.length + 1 }
}

const ends = (s, i) => i >= s.length || SPACE.test(s[i])

/**
 * The text cut into `{ text, command }` segments, `command` set on the
 * known command at the start of the prompt.
 */
export function highlightSegments(text, commands) {
  const s = String(text || "")
  const lead = s.length - s.trimStart().length
  const command = (commands || [])
    .filter((c) => s.startsWith(c.insert, lead) && ends(s, lead + c.insert.length))
    .sort((a, b) => b.insert.length - a.insert.length)[0]
  if (!command) return [{ text: s, command: null }]
  const end = lead + command.insert.length
  const out = []
  if (lead) out.push({ text: s.slice(0, lead), command: null })
  out.push({ text: s.slice(lead, end), command })
  if (end < s.length) out.push({ text: s.slice(end), command: null })
  return out
}

/** The commands the prompt uses (for the "uses /fix-backlog" hint). */
export function usedCommands(text, commands) {
  return highlightSegments(text, commands)
    .filter((seg) => seg.command)
    .map((seg) => seg.command)
}
