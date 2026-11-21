import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../data/store'
import type { Task, TaskGroup } from '../types'
import { SelectionScope } from '../lib/selection'
import TaskList, { EmptyIcon, SkeletonRows } from './TaskList'
import ConfirmDialog from './ConfirmDialog'
import { LIMITS } from '../lib/limits'

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
      const group = await store.addGroup(clean)
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

  const scope = {
    owner: selectionOwner,
    claim: setSelectionOwner,
    release: (id: string) => setSelectionOwner((cur) => (cur === id ? null : cur)),
  }

  return (
    <SelectionScope value={scope}>
      <section>
        <form className="quick-add" onSubmit={createGroup}>
          <span className="quick-add-lead" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
              <path d="M2.8 6a1.6 1.6 0 0 1 1.6-1.6h3l1.7 1.7h6.5A1.6 1.6 0 0 1 17.2 7.7v6.7a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6z" />
            </svg>
          </span>
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
          <div className="group-stack">
            {groups.map((g) => {
              const open = !collapsed.has(g.id)
              const bodyId = `group-body-${g.id}`
              return (
                <section key={g.id} className={`group-section${open ? ' open' : ''}`}>
                  <header className="group-section-head">
                    <button
                      type="button"
                      className="group-toggle"
                      onClick={() => toggleCollapsed(g.id)}
                      aria-expanded={open}
                      aria-controls={bodyId}
                    >
                      <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
                      <span className="group-name">{g.name}</span>
                      <span className="group-count">{g.task_count}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setToDelete(g)}
                      aria-label={`Delete group "${g.name}"`}
                    >
                      ×
                    </button>
                  </header>
                  {/* Collapsed groups stay mounted (just hidden), so their
                      tasks don't need loading again when reopened. */}
                  <div id={bodyId} className="group-section-body" hidden={!open}>
                    <TaskList
                      groupId={g.id}
                      compact
                      placeholder={`Add something to ${g.name}`}
                      onCountChange={(count) => setCount(g.id, count)}
                      initialTasks={tasksByGroup.get(g.id) ?? []}
                    />
                  </div>
                </section>
              )
            })}
          </div>
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
