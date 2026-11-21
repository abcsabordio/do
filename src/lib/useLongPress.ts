import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

const HOLD_MS = 500
const MOVE_TOLERANCE = 10 // px; moving further means scrolling, not holding

/**
 * Fires `onLongPress` when a pointer (finger or mouse) is held still on the
 * element. Spread the returned handlers onto the element.
 *
 * Elements marked with data-no-longpress (buttons, the drag handle,
 * checkboxes) are ignored, so they keep working normally.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  function cancel() {
    window.clearTimeout(timer.current)
    timer.current = undefined
    origin.current = null
  }

  return {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[data-no-longpress]')) return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        fired.current = true
        origin.current = null
        navigator.vibrate?.(25) // small buzz on phones that support it
        onLongPress()
      }, HOLD_MS)
    },
    onPointerMove(e: PointerEvent) {
      if (!origin.current) return
      const moved = Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y)
      if (moved > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // The click that follows a long press must not also count as a tap.
    onClickCapture(e: MouseEvent) {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
    // Stop the phone's own long-press menu (copy / share) from popping up.
    onContextMenu(e: MouseEvent) {
      if (fired.current || timer.current !== undefined) e.preventDefault()
    },
  }
}
