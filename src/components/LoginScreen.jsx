import { useEffect, useMemo, useRef, useState } from "react"
import { login } from "../lib/api.js"
import { redactionRows } from "../lib/redaction.js"
import { PiIcon } from "./PiIcon.jsx"

// Length of the unlock sequence in app.css (wipe, welcome, aperture).
const UNLOCK_MS = 2400
// Length of the lock-in after a logout (blur, backdrop, card).
export const LOCK_MS = 900

export function prefersReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/**
 * The login screen: a backdrop of redacted chat lines and the login form
 * (the server checks the password with PAM). Once `unlockedAs` is set it plays
 * the unlock sequence over the app — the redaction bars peel away, a welcome
 * line writes in, an aperture opens onto the app — and calls `onDone` at the
 * end, or as soon as the user clicks or presses a key. With `locking` (a logout
 * in progress) it comes in over the app instead: the app blurs behind it, the
 * backdrop and then the form fade in (LOCK_MS).
 */
export function LoginScreen({ unlockedAs = null, locking = false, onLogin, onDone }) {
  const rows = useMemo(() => redactionRows(), [])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const passwordRef = useRef(null)
  const unlocking = Boolean(unlockedAs)

  useEffect(() => {
    if (!unlocking) return undefined
    const timer = setTimeout(onDone, prefersReducedMotion() ? 600 : UNLOCK_MS)
    window.addEventListener("keydown", onDone)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("keydown", onDone)
    }
  }, [unlocking, onDone])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const user = await login(username.trim(), password)
      setPassword("")
      onLogin(user)
    } catch (err) {
      setError(
        err.status === 401
          ? "Wrong username or password. Use the password of your computer account."
          : `Could not log in: ${err.message}`
      )
      setPassword("")
      setBusy(false)
      passwordRef.current?.focus()
    }
  }

  const welcome = `Welcome back, ${unlockedAs || ""}`

  return (
    <div
      className={`pw-login${unlocking ? " is-unlocking" : ""}${locking ? " is-locking" : ""}`}
      id="pwLogin"
      onClick={unlocking ? onDone : undefined}
    >
      <div className="pw-login__field" aria-hidden="true">
        <div className="pw-login__drift">
          {rows.map((row, r) => (
            <div key={r} className={`pw-login__row pw-login__row--${row.side}`}>
              {row.lines.map((line, i) => (
                <span
                  key={i}
                  className="pw-login__line"
                  style={{ "--w": `${line.width}%`, "--c": line.color, "--d": `${line.delay}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <form className="pw-login__card" onSubmit={submit} aria-hidden={unlocking || undefined}>
        <div className="pw-login__mark">
          <PiIcon size={18} />
          <span>pi WebUI</span>
        </div>
        <h1 className="pw-login__title">Log in</h1>
        <p className="pw-login__hint">Your pi sessions hold code and secrets. Use the username and password of your computer account, as for your desktop session.</p>
        <label className="pw-login__label" htmlFor="pwLoginUser">
          Username
        </label>
        <input
          id="pwLoginUser"
          className="pw-login__input"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck="false"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="pw-login__label" htmlFor="pwLoginPassword">
          Password
        </label>
        <input
          id="pwLoginPassword"
          ref={passwordRef}
          className="pw-login__input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p className="pw-login__error" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true"></i> {error}
          </p>
        ) : null}
        <button type="submit" className="pw-login__submit" id="pwLoginSubmit" disabled={busy}>
          {unlocking ? (
            <>
              <i className="fa-solid fa-check" aria-hidden="true"></i> Logged in
            </>
          ) : busy ? (
            <>
              <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Checking password
            </>
          ) : (
            <>
              <i className="fa-solid fa-lock-open" aria-hidden="true"></i> Log in
            </>
          )}
        </button>
      </form>

      {unlocking ? (
        <>
          <p className="pw-login__welcome" role="status" aria-label={welcome}>
            {Array.from(welcome).map((ch, i) => (
              <span key={i} style={{ "--i": i }} aria-hidden="true">
                {ch === " " ? " " : ch}
              </span>
            ))}
          </p>
          <div className="pw-login__ring" aria-hidden="true"></div>
        </>
      ) : null}
    </div>
  )
}
