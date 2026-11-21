import { useCallback, useEffect, useState } from 'react'
import { disableNotifications, enableNotifications, getNotifyState } from './push'
import type { NotifyState } from './push'

/** Current notification status for this device, plus on/off actions. */
export function useNotifications(kind: 'cloud' | 'local') {
  const [state, setState] = useState<NotifyState | null>(null) // null = still checking
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getNotifyState(kind)
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState('unsupported'))
    return () => {
      cancelled = true
    }
  }, [kind])

  const run = useCallback(
    async (action: typeof enableNotifications) => {
      setBusy(true)
      setError(null)
      try {
        await action(kind)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
      setState(await getNotifyState(kind).catch(() => 'unsupported' as const))
      setBusy(false)
    },
    [kind]
  )

  return {
    state,
    busy,
    error,
    enable: () => run(enableNotifications),
    disable: () => run(disableNotifications),
  }
}
