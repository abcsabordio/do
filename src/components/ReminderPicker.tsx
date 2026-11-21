import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { formatReminder } from '../lib/reminders'

interface Props {
  id?: string
  value: string | null // ISO timestamp, or null for no reminder
  onChange: (value: string | null) => void
  now: Date
  invalid?: boolean
  describedBy?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function at(day: Date, hours: number, minutes = 0) {
  const d = new Date(day)
  d.setHours(hours, minutes, 0, 0)
  return d
}

function addDays(day: Date, n: number) {
  const d = new Date(day)
  d.setDate(d.getDate() + n)
  return d
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// Does this person's locale use a 12-hour clock (with AM/PM)?
const USES_12H = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false

const shortTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })

/** One-tap choices at the top of the picker. */
function presets(now: Date) {
  const list: { label: string; date: Date }[] = []
  const inAnHour = new Date(now)
  inAnHour.setHours(now.getHours() + 1, now.getMinutes() < 30 ? 0 : 30, 0, 0)
  if (sameDay(inAnHour, now)) list.push({ label: 'In 1 hour', date: inAnHour })
  if (now.getHours() < 17) list.push({ label: 'Tonight', date: at(now, 18) })
  list.push({ label: 'Tomorrow', date: at(addDays(now, 1), 9) })
  const day = now.getDay() // 0 = Sunday
  if (day >= 1 && day <= 4) list.push({ label: 'Weekend', date: at(addDays(now, 6 - day), 10) })
  list.push({ label: 'Next week', date: at(addDays(now, ((8 - day) % 7) || 7), 9) }) // next Monday
  return list
}

/** Where the picker starts when there's no reminder yet: the next full hour, or tomorrow 9:00. */
function startingPoint(now: Date) {
  const next = at(now, now.getHours() + 1)
  return sameDay(next, now) && next.getHours() <= 21 ? next : at(addDays(now, 1), 9)
}

/**
 * Reminder field: a summary button that opens a modal with quick picks,
 * a month calendar and tap-to-choose time columns. Nothing changes until
 * "Set" is pressed; Cancel throws the draft away.
 */
