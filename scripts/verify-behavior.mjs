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
  const { exportAsHTML, generateItinerary } = await server.ssrLoadModule('/src/lib/scheduler.ts')
  const { parseTimetableText } = await server.ssrLoadModule('/src/lib/timetableParser.ts')
  const initial = useTimelineStore.getState()

  // A brand-new browser receives the editable Nemuro train-to-bus sample.
  assert.equal(initial.transits.size, 20)
  assert.equal(initial.transits.has('sample-train-2'), true)
  assert.equal(initial.transits.has('sample-bus-3'), true)
  assert.equal(initial.transits.has('sample-return-bus-5'), true)
  assert.equal(initial.transits.has('sample-return-train-5'), true)
  assert.equal(initial.timelines.has('sample-plan'), true)
  assert.equal(initial.planEvents.size, 0)
  assert.equal(initial.selectedTimelineId, 'sample-plan')
  assert.equal(initial.timelines.get('sample-plan').name, '计划 1')
  assert.deepEqual(initial.timelines.get('sample-plan').segments.map(segment => segment.transitId), [
    'sample-train-3', 'sample-bus-5', 'sample-return-bus-5', 'sample-return-train-5',
  ])
  assert.equal(initial.transits.get('sample-train-3').departureTime.includes('T13:40:00'), true)
  assert.equal(initial.transits.get('sample-bus-5').arrivalTime.includes('T16:54:00'), true)
  assert.equal(initial.transits.get('sample-return-bus-5').departureTime.includes('T17:20:00'), true)
  assert.equal(initial.transits.get('sample-return-train-5').arrivalTime.includes('T21:40:00'), true)

  const parsed = parseTimetableText('09:00-11:30 JR Test\n12:00→12:40 Bus Test', {
    date: '2026-07-11', type: 'train', category: 'row-test',
  })
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.transits.length, 2)
  assert.equal(parsed.transits[0].name, 'JR Test')

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
    selectedTimelineId: 'plan',
    past: [],
    future: [],
  })

  const generated = generateItinerary(timeline, useTimelineStore.getState().transits)
  assert.deepEqual(generated.events.map(event => event.type), ['transit', 'transit'])
  assert.equal(generated.events[0].endTime, flight.arrivalTime)

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
      endTime: '2026-07-11T09:00:00+09:00',
      type: 'transit',
      description: '<script>alert(1)</script>',
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
  assert.match(exported, /08:00<\/strong>.*09:00<\/strong>/)

  // One-click clear removes every editable collection, and one undo restores it all.
  useTimelineStore.getState().clearAll()
  assert.equal(useTimelineStore.getState().transits.size, 0)
  assert.equal(useTimelineStore.getState().timelines.size, 1)
  assert.equal(useTimelineStore.getState().planEvents.size, 0)
  assert.deepEqual(useTimelineStore.getState().rows, [])
  assert.equal(useTimelineStore.getState().timelines.get('plan-default').name, '计划 1')
  assert.equal(useTimelineStore.getState().selectedTimelineId, 'plan-default')
  useTimelineStore.getState().restoreDemo()
  assert.equal(useTimelineStore.getState().transits.size, 20)
  assert.equal(useTimelineStore.getState().rows.length, 4)
  assert.equal(useTimelineStore.getState().timelines.get('sample-plan').segments.length, 4)
  useTimelineStore.getState().undo()
  assert.equal(useTimelineStore.getState().transits.size, 0)
  assert.equal(useTimelineStore.getState().selectedTimelineId, 'plan-default')
  useTimelineStore.getState().undo()
  assert.equal(useTimelineStore.getState().transits.size, 3)
  assert.equal(useTimelineStore.getState().timelines.has('plan'), true)
  assert.equal(useTimelineStore.getState().planEvents.has('event'), true)
  assert.equal(useTimelineStore.getState().selectedTimelineId, 'plan')

  const beforeImportCount = useTimelineStore.getState().transits.size
  useTimelineStore.getState().importTransits(parsed.transits)
  assert.equal(useTimelineStore.getState().transits.size, beforeImportCount + 2)
  useTimelineStore.getState().undo()
  assert.equal(useTimelineStore.getState().transits.size, beforeImportCount)

  // A source timetable row is N-choose-1 inside each plan.
  assert.equal(useTimelineStore.getState().updateTransit('train', { category: 'row-train' }), true)
  assert.equal(useTimelineStore.getState().updateTransit('train-alternative', { category: 'row-train' }), true)
  assert.equal(useTimelineStore.getState().addSegmentToTimeline('plan', 'train-alternative'), true)
  const selectedIds = useTimelineStore.getState().timelines.get('plan').segments.map(segment => segment.transitId)
  assert.equal(selectedIds.includes('train'), false)
  assert.equal(selectedIds.includes('train-alternative'), true)

  useTimelineStore.getState().addTransit({
    ...train,
    id: 'train-event-conflict',
    category: 'row-train',
    departureTime: '2026-07-11T10:40:00+09:00',
    arrivalTime: '2026-07-11T11:10:00+09:00',
  })
  assert.equal(useTimelineStore.getState().addSegmentToTimeline('plan', 'train-event-conflict'), false)
  assert.equal(useTimelineStore.getState().timelines.get('plan').segments.some(segment => segment.transitId === 'train-alternative'), true)

  // Deleting the last plan immediately creates and activates an empty Plan 1.
  useTimelineStore.getState().deleteTimeline('plan')
  assert.equal(useTimelineStore.getState().timelines.size, 1)
  assert.equal(useTimelineStore.getState().timelines.get('plan-default').name, '计划 1')
  assert.equal(useTimelineStore.getState().selectedTimelineId, 'plan-default')

  console.log('Behavior verification passed')
} finally {
  await server.close()
}
