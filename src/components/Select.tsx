import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string // smaller grey text on the right
}

interface Props<T extends string> {
  id?: string
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  disabledText?: string // shown instead of the value while disabled
}

/**
 * A dropdown styled to match the app (the browser's own <select> menu can't
 * be styled). Works with mouse, touch and keyboard:
 * arrows move, Enter/Space picks, Escape closes.
 */
export default function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  disabledText,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const currentIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const current = options[currentIndex]

  // Close when tapping anywhere outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    listRef.current?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  function openMenu() {
    if (disabled) return
    setActive(currentIndex)
    setOpen(true)
  }

  function pick(i: number) {
    onChange(options[i].value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onButtonKey(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      openMenu()
    }
  }

  function onListKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(options.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') pick(active)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      buttonRef.current?.focus()
    } else return
    // Stop Escape from also closing the surrounding dialog.
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className={`select${open ? ' open' : ''}`} ref={rootRef}>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        className="select-button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onButtonKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="select-value">{disabled && disabledText ? disabledText : current?.label}</span>
        <span className="chevron down" aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          className="select-menu"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`select-option${i === active ? ' active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span className="select-check" aria-hidden="true">{o.value === value ? '✓' : ''}</span>
              <span className="select-label">{o.label}</span>
              {o.hint && <span className="select-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
