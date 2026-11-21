import { useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'

interface Props {
  digits: string[] // one entry per box, '' when empty
  onChange: (digits: string[]) => void
  onComplete?: (code: string) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

/**
 * Six separate boxes for a one-time code.
 * Typing moves forward, Backspace moves back, and pasting (or the phone's
 * "fill code from Messages/Mail" suggestion) spreads digits across the boxes.
 */
export default function CodeInput({ digits, onChange, onComplete, disabled, invalid, describedBy }: Props) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const length = digits.length

  function focusBox(i: number) {
    const box = boxes.current[Math.max(0, Math.min(length - 1, i))]
    box?.focus()
    box?.select()
  }

  function commit(next: string[]) {
    onChange(next)
    if (next.every((d) => d !== '')) onComplete?.(next.join(''))
  }

  // Put a run of digits into the boxes starting at `start`.
  function fill(start: number, incoming: string) {
    const clean = incoming.replace(/\D/g, '').slice(0, length - start)
    if (!clean) return
    const next = [...digits]
    for (let k = 0; k < clean.length; k++) next[start + k] = clean[k]
    commit(next)
    focusBox(start + clean.length)
  }

  function handleChange(i: number, value: string) {
    if (value === '') {
      const next = [...digits]
      next[i] = ''
      onChange(next)
      return
    }
    let clean = value.replace(/\D/g, '')
    // A full code at once means autofill; always start it from the first box.
    if (clean.length >= length) return fill(0, clean)
    // Typed into a box that already had a digit: keep only the new one.
    if (digits[i] && clean.length > 1) clean = clean.replace(digits[i], '')
    fill(i, clean)
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[i] === '' && i > 0) {
      e.preventDefault()
      const next = [...digits]
      next[i - 1] = ''
      onChange(next)
      focusBox(i - 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusBox(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusBox(i + 1)
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    fill(text.replace(/\D/g, '').length >= length ? 0 : i, text)
  }

  return (
    <div className={`code-input${invalid ? ' invalid' : ''}`} role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? length : 1} // first box accepts a full autofilled code
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          autoFocus={i === 0}
        />
      ))}
    </div>
  )
}
