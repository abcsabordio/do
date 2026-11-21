import { createContext, useContext } from 'react'

/**
 * When several task lists are on screen at once (the Groups tab), only one
 * may be in selection mode. A list "claims" selection when you long-press in
 * it, which quietly ends selection in any other list.
 */
export interface SelectionScopeValue {
  owner: string | null
  claim: (listId: string) => void
  release: (listId: string) => void
}

export const SelectionScope = createContext<SelectionScopeValue | null>(null)

export function useSelectionScope() {
  return useContext(SelectionScope)
}
