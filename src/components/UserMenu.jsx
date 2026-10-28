import { useEffect, useRef, useState } from "react"
import { greeting } from "../lib/format.js"
import { THEMES, setTheme } from "../lib/theme.js"
import { useTheme } from "../hooks/useTheme.js"

const THEME_META = {
  system: { icon: "fa-circle-half-stroke", label: "System theme" },
  light: { icon: "fa-sun", label: "Light theme" },
  dark: { icon: "fa-moon", label: "Dark theme" },
}

/** Asks before logging out: it also ends every open shell. */
function LogoutDialog({ open, onCancel, onConfirm }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="pw-dialog"
      id="pwLogoutDialog"
      aria-labelledby="pwLogoutTitle"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <h2 className="pw-dialog__title" id="pwLogoutTitle">
        Log out?
      </h2>
      <p className="pw-dialog__body">Open terminal shells end too. You can log back in with your computer account.</p>
      <div className="pw-dialog__actions">
        <button type="button" className="pw-btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="pw-btn pw-btn--danger" id="pwLogoutConfirm" onClick={onConfirm}>
          <i className="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Log out
        </button>
      </div>
    </dialog>
  )
}

/**
 * The projects panel's footer: a greeting with the username and a kebab menu with Settings,
 * the theme (system / light / dark) and Log out, which asks first. `compact`
 * (the collapsed rail) shows only the kebab.
 */
export function UserMenu({ user, onLogout, onOpenSettings, compact = false }) {
  const { pref } = useTheme()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The greeting follows the time of day.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const root = useRef(null)
  const button = useRef(null)
  const menu = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    menu.current?.querySelector("[role^=menuitem]")?.focus()
    const outside = (e) => !root.current?.contains(e.target) && setOpen(false)
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [open])

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const items = [...menu.current.querySelectorAll("[role^=menuitem]")]
    const i = items.indexOf(document.activeElement)
    const step = e.key === "ArrowDown" ? 1 : -1
    items[(i + step + items.length) % items.length]?.focus()
  }

  return (
    <div className={`pw-user-menu${compact ? " pw-user-menu--compact" : ""}`} ref={root}>
      {compact ? null : (
        <span className="pw-user" title={`Logged in as ${user}`}>
          <i className="fa-solid fa-circle-user" aria-hidden="true"></i>
          <span className="pw-user__name">
            {greeting(now)}, <strong>{user}</strong>
          </span>
        </span>
      )}
      <button
        type="button"
        ref={button}
        className={`pw-icon-btn${open ? " is-open" : ""}`}
        id={compact ? undefined : "pwUserMenu"}
        onClick={() => setOpen(!open)}
        title={`Logged in as ${user}`}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i>
      </button>
      {open ? (
        <div className="pw-menu" role="menu" aria-label="Account" ref={menu} onKeyDown={onKeyDown}>
          <p className="pw-menu__head">
            Logged in as <strong>{user}</strong>
          </p>
          <div className="pw-menu__divider" role="separator"></div>
          <button
            type="button"
            role="menuitem"
            className="pw-menu__item"
            id={compact ? undefined : "pwOpenSettings"}
            onClick={() => {
              setOpen(false)
              onOpenSettings?.()
            }}
          >
            <i className="fa-solid fa-gear" aria-hidden="true"></i>
            <span>Settings</span>
          </button>
          <div className="pw-menu__divider" role="separator"></div>
          <p className="pw-menu__group">Theme</p>
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={pref === t}
              className="pw-menu__item"
              onClick={() => setTheme(t)}
            >
              <i className={`fa-solid ${THEME_META[t].icon}`} aria-hidden="true"></i>
              <span>{THEME_META[t].label}</span>
              {pref === t ? <i className="fa-solid fa-check pw-menu__check" aria-hidden="true"></i> : null}
            </button>
          ))}
          <div className="pw-menu__divider" role="separator"></div>
          <button
            type="button"
            role="menuitem"
            className="pw-menu__item"
            id={compact ? undefined : "pwLogout"}
            onClick={() => {
              setOpen(false)
              setConfirming(true)
            }}
          >
            <i className="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
            <span>Log out…</span>
          </button>
        </div>
      ) : null}
      <LogoutDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onLogout()
        }}
      />
    </div>
  )
}
