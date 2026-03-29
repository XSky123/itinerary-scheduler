import { useState, useRef, useEffect } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTimelineStore } from '../store/timelineStore'
import type { TransitOption, Timeline, TransitType, PlanEventBlock } from '../lib/models'
import type { HistoryEntry } from '../store/timelineStore'
import { formatDuration } from '../lib/scheduler'
import { getRowColor, hexToRgba } from '../lib/rowColors'

const TYPE_EMOJI: Record<TransitType, string> = {
  flight: '✈', train: '🚄', bus: '🚌', shuttle: '🚐', custom: '🚗',
}

const PLAN_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4']
const LABEL_COL_WIDTH = 230
const SNAP_MS = 5 * 60 * 1000
const DAY_START_H = 7
const DAY_END_H = 23
// Min px width for a gap to render event blocks inline in the Gantt
const MIN_GAP_PX_FOR_INLINE = 44

interface DragState {
  entityId: string
  entityType: 'transit' | 'event'
  action: 'move' | 'resize-l' | 'resize-r'
  startClientX: number
  startDepMs: number
  startArrMs: number
  contentWidthPx: number
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

function buildTimeRange(transits: TransitOption[]): { rangeStart: Dayjs; rangeEnd: Dayjs; totalMs: number } {
  if (transits.length === 0) {
    const base = dayjs().startOf('day')
    return { rangeStart: base.add(8, 'hour'), rangeEnd: base.add(20, 'hour'), totalMs: 12 * 3600000 }
  }
  const ts = transits.flatMap(t => [dayjs(t.departureTime).valueOf(), dayjs(t.arrivalTime).valueOf()])
  const rangeStart = dayjs(Math.min(...ts)).startOf('hour')
  const rangeEnd = dayjs(Math.max(...ts)).startOf('hour').add(1, 'hour')
  return { rangeStart, rangeEnd, totalMs: rangeEnd.diff(rangeStart) }
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
    getAllTransits, getAllTimelines, getAllRows,
    selectedTimelineId, selectTimeline,
    createTimeline, deleteTimeline, renameTimeline,
    addSegmentToTimeline, removeSegmentFromTimeline,
    updateTransit, addRow, updateRow, removeRow,
    setEditingTransitId, past, future, undo, redo, pushHistoryEntry,
    addPlanEvent, updatePlanEvent, removePlanEvent, getPlanEventsByTimeline,
  } = useTimelineStore()

  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editingRowName, setEditingRowName] = useState('')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingPlanName, setEditingPlanName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const dragRef = useRef<DragState | null>(null)
  const dragMovedRef = useRef(false)
  const preDragStateRef = useRef<HistoryEntry | null>(null)
  const dragParamsRef = useRef({ totalMs: 0, updateTransit, updatePlanEvent })
  const ganttRef = useRef<HTMLDivElement>(null)

  const transits = getAllTransits()
  const timelines = getAllTimelines()
  const rows = getAllRows()
  const groups = buildGroups(transits, rows)
  const { rangeStart, rangeEnd, totalMs } = buildTimeRange(transits)
  const hours = buildHourTicks(rangeStart, rangeEnd)
  const hourCount = Math.max(1, Math.ceil(totalMs / 3600000))
  const minGanttWidth = LABEL_COL_WIDTH + Math.max(600, hourCount * 90)
  const ganttContentWidth = minGanttWidth - LABEL_COL_WIDTH

  dragParamsRef.current = { totalMs, updateTransit, updatePlanEvent }

  const toLeftPct = (t: string) => Math.max(0, (dayjs(t).diff(rangeStart) / totalMs) * 100)
  const toWidthPct = (d: string, a: string) => Math.max(0.5, (dayjs(a).diff(dayjs(d)) / totalMs) * 100)

  const transitPlanMap = new Map<string, Timeline[]>()
  for (const tl of timelines)
    for (const seg of tl.segments) {
      if (!transitPlanMap.has(seg.transitId)) transitPlanMap.set(seg.transitId, [])
      transitPlanMap.get(seg.transitId)!.push(tl)
    }

  const planColor = (idx: number) => PLAN_COLORS[idx % PLAN_COLORS.length]

  const getTransitRowColor = (transit: TransitOption) => {
    if (!transit.category) return '#9ca3af'
    const rowIdx = rows.findIndex(r => r.id === transit.category)
    return getRowColor(rowIdx >= 0 ? rowIdx : -1)
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
      ...getPlanEventsByTimeline(timelineId).map(ev => ({ s: dayjs(ev.startTime).valueOf(), e: dayjs(ev.endTime).valueOf() })),
    ].sort((a, b) => a.s - b.s)
    let gapStart = dayStart
    let gapEnd = dayEnd
    for (const { s, e } of occupied) {
      if (e <= refTimeMs) gapStart = Math.max(gapStart, e)
      else if (s > refTimeMs) { gapEnd = Math.min(gapEnd, s); break }
    }
    return { startMs: gapStart, endMs: Math.min(gapStart + 3_600_000, gapEnd) }
  }

  // ── Drag ─────────────────────────────────────────────────────────────────
  const startDrag = (e: React.MouseEvent, transit: TransitOption, action: DragState['action']) => {
    e.preventDefault(); e.stopPropagation()
    if (!ganttRef.current) return
    dragMovedRef.current = false
    preDragStateRef.current = {
      transits: transits.map(t => [t.id, t]),
      timelines: timelines.map(tl => [tl.id, tl]),
    }
    dragRef.current = {
      entityId: transit.id, entityType: 'transit', action,
      startClientX: e.clientX,
      startDepMs: dayjs(transit.departureTime).valueOf(),
      startArrMs: dayjs(transit.arrivalTime).valueOf(),
      contentWidthPx: ganttRef.current.offsetWidth - LABEL_COL_WIDTH,
    }
  }

  const startEventDrag = (e: React.MouseEvent, ev: PlanEventBlock, action: DragState['action']) => {
    e.preventDefault(); e.stopPropagation()
    if (!ganttRef.current) return
    dragMovedRef.current = false
    dragRef.current = {
      entityId: ev.id, entityType: 'event', action,
      startClientX: e.clientX,
      startDepMs: dayjs(ev.startTime).valueOf(),
      startArrMs: dayjs(ev.endTime).valueOf(),
      contentWidthPx: ganttRef.current.offsetWidth - LABEL_COL_WIDTH,
    }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragRef.current; if (!ds) return
      if (Math.abs(e.clientX - ds.startClientX) > 3) dragMovedRef.current = true
      const { totalMs: ms, updateTransit: updT, updatePlanEvent: updE } = dragParamsRef.current
      const deltaMs = Math.round(((e.clientX - ds.startClientX) * ms / ds.contentWidthPx) / SNAP_MS) * SNAP_MS
      let dep = ds.startDepMs, arr = ds.startArrMs
      if (ds.action === 'move') { dep += deltaMs; arr += deltaMs }
      else if (ds.action === 'resize-l') dep = Math.min(ds.startDepMs + deltaMs, arr - SNAP_MS)
      else arr = Math.max(ds.startArrMs + deltaMs, dep + SNAP_MS)
      if (ds.entityType === 'transit') {
        updT(ds.entityId, {
          departureTime: dayjs(dep).toISOString(),
          arrivalTime: dayjs(arr).toISOString(),
          duration: Math.round((arr - dep) / 60000),
        })
      } else {
        updE(ds.entityId, { startTime: dayjs(dep).toISOString(), endTime: dayjs(arr).toISOString() })
      }
    }
    const onUp = () => {
      if (dragRef.current?.entityType === 'transit' && dragMovedRef.current && preDragStateRef.current) {
        pushHistoryEntry(preDragStateRef.current)
      }
      preDragStateRef.current = null
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setContextMenu({ entityId: transitId, entityType: 'transit', x: e.clientX, y: e.clientY, fromPlanId })
  }
  const openEventCtx = (e: React.MouseEvent, eventId: string) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ entityId: eventId, entityType: 'event', x: e.clientX, y: e.clientY })
  }
  const toggleInPlan = (timelineId: string, transitId: string) => {
    const tl = timelines.find(t => t.id === timelineId); if (!tl) return
    const seg = tl.segments.find(s => s.transitId === transitId)
    if (seg) removeSegmentFromTimeline(timelineId, seg.order)
    else addSegmentToTimeline(timelineId, transitId)
    setContextMenu(null)
  }
  const removeFromPlan = (timelineId: string, transitId: string) => {
    const tl = timelines.find(t => t.id === timelineId); if (!tl) return
    const seg = tl.segments.find(s => s.transitId === transitId)
    if (seg) removeSegmentFromTimeline(timelineId, seg.order)
    setContextMenu(null)
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
        title={group.label}
      >
        {emoji && <span className="row-type-emoji">{emoji}</span>}
        {group.label}
      </span>
    )
  }

  // ── Event block rendering for a plan lane ────────────────────────────────
  const renderEventBlocksForPlan = (tl: Timeline, planTransits: TransitOption[]) => {
    const evBlocks = getPlanEventsByTimeline(tl.id)
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
        return gapEvents.map(ev => (
          <div key={ev.id}
            className="gantt-block plan-event-block"
            style={{ left: `${toLeftPct(ev.startTime)}%`, width: `${toWidthPct(ev.startTime, ev.endTime)}%` }}
            onMouseDown={e => startEventDrag(e, ev, 'move')}
            onContextMenu={e => openEventCtx(e, ev.id)}
            title={`${ev.label}\n${dayjs(ev.startTime).format('HH:mm')}–${dayjs(ev.endTime).format('HH:mm')}\n右键删除`}
          >
            <div className="resize-handle resize-l" onMouseDown={e => { e.stopPropagation(); startEventDrag(e, ev, 'resize-l') }} />
            <div className="resize-handle resize-r" onMouseDown={e => { e.stopPropagation(); startEventDrag(e, ev, 'resize-r') }} />
            <div className="block-name">{ev.label}</div>
            <div className="block-time">{dayjs(ev.startTime).format('HH:mm')}–{dayjs(ev.endTime).format('HH:mm')}</div>
          </div>
        ))
      }

      // Grouped
      const minStart = Math.min(...gapEvents.map(e => dayjs(e.startTime).valueOf()))
      const maxEnd = Math.max(...gapEvents.map(e => dayjs(e.endTime).valueOf()))
      const groupLeft = `${toLeftPct(dayjs(minStart).toISOString())}%`
      const groupWidth = `${toWidthPct(dayjs(minStart).toISOString(), dayjs(maxEnd).toISOString())}%`

      if (!isExpanded) {
        return [(
          <div key={groupKey} className="gantt-block plan-event-group"
            style={{ left: groupLeft, width: groupWidth }}
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
          style={{ left: groupLeft, width: groupWidth, height: `${expandedHeight}px`, top: '4px', bottom: 'auto' }}
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
    const evBlocks = getPlanEventsByTimeline(tl.id)
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
            return (
              <div key={group.rowId ?? '__uncategorized'} className="gantt-row">
                <div className="gantt-label-col gantt-label-col-source">
                  {renderRowLabel(group)}
                  {group.rowId && (
                    <button className="btn-icon row-del-btn" onClick={() => removeRow(group.rowId!)} title="删除交通行" aria-label="删除交通行">×</button>
                  )}
                </div>
                <div className="gantt-row-content">
                  <GridLines hours={hours} rangeStart={rangeStart} totalMs={totalMs} />
                  {group.transits.map(transit => {
                    const isInPlan = (transitPlanMap.get(transit.id) ?? []).length > 0
                    const bgAlpha = isInPlan ? 0.32 : 0.15
                    const borderAlpha = isInPlan ? 0.85 : 0.55
                    return (
                      <div
                        key={transit.id}
                        className={`gantt-block${isInPlan ? ' in-plan' : ''}`}
                        style={{
                          left: `${toLeftPct(transit.departureTime)}%`,
                          width: `${toWidthPct(transit.departureTime, transit.arrivalTime)}%`,
                          background: hexToRgba(rowColor, bgAlpha),
                          borderColor: hexToRgba(rowColor, borderAlpha),
                          borderStyle: isInPlan ? 'dashed' : 'solid',
                          color: rowColor,
                        }}
                        onMouseDown={e => startDrag(e, transit, 'move')}
                        onClick={() => { if (!dragMovedRef.current) setEditingTransitId(transit.id) }}
                        onContextMenu={e => openCtx(e, transit.id)}
                        title={[transit.name, `${dayjs(transit.departureTime).format('HH:mm')} → ${dayjs(transit.arrivalTime).format('HH:mm')}`, formatDuration(transit.duration), transit.notes, '点击在左栏编辑 · 拖拽移动 · 右键管理计划'].filter(Boolean).join('\n')}
                        role="button" tabIndex={0} aria-label={transit.name}
                      >
                        <div className="resize-handle resize-l" onMouseDown={e => { e.stopPropagation(); startDrag(e, transit, 'resize-l') }} />
                        <div className="resize-handle resize-r" onMouseDown={e => { e.stopPropagation(); startDrag(e, transit, 'resize-r') }} />
                        <div className="block-name">{transit.name}</div>
                        <div className="block-time">{dayjs(transit.departureTime).format('HH:mm')}–{dayjs(transit.arrivalTime).format('HH:mm')}</div>
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
                <div className="gantt-label-col"><span className="gantt-label gantt-separator-label">最终方案</span></div>
                <div style={{ flex: 1, borderTop: '2px dashed #c8cbe0' }} />
              </div>
              {timelines.map((tl, idx) => {
                const color = planColor(idx)
                const planTransits = tl.segments.map(s => transits.find(t => t.id === s.transitId)).filter(Boolean) as TransitOption[]
                const isSelected = selectedTimelineId === tl.id
                const extraHeight = getPlanRowExtraHeight(tl, planTransits)
                return (
                  <div key={tl.id} className={`gantt-row gantt-plan-row${isSelected ? ' plan-row-selected' : ''}`}
                    style={{ minHeight: 60 + extraHeight }}
                  >
                    <div className="gantt-label-col gantt-plan-label-col" onClick={() => selectTimeline(isSelected ? null : tl.id)}>
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
                          title={tl.name}
                          onClick={e => { e.stopPropagation(); startPlanEdit(tl) }}
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
                        const segment = tl.segments.find(s => s.transitId === transit.id)
                        const isConflict = segment ? !segment.validConnection : false
                        return (
                          <div
                            key={transit.id}
                            className={`gantt-block plan-block reserved${isConflict ? ' conflict' : ''}`}
                            style={{
                              left: `${toLeftPct(transit.departureTime)}%`,
                              width: `${toWidthPct(transit.departureTime, transit.arrivalTime)}%`,
                              '--plan-color': blockColor,
                            } as React.CSSProperties}
                            title={[rowName, transit.name, `${dayjs(transit.departureTime).format('HH:mm')} → ${dayjs(transit.arrivalTime).format('HH:mm')}`, transit.notes, '左键在左栏编辑 · 右键移出计划'].filter(Boolean).join('\n')}
                            onClick={() => setEditingTransitId(transit.id)}
                            onContextMenu={e => openCtx(e, transit.id, tl.id)}
                          >
                            {rowName && <div className="block-row-name">{rowName}</div>}
                            {transit.name && <div className="block-name">{transit.name}</div>}
                            <div className="block-time">{dayjs(transit.departureTime).format('HH:mm')}–{dayjs(transit.arrivalTime).format('HH:mm')}</div>
                          </div>
                        )
                      })}
                      {renderEventBlocksForPlan(tl, planTransits)}
                    </div>
                  </div>
                )
              })}
              <div className="gantt-add-row gantt-add-plan" onClick={handleAddPlan}>
                <div className="gantt-label-col gantt-add-row-label">＋ 添加方案</div>
                <div style={{ flex: 1 }} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="plan-footer">
        <span className="plan-footer-hint">点击块在左栏编辑 · 拖拽移动 · 右键管理计划 · 计划行空白处右键添加事项 · Ctrl+Z 撤销</span>
        {selectedTimelineId && (
          <><span className="plan-footer-sep">｜</span>
          <span className="plan-footer-name">{timelines.find(t => t.id === selectedTimelineId)?.name}<span style={{ fontWeight: 400, color: '#9ca3af' }}> 预览中</span></span></>
        )}
      </div>

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
                  <span className="ctx-check" style={{ color: '#ef4444' }}>×</span>从此计划移除
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
