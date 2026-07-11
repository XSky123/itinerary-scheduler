import { useState, useRef, useEffect, useMemo } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { shallow } from 'zustand/shallow'
import { useTimelineStore } from '../store/timelineStore'
import type { TransitOption, Timeline, TransitType, PlanEventBlock } from '../lib/models'
import type { HistoryEntry } from '../store/timelineStore'
import { formatDuration } from '../lib/scheduler'
import { getRowColor, hexToRgba } from '../lib/rowColors'

const TYPE_EMOJI: Record<TransitType, string> = {
  flight: '✈', train: '🚄', bus: '🚌', shuttle: '🚐', custom: '🚗',
}

const PLAN_COLORS = ['#2563eb', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4']
const LABEL_COL_WIDTH = 230
const SNAP_MS = 5 * 60 * 1000
const DAY_START_H = 7
const DAY_END_H = 23
const MIN_GAP_PX_FOR_INLINE = 14
const MIN_EVENT_VISIBLE_PX = 18

interface DragState {
  entityId: string
  entityType: 'transit' | 'event'
  action: 'move' | 'resize-l' | 'resize-r'
  startClientX: number
  startClientY: number
  startDepMs: number
  startArrMs: number
  contentWidthPx: number
  totalMs: number
  minStart?: number
  maxEnd?: number
}

interface DragPreview {
  entityId: string
  entityType: 'transit' | 'event'
  startMs: number
  endMs: number
}

interface ContextMenu {
  entityId: string
  entityType: 'transit' | 'event'
  x: number
  y: number
  fromPlanId?: string
}

interface GanttRowGroup {
  rowId: string | null
  label: string
  transits: TransitOption[]
  colorIndex: number
}

interface TimeSpan {
  start: number
  end: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function buildTimeRange(transits: TransitOption[], events: PlanEventBlock[]): { rangeStart: Dayjs; rangeEnd: Dayjs; totalMs: number } {
  if (transits.length === 0 && events.length === 0) {
    const base = dayjs().startOf('day')
    return { rangeStart: base.add(8, 'hour'), rangeEnd: base.add(20, 'hour'), totalMs: 12 * 3600000 }
  }
  const ts = [
    ...transits.flatMap(t => [dayjs(t.departureTime).valueOf(), dayjs(t.arrivalTime).valueOf()]),
    ...events.flatMap(event => [dayjs(event.startTime).valueOf(), dayjs(event.endTime).valueOf()]),
  ]
  const rangeStart = dayjs(Math.min(...ts)).startOf('hour')
  const rangeEnd = dayjs(Math.max(...ts)).startOf('hour').add(1, 'hour')
  return { rangeStart, rangeEnd, totalMs: rangeEnd.diff(rangeStart) }
}

function layoutTransitLanes(transits: TransitOption[]) {
  const laneEnds: number[] = []
  const items = transits.map(transit => {
    const start = dayjs(transit.departureTime).valueOf()
    const end = dayjs(transit.arrivalTime).valueOf()
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    return { transit, lane }
  })
  return { items, laneCount: Math.max(1, laneEnds.length) }
}

function buildHourTicks(rangeStart: Dayjs, rangeEnd: Dayjs): Dayjs[] {
  const hours: Dayjs[] = []
  let c = rangeStart
  while (!c.isAfter(rangeEnd)) { hours.push(c); c = c.add(1, 'hour') }
  return hours
}

function buildGroups(transits: TransitOption[], rows: { id: string; name: string }[]): GanttRowGroup[] {
  const byRow: Record<string, TransitOption[]> = {}
  const uncategorized: TransitOption[] = []
  for (const t of transits) {
    if (t.category) { byRow[t.category] = byRow[t.category] ?? []; byRow[t.category].push(t) }
    else uncategorized.push(t)
  }
  const sort = (arr: TransitOption[]) => [...arr].sort((a, b) => dayjs(a.departureTime).diff(dayjs(b.departureTime)))
  const result: GanttRowGroup[] = rows.map((row, idx) => ({
    rowId: row.id, label: row.name,
    transits: sort(byRow[row.id] ?? []),
    colorIndex: idx,
  }))
  if (uncategorized.length > 0) result.push({ rowId: null, label: '未分类', transits: sort(uncategorized), colorIndex: -1 })
  return result
}

function rowEmoji(transits: TransitOption[]): string {
  if (!transits.length) return ''
  const counts: Partial<Record<TransitType, number>> = {}
  for (const t of transits) counts[t.type] = (counts[t.type] ?? 0) + 1
  const dominant = Object.entries(counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0] as TransitType
  return TYPE_EMOJI[dominant] ?? ''
}

function HourTicks({ hours, rangeStart, totalMs }: { hours: Dayjs[]; rangeStart: Dayjs; totalMs: number }) {
  return <>{hours.map(h => (
    <div key={h.valueOf()} className="gantt-tick" style={{ left: `${(h.diff(rangeStart) / totalMs) * 100}%` }}>
      <span className="gantt-tick-label">{h.format('H')}{h.format('mm') !== '00' ? `:${h.format('mm')}` : ''}</span>
    </div>
  ))}</>
}

function GridLines({ hours, rangeStart, totalMs }: { hours: Dayjs[]; rangeStart: Dayjs; totalMs: number }) {
  return <>{hours.map(h => (
    <div key={h.valueOf()} className="gantt-grid-line" style={{ left: `${(h.diff(rangeStart) / totalMs) * 100}%` }} />
  ))}</>
}

export default function TimelineEditor() {
  const {
    transitsMap, timelinesMap, planEventsMap, rows,
    selectedTimelineId, selectTimeline,
    createTimeline, deleteTimeline, renameTimeline,
    addSegmentToTimeline, removeSegmentFromTimeline,
    addRow, updateRow, removeRow,
    setEditingTransitId, past, future, undo, redo, clearAll, restoreDemo,
    addPlanEvent, removePlanEvent,
  } = useTimelineStore(state => ({
    transitsMap: state.transits,
    timelinesMap: state.timelines,
    planEventsMap: state.planEvents,
    rows: state.rows,
    selectedTimelineId: state.selectedTimelineId,
    selectTimeline: state.selectTimeline,
    createTimeline: state.createTimeline,
    deleteTimeline: state.deleteTimeline,
    renameTimeline: state.renameTimeline,
    addSegmentToTimeline: state.addSegmentToTimeline,
    removeSegmentFromTimeline: state.removeSegmentFromTimeline,
    addRow: state.addRow,
    updateRow: state.updateRow,
    removeRow: state.removeRow,
    setEditingTransitId: state.setEditingTransitId,
    past: state.past,
    future: state.future,
    undo: state.undo,
    redo: state.redo,
    clearAll: state.clearAll,
    restoreDemo: state.restoreDemo,
    addPlanEvent: state.addPlanEvent,
    removePlanEvent: state.removePlanEvent,
  }), shallow)

  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editingRowName, setEditingRowName] = useState('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingPlanName, setEditingPlanName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [interactionMessage, setInteractionMessage] = useState('')
  const [confirmAction, setConfirmAction] = useState<'clear' | 'restore' | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const dragMovedRef = useRef(false)
  const preDragStateRef = useRef<HistoryEntry | null>(null)
  const dragPreviewRef = useRef<DragPreview | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const ganttRef = useRef<HTMLDivElement>(null)
  const candidateClickTimerRef = useRef<number | null>(null)
  const cancelConfirmButtonRef = useRef<HTMLButtonElement>(null)

  const transits = useMemo(() => Array.from(transitsMap.values()), [transitsMap])
  const timelines = useMemo(() => Array.from(timelinesMap.values()), [timelinesMap])
  const planEvents = useMemo(() => Array.from(planEventsMap.values()), [planEventsMap])
  const transitById = useMemo(() => new Map(transits.map(t => [t.id, t])), [transits])
  const eventsByTimeline = useMemo(() => {
    const result = new Map<string, PlanEventBlock[]>()
    for (const event of planEventsMap.values()) {
      const list = result.get(event.timelineId) ?? []
      list.push(event)
      result.set(event.timelineId, list)
    }
    for (const list of result.values()) {
      list.sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime)))
    }
    return result
  }, [planEventsMap])
  const getPlanEvents = (timelineId: string) => eventsByTimeline.get(timelineId) ?? []
  const groups = useMemo(() => buildGroups(transits, rows), [transits, rows])
  const laneLayouts = useMemo(() => new Map(
    groups.map(group => [group.rowId ?? '__uncategorized', layoutTransitLanes(group.transits)])
  ), [groups])
  const { rangeStart, rangeEnd, totalMs } = useMemo(() => buildTimeRange(transits, planEvents), [transits, planEvents])
  const hours = useMemo(() => buildHourTicks(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const hourCount = Math.max(1, Math.ceil(totalMs / 3600000))
  const minGanttWidth = LABEL_COL_WIDTH + Math.max(600, hourCount * 90)
  const ganttContentWidth = minGanttWidth - LABEL_COL_WIDTH

  const rangeStartMs = rangeStart.valueOf()
  const toLeftPct = (timeMs: number) => Math.max(0, ((timeMs - rangeStartMs) / totalMs) * 100)
  const toWidthPct = (startMs: number, endMs: number) => Math.max(0.5, ((endMs - startMs) / totalMs) * 100)

  const transitPlanMap = useMemo(() => {
    const result = new Map<string, Timeline[]>()
    for (const tl of timelines) {
      for (const seg of tl.segments) {
        const list = result.get(seg.transitId) ?? []
        list.push(tl)
        result.set(seg.transitId, list)
      }
    }
    return result
  }, [timelines])
  const hasClearableData = useMemo(() =>
    transits.length > 0 || planEvents.length > 0 || rows.length > 0 || timelines.length > 1 ||
    timelines.some(timeline => timeline.segments.length > 0 || timeline.name !== '计划 1'),
  [transits.length, planEvents.length, rows.length, timelines])

  const planDataByTimeline = useMemo(() => new Map(timelines.map(timeline => {
    const transits = timeline.segments
      .map(segment => transitById.get(segment.transitId))
      .filter(Boolean) as TransitOption[]
    return [timeline.id, {
      transits,
      segmentByTransitId: new Map(timeline.segments.map(segment => [segment.transitId, segment])),
    }]
  })), [timelines, transitById])

  const rowColorById = useMemo(() => new Map(
    rows.map((row, index) => [row.id, getRowColor(index)])
  ), [rows])

  const planColor = (idx: number) => PLAN_COLORS[idx % PLAN_COLORS.length]

  const getTransitRowColor = (transit: TransitOption) => {
    if (!transit.category) return '#9ca3af'
    return rowColorById.get(transit.category) ?? getRowColor(-1)
  }

  const getPlanTransits = (timelineId: string) => {
    return planDataByTimeline.get(timelineId)?.transits ?? []
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Transit gaps for a plan (7:00–23:00 relative to rangeStart's day) */
  const computeTransitGaps = (planTransits: TransitOption[]) => {
    const base = rangeStart.startOf('day')
    const dayStart = base.add(DAY_START_H, 'hour').valueOf()
    const dayEnd = base.add(DAY_END_H, 'hour').valueOf()
    const sorted = [...planTransits].sort((a, b) => dayjs(a.departureTime).diff(dayjs(b.departureTime)))
    const gaps: Array<{ start: number; end: number; key: string }> = []
    if (sorted.length === 0) {
      gaps.push({ start: dayStart, end: dayEnd, key: 'all' })
      return gaps
    }
    const firstDep = dayjs(sorted[0].departureTime).valueOf()
    if (firstDep > dayStart) gaps.push({ start: dayStart, end: firstDep, key: `pre-${firstDep}` })
    for (let i = 0; i < sorted.length - 1; i++) {
      const arrMs = dayjs(sorted[i].arrivalTime).valueOf()
      const nextDepMs = dayjs(sorted[i + 1].departureTime).valueOf()
      if (nextDepMs > arrMs) gaps.push({ start: arrMs, end: nextDepMs, key: `mid-${arrMs}` })
    }
    const lastArr = dayjs(sorted[sorted.length - 1].arrivalTime).valueOf()
    if (dayEnd > lastArr) gaps.push({ start: lastArr, end: dayEnd, key: `post-${lastArr}` })
    return gaps
  }

  /** Compute default time window for a new event block given click position */
  const computeNewEventDefault = (timelineId: string, planTransits: TransitOption[], refTimeMs: number) => {
    const base = rangeStart.startOf('day')
    const dayStart = base.add(DAY_START_H, 'hour').valueOf()
    const dayEnd = base.add(DAY_END_H, 'hour').valueOf()
    const occupied = [
      ...planTransits.map(t => ({ s: dayjs(t.departureTime).valueOf(), e: dayjs(t.arrivalTime).valueOf() })),
      ...getPlanEvents(timelineId).map(ev => ({ s: dayjs(ev.startTime).valueOf(), e: dayjs(ev.endTime).valueOf() })),
    ].sort((a, b) => a.s - b.s)
    let gapStart = dayStart
    let gapEnd = dayEnd
    for (const { s, e } of occupied) {
      if (e <= refTimeMs) gapStart = Math.max(gapStart, e)
      else if (s > refTimeMs) { gapEnd = Math.min(gapEnd, s); break }
    }
    return { startMs: gapStart, endMs: Math.min(gapStart + 3_600_000, gapEnd) }
  }

  const getEventSlotBounds = (timelineId: string, eventId: string) => {
    const currentEvent = getPlanEvents(timelineId).find(ev => ev.id === eventId)
    if (!currentEvent) return null

    const occupied: TimeSpan[] = [
      ...getPlanTransits(timelineId).map(t => ({
        start: dayjs(t.departureTime).valueOf(),
        end: dayjs(t.arrivalTime).valueOf(),
      })),
      ...getPlanEvents(timelineId)
        .filter(ev => ev.id !== eventId)
        .map(ev => ({
          start: dayjs(ev.startTime).valueOf(),
          end: dayjs(ev.endTime).valueOf(),
        })),
    ].sort((a, b) => a.start - b.start)

    const currentStart = dayjs(currentEvent.startTime).valueOf()
    const currentEnd = dayjs(currentEvent.endTime).valueOf()
    let minStart = rangeStart.startOf('day').add(DAY_START_H, 'hour').valueOf()
    let maxEnd = rangeStart.startOf('day').add(DAY_END_H, 'hour').valueOf()

    for (const item of occupied) {
      if (item.end <= currentStart) {
        minStart = Math.max(minStart, item.end)
        continue
      }
      if (item.start >= currentEnd) {
        maxEnd = Math.min(maxEnd, item.start)
        break
      }
    }

    return { minStart, maxEnd }
  }

  const getEventVisualStyle = (startMs: number, endMs: number, slotStart: number, slotEnd: number) => {
    const rawLeftPx = ((startMs - rangeStart.valueOf()) / totalMs) * ganttContentWidth
    const rawWidthPx = Math.max(1, ((endMs - startMs) / totalMs) * ganttContentWidth)
    const slotLeftPx = ((slotStart - rangeStart.valueOf()) / totalMs) * ganttContentWidth
    const slotRightPx = ((slotEnd - rangeStart.valueOf()) / totalMs) * ganttContentWidth
    const slotWidthPx = Math.max(0, slotRightPx - slotLeftPx)
    const visualWidthPx = Math.max(1, Math.min(Math.max(rawWidthPx, Math.min(MIN_EVENT_VISIBLE_PX, slotWidthPx)), slotWidthPx))
    const visualLeftPx = clamp(rawLeftPx, slotLeftPx, Math.max(slotLeftPx, slotRightPx - visualWidthPx))

    return {
      left: `${(visualLeftPx / ganttContentWidth) * 100}%`,
      width: `${(visualWidthPx / ganttContentWidth) * 100}%`,
    }
  }

  // ── Drag ─────────────────────────────────────────────────────────────────
  const startDrag = (e: React.MouseEvent, transit: TransitOption, action: DragState['action']) => {
    e.preventDefault(); e.stopPropagation()
    if (!ganttRef.current) return
    setInteractionMessage('')
    dragMovedRef.current = false
    preDragStateRef.current = null
    dragRef.current = {
      entityId: transit.id, entityType: 'transit', action,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startDepMs: dayjs(transit.departureTime).valueOf(),
      startArrMs: dayjs(transit.arrivalTime).valueOf(),
      contentWidthPx: ganttRef.current.offsetWidth - LABEL_COL_WIDTH,
      totalMs,
    }
  }

  const startEventDrag = (e: React.MouseEvent, ev: PlanEventBlock, action: DragState['action']) => {
    e.preventDefault(); e.stopPropagation()
    if (!ganttRef.current) return
    const bounds = getEventSlotBounds(ev.timelineId, ev.id)
    if (!bounds) return
    dragMovedRef.current = false
    preDragStateRef.current = null
    dragRef.current = {
      entityId: ev.id, entityType: 'event', action,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startDepMs: dayjs(ev.startTime).valueOf(),
      startArrMs: dayjs(ev.endTime).valueOf(),
      contentWidthPx: ganttRef.current.offsetWidth - LABEL_COL_WIDTH,
      totalMs,
      ...bounds,
    }
  }

  useEffect(() => {
    const publishPreview = () => {
      dragFrameRef.current = null
      setDragPreview(dragPreviewRef.current)
    }
    const onMove = (e: MouseEvent) => {
      const ds = dragRef.current; if (!ds) return
      if (Math.hypot(e.clientX - ds.startClientX, e.clientY - ds.startClientY) <= 3) return
      if (!dragMovedRef.current) {
        const state = useTimelineStore.getState()
        preDragStateRef.current = {
          transits: Array.from(state.transits.entries()),
          timelines: Array.from(state.timelines.entries()),
          planEvents: Array.from(state.planEvents.entries()),
          rows: [...state.rows],
          selectedTimelineId: state.selectedTimelineId,
        }
        dragMovedRef.current = true
      }
      const deltaMs = Math.round(((e.clientX - ds.startClientX) * ds.totalMs / ds.contentWidthPx) / SNAP_MS) * SNAP_MS
      let dep = ds.startDepMs, arr = ds.startArrMs
      if (ds.action === 'move') { dep += deltaMs; arr += deltaMs }
      else if (ds.action === 'resize-l') dep = Math.min(ds.startDepMs + deltaMs, arr - SNAP_MS)
      else arr = Math.max(ds.startArrMs + deltaMs, dep + SNAP_MS)
      if (ds.entityType === 'event') {
        const duration = ds.startArrMs - ds.startDepMs
        if (ds.action === 'move') {
          dep = clamp(dep, ds.minStart!, ds.maxEnd! - duration)
          arr = dep + duration
        } else if (ds.action === 'resize-l') {
          dep = clamp(dep, ds.minStart!, arr - SNAP_MS)
        } else {
          arr = clamp(arr, dep + SNAP_MS, ds.maxEnd!)
        }
      }
      const nextPreview = { entityId: ds.entityId, entityType: ds.entityType, startMs: dep, endMs: arr }
      const previous = dragPreviewRef.current
      if (previous?.startMs === dep && previous.endMs === arr && previous.entityId === ds.entityId) return
      dragPreviewRef.current = nextPreview
      if (dragFrameRef.current === null) dragFrameRef.current = requestAnimationFrame(publishPreview)
    }
    const onUp = () => {
      const ds = dragRef.current
      const preview = dragPreviewRef.current
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      if (ds && dragMovedRef.current && preview) {
        const state = useTimelineStore.getState()
        if (ds.entityType === 'transit') {
          const updated = state.updateTransit(ds.entityId, {
            departureTime: dayjs(preview.startMs).toISOString(),
            arrivalTime: dayjs(preview.endMs).toISOString(),
            duration: Math.round((preview.endMs - preview.startMs) / 60000),
          })
          if (updated && preDragStateRef.current) state.pushHistoryEntry(preDragStateRef.current)
          if (!updated) setInteractionMessage('班次时间与计划事项重叠，已恢复原位置。')
        } else {
          state.updatePlanEvent(ds.entityId, {
            startTime: dayjs(preview.startMs).toISOString(),
            endTime: dayjs(preview.endMs).toISOString(),
          })
          if (preDragStateRef.current) state.pushHistoryEntry(preDragStateRef.current)
        }
      }
      preDragStateRef.current = null
      dragPreviewRef.current = null
      setDragPreview(null)
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Context menus ─────────────────────────────────────────────────────────
  const openCtx = (e: React.MouseEvent, transitId: string, fromPlanId?: string) => {
    e.preventDefault(); e.stopPropagation()
    if (fromPlanId) selectTimeline(fromPlanId)
    setContextMenu({
      entityId: transitId,
      entityType: 'transit',
      x: clamp(e.clientX, 8, Math.max(8, window.innerWidth - 210)),
      y: clamp(e.clientY, 8, Math.max(8, window.innerHeight - 260)),
      fromPlanId,
    })
  }
  const openEventCtx = (e: React.MouseEvent, eventId: string) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({
      entityId: eventId,
      entityType: 'event',
      x: clamp(e.clientX, 8, Math.max(8, window.innerWidth - 210)),
      y: clamp(e.clientY, 8, Math.max(8, window.innerHeight - 120)),
    })
  }
  const handleCandidateClick = (transitId: string) => {
    const currentPlan = (selectedTimelineId && timelinesMap.has(selectedTimelineId))
      ? timelinesMap.get(selectedTimelineId)
      : timelines[0]
    const targetId = currentPlan?.id ?? createTimeline('计划 1')
    const target = useTimelineStore.getState().timelines.get(targetId)
    if (target?.segments.some(segment => segment.transitId === transitId)) {
      setInteractionMessage(`已在「${target.name}」中选中这一班。`)
      return
    }
    if (!addSegmentToTimeline(targetId, transitId)) {
      setInteractionMessage('该班次会覆盖当前计划中的现有事项，请先调整事项时间。')
      return
    }
    setInteractionMessage(`已更新「${target?.name ?? '计划 1'}」。`)
  }
  const scheduleCandidateClick = (transitId: string) => {
    if (candidateClickTimerRef.current !== null) window.clearTimeout(candidateClickTimerRef.current)
    candidateClickTimerRef.current = window.setTimeout(() => {
      candidateClickTimerRef.current = null
      handleCandidateClick(transitId)
    }, 260)
  }
  const handleCandidateDoubleClick = (e: React.MouseEvent, transitId: string) => {
    e.stopPropagation()
    if (candidateClickTimerRef.current !== null) {
      window.clearTimeout(candidateClickTimerRef.current)
      candidateClickTimerRef.current = null
    }
    setEditingTransitId(transitId)
  }
  useEffect(() => () => {
    if (candidateClickTimerRef.current !== null) window.clearTimeout(candidateClickTimerRef.current)
  }, [])
  useEffect(() => {
    if (!confirmAction) return
    cancelConfirmButtonRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmAction(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [confirmAction])
  const handleTransitKeyDown = (e: React.KeyboardEvent, transit: TransitOption) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleCandidateClick(transit.id)
      return
    }
    if (e.key.toLowerCase() === 'e') { e.preventDefault(); setEditingTransitId(transit.id); return }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const delta = (e.key === 'ArrowLeft' ? -1 : 1) * SNAP_MS
    const state = useTimelineStore.getState()
    const historyEntry: HistoryEntry = {
      transits: Array.from(state.transits.entries()),
      timelines: Array.from(state.timelines.entries()),
      planEvents: Array.from(state.planEvents.entries()),
      rows: [...state.rows],
      selectedTimelineId: state.selectedTimelineId,
    }
    const updated = state.updateTransit(transit.id, {
      departureTime: dayjs(transit.departureTime).add(delta, 'millisecond').toISOString(),
      arrivalTime: dayjs(transit.arrivalTime).add(delta, 'millisecond').toISOString(),
    })
    if (updated) state.pushHistoryEntry(historyEntry)
    else setInteractionMessage('班次时间与计划事项重叠，无法移动。')
  }
  const toggleInPlan = (timelineId: string, transitId: string) => {
    const tl = timelines.find(t => t.id === timelineId); if (!tl) return
    const seg = tl.segments.find(s => s.transitId === transitId)
    if (seg) removeSegmentFromTimeline(timelineId, seg.order)
    else if (!addSegmentToTimeline(timelineId, transitId)) {
      setInteractionMessage('该班次会覆盖方案中的现有事项，请先调整事项时间。')
    } else {
      setInteractionMessage('')
    }
    setContextMenu(null)
  }
  const removeFromPlan = (timelineId: string, transitId: string) => {
    const tl = timelines.find(t => t.id === timelineId); if (!tl) return
    const seg = tl.segments.find(s => s.transitId === transitId)
    if (seg) removeSegmentFromTimeline(timelineId, seg.order)
    setContextMenu(null)
  }

  const handleClearAll = () => {
    if (!hasClearableData) return
    setConfirmAction('clear')
  }
  const handleRestoreDemo = () => {
    setConfirmAction('restore')
  }
  const handleConfirmAction = () => {
    if (confirmAction === 'clear') {
      clearAll()
      setInteractionMessage('已清空行程内容并保留空的「计划 1」。点 ↩ 或按 Ctrl+Z 可撤销。')
    } else if (confirmAction === 'restore') {
      restoreDemo()
      setInteractionMessage('已恢复根室官方时刻快照。点 ↩ 或按 Ctrl+Z 可撤销。')
    }
    setConfirmAction(null)
  }

  // ── Plan lane right-click → add event block ───────────────────────────────
  const handlePlanLaneContextMenu = (e: React.MouseEvent, tl: Timeline, planTransits: TransitOption[]) => {
    e.preventDefault()
    if (!ganttRef.current) return
    const rect = ganttRef.current.getBoundingClientRect()
    const contentX = e.clientX - rect.left - LABEL_COL_WIDTH
    const contentWidthPx = ganttRef.current.offsetWidth - LABEL_COL_WIDTH
    if (contentWidthPx <= 0) return
    const ratio = Math.max(0, Math.min(1, contentX / contentWidthPx))
    const clickTimeMs = rangeStart.valueOf() + ratio * totalMs
    const { startMs, endMs } = computeNewEventDefault(tl.id, planTransits, clickTimeMs)
    addPlanEvent({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timelineId: tl.id,
      startTime: dayjs(startMs).toISOString(),
      endTime: dayjs(endMs).toISOString(),
      label: '事项',
    })
  }

  // ── Row / plan name editing ───────────────────────────────────────────────
  const commitRowEdit = () => {
    if (editingRowId && editingRowName.trim()) updateRow(editingRowId, editingRowName.trim())
    setEditingRowId(null)
  }
  const handleAddRow = () => {
    const name = `交通行 ${rows.length + 1}`
    const id = addRow(name)
    setEditingRowId(id); setEditingRowName(name)
  }
  const commitPlanEdit = () => {
    if (editingPlanId && editingPlanName.trim()) renameTimeline(editingPlanId, editingPlanName.trim())
    setEditingPlanId(null)
  }
  const startPlanEdit = (tl: Timeline) => { setEditingPlanId(tl.id); setEditingPlanName(tl.name) }
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    createTimeline(newName.trim() || `计划 ${timelines.length + 1}`)
    setNewName('')
  }
  const handleAddPlan = () => { createTimeline(`计划 ${timelines.length + 1}`) }

  const renderRowLabel = (group: GanttRowGroup) => {
    const emoji = rowEmoji(group.transits)
    const color = getRowColor(group.colorIndex)
    if (editingRowId === group.rowId && group.rowId) {
      return (
        <input className="gantt-row-label-input" value={editingRowName}
          onChange={e => setEditingRowName(e.target.value)}
          onBlur={commitRowEdit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingRowId(null) }}
          autoFocus
        />
      )
    }
    return (
      <span
        className={`gantt-label${group.rowId ? ' gantt-label-editable' : ''}`}
        style={group.rowId ? { color } : undefined}
        onClick={() => { if (!group.rowId) return; setEditingRowId(group.rowId); setEditingRowName(group.label) }}
        title={`${group.label}：${group.transits.length} 个候选，每个方案选 1 班`}
      >
        {emoji && <span className="row-type-emoji">{emoji}</span>}
        {group.label}
      </span>
    )
  }

  // ── Event block rendering for a plan lane ────────────────────────────────
  const renderEventBlocksForPlan = (tl: Timeline, planTransits: TransitOption[]) => {
    const evBlocks = getPlanEvents(tl.id)
    if (evBlocks.length === 0) return null
    const gaps = computeTransitGaps(planTransits)

    return gaps.flatMap(gap => {
      const gapEvents = evBlocks
        .filter(ev => dayjs(ev.startTime).valueOf() >= gap.start && dayjs(ev.startTime).valueOf() < gap.end)
        .sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime)))
      if (gapEvents.length === 0) return []

      // If gap is too narrow to render inline, skip (shown in right panel only)
      const gapWidthPx = (gap.end - gap.start) / totalMs * ganttContentWidth
      if (gapWidthPx < MIN_GAP_PX_FOR_INLINE) return []

      const groupKey = `${tl.id}-${gap.key}`
      const shouldGroup = gapEvents.length > 1 && gapWidthPx < gapEvents.length * 60
      const isExpanded = expandedGroups.has(groupKey)

      if (!shouldGroup) {
        // Render individually
        return gapEvents.map(ev => {
          const startMs = dragPreview?.entityType === 'event' && dragPreview.entityId === ev.id
            ? dragPreview.startMs : dayjs(ev.startTime).valueOf()
          const endMs = dragPreview?.entityType === 'event' && dragPreview.entityId === ev.id
            ? dragPreview.endMs : dayjs(ev.endTime).valueOf()
          const isCompact = ((endMs - startMs) / totalMs) * ganttContentWidth < 42
          return <div key={ev.id}
            className={`gantt-block plan-event-block${isCompact ? ' compact' : ''}`}
            style={getEventVisualStyle(
              startMs,
              endMs,
              gap.start,
              gap.end,
            )}
            onMouseDown={e => startEventDrag(e, ev, 'move')}
            onContextMenu={e => openEventCtx(e, ev.id)}
            title={`${ev.label}\n${dayjs(startMs).format('HH:mm')}–${dayjs(endMs).format('HH:mm')}\n右键删除`}
          >
            <div className="resize-handle resize-l" onMouseDown={e => { e.stopPropagation(); startEventDrag(e, ev, 'resize-l') }} />
            <div className="resize-handle resize-r" onMouseDown={e => { e.stopPropagation(); startEventDrag(e, ev, 'resize-r') }} />
            <div className="block-name">{ev.label}</div>
            <div className="block-time">{dayjs(startMs).format('HH:mm')}–{dayjs(endMs).format('HH:mm')}</div>
          </div>
        })
      }

      // Grouped
      const minStart = Math.min(...gapEvents.map(e => dayjs(e.startTime).valueOf()))
      const maxEnd = Math.max(...gapEvents.map(e => dayjs(e.endTime).valueOf()))
      const groupStyle = getEventVisualStyle(minStart, maxEnd, gap.start, gap.end)

      if (!isExpanded) {
        return [(
          <div key={groupKey} className="gantt-block plan-event-group"
            style={groupStyle}
            onClick={() => setExpandedGroups(prev => new Set([...prev, groupKey]))}
            title={`${gapEvents.length} 个事项，点击展开`}
          >
            <span className="block-name">多个事项 ({gapEvents.length})</span>
            <span className="event-group-expand">↓</span>
          </div>
        )]
      }

      // Expanded group
      const expandedHeight = gapEvents.length * 30 + 18
      return [(
        <div key={groupKey} className="gantt-block plan-event-group expanded"
          style={{ ...groupStyle, height: `${expandedHeight}px`, top: '4px', bottom: 'auto' }}
        >
          <button className="group-collapse-btn"
            onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.delete(groupKey); return n })}
            title="折叠"
          >↑</button>
          {gapEvents.map((ev, i) => (
            <div key={ev.id} className="gantt-block plan-event-child"
              style={{ top: `${i * 30 + 4}px` }}
              onMouseDown={e => startEventDrag(e, ev, 'move')}
              onContextMenu={e => openEventCtx(e, ev.id)}
              title={`${ev.label}\n右键删除`}
            >
              {ev.label}
            </div>
          ))}
        </div>
      )]
    })
  }

  const getPlanRowExtraHeight = (tl: Timeline, planTransits: TransitOption[]) => {
    const evBlocks = getPlanEvents(tl.id)
    if (evBlocks.length === 0) return 0
    const gaps = computeTransitGaps(planTransits)
    let maxExtra = 0
    for (const gap of gaps) {
      const groupKey = `${tl.id}-${gap.key}`
      if (!expandedGroups.has(groupKey)) continue
      const gapEvents = evBlocks.filter(ev => dayjs(ev.startTime).valueOf() >= gap.start && dayjs(ev.startTime).valueOf() < gap.end)
      const gapWidthPx = (gap.end - gap.start) / totalMs * ganttContentWidth
      if (gapEvents.length > 1 && gapWidthPx < gapEvents.length * 60) {
        maxExtra = Math.max(maxExtra, gapEvents.length * 30 + 18 + 12)
      }
    }
    return maxExtra
  }

  return (
    <main className="panel panel-editor">
      <div className="plan-bar">
        <span className="plan-bar-title">时刻表</span>
        <div className="undo-redo-group">
          <button className="btn-undoredo" onClick={undo} disabled={past.length === 0} title="撤销 (Ctrl+Z)" aria-label="撤销">↩</button>
          <button className="btn-undoredo" onClick={redo} disabled={future.length === 0} title="恢复 (Ctrl+Y)" aria-label="恢复">↪</button>
          <button className="btn-clear-all" onClick={handleClearAll}
            disabled={!hasClearableData}
            title="清空行程内容，保留空的计划 1（弹窗确认，可撤销）">
            一键清空
          </button>
          <button className="btn-restore-demo" onClick={handleRestoreDemo}
            title="用根室官方时刻快照覆盖当前内容（弹窗确认，可撤销）">
            恢复官方示例
          </button>
        </div>
        <form className="plan-create-form" onSubmit={handleCreate}>
          <input type="text" placeholder={`计划 ${timelines.length + 1}`} value={newName} onChange={e => setNewName(e.target.value)} />
          <button type="submit" className="btn-primary">＋ 新建计划</button>
        </form>
      </div>

      <div className="gantt-scroll">
        <div className="gantt" ref={ganttRef} style={{ minWidth: minGanttWidth }}>
          {/* Time axis */}
          <div className="gantt-header-row">
            <div className="gantt-label-col" />
            <div className="gantt-axis"><HourTicks hours={hours} rangeStart={rangeStart} totalMs={totalMs} /></div>
          </div>

          {/* Source rows */}
          {groups.map(group => {
            const rowColor = getRowColor(group.colorIndex)
            const laneLayout = laneLayouts.get(group.rowId ?? '__uncategorized')!
            return (
              <div key={group.rowId ?? '__uncategorized'} className="gantt-row"
                style={{ minHeight: Math.max(54, laneLayout.laneCount * 46 + 8) }}>
                <div className="gantt-label-col gantt-label-col-source">
                  {renderRowLabel(group)}
                  {group.rowId && (
                    <button className="btn-icon row-del-btn" onClick={() => removeRow(group.rowId!)} title="删除交通行" aria-label="删除交通行">×</button>
                  )}
                </div>
                <div className="gantt-row-content">
                  <GridLines hours={hours} rangeStart={rangeStart} totalMs={totalMs} />
                  {laneLayout.items.map(({ transit, lane }) => {
                    const isInPlan = (transitPlanMap.get(transit.id) ?? []).length > 0
                    const bgAlpha = isInPlan ? 0.32 : 0.15
                    const borderAlpha = isInPlan ? 0.85 : 0.55
                    const startMs = dragPreview?.entityType === 'transit' && dragPreview.entityId === transit.id
                      ? dragPreview.startMs : dayjs(transit.departureTime).valueOf()
                    const endMs = dragPreview?.entityType === 'transit' && dragPreview.entityId === transit.id
                      ? dragPreview.endMs : dayjs(transit.arrivalTime).valueOf()
                    return (
                      <div
                        key={transit.id}
                        className={`gantt-block${isInPlan ? ' in-plan' : ''}`}
                        style={{
                          left: `${toLeftPct(startMs)}%`,
                          width: `${toWidthPct(startMs, endMs)}%`,
                          background: hexToRgba(rowColor, bgAlpha),
                          borderColor: hexToRgba(rowColor, borderAlpha),
                          borderStyle: isInPlan ? 'dashed' : 'solid',
                          color: rowColor,
                          top: `${6 + lane * 46}px`,
                          bottom: 'auto',
                          height: '42px',
                        }}
                        onMouseDown={e => startDrag(e, transit, 'move')}
                        onClick={() => { if (!dragMovedRef.current) scheduleCandidateClick(transit.id) }}
                        onDoubleClick={e => handleCandidateDoubleClick(e, transit.id)}
                        onContextMenu={e => openCtx(e, transit.id)}
                        onKeyDown={e => handleTransitKeyDown(e, transit)}
                        title={[transit.name, `${dayjs(startMs).format('HH:mm')} → ${dayjs(endMs).format('HH:mm')}`, formatDuration(Math.round((endMs - startMs) / 60000)), transit.notes, '单击选入当前计划 · 双击编辑 · 拖拽移动 · 右键精确管理'].filter(Boolean).join('\n')}
                        role="button" tabIndex={0} aria-label={transit.name}
                      >
                        <div className="resize-handle resize-l" onMouseDown={e => { e.stopPropagation(); startDrag(e, transit, 'resize-l') }} />
                        <div className="resize-handle resize-r" onMouseDown={e => { e.stopPropagation(); startDrag(e, transit, 'resize-r') }} />
                        <div className="block-name">{transit.name}</div>
                        <div className="block-time">{dayjs(startMs).format('HH:mm')}–{dayjs(endMs).format('HH:mm')}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Add row */}
          <div className="gantt-add-row" onClick={handleAddRow}>
            <div className="gantt-label-col gantt-add-row-label">＋ 添加交通行</div>
            <div style={{ flex: 1 }} />
          </div>

          {/* Plan lanes */}
          {timelines.length > 0 && (
            <>
              <div className="gantt-plan-separator">
                <div className="gantt-label-col"><span className="gantt-label gantt-separator-label">计划</span></div>
                <div style={{ flex: 1, borderTop: '2px dashed #c8cbe0' }} />
              </div>
              {timelines.map((tl, idx) => {
                const color = planColor(idx)
                const planData = planDataByTimeline.get(tl.id)!
                const planTransits = planData.transits
                const isSelected = selectedTimelineId === tl.id
                const extraHeight = getPlanRowExtraHeight(tl, planTransits)
                return (
                  <div key={tl.id} className={`gantt-row gantt-plan-row${isSelected ? ' plan-row-selected' : ''}`}
                    style={{ minHeight: 60 + extraHeight, '--active-plan-color': color } as React.CSSProperties}
                    onClick={() => selectTimeline(tl.id)}
                  >
                    <div className="gantt-label-col gantt-plan-label-col">
                      <span className="plan-color-dot" style={{ background: color }} />
                      {editingPlanId === tl.id ? (
                        <input
                          className="gantt-plan-name-input"
                          value={editingPlanName}
                          onChange={e => setEditingPlanName(e.target.value)}
                          onBlur={commitPlanEdit}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingPlanId(null) }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="gantt-label gantt-label-editable"
                          style={{ color }}
                          title={`${tl.name}（单击激活，双击改名）`}
                          onDoubleClick={e => { e.stopPropagation(); startPlanEdit(tl) }}
                        >{tl.name}</span>
                      )}
                      {!tl.isValid && <span className="plan-row-invalid">!</span>}
                      <button className="btn-icon plan-row-del" onClick={e => { e.stopPropagation(); deleteTimeline(tl.id) }} aria-label="删除计划">×</button>
                    </div>
                    <div className="gantt-row-content"
                      onContextMenu={e => handlePlanLaneContextMenu(e, tl, planTransits)}
                    >
                      <GridLines hours={hours} rangeStart={rangeStart} totalMs={totalMs} />
                      {planTransits.map(transit => {
                        const blockColor = getTransitRowColor(transit)
                        const rowName = transit.category ? rows.find(r => r.id === transit.category)?.name : null
                        const segment = planData.segmentByTransitId.get(transit.id)
                        const isConflict = segment ? !segment.validConnection : false
                        const startMs = dragPreview?.entityType === 'transit' && dragPreview.entityId === transit.id
                          ? dragPreview.startMs : dayjs(transit.departureTime).valueOf()
                        const endMs = dragPreview?.entityType === 'transit' && dragPreview.entityId === transit.id
                          ? dragPreview.endMs : dayjs(transit.arrivalTime).valueOf()
                        return (
                          <div
                            key={transit.id}
                            className={`gantt-block plan-block reserved${isConflict ? ' conflict' : ''}`}
                            style={{
                              left: `${toLeftPct(startMs)}%`,
                              width: `${toWidthPct(startMs, endMs)}%`,
                              '--plan-color': blockColor,
                            } as React.CSSProperties}
                            title={[rowName, transit.name, `${dayjs(startMs).format('HH:mm')} → ${dayjs(endMs).format('HH:mm')}`, transit.notes, '单击激活此计划 · 双击编辑班次 · 右键从计划移除'].filter(Boolean).join('\n')}
                            onClick={e => { e.stopPropagation(); selectTimeline(tl.id) }}
                            onDoubleClick={e => { e.stopPropagation(); setEditingTransitId(transit.id) }}
                            onContextMenu={e => openCtx(e, transit.id, tl.id)}
                          >
                            {rowName && <div className="block-row-name">{rowName}</div>}
                            {transit.name && <div className="block-name">{transit.name}</div>}
                            <div className="block-time">{dayjs(startMs).format('HH:mm')}–{dayjs(endMs).format('HH:mm')}</div>
                          </div>
                        )
                      })}
                      {renderEventBlocksForPlan(tl, planTransits)}
                    </div>
                  </div>
                )
              })}
              <div className="gantt-add-row gantt-add-plan" onClick={handleAddPlan}>
                <div className="gantt-label-col gantt-add-row-label">＋ 添加计划</div>
                <div style={{ flex: 1 }} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="plan-footer">
        <span className="plan-footer-hint">单击候选班次更新当前计划 · 双击编辑 · 拖拽移动 · 右键精确管理 · Ctrl+Z 撤销</span>
        {interactionMessage && <span className="plan-footer-error" role="status">{interactionMessage}</span>}
        {selectedTimelineId && (
          <><span className="plan-footer-sep">｜</span>
          <span className="plan-footer-name">{timelines.find(t => t.id === selectedTimelineId)?.name}<span style={{ fontWeight: 400, color: '#9ca3af' }}> 预览中</span></span></>
        )}
      </div>

      {confirmAction && (
        <div className="confirm-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setConfirmAction(null)
        }}>
          <div className="confirm-modal" role="alertdialog" aria-modal="true"
            aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-description">
            <div className={`confirm-modal-icon ${confirmAction}`} aria-hidden="true">
              {confirmAction === 'clear' ? '!' : '↻'}
            </div>
            <h2 id="confirm-modal-title">
              {confirmAction === 'clear' ? '确定清空当前行程？' : '确定恢复官方示例？'}
            </h2>
            <p id="confirm-modal-description">
              {confirmAction === 'clear'
                ? '交通行、班次和事项会被清空，仅保留一个空的“计划 1”。'
                : '当前交通行、班次、计划和事项会被根室官方时刻示例覆盖。'}
            </p>
            <p className="confirm-modal-undo">操作完成后仍可点击 ↩ 或按 Ctrl+Z 撤销。</p>
            <div className="confirm-modal-actions">
              <button type="button" ref={cancelConfirmButtonRef} className="confirm-modal-cancel" onClick={() => setConfirmAction(null)}>取消</button>
              <button type="button"
                className={`confirm-dialog-confirm ${confirmAction === 'clear' ? 'danger' : 'primary'}`}
                onClick={handleConfirmAction}>
                {confirmAction === 'clear' ? '确认清空' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <>
          <div className="ctx-backdrop" onClick={() => setContextMenu(null)} />
          <div className="ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            {contextMenu.entityType === 'event' ? (
              <>
                <div className="ctx-header">事项操作</div>
                <button className="ctx-item" onClick={() => { removePlanEvent(contextMenu.entityId); setContextMenu(null) }}>
                  <span className="ctx-check" style={{ color: '#ef4444' }}>×</span>删除此事项
                </button>
              </>
            ) : contextMenu.fromPlanId ? (
              <>
                <div className="ctx-header">移出计划</div>
                <button className="ctx-item" onClick={() => removeFromPlan(contextMenu.fromPlanId!, contextMenu.entityId)}>
                  <span className="ctx-check" style={{ color: '#ef4444' }}>×</span>
                  从「{timelines.find(timeline => timeline.id === contextMenu.fromPlanId)?.name ?? '此计划'}」移除
                </button>
                <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
                {timelines.filter(t => t.id !== contextMenu.fromPlanId).map((tl, i) => {
                  const otherIdx = timelines.indexOf(tl)
                  const isIn = tl.segments.some(s => s.transitId === contextMenu.entityId)
                  if (!isIn) return null
                  return (
                    <button key={tl.id} className="ctx-item ctx-item-in" onClick={() => removeFromPlan(tl.id, contextMenu.entityId)}>
                      <span className="ctx-dot" style={{ background: planColor(otherIdx >= 0 ? otherIdx : i) }} />
                      <span className="ctx-check" style={{ color: '#ef4444' }}>×</span>从「{tl.name}」移除
                    </button>
                  )
                })}
              </>
            ) : (
              timelines.length === 0 ? <div className="ctx-header">请先新建计划</div> : (
                <>
                  <div className="ctx-header">加入 / 移出计划</div>
                  {timelines.map((tl, idx) => {
                    const isIn = tl.segments.some(s => s.transitId === contextMenu.entityId)
                    return (
                      <button key={tl.id} className={`ctx-item${isIn ? ' ctx-item-in' : ''}`} onClick={() => toggleInPlan(tl.id, contextMenu.entityId)}>
                        <span className="ctx-dot" style={{ background: planColor(idx) }} />
                        <span className="ctx-check">{isIn ? '✓' : '+'}</span>
                        {tl.name}{!tl.isValid && <span className="ctx-warn"> ⚠</span>}
                      </button>
                    )
                  })}
                </>
              )
            )}
          </div>
        </>
      )}
    </main>
  )
}
