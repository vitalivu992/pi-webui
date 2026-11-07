import { useCallback, useEffect, useRef, useState } from "react"

/**
 * `const [dialog, confirm] = useConfirm()`: render `dialog`, then
 * `await confirm({ title, body, confirm, danger })` resolves true when confirmed.
 */
export function useConfirm() {
  const [ask, setAsk] = useState(null)
  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), [])
  const close = (ok) => {
    ask?.resolve(ok)
    setAsk(null)
  }
  return [<ConfirmDialog key="confirm" ask={ask} onClose={close} />, confirm]
}

function ConfirmDialog({ ask, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (ask && !dialog.open) dialog.showModal()
    if (!ask && dialog.open) dialog.close()
  }, [ask])

  return (
    <dialog
      ref={ref}
      className="pw-dialog"
      id="pwConfirm"
      aria-labelledby="pwConfirmTitle"
      onCancel={(e) => {
        e.preventDefault()
        onClose(false)
      }}
      onClick={(e) => e.target === e.currentTarget && onClose(false)}
    >
      {ask ? (
        <>
          <h2 className="pw-dialog__title" id="pwConfirmTitle">
            {ask.title}
          </h2>
          {ask.body ? <p className="pw-dialog__body">{ask.body}</p> : null}
          <div className="pw-dialog__actions">
            <button type="button" className="pw-btn" onClick={() => onClose(false)} autoFocus>
              Cancel
            </button>
            <button type="button" className={`pw-btn ${ask.danger === false ? "pw-btn--primary" : "pw-btn--danger"}`} id="pwConfirmOk" onClick={() => onClose(true)}>
              {ask.confirm || "OK"}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  )
}
