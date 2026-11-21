import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, HTMLAttributes, ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, snapCenterToCursor } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../data/store'
import type { Task, TaskGroup } from '../types'
import { SelectionScope } from '../lib/selection'
import { byPosition, sortKey } from '../lib/reminders'
import TaskList, { EmptyIcon, SkeletonRows } from './TaskList'
import ConfirmDialog from './ConfirmDialog'
import { LIMITS } from '../lib/limits'
import { useLongPress } from '../lib/useLongPress'

// Selection "owner" id for group selection. The task lists inside groups use
// their own ids, so starting one kind of selection quietly ends the other.
const GROUPS = 'groups'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

// Remember which groups are collapsed, per browser.
const COLLAPSED_KEY = 'todo.collapsedGroups'

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function writeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {
    // Not important enough to report.
  }
}

export default function GroupsView() {
  const store = useStore()
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)
  const [toDelete, setToDelete] = useState<TaskGroup | null>(null)
  // Which group's list is in selection mode (only one at a time).
  const [selectionOwner, setSelectionOwner] = useState<string | null>(null)

  // Tasks for every group, fetched together with the groups (one request
  // instead of one per group). Each group's list starts from these.
  const [tasksByGroup, setTasksByGroup] = useState<Map<string, Task[]>>(new Map())

  // The group being dragged. While set, every group shows only its header,
  // so the list is short and easy to reorder; they reopen on drop.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const sensors = useSensors(
    // Small distance so a tap on the handle isn't treated as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Keyboard: focus the handle, Space to pick up, arrows to move, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const ordered = [...groups].sort(byPosition)

  // ---------- Selecting several groups (long-press a header) ----------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const activeSelection = selectionOwner === GROUPS ? selectedIds : new Set<string>()
  const selectingGroups = activeSelection.size > 0

  function toggleSelected(id: string) {
    const next = new Set(selectionOwner === GROUPS ? selectedIds : [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
    setSelectionOwner(next.size ? GROUPS : null)
  }

  function clearSelected() {
    setSelectedIds(new Set())
    setSelectionOwner((cur) => (cur === GROUPS ? null : cur))
  }

  // Escape leaves selection mode (inside a dialog, Escape just closes it).
  useEffect(() => {
    if (!selectingGroups) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      setSelectedIds(new Set())
      setSelectionOwner((cur) => (cur === GROUPS ? null : cur))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectingGroups])

  async function deleteSelected() {
    const ids = [...activeSelection]
    const targets = new Set(ids)
    const before = groups
    setConfirmingBulk(false)
    clearSelected()
    setGroups((prev) => prev.filter((g) => !targets.has(g.id)))
    try {
      await store.deleteGroups(ids)
    } catch (err) {
      setGroups(before)
      setError(errorText(err))
    }
  }

  const selectedGroups = ordered.filter((g) => activeSelection.has(g.id))
  const selectedTaskCount = selectedGroups.reduce((sum, g) => sum + g.task_count, 0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const { groups: list, tasks } = await store.listGroupsWithTasks()
        if (cancelled) return
        const byGroup = new Map<string, Task[]>()
        for (const t of tasks) {
          if (!t.group_id) continue
          byGroup.set(t.group_id, [...(byGroup.get(t.group_id) ?? []), t])
        }
        setTasksByGroup(byGroup)
        setGroups(list)
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
  }, [store])

  async function createGroup(e: FormEvent) {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) return

    setName('')
    setError(null)
    try {
      // New groups go to the top.
      const top = ordered.length ? sortKey(ordered[0]) - 1 : 0
      const group = await store.addGroup(clean, top)
      setGroups((prev) => [group, ...prev])
    } catch (err) {
      setError(errorText(err))
      setName(clean)
    }
  }

  async function deleteGroup(group: TaskGroup) {
    setToDelete(null)
    try {
      await store.deleteGroup(group.id)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
    } catch (err) {
      setError(errorText(err))
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeCollapsed(next)
      return next
    })
  }

  // Keep the header counts in step with the lists inside each group.
  const setCount = useCallback((id: string, count: number) => {
    setGroups((prev) =>
      prev.some((g) => g.id === id && g.task_count !== count)
        ? prev.map((g) => (g.id === id ? { ...g, task_count: count } : g))
        : prev
    )
  }, [])

  // ---------- Reordering groups ----------

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingId(String(active.id))
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const movedId = String(active.id)
    setDraggingId(null)
    // Once the groups have reopened, bring the moved one back into view.
    requestAnimationFrame(() =>
      document.getElementById(`group-${movedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
    if (!over || active.id === over.id) return
    const from = ordered.findIndex((g) => g.id === active.id)
    const to = ordered.findIndex((g) => g.id === over.id)
    if (from < 0 || to < 0) return

    // Halfway between the new neighbours, so only this one group is saved.
    const moved = arrayMove(ordered, from, to)
    const above = moved[to - 1]
    const below = moved[to + 1]
    const position =
      above && below ? (sortKey(above) + sortKey(below)) / 2 : above ? sortKey(above) + 1 : sortKey(below) - 1

    const group = ordered[from]
    const setPosition = (pos: number | null | undefined) =>
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, position: pos } : g)))
    setPosition(position)
    try {
      await store.updateGroup(group.id, { position })
    } catch (err) {
      setPosition(group.position)
      setError(errorText(err))
    }
  }

  const dragged = draggingId ? ordered.find((g) => g.id === draggingId) : undefined

  const scope = {
    owner: selectionOwner,
    claim: setSelectionOwner,
    release: (id: string) => setSelectionOwner((cur) => (cur === id ? null : cur)),
  }

  return (
    <SelectionScope value={scope}>
      <section>
        <form className="quick-add" onSubmit={createGroup}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New group, e.g. Groceries"
            aria-label="New group name"
            maxLength={LIMITS.groupName}
            enterKeyHint="done"
          />
          <button
            className="quick-add-btn submit"
            type="submit"
            disabled={!name.trim()}
            aria-label="Create group"
            title="Create group (Enter)"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </form>

        {error && <p className="message error" role="alert">{error}</p>}

        {loading ? (
          <div className="group-stack" aria-busy="true" aria-label="Loading groups">
            {[0, 1].map((i) => (
              <section key={i} className="group-section">
                <div className="group-section-head skeleton-head">
                  <span className="skel skel-line" style={{ width: i ? '30%' : '42%' }} />
                </div>
                <div className="group-section-body compact">
                  <SkeletonRows count={2} />
                </div>
              </section>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state" role="status">
            <EmptyIcon size={72} />
            <p className="empty-title">No groups yet</p>
            <p className="empty-sub">Create one to keep related tasks together.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            // Groups shrink to their headers when a drag starts, so keep re-measuring.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            <SortableContext items={ordered.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              <div className={`group-stack${draggingId ? ' sorting' : ''}`}>
                {ordered.map((g) => {
                  const open = !collapsed.has(g.id)
                  const bodyId = `group-body-${g.id}`
                  const selected = activeSelection.has(g.id)
                  return (
                    <SortableGroup key={g.id} group={g} disabled={selectingGroups} selected={selected}>
                      {(handle) => (
                        <>
                          <GroupHeader
                            group={g}
                            open={open}
                            bodyId={bodyId}
                            handle={handle}
                            selecting={selectingGroups}
                            selected={selected}
                            onToggle={() => (selectingGroups ? toggleSelected(g.id) : toggleCollapsed(g.id))}
                            onLongPress={() => toggleSelected(g.id)}
                            onDelete={() => setToDelete(g)}
                          />
                          {/* Collapsed groups stay mounted (just hidden), so their
                              tasks don't need loading again when reopened. */}
                          <div id={bodyId} className="group-section-body" hidden={!open || draggingId !== null}>
                            <TaskList
                              groupId={g.id}
                              compact
                              placeholder={`Add something to ${g.name}`}
                              onCountChange={(count) => setCount(g.id, count)}
                              initialTasks={tasksByGroup.get(g.id) ?? []}
                            />
                          </div>
                        </>
                      )}
                    </SortableGroup>
                  )
                })}
              </div>
            </SortableContext>

            {/* What follows your finger while dragging: just the header.
                The groups collapse as the drag starts, so the card is pinned
                to the pointer rather than to where the header used to be. */}
            <DragOverlay modifiers={[snapCenterToCursor, restrictToVerticalAxis]}>
              {dragged && (
                <section className="group-section drag-overlay">
                  <GroupHeader group={dragged} open={false} bodyId="" />
                </section>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {selectingGroups && (
          <div className="selection-bar" role="toolbar" aria-label="Selected groups">
            <button type="button" className="icon-btn plain" onClick={clearSelected} aria-label="Cancel selection">
              ×
            </button>
            <span className="selection-count" aria-live="polite">
              {activeSelection.size} {activeSelection.size === 1 ? 'group' : 'groups'}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (activeSelection.size === groups.length) {
                  clearSelected()
                } else {
                  setSelectedIds(new Set(groups.map((g) => g.id)))
                  setSelectionOwner(GROUPS)
                }
              }}
            >
              {activeSelection.size === groups.length ? 'Select none' : 'Select all'}
            </button>
            <span className="spacer" />
            <button type="button" className="btn danger small" onClick={() => setConfirmingBulk(true)}>
              Delete
            </button>
          </div>
        )}

        {confirmingBulk && (
          <ConfirmDialog
            title={`Delete ${selectedGroups.length} ${selectedGroups.length === 1 ? 'group' : 'groups'}?`}
            message={
              selectedTaskCount > 0
                ? `This also deletes the ${selectedTaskCount} ${selectedTaskCount === 1 ? 'task' : 'tasks'} inside them. This can't be undone.`
                : "This can't be undone."
            }
            confirmLabel="Delete"
            onConfirm={deleteSelected}
            onCancel={() => setConfirmingBulk(false)}
          />
        )}

        {toDelete && (
          <ConfirmDialog
            title={`Delete "${toDelete.name}"?`}
            message={
              toDelete.task_count > 0
                ? `This also deletes the ${toDelete.task_count} ${toDelete.task_count === 1 ? 'task' : 'tasks'} inside it. This can't be undone.`
                : "This can't be undone."
            }
            confirmLabel="Delete group"
            onConfirm={() => deleteGroup(toDelete)}
            onCancel={() => setToDelete(null)}
          />
        )}
      </section>
    </SelectionScope>
  )
}

