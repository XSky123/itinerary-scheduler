import assert from 'node:assert/strict'
import { createServer } from 'vite'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
  key: index => Array.from(storage.keys())[index] ?? null,
  get length() { return storage.size },
}

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { useTimelineStore } = await server.ssrLoadModule('/src/store/timelineStore.ts')
  const { exportAsHTML } = await server.ssrLoadModule('/src/lib/scheduler.ts')
  const initial = useTimelineStore.getState()

  const flight = {
    id: 'flight',
    type: 'flight',
    name: 'Flight',
    departureTime: '2026-07-11T08:00:00+09:00',
    arrivalTime: '2026-07-11T09:00:00+09:00',
    duration: 60,
  }
  const train = {
    id: 'train',
    type: 'train',
    name: 'Train',
    departureTime: '2026-07-11T08:50:00+09:00',
    arrivalTime: '2026-07-11T10:00:00+09:00',
    duration: 55,
  }
  const timeline = {
    id: 'plan',
    name: 'Plan',
    segments: [
      { transitId: 'flight', order: 0, validConnection: true },
      { transitId: 'train', order: 1, validConnection: true },
    ],
    isValid: true,
    totalDuration: 120,
    createdAt: '2026-07-11T00:00:00+09:00',
    updatedAt: '2026-07-11T00:00:00+09:00',
  }
  const event = {
    id: 'event',
    timelineId: 'plan',
    startTime: '2026-07-11T10:30:00+09:00',
    endTime: '2026-07-11T11:00:00+09:00',
    label: 'Event',
  }

  useTimelineStore.setState({
    transits: new Map([['flight', flight], ['train', train]]),
    timelines: new Map([['plan', timeline]]),
    planEvents: new Map([['event', event]]),
    rows: [],
    config: initial.config,
    past: [],
    future: [],
  })

  // Candidate options may overlap; adding one must remain valid store behavior.
  useTimelineStore.getState().addTransit({
    ...train,
    id: 'train-alternative',
    name: 'Alternative',
    departureTime: '2026-07-11T09:30:00+09:00',
    arrivalTime: '2026-07-11T10:20:00+09:00',
  })
  assert.equal(useTimelineStore.getState().transits.size, 3)

  // A direct time overlap is allowed as an alternative, but the plan must be marked invalid.
  assert.equal(useTimelineStore.getState().updateTransit('flight', { name: 'Flight renamed' }), true)
  assert.equal(useTimelineStore.getState().timelines.get('plan').isValid, false)

  // A transit may not be moved over an existing plan event.
  const beforeRejectedMove = useTimelineStore.getState().transits.get('train')
  assert.equal(useTimelineStore.getState().updateTransit('train', {
    departureTime: '2026-07-11T10:40:00+09:00',
    arrivalTime: '2026-07-11T11:40:00+09:00',
  }), false)
  assert.deepEqual(useTimelineStore.getState().transits.get('train'), beforeRejectedMove)

  // A non-conflicting move is accepted and revalidates the plan.
  assert.equal(useTimelineStore.getState().updateTransit('train', {
    departureTime: '2026-07-11T09:50:00+09:00',
    arrivalTime: '2026-07-11T10:20:00+09:00',
    duration: 30,
  }), true)
  assert.equal(useTimelineStore.getState().timelines.get('plan').isValid, true)

  const exported = exportAsHTML({
    id: 'itinerary-plan',
    timelineId: 'plan',
    events: [{
      time: '2026-07-11T08:00:00+09:00',
      type: 'depart',
      description: '出发 - <script>alert(1)</script>',
    }],
    startTime: '2026-07-11T08:00:00+09:00',
    endTime: '2026-07-11T10:20:00+09:00',
    totalDuration: 140,
    createdAt: '2026-07-11T00:00:00+09:00',
  }, [event], '推荐方案')
  assert.match(exported, /^<!doctype html>/)
  assert.match(exported, /推荐方案/)
  assert.match(exported, /事项/)
  assert.match(exported, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(exported, /<script>alert\(1\)<\/script>/)

  console.log('Behavior verification passed')
} finally {
  await server.close()
}
