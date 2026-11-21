import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { useStore } from '../data/store'
import type { Task, TaskChanges } from '../types'
import { byPosition, localTimeZone, sortKey } from '../lib/reminders'
import { SortableTaskRow, TaskRow } from './TaskRow'
import TaskEditor from './TaskEditor'
import type { TaskDetails } from './TaskEditor'
import ConfirmDialog from './ConfirmDialog'
import { useUndo } from '../lib/undo'
import { playCheck } from '../lib/sound'
import { useSelectionScope } from '../lib/selection'

interface Props {
  // null = tasks that don't belong to any group (the main Tasks tab)
  groupId: string | null
  // Shown inside a group section: smaller add box, no hint line.
  compact?: boolean
  placeholder?: string
  // Tells the parent how many tasks there are (for the group header count).
  onCountChange?: (count: number) => void
  // Tasks the parent already fetched. When given, the list skips its own load.
  initialTasks?: Task[]
}

type Editing = { mode: 'create'; initial: TaskDetails } | { mode: 'edit'; task: Task }

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export default function TaskList({ groupId, compact = false, placeholder, onCountChange, initialTasks }: Props) {
  const store = useStore()
  const showUndo = useUndo()
  const scope = useSelectionScope()
  const listId = groupId ?? 'ungrouped'
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [preloaded] = useState(() => initialTasks !== undefined)
  const [tasks, setTasks] = useState<Task[]>(initialTasks ?? [])
  const [loading, setLoading] = useState(!preloaded)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [showFinished, setShowFinished] = useState(true)
  const [editing, setEditing] = useState<Editing | null>(null)
  // Ids picked in selection mode. Selection mode is on while this isn't empty.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Ids that were just toggled. They stay in their old section for a moment
  // so the strike-through animation is visible before the task moves.
  const [settling, setSettling] = useState<Set<string>>(new Set())

  // Current time, refreshed every minute so "Today" / overdue labels stay right.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // If another list on screen took over selection, this one stops selecting.
  const ownsSelection = !scope || scope.owner === listId
  const selecting = ownsSelection && selected.size > 0

  useEffect(() => {
    onCountChange?.(tasks.length)
  }, [tasks.length, onCountChange])

  const sensors = useSensors(
    // Small distance so a tap on the handle isn't treated as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Keyboard: focus the handle, Space to pick up, arrows to move, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (preloaded) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const list = await store.listTasks(groupId)
        if (!cancelled) setTasks(list)
      } catch (err) {
        if (!cancelled) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [store, groupId, preloaded])

  // Escape leaves selection mode.
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      // Escape inside an open dialog just closes the dialog.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  function patchTasks(ids: string[], changes: TaskChanges) {
    const targets = new Set(ids)
    setTasks((prev) => prev.map((t) => (targets.has(t.id) ? { ...t, ...changes } : t)))
  }

  // New tasks go to the top of the list.
  const topPosition = () => (tasks.length ? Math.min(...tasks.map(sortKey)) - 1 : 0)

  // Reminders remember the time zone they were set in, so the server sends
  // "every Saturday 9 AM" at 9 AM your time, even across daylight saving.
  const withZone = (details: TaskDetails) =>
    details.remind_at ? { ...details, tz: localTimeZone() } : details

  async function createTask(details: TaskDetails) {
    const task = await store.addTask({ ...withZone(details), position: topPosition() }, groupId)
    setTasks((prev) => [task, ...prev])
  }

  async function quickAdd(e: FormEvent) {
    e.preventDefault()
    const clean = title.trim()
    if (!clean) return

    setTitle('')
    setError(null)
    try {
      await createTask({ title: clean, notes: null, remind_at: null, repeat: null })
    } catch (err) {
      setError(errorText(err))
      setTitle(clean) // give the text back so nothing is lost
    }
  }

  // Throws on failure so the editor can show the error and stay open.
  async function saveEdit(task: Task, details: TaskDetails) {
    const changes = withZone(details)
    await store.updateTask(task.id, changes)
    patchTasks([task.id], changes)
  }

  async function toggleTask(task: Task) {
    const nextDone = !task.is_done
    const completed_at = nextDone ? new Date().toISOString() : null

    // Update the screen first (optimistic), then save.
    if (nextDone) playCheck()
    patchTasks([task.id], { is_done: nextDone, completed_at })
    setSettling((prev) => new Set(prev).add(task.id))
    window.setTimeout(() => {
      setSettling((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }, 450)

    try {
      await store.updateTask(task.id, { is_done: nextDone, completed_at })
    } catch (err) {
      patchTasks([task.id], { is_done: task.is_done, completed_at: task.completed_at })
      setError(errorText(err))
    }
  }

  // Hide the task now, but only really delete it once the 5-second
  // "Undo" toast runs out.
  function deleteTask(task: Task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    const restore = () => setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev, task]))
    showUndo({
      message: `Deleted "${task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}"`,
      undo: restore,
      commit: () => {
        store.deleteTask(task.id).catch((err) => {
          restore()
          setError(errorText(err))
        })
      },
    })
  }

  // ---------- Selection mode ----------

  const activeSelected = ownsSelection ? selected : new Set<string>()

  function clearSelection() {
    setSelected(new Set())
    scope?.release(listId)
  }

  function toggleSelect(task: Task) {
    if (!ownsSelection) {
      // Starting a selection here ends any selection in another list.
      scope?.claim(listId)
      setSelected(new Set([task.id]))
      return
    }
    scope?.claim(listId)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(task.id)) next.delete(task.id)
      else next.add(task.id)
      return next
    })
  }

  const selectedTasks = tasks.filter((t) => activeSelected.has(t.id))
  const allSelectedDone = selectedTasks.length > 0 && selectedTasks.every((t) => t.is_done)

  async function markSelected() {
    const ids = [...activeSelected]
    const before = tasks
    const nextDone = !allSelectedDone
    const changes = { is_done: nextDone, completed_at: nextDone ? new Date().toISOString() : null }

    if (nextDone) playCheck()
    patchTasks(ids, changes)
    clearSelection()
    try {
      await store.updateTasks(ids, changes)
    } catch (err) {
      setTasks(before)
      setError(errorText(err))
    }
  }

  // Runs after the user confirms in the dialog.
  async function deleteSelected() {
    const ids = [...activeSelected]
    const targets = new Set(ids)
    const before = tasks
    setConfirmingDelete(false)
    setTasks((prev) => prev.filter((t) => !targets.has(t.id)))
    clearSelection()
    try {
      await store.deleteTasks(ids)
    } catch (err) {
      setTasks(before)
      setError(errorText(err))
    }
  }

  // ---------- Sections and ordering ----------

  // true = this task is shown in the "Finished" section right now
  const inFinishedSection = (t: Task) => (settling.has(t.id) ? !t.is_done : t.is_done)

  const openTasks = tasks.filter((t) => !inFinishedSection(t)).sort(byPosition)
  const finishedTasks = tasks
    .filter(inFinishedSection)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = openTasks.findIndex((t) => t.id === active.id)
    const to = openTasks.findIndex((t) => t.id === over.id)
    if (from < 0 || to < 0) return

    // Put the task halfway between its new neighbours, so only this one
    // row has to be saved.
    const moved = arrayMove(openTasks, from, to)
    const above = moved[to - 1]
    const below = moved[to + 1]
    const position =
      above && below
        ? (sortKey(above) + sortKey(below)) / 2
        : above
          ? sortKey(above) + 1
          : sortKey(below) - 1

    const task = openTasks[from]
    patchTasks([task.id], { position })
    try {
      await store.updateTask(task.id, { position })
    } catch (err) {
      patchTasks([task.id], { position: task.position })
      setError(errorText(err))
    }
  }

  const rowProps = (t: Task) => ({
    task: t,
    selecting,
    selected: activeSelected.has(t.id),
    onToggleDone: toggleTask,
    onDelete: deleteTask,
    onOpen: (task: Task) => setEditing({ mode: 'edit', task }),
    onLongPress: toggleSelect,
    onToggleSelect: toggleSelect,
    now,
  })

  return (
    <section className={[selecting && 'selecting', compact && 'compact'].filter(Boolean).join(' ') || undefined}>
      <form className="quick-add" onSubmit={quickAdd}>
        <span className="quick-add-lead" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder ?? 'What do you need to do?'}
          aria-label="New task"
          maxLength={200}
          enterKeyHint="done"
        />
        <button
          type="button"
          className="quick-add-btn details"
          onClick={() =>
            setEditing({
              mode: 'create',
              initial: { title: title.trim(), notes: null, remind_at: null, repeat: null },
            })
          }
          aria-label="Add task with details and reminder"
          title="Add details and reminder"
        >
          <DetailsIcon />
        </button>
        <button
          className="quick-add-btn submit"
          type="submit"
          disabled={!title.trim()}
          aria-label="Add task"
          title="Add task (Enter)"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      {error && <p className="message error" role="alert">{error}</p>}

      {loading ? (
        <SkeletonRows count={compact ? 2 : 4} />
      ) : (
        <>
          {openTasks.length === 0 && finishedTasks.length === 0 && (
            <div className="empty-state" role="status">
              <EmptyIcon size={compact ? 40 : 72} />
              <p className="empty-title">No tasks yet</p>
              {!compact && <p className="empty-sub">Type one above to get started.</p>}
            </div>
          )}
          {openTasks.length === 0 && finishedTasks.length > 0 && (
            <p className="empty">All done. Add another task above.</p>
          )}
          {openTasks.length > 1 && !selecting && !compact && (
            <p className="hint subtle">Drag ⠿ to reorder · Long-press a task to select several</p>
          )}

          {openTasks.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={openTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ul className="task-list">
                  {openTasks.map((t) => (
                    <SortableTaskRow key={t.id} {...rowProps(t)} disabled={selecting} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {finishedTasks.length > 0 && (
            <div className="finished">
              <button
                type="button"
                className="finished-toggle"
                onClick={() => setShowFinished((v) => !v)}
                aria-expanded={showFinished}
              >
                <span className={`chevron${showFinished ? ' open' : ''}`} aria-hidden="true" />
                Finished ({finishedTasks.length})
              </button>
              {showFinished && (
                <ul className="task-list">
                  {finishedTasks.map((t) => (
                    <TaskRow key={t.id} {...rowProps(t)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {selecting && (
        <div className="selection-bar" role="toolbar" aria-label="Selected tasks">
          <button
            type="button"
            className="icon-btn plain"
            onClick={clearSelection}
            aria-label="Cancel selection"
          >
            ×
          </button>
          <span className="selection-count" aria-live="polite">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              selected.size === tasks.length ? clearSelection() : setSelected(new Set(tasks.map((t) => t.id)))
            }
          >
            {selected.size === tasks.length ? 'Select none' : 'Select all'}
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary small" onClick={markSelected}>
            {allSelectedDone ? 'Mark not done' : 'Mark done'}
          </button>
          <button type="button" className="btn danger small" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${selected.size} ${selected.size === 1 ? 'task' : 'tasks'}?`}
          message="This can't be undone."
          confirmLabel="Delete"
          onConfirm={deleteSelected}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {editing && (
        <TaskEditor
          key={editing.mode === 'edit' ? editing.task.id : 'new'}
          mode={editing.mode}
          initial={
            editing.mode === 'edit'
              ? {
                  title: editing.task.title,
                  notes: editing.task.notes,
                  remind_at: editing.task.remind_at,
                  repeat: editing.task.repeat,
                }
              : editing.initial
          }
          onSave={async (details) => {
            if (editing.mode === 'edit') {
              await saveEdit(editing.task, details)
            } else {
              await createTask(details)
              setTitle('')
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

/** Grey placeholder rows shown while tasks load. */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <ul className="task-list skeleton" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="task">
          <span className="skel skel-dot" />
          <span className="skel skel-line" style={{ width: `${[70, 52, 64, 45][i % 4]}%` }} />
        </li>
      ))}
    </ul>
  )
}

/** An empty tray, shown when a list has no tasks. */
export function EmptyIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M10 36l7.5-18.5A4 4 0 0 1 21.2 15h21.6a4 4 0 0 1 3.7 2.5L54 36v11a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z"
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M10 36h12l3 6h14l3-6h12" stroke="currentColor" strokeWidth="2.2" />
      <path d="M32 4v5M20 7l2.5 4M44 7l-2.5 4" stroke="var(--accent)" strokeWidth="2.2" opacity="0.7" />
    </svg>
  )
}

function DetailsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M3.5 5.5h9M3.5 10h6M3.5 14.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14.5" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14.5 11.4V13l1 .8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