export default function ReminderPicker({ id, value, onChange, now, invalid, describedBy }: Props) {
  const selected = value ? new Date(value) : null
  const [open, setOpen] = useState(false)

  return (
    <div className="reminder">
      <div className={`picker-trigger${invalid ? ' invalid' : ''}${selected ? ' has-value' : ''}`}>
        <button
          id={id}
          type="button"
          className="picker-main"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-describedby={describedBy}
        >
          <BellIcon />
          <span>{selected ? formatReminder(selected, now) : 'Add reminder'}</span>
          <span className="chevron down" aria-hidden="true" />
        </button>
        {selected && (
          <button type="button" className="picker-clear" onClick={() => onChange(null)} aria-label="Remove reminder">
            ×
          </button>
        )}
      </div>

      {open && (
        <PickerDialog
          initial={selected ?? startingPoint(now)}
          hasValue={!!selected}
          now={now}
          onSet={(d) => {
            onChange(d.toISOString())
            setOpen(false)
          }}
          onRemove={() => {
            onChange(null)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

// ---------- The modal ----------

interface DialogProps {
  initial: Date
  hasValue: boolean
  now: Date
  onSet: (date: Date) => void
  onRemove: () => void
  onClose: () => void
}

function PickerDialog({ initial, hasValue, now, onSet, onRemove, onClose }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(initial)
  const [view, setView] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1))

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  const past = draft <= now

  function pickDay(day: Date) {
    setDraft(at(day, draft.getHours(), draft.getMinutes()))
  }

  function pickPreset(date: Date) {
    setDraft(date)
    setView(new Date(date.getFullYear(), date.getMonth(), 1))
  }

  // ---------- Calendar grid ----------
  const year = view.getFullYear()
  const month = view.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = at(now, 0)
  const cells: (Date | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ]
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 1, i + 1).toLocaleDateString(undefined, { weekday: 'narrow' }) // Feb 1 2026 is a Sunday
  )
  const canGoBack = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth())

  return (
    <dialog
      ref={ref}
      className="sheet dt-sheet"
      aria-labelledby="dt-title"
      // This dialog sits inside the task editor's dialog. Stop Escape and
      // close from reaching the editor, which would close it too.
      onCancel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      onClose={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose() // backdrop
      }}
    >
      <div className="dt-body">
        <div className="sheet-head">
          <h2 id="dt-title">Remind me</h2>
          <button type="button" className="icon-btn plain" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className={`dt-summary${past ? ' past' : ''}`} aria-live="polite">
          <BellIcon />
          {formatReminder(draft, now)}
        </p>

        <div className="preset-row" role="group" aria-label="Quick picks">
          {presets(now).map((p) => {
            const active = draft.getTime() === p.date.getTime()
            const when =
              p.label === 'Weekend' || p.label === 'Next week'
                ? p.date.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + shortTime(p.date)
                : shortTime(p.date)
            return (
              <button
                key={p.label}
                type="button"
                className={`chip${active ? ' active' : ''}`}
                onClick={() => pickPreset(p.date)}
                aria-pressed={active}
              >
                {p.label}
                <small>{when}</small>
              </button>
            )
          })}
        </div>

        <div className="dt-grid">
          <div className="calendar">
            <div className="calendar-head">
              <span className="cal-title" aria-live="polite">
                {view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <div className="cal-navs">
                <button
                  type="button"
                  className="cal-nav"
                  onClick={() => setView(new Date(year, month - 1, 1))}
                  disabled={!canGoBack}
                  aria-label="Previous month"
                >
                  <Chevron dir="left" />
                </button>
                <button
                  type="button"
                  className="cal-nav"
                  onClick={() => setView(new Date(year, month + 1, 1))}
                  aria-label="Next month"
                >
                  <Chevron dir="right" />
                </button>
              </div>
            </div>

            <div className="cal-grid">
              {weekdays.map((w, i) => (
                <span key={i} className="cal-weekday" aria-hidden="true">
                  {w}
                </span>
              ))}
              {cells.map((day, i) =>
                day ? (
                  <button
                    key={i}
                    type="button"
                    className={['cal-day', sameDay(day, now) && 'today', sameDay(day, draft) && 'selected']
                      .filter(Boolean)
                      .join(' ')}
                    disabled={day < today}
                    onClick={() => pickDay(day)}
                    aria-label={day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    aria-pressed={sameDay(day, draft)}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span key={i} />
                )
              )}
            </div>
          </div>

          <TimeColumns value={draft} onChange={(h, m) => setDraft(at(draft, h, m))} />
        </div>

        {past && <p className="dt-warning">That time has already passed. Pick a later time.</p>}

        <div className="dt-actions">
          {hasValue && (
            <button type="button" className="btn ghost danger-text" onClick={onRemove}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onSet(draft)}>
            Set reminder
          </button>
        </div>
      </div>
    </dialog>
  )
}

// ---------- Time: ▲ / ▼ steppers for hour, minute and AM/PM ----------

const DAY_MINUTES = 24 * 60
const MINUTE_STEP = 5

function TimeColumns({ value, onChange }: { value: Date; onChange: (h: number, m: number) => void }) {
  const h = value.getHours()
  const m = value.getMinutes()
  const pm = h >= 12
  const shownHour = USES_12H ? h % 12 || 12 : h

  // Everything moves within the same day (wrapping at midnight).
  function setTotal(total: number) {
    const t = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
    onChange(Math.floor(t / 60), t % 60)
  }
  const stepHour = (dir: 1 | -1) => setTotal(h * 60 + m + dir * 60)
  // Snap to the 5-minute grid; 55 → 00 rolls the hour over.
  const stepMinute = (dir: 1 | -1) => {
    const total = h * 60 + m
    const snapped = dir > 0 ? Math.floor(total / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP : Math.ceil(total / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP
    setTotal(snapped)
  }
  const flipHalf = () => setTotal(h * 60 + m + 12 * 60)

  const minuteRef = useRef<HTMLInputElement>(null)
  const ampmRef = useRef<HTMLInputElement>(null)

  // Typed values. Anything out of range is ignored (the old value comes back).
  const hourTyping: Typing = {
    // "1" could become 10–12 (or 1x in 24h), so wait; "5" can't, so it's done.
    isComplete: (raw) => raw.length === 2 || Number(raw[0]) >= (USES_12H ? 2 : 3),
    commit: (raw) => {
      const n = Number(raw)
      if (USES_12H ? n >= 1 && n <= 12 : n >= 0 && n <= 23) {
        onChange(USES_12H ? (n % 12) + (pm ? 12 : 0) : n, m)
      }
    },
    next: minuteRef,
  }
  const minuteTyping: Typing = {
    isComplete: (raw) => raw.length === 2 || Number(raw[0]) >= 6,
    commit: (raw) => {
      const n = Number(raw)
      if (n >= 0 && n <= 59) onChange(h, n)
    },
    next: USES_12H ? ampmRef : undefined,
  }

  return (
    <div className="time-steppers" role="group" aria-label="Time">
      <Stepper
        label="Hour"
        text={USES_12H ? String(shownHour) : pad(h)}
        valueNow={USES_12H ? shownHour : h}
        onStep={stepHour}
        typing={hourTyping}
      />
      <span className="time-colon" aria-hidden="true">:</span>
      <Stepper
        label="Minute"
        text={pad(m)}
        valueNow={m}
        onStep={stepMinute}
        typing={minuteTyping}
        inputRef={minuteRef}
      />
      {USES_12H && (
        <Stepper
          label="AM or PM"
          text={pm ? 'PM' : 'AM'}
          valueNow={pm ? 1 : 0}
          onStep={flipHalf}
          inputRef={ampmRef}
          narrowText
          // Press A or P, or tap it to flip.
          onLetter={(key) => {
            if (key === 'a' && pm) flipHalf()
            if (key === 'p' && !pm) flipHalf()
          }}
        />
      )}
    </div>
  )
}

interface Typing {
  /** True once enough digits are typed to move on to the next box. */
  isComplete: (raw: string) => boolean
  commit: (raw: string) => void
  next?: RefObject<HTMLInputElement | null>
}

/**
 * ▲ value ▼. Tap an arrow to step once; hold it to keep stepping.
 * The value is a text box: type digits, or use ↑/↓.
 */
function Stepper({
  label,
  text,
  valueNow,
  onStep,
  narrowText,
  typing,
  onLetter,
  inputRef,
}: {
  label: string
  text: string
  valueNow: number
  onStep: (dir: 1 | -1) => void
  narrowText?: boolean
  typing?: Typing
  onLetter?: (key: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  // What's been typed but not applied yet (null = show the real value).
  const [draft, setDraft] = useState<string | null>(null)

  function commitDraft() {
    if (typing && draft) typing.commit(draft)
    setDraft(null)
  }

  // Latest onStep, so a held button keeps stepping from the newest value.
  const stepRef = useRef(onStep)
  useEffect(() => {
    stepRef.current = onStep
  })
  const timer = useRef<number | undefined>(undefined)

  function stop() {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])

  function start(dir: 1 | -1) {
    stop()
    stepRef.current(dir)
    // Wait a moment, then repeat quickly while the button is held.
    const repeat = (delay: number) => {
      timer.current = window.setTimeout(() => {
        stepRef.current(dir)
        repeat(Math.max(60, delay * 0.85))
      }, delay)
    }
    repeat(400)
  }

  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      className="step-btn"
      aria-label={`${dir > 0 ? 'Increase' : 'Decrease'} ${label.toLowerCase()}`}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start(dir)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()} // long-press on phones
      onClick={(e) => {
        if (e.detail === 0) stepRef.current(dir) // keyboard "click" (no pointer)
      }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d={dir > 0 ? 'M3.5 10L8 5.5l4.5 4.5' : 'M3.5 6L8 10.5 12.5 6'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )

  return (
    <div className="stepper">
      {arrow(1)}
      <input
        ref={inputRef}
        className={`step-value${narrowText ? ' narrow' : ''}`}
        type="text"
        role="spinbutton"
        inputMode={typing ? 'numeric' : 'none'}
        readOnly={!typing}
        maxLength={2}
        autoComplete="off"
        aria-label={label}
        aria-valuenow={valueNow}
        aria-valuetext={text}
        value={draft ?? text}
        // Select everything on focus, so typing replaces the old value.
        onFocus={(e) => e.currentTarget.select()}
        onMouseUp={(e) => e.preventDefault()} // keep the selection after a click
        onClick={() => {
          if (!typing && onLetter) stepRef.current(1) // tap AM/PM to flip it
        }}
        onChange={(e) => {
          if (!typing) return
          const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
          if (!raw) {
            setDraft('')
            return
          }
          if (typing.isComplete(raw)) {
            typing.commit(raw)
            setDraft(null)
            const next = typing.next?.current
            if (next) next.focus()
            else e.target.select()
          } else {
            setDraft(raw)
          }
        }}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (onLetter && /^[ap]$/i.test(e.key)) {
            e.preventDefault()
            onLetter(e.key.toLowerCase())
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            commitDraft()
            e.currentTarget.select()
            return
          }
          const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
          if (!dir) return
          e.preventDefault()
          setDraft(null)
          stepRef.current(dir)
        }}
      />
      {arrow(-1)}
    </div>
  )
}

// ---------- Icons ----------

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3.5L5.5 8l4.5 4.5' : 'M6 3.5L10.5 8 6 12.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 2.2a3.6 3.6 0 0 0-3.6 3.6v2.4L3.2 10.6h9.6l-1.2-2.4V5.8A3.6 3.6 0 0 0 8 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.6 12.6a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
