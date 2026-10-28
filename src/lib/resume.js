// The terminal command that continues a conversation in the pi TUI.

const SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/

/** POSIX shell quoting: bare when safe, else single quotes. */
export function shellQuote(value) {
  const s = String(value ?? "")
  if (s && SAFE.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * `cd <cwd> && pi --session <id>`. pi looks sessions up by the directory it
 * runs in, hence the cd.
 */
export function resumeCommand(conversation) {
  if (!conversation?.id) return ""
  const command = `pi --session ${shellQuote(conversation.id)}`
  const cwd = conversation.cwd || conversation.projectPath
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command
}
