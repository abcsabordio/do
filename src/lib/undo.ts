import { createContext, useContext } from 'react'

export interface UndoAction {
  message: string
  // Put things back on screen (the change was never saved).
  undo: () => void
  // Actually save the change. Runs when the toast times out, or right away
  // if another undoable action replaces this one.
  commit: () => void
}

export const UndoContext = createContext<((action: UndoAction) => void) | null>(null)

/** Show an "Undo" toast. Falls back to committing immediately outside a provider. */
export function useUndo(): (action: UndoAction) => void {
  return useContext(UndoContext) ?? ((action) => action.commit())
}