// ---------- One group card ----------

interface Handle {
  setNode: (el: HTMLElement | null) => void
  props: HTMLAttributes<HTMLButtonElement>
}

/** A group card that can be dragged by the grip in its header. */
function SortableGroup({
  group,
  disabled,
  selected,
  children,
}: {
  group: TaskGroup
  disabled: boolean
  selected: boolean
  children: (handle: Handle) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled })
  const classes = ['group-section']
  if (isDragging) classes.push('drag-placeholder')
  if (selected) classes.push('selected')
  return (
    <section
      ref={setNodeRef}
      id={`group-${group.id}`}
      className={classes.join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children({ setNode: setActivatorNodeRef, props: { ...attributes, ...listeners } })}
    </section>
  )
}

function GroupHeader({
  group,
  open,
  bodyId,
  handle,
  selecting = false,
  selected = false,
  onToggle,
  onLongPress,
  onDelete,
}: {
  group: TaskGroup
  open: boolean
  bodyId: string
  handle?: Handle
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
  onLongPress?: () => void
  onDelete?: () => void
}) {
  const longPress = useLongPress(() => onLongPress?.())
  return (
    <header className="group-section-head" {...(onLongPress ? longPress : {})}>
      {selecting ? (
        <button
          type="button"
          className={`select-mark${selected ? ' on' : ''}`}
          data-no-longpress
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={`Select group "${group.name}"`}
        />
      ) : (
        <button
          ref={handle?.setNode}
          type="button"
          className="drag-handle"
          data-no-longpress
          aria-label={`Move group "${group.name}"`}
          title="Drag to reorder"
          {...handle?.props}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            {[4, 8, 12].map((y) => (
              <g key={y} fill="currentColor">
                <circle cx="6" cy={y} r="1.3" />
                <circle cx="10" cy={y} r="1.3" />
              </g>
            ))}
          </svg>
        </button>
      )}
      <button
        type="button"
        className="group-toggle"
        onClick={onToggle}
        aria-expanded={selecting ? undefined : open}
        aria-controls={selecting ? undefined : bodyId || undefined}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `Select group "${group.name}"` : undefined}
      >
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
        <span className="group-name">{group.name}</span>
        <span className="group-count">{group.task_count}</span>
      </button>
      {!selecting && (
        <button
          type="button"
          className="icon-btn"
          data-no-longpress
          onClick={onDelete}
          aria-label={`Delete group "${group.name}"`}
        >
          ×
        </button>
      )}
    </header>
  )
}
