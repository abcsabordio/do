// Checks of the app's pure logic (validation, sign-in throttle, reminder
// maths, guest storage). No browser needed. Run with: npm test
import assert from 'node:assert/strict'
import * as v from '../src/auth/validation'
import * as th from '../src/auth/throttle'
import * as r from '../src/lib/reminders'
import * as lim from '../src/lib/limits'
import * as ls from '../src/data/localStore'

// Minimal stand-in for the browser's localStorage (only read when called).
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, val: string) => void store.set(k, String(val)),
  removeItem: (k: string) => void store.delete(k),
}

let passed = 0
const test = async (name: string, fn: () => unknown) => {
  try {
    await fn()
    passed++
  } catch (e) {
    console.error('FAIL', name, '\n ', (e as Error).message)
    process.exitCode = 1
  }
}

// ---------- validation ----------
await test('email ok', () => assert.equal(v.validateEmail(' a@b.co '), null))
await test('email typo', () => assert.ok(v.validateEmail('a@b')))
await test('email too long', () => assert.ok(v.validateEmail('a'.repeat(250) + '@b.co')))
await test('pw short', () => assert.match(v.validateNewPassword('a1'), /8/))
await test('pw no number', () => assert.match(v.validateNewPassword('abcdefgh'), /number/))
await test('pw no letter', () => assert.match(v.validateNewPassword('12345678'), /letter/))
await test('pw ok', () => assert.equal(v.validateNewPassword('abcdefg1'), null))
await test('pw 72 bytes ok', () => assert.equal(v.validateNewPassword('a1'.repeat(36)), null))
await test('pw 73 bytes rejected', () => assert.ok(v.validateNewPassword('a1'.repeat(36) + 'x')))
await test('pw emoji counts as bytes', () => assert.ok(v.validateNewPassword('a1' + '😀'.repeat(18))))
await test('confirm mismatch', () => assert.ok(v.validateConfirm('a', 'b')))
await test('code 6 digits', () => assert.equal(v.validateCode('123456'), null))
await test('code letters', () => assert.ok(v.validateCode('12a456')))

// ---------- throttle ----------
await test('3 failures lock 30s', () => {
  store.clear()
  const t0 = 1_000_000
  assert.equal(th.recordFailure(t0), 0)
  assert.equal(th.recordFailure(t0 + 1), 0)
  assert.equal(th.recordFailure(t0 + 2), t0 + 2 + 30_000)
  assert.ok(th.lockedUntil(t0 + 10))
  assert.equal(th.lockedUntil(t0 + 40_000), 0)
})
await test('lock doubles then caps at 15 min', () => {
  store.clear()
  let t = 5_000_000
  let until = 0
  for (let i = 0; i < 20; i++) until = th.recordFailure(++t)
  assert.equal(until - t, 15 * 60_000)
})
await test('success resets', () => {
  th.recordSuccess()
  assert.equal(th.lockedUntil(Date.now()), 0)
})
await test('quiet hour forgets failures', () => {
  store.clear()
  th.recordFailure(0); th.recordFailure(1)
  assert.equal(th.recordFailure(2 + 61 * 60_000), 0)
})
await test('3 emails per 15 min', () => {
  store.clear()
  const t = 9_000_000
  th.recordSend(t); th.recordSend(t + 1); th.recordSend(t + 2)
  assert.equal(th.nextSendAt(t + 3), t + 15 * 60_000)
  assert.equal(th.nextSendAt(t + 15 * 60_000 + 1), 0)
})
await test('formatWait', () => {
  assert.equal(th.formatWait(42_000), '0:42')
  assert.equal(th.formatWait(725_000), '12:05')
})
await test('corrupt throttle storage is ignored', () => {
  store.set('todo.authThrottle', '{not json')
  assert.equal(th.lockedUntil(), 0)
})

// ---------- reminders ----------
const now = new Date('2026-11-21T12:00:00')
await test('one-off returns itself', () =>
  assert.equal(r.nextReminder('2026-11-20T09:00:00', null, now).getTime(), new Date('2026-11-20T09:00:00').getTime()))
await test('daily rolls forward', () =>
  assert.equal(r.nextReminder('2026-11-01T09:00:00', 'daily', now).getTime(), new Date('2026-11-22T09:00:00').getTime()))
await test('weekly keeps weekday', () =>
  assert.equal(r.nextReminder('2026-11-07T10:00:00', 'weekly', now).getDay(), 6))
await test('lastReminder future = null', () => assert.equal(r.lastReminder('2026-12-01T09:00:00', null, now), null))
await test('lastReminder daily', () =>
  assert.equal(r.lastReminder('2026-11-01T09:00:00', 'daily', now)!.getTime(), new Date('2026-11-21T09:00:00').getTime()))
await test('very old daily reminder terminates', () => {
  const d = r.nextReminder('1990-01-01T09:00:00', 'daily', now)
  assert.ok(d instanceof Date)
})
await test('repeat labels', () => {
  assert.equal(r.repeatLabel('daily'), 'Every day')
  assert.match(r.repeatLabel('monthly', new Date('2026-11-22T00:00:00')), /22nd/)
  assert.match(r.repeatLabel('monthly', new Date('2026-11-11T00:00:00')), /11th/)
  assert.match(r.repeatLabel('monthly', new Date('2026-11-01T00:00:00')), /1st/)
})
await test('sortKey falls back to created_at', () =>
  assert.ok(r.sortKey({ position: null, created_at: '2026-01-01T00:00:00Z' }) < 0))

// ---------- limits + guest store ----------
await test('clamp', () => assert.equal(lim.clamp('abcdef', 3), 'abc'))
await test('guest store clamps and round-trips', async () => {
  store.clear()
  const t = await ls.localStore.addTask({ title: 'x'.repeat(500), notes: 'n'.repeat(5000) }, null)
  assert.equal(t.title.length, lim.LIMITS.taskTitle)
  assert.equal(t.notes!.length, lim.LIMITS.taskNotes)
  await ls.localStore.updateTask(t.id, { title: 'y'.repeat(300) })
  const [saved] = await ls.localStore.listTasks(null)
  assert.equal(saved.title.length, lim.LIMITS.taskTitle)
  const g = await ls.localStore.addGroup('g'.repeat(200))
  assert.equal(g.name.length, lim.LIMITS.groupName)
  await ls.localStore.addTask({ title: 'in group' }, g.id)
  const { groups, tasks } = await ls.localStore.listGroupsWithTasks()
  assert.equal(groups[0].task_count, 1)
  assert.equal(tasks.length, 1)
  await ls.localStore.deleteGroup(g.id)
  assert.equal((await ls.localStore.listGroupsWithTasks()).tasks.length, 0)
  assert.equal((await ls.localStore.listTasks(null)).length, 1) // ungrouped task survives
})
await test('old guest data with description migrates to notes', () => {
  store.set('todo.guest.v1', JSON.stringify({ tasks: [{ id: '1', title: 't', description: 'old' }], groups: [] }))
  assert.equal(ls.readGuestData().tasks[0].notes, 'old')
})
await test('corrupt guest data starts empty', () => {
  store.set('todo.guest.v1', '{{{')
  assert.deepEqual(ls.readGuestData(), { tasks: [], groups: [] })
})

console.log(`${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`)
