import type { CSSProperties, HTMLAttributes, Ref } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../types'
import { useLongPress } from '../lib/useLongPress'
import { formatReminder, nextReminder, repeatLabel } from '../lib/reminders'

interface RowProps {
  task: Task
  selecting: boolean // selection mode is on (after a long press)
  selected: boolean
  onToggleDone: (task: Task) => void
  onDelete: (task: Task) => void
  onOpen: (task: Task) => void
  onLongPress: (task: Task) => void
  onToggleSelect: (task: Task) => void
  now: number // current time (ms), refreshed by the list every minute
}

// Supplied by SortableTaskRow so the row can be dragged.
interface DragProps {
  draggable?: boolean
  setRowNode?: Ref<HTMLLIElement>
  setHandleNode?: Ref<HTMLButtonElement>
  handleProps?: HTMLAttributes<HTMLButtonElement>
  dragStyle?: CSSProperties
  dragging?: boolean
}

export function TaskRow({
  task,
  selecting,
  selected,
  onToggleDone,
  onDelete,
  onOpen,
  onLongPress,
  onToggleSelect,
  now,
  draggable = false,
  setRowNode,
  setHandleNode,
  handleProps,
  dragStyle,
  dragging = false,
}: RowProps & DragProps) {
  const longPress = useLongPress(() => onLongPress(task))

  const classes = ['task']
  if (task.is_done) classes.push('is-done')
  if (selected) classes.push('selected')
  if (dragging) classes.push('dragging')

  return (
    <li ref={setRowNode} style={dragStyle} className={classes.join(' ')} {...longPress}>
      {!selecting &&
        (draggable ? (
          <button
            ref={setHandleNode}
            type="button"
            className="drag-handle"
            data-no-longpress
            aria-label={`Reorder "${task.title}"`}
            {...handleProps}
          >
            <GripIcon />
          </button>
        ) : (
          <span className="drag-spacer" aria-hidden="true" />
        ))}

      {selecting ? (
        <button
          type="button"
          className={`select-mark${selected ? ' on' : ''}`}
          data-no-longpress
          onClick={() => onToggleSelect(task)}
          aria-pressed={selected}
          aria-label={`Select "${task.title}"`}
        />
      ) : (
        <input
          type="checkbox"
          className="check"
          data-no-longpress
          checked={task.is_done}
          onChange={() => onToggleDone(task)}
          aria-label={`Mark "${task.title}" as ${task.is_done ? 'not done' : 'done'}`}
        />
      )}

      <button
        type="button"
        className="task-main"
        onClick={() => (selecting ? onToggleSelect(task) : onOpen(task))}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `Select "${task.title}"` : undefined}
      >
        <span className="task-title-wrap">
          <span className="task-title">{task.title}</span>
        </span>
        {task.notes && <span className="task-desc">{task.notes}</span>}
        {task.remind_at && <ReminderLine task={task} now={now} />}
      </button>

      {!selecting && (
        <button
          type="button"
          className="icon-btn"
          data-no-longpress
          onClick={() => onDelete(task)}
          aria-label={`Delete "${task.title}"`}
        >
          ×
        </button>
      )}
    </li>
  )
}

/** A row that can be dragged to a new position (open tasks only). */
export function SortableTaskRow(props: RowProps & { disabled: boolean }) {
  const { disabled, ...rowProps } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.task.id, disabled })

  return (
    <TaskRow
      {...rowProps}
      draggable
      setRowNode={setNodeRef}
      setHandleNode={setActivatorNodeRef}
      // Pointer + keyboard handlers that make the grip draggable
      handleProps={{ ...attributes, ...listeners }}
      dragStyle={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
    />
  )
}

function ReminderLine({ task, now }: { task: Task; now: number }) {
  const current = new Date(now)
  const start = new Date(task.remind_at!)
  const next = nextReminder(task.remind_at!, task.repeat, current)
  const overdue = !task.is_done && !task.repeat && next < current

  return (
    // Two pieces that each stay on one line, so a long reminder wraps
    // between them instead of mid-phrase on narrow phones.
    <span className={`task-meta${overdue ? ' overdue' : ''}`}>
      <span className="meta-item">
        <BellIcon />
        {formatReminder(next, current)}
      </span>
      {task.repeat && (
        <span className="meta-item">
          <RepeatIcon />
          {repeatLabel(task.repeat, start)}
        </span>
      )}
    </span>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {[4, 8, 12].map((y) => (
        <g key={y} fill="currentColor">
          <circle cx="6" cy={y} r="1.3" />
          <circle cx="10" cy={y} r="1.3" />
        </g>
      ))}
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.2V6.5A2.5 2.5 0 0 1 5.5 4H12m0 0-2-2m2 2-2 2" />
      <path d="M13 8.8v.7A2.5 2.5 0 0 1 10.5 12H4m0 0 2 2m-2-2 2-2" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
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
