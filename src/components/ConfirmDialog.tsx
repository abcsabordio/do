import { useEffect, useRef } from 'react'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** A small "Are you sure?" modal for destructive actions. */
export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="sheet confirm"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onClose={onCancel} // Escape key or Cancel
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
    >
      <div className="sheet-body">
        <div className="confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20">
            <path
              d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-message" className="confirm-message">{message}</p>
        <div className="sheet-actions">
          {/* Cancel gets focus first, so pressing Enter by accident is harmless. */}
          <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn danger-solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
