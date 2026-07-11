import { writeFile } from 'node:fs/promises'
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
  root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
})

try {
  const { useTimelineStore } = await server.ssrLoadModule('/src/store/timelineStore.ts')
  const { generateItinerary, exportAsHTML } = await server.ssrLoadModule('/src/lib/scheduler.ts')
  const state = useTimelineStore.getState()
  const timeline = state.timelines.get('sample-plan')
  const itinerary = generateItinerary(timeline, state.transits)
  const events = Array.from(state.planEvents.values()).filter(event => event.timelineId === timeline.id)
  await writeFile('visual-export.html', exportAsHTML(itinerary, events, timeline.name), { encoding: 'utf8' })
  console.log('visual-export.html generated')
} finally {
  await server.close()
}
