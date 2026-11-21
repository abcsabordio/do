import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UndoContext } from '../lib/undo'
import type { UndoAction } from '../lib/undo'

const UNDO_MS = 5000

/**
 * Shows one "Deleted … · Undo" toast at a time at the bottom of the screen.
 * The real delete only happens when the toast runs out.
 */
export default function UndoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(UndoAction & { key: number }) | null>(null)
  const pending = useRef<UndoAction | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const finish = useCallback((run: 'commit' | 'undo') => {
    window.clearTimeout(timer.current)
    const action = pending.current
    pending.current = null
    setCurrent(null)
    if (action) action[run]()
  }, [])

  const show = useCallback(
    (action: UndoAction) => {
      finish('commit') // a newer action replaces (and saves) the previous one
      pending.current = action
      setCurrent({ ...action, key: Date.now() })
      timer.current = window.setTimeout(() => finish('commit'), UNDO_MS)
    },
    [finish]
  )

  // Save anything still pending when signing out or closing the page.
  useEffect(() => {
    const flush = () => finish('commit')
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [finish])

  return (
    <UndoContext value={show}>
      {children}
      {current && (
        <div className="toast" role="status" key={current.key}>
          <span className="toast-text">{current.message}</span>
          <button type="button" className="toast-action" onClick={() => finish('undo')}>
            Undo
          </button>
          <span className="toast-timer" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden="true" />
        </div>
      )}
    </UndoContext>
  )
}
