import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Repeat } from '../types'
import { repeatLabel } from '../lib/reminders'
import ReminderPicker from './ReminderPicker'
import Select from './Select'
import { useStore } from '../data/store'
import { useNotifications } from '../lib/useNotifications'

export interface TaskDetails {
  title: string
  notes: string | null
  remind_at: string | null
  repeat: Repeat | null
}

interface Props {
  mode: 'create' | 'edit'
  initial: TaskDetails
  onSave: (details: TaskDetails) => Promise<void>
  onClose: () => void
}

const TITLE_MAX = 200
const DESCRIPTION_MAX = 2000

/**
 * A pop-up form for a task's title, description, reminder and repeat.
 * Uses the native <dialog> element: it traps focus, closes on Escape,
 * and shows as a bottom sheet on phones (see .sheet in index.css).
 */
export default function TaskEditor({ mode, initial, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.notes ?? '')
  const [remindAt, setRemindAt] = useState<string | null>(initial.remind_at)
  const [repeat, setRepeat] = useState<Repeat | 'none'>(initial.repeat ?? 'none')
  const [errors, setErrors] = useState<{ title?: string; remind?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)
  const [now] = useState(() => new Date())
  const notify = useNotifications(useStore().kind)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const reminderDate = remindAt ? new Date(remindAt) : undefined

  function validate() {
    const next: typeof errors = {}
    if (!title.trim()) next.title = 'Give the task a name.'
    // A one-off reminder in the past would never go off. Repeating ones
    // are fine: they roll forward to the next occurrence.
    if (remindAt && repeat === 'none' && new Date(remindAt) <= new Date()) {
      next.remind = 'Pick a time in the future.'
    }
    return next
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (found.title || found.remind) return

    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        notes: description.trim() || null,
        remind_at: remindAt,
        repeat: remindAt && repeat !== 'none' ? repeat : null,
      })
      onClose()
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save the task.' })
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="editor-title"
      onClose={onClose}
      // Clicking the dark backdrop (outside the panel) closes the dialog.
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
    >
      <form className="sheet-body" onSubmit={handleSubmit} noValidate>
        <div className="sheet-head">
          <h2 id="editor-title">{mode === 'create' ? 'New task' : 'Edit task'}</h2>
          <button
            type="button"
            className="icon-btn plain"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="field">
          <label htmlFor="task-title">Title</label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (errors.title) setErrors((p) => ({ ...p, title: undefined }))
            }}
            maxLength={TITLE_MAX}
            placeholder="What needs doing?"
            aria-invalid={!!errors.title || undefined}
            aria-describedby={errors.title ? 'task-title-error' : undefined}
            autoFocus={!initial.title}
          />
          {errors.title && <p id="task-title-error" className="field-error">{errors.title}</p>}
        </div>

        <div className="field">
          <label htmlFor="task-desc">
            Description <span className="optional">optional</span>
          </label>
          <textarea
            id="task-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="Notes, links, details…"
          />
        </div>

        <div className="field">
          <label htmlFor="task-remind">
            Reminder <span className="optional">optional</span>
          </label>
          <ReminderPicker
            id="task-remind"
            value={remindAt}
            now={now}
            onChange={(v) => {
              setRemindAt(v)
              if (!v) setRepeat('none')
              if (errors.remind) setErrors((p) => ({ ...p, remind: undefined }))
            }}
            invalid={!!errors.remind}
            describedBy={errors.remind ? 'task-remind-error' : undefined}
          />
          {errors.remind && <p id="task-remind-error" className="field-error">{errors.remind}</p>}
          {remindAt && notify.state === 'off' && (
            <div className="notify-hint">
              <span>{notify.error ?? "Turn on notifications so this reminder can reach you."}</span>
              <button type="button" className="btn primary small" onClick={notify.enable} disabled={notify.busy}>
                {notify.busy ? 'Turning on…' : 'Turn on'}
              </button>
            </div>
          )}
          {remindAt && notify.state === 'denied' && (
            <p className="notify-hint muted">
              Notifications are blocked for this site, so this reminder won't pop up. Allow them in your
              browser's site settings.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="task-repeat">Repeat</label>
          <Select<Repeat | 'none'>
            id="task-repeat"
            value={repeat}
            onChange={setRepeat}
            disabled={!remindAt}
            disabledText="Set a reminder first"
            options={[
              { value: 'none', label: "Doesn't repeat" },
              { value: 'daily', label: 'Daily', hint: repeatLabel('daily', reminderDate) },
              { value: 'weekly', label: 'Weekly', hint: repeatLabel('weekly', reminderDate) },
              { value: 'monthly', label: 'Monthly', hint: repeatLabel('monthly', reminderDate) },
            ]}
          />
        </div>

        {errors.form && <p className="message error" role="alert">{errors.form}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Add task' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
