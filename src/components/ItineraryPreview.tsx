import { useState } from 'react'
import dayjs from 'dayjs'
import { useTimelineStore } from '../store/timelineStore'
import { generateItinerary, formatTime, formatDuration, exportAsCSV } from '../lib/scheduler'
import type { Timeline, ItineraryEvent, PlanEventBlock } from '../lib/models'

const EVENT_ICONS: Record<string, string> = {
  depart: 'D',
  arrive: 'A',
  transit: 'T',
  gap: 'G',
}

const MAX_EVENT_NOTES_LENGTH = 120

type EventDraft = {
  label: string
  start: string
  end: string
  notes: string
}

function normalizeTimeInput(raw: string): string {
  return raw.replace(/：/g, ':').trim()
}

function parseTimeStr(raw: string): string | null {
  const s = normalizeTimeInput(raw)
  const m1 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m1) {
    const h = +m1[1]
    const mm = +m1[2]
    if (h <= 23 && mm <= 59) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const m2 = s.match(/^(\d{3,4})$/)
  if (m2) {
    const p = m2[0].padStart(4, '0')
    const h = +p.slice(0, 2)
    const mm = +p.slice(2)
    if (h <= 23 && mm <= 59) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const m3 = s.match(/^(\d{1,2})$/)
  if (m3) {
    const h = +m3[1]
    if (h <= 23) return `${String(h).padStart(2, '0')}:00`
  }
  return null
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function sortedTimeline(timeline: Timeline, transitMap: Map<string, { departureTime: string }>): Timeline {
  const sorted = [...timeline.segments].sort((a, b) => {
    const tA = transitMap.get(a.transitId)
    const tB = transitMap.get(b.transitId)
    if (!tA || !tB) return 0
    return dayjs(tA.departureTime).diff(dayjs(tB.departureTime))
  })
  return { ...timeline, segments: sorted.map((s, i) => ({ ...s, order: i })) }
}

export default function ItineraryPreview() {
  const {
    getAllTimelines, getAllTransits, selectedTimelineId, selectTimeline,
    addPlanEvent, updatePlanEvent, removePlanEvent, getPlanEventsByTimeline,
  } = useTimelineStore()

  const [eventDrafts, setEventDrafts] = useState<Record<string, EventDraft>>({})
  const [eventErrors, setEventErrors] = useState<Record<string, { start: boolean; end: boolean; message?: string }>>({})

  const timelines = getAllTimelines()
  const transitMap = new Map(getAllTransits().map(t => [t.id, t]))

  const activeTimeline =
    (selectedTimelineId ? timelines.find(t => t.id === selectedTimelineId) : null) ??
    timelines[0] ?? null

  const itinerary =
    activeTimeline && activeTimeline.segments.length > 0
      ? generateItinerary(sortedTimeline(activeTimeline, transitMap), transitMap)
      : null

  const getEventsInGap = (gapEvent: ItineraryEvent): PlanEventBlock[] => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return []
    const gapStartMs = dayjs(gapEvent.time).valueOf()
    const gapEndMs = gapStartMs + gapEvent.duration * 60000
    return getPlanEventsByTimeline(activeTimeline.id)
      .filter(ev => dayjs(ev.startTime).valueOf() >= gapStartMs && dayjs(ev.startTime).valueOf() < gapEndMs)
      .sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime)))
  }

  const getEventDraft = (ev: PlanEventBlock): EventDraft => (
    eventDrafts[ev.id] ?? {
      label: ev.label,
      start: dayjs(ev.startTime).format('HH:mm'),
      end: dayjs(ev.endTime).format('HH:mm'),
      notes: ev.notes ?? '',
    }
  )

  const setEventDraftField = (ev: PlanEventBlock, field: keyof EventDraft, value: string) => {
    const base = getEventDraft(ev)
    setEventDrafts(prev => ({
      ...prev,
      [ev.id]: {
        ...base,
        [field]: field === 'notes' ? value.slice(0, MAX_EVENT_NOTES_LENGTH) : value,
      },
    }))
  }

  const validateEventDraft = (gapEvent: ItineraryEvent, ev: PlanEventBlock, draft: EventDraft) => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) {
      return { start: false, end: false, message: '当前事项暂时无法校验' }
    }

    const normalizedStart = parseTimeStr(draft.start)
    const normalizedEnd = parseTimeStr(draft.end)
    if (!normalizedStart || !normalizedEnd) {
      return { start: !normalizedStart, end: !normalizedEnd, message: '请输入正确的时间，支持 08:00 / 800 / 8' }
    }

    const day = dayjs(gapEvent.time).format('YYYY-MM-DD')
    const start = dayjs(`${day}T${normalizedStart}`)
    const end = dayjs(`${day}T${normalizedEnd}`)
    const gapStart = dayjs(gapEvent.time)
    const gapEnd = gapStart.add(gapEvent.duration, 'minute')

    if (!end.isAfter(start)) {
      return { start: false, end: true, message: '结束时间需要晚于开始时间' }
    }
    if (start.isBefore(gapStart) || end.isAfter(gapEnd)) {
      return { start: true, end: true, message: '事项时间不能超出当前间隙' }
    }

    const overlaps = getEventsInGap(gapEvent)
      .filter(item => item.id !== ev.id)
      .some(item => start.isBefore(dayjs(item.endTime)) && end.isAfter(dayjs(item.startTime)))

    if (overlaps) {
      return { start: true, end: true, message: '事项时间不能与其他事项重叠' }
    }

    return { start: false, end: false }
  }

  const commitEventDraft = (gapEvent: ItineraryEvent, ev: PlanEventBlock) => {
    const draft = getEventDraft(ev)
    const result = validateEventDraft(gapEvent, ev, draft)
    if (result.message) {
      setEventErrors(prev => ({ ...prev, [ev.id]: result }))
      return
    }

    const normalizedStart = parseTimeStr(draft.start)!
    const normalizedEnd = parseTimeStr(draft.end)!
    const day = dayjs(gapEvent.time).format('YYYY-MM-DD')

    setEventDrafts(prev => ({
      ...prev,
      [ev.id]: {
        ...draft,
        start: normalizedStart,
        end: normalizedEnd,
      },
    }))
    setEventErrors(prev => {
      const next = { ...prev }
      delete next[ev.id]
      return next
    })

    updatePlanEvent(ev.id, {
      label: draft.label.trim() || '事项',
      startTime: dayjs(`${day}T${normalizedStart}`).toISOString(),
      endTime: dayjs(`${day}T${normalizedEnd}`).toISOString(),
      notes: draft.notes.trim() || undefined,
    })
  }

  const handleAddEventInGap = (gapEvent: ItineraryEvent) => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return
    const gapStartMs = dayjs(gapEvent.time).valueOf()
    const gapEndMs = gapStartMs + gapEvent.duration * 60000
    const existing = getEventsInGap(gapEvent)
    const newStartMs = existing.length > 0
      ? dayjs(existing[existing.length - 1].endTime).valueOf()
      : gapStartMs
    if (newStartMs >= gapEndMs) return

    addPlanEvent({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timelineId: activeTimeline.id,
      startTime: dayjs(newStartMs).toISOString(),
      endTime: dayjs(Math.min(newStartMs + 3_600_000, gapEndMs)).toISOString(),
      label: '事项',
    })
  }

  return (
    <aside className="panel panel-preview">
      <div className="panel-header">
        <h2>行程预览</h2>
      </div>

      {timelines.length > 1 && (
        <div className="timeline-tabs">
          {timelines.map(t => (
            <button
              key={t.id}
              className={`timeline-tab${activeTimeline?.id === t.id ? ' active' : ''}`}
              onClick={() => selectTimeline(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {!activeTimeline || activeTimeline.segments.length === 0 ? (
        <p className="empty-hint">在时刻表中点击班次块加入计划，这里会自动生成行程。</p>
      ) : (
        <>
          {itinerary && (
            <>
              <div className="itinerary-summary">
                <div className="summary-item">
                  <span className="summary-label">出发</span>
                  <span className="summary-value">{formatTime(itinerary.startTime)}</span>
                </div>
                <div className="summary-sep">→</div>
                <div className="summary-item">
                  <span className="summary-label">到达</span>
                  <span className="summary-value">{formatTime(itinerary.endTime)}</span>
                </div>
                <div className="summary-total">总 {formatDuration(itinerary.totalDuration)}</div>
              </div>

              <div className="event-list">
                {itinerary.events.map((event, idx) => {
                  const gapEvents = event.type === 'gap' ? getEventsInGap(event) : []
                  const usedMinutes = gapEvents.reduce((sum, ev) =>
                    sum + dayjs(ev.endTime).diff(dayjs(ev.startTime), 'minute'), 0)
                  const remainMinutes = event.type === 'gap' ? (event.duration ?? 0) - usedMinutes : 0
                  const canAddMore = event.type === 'gap' && remainMinutes > 0

                  return (
                    <div key={idx}>
                      <div className={`event-row event-${event.type}`}>
                        <span className="event-icon">{EVENT_ICONS[event.type] ?? '•'}</span>
                        <span className="event-time">{formatTime(event.time)}</span>
                        <span className="event-desc">{event.description}</span>
                        {event.type === 'gap' && event.duration !== undefined && (
                          <span className="event-dur gap-quota" title={`可用配额 ${formatDuration(event.duration)}`}>
                            {formatDuration(event.duration)}
                          </span>
                        )}
                        {event.type !== 'gap' && event.duration !== undefined && (
                          <span className="event-dur">{formatDuration(event.duration)}</span>
                        )}
                        {canAddMore && (
                          <button
                            className="gap-add-btn"
                            onClick={() => handleAddEventInGap(event)}
                            title={`新增事项，剩余 ${formatDuration(remainMinutes)}`}
                          >+</button>
                        )}
                      </div>

                      {gapEvents.map(ev => {
                        const draft = getEventDraft(ev)
                        const error = eventErrors[ev.id]
                        return (
                          <div key={ev.id} className="plan-event-preview-row">
                            <span className="plan-event-pin">#</span>
                            <input
                              className="plan-event-label-input"
                              value={draft.label}
                              onChange={e => setEventDraftField(ev, 'label', e.target.value)}
                              onBlur={() => commitEventDraft(event, ev)}
                              placeholder="事项标题"
                            />
                            <input
                              type="text"
                              className={`plan-event-time-input${error?.start ? ' input-error' : ''}`}
                              value={draft.start}
                              onChange={e => setEventDraftField(ev, 'start', e.target.value)}
                              onBlur={() => commitEventDraft(event, ev)}
                              placeholder="08:00"
                            />
                            <span className="plan-event-time-sep">-</span>
                            <input
                              type="text"
                              className={`plan-event-time-input${error?.end ? ' input-error' : ''}`}
                              value={draft.end}
                              onChange={e => setEventDraftField(ev, 'end', e.target.value)}
                              onBlur={() => commitEventDraft(event, ev)}
                              placeholder="10:00"
                            />
                            <button
                              className="btn-icon"
                              onClick={() => removePlanEvent(ev.id)}
                              title="删除"
                              style={{ marginLeft: 'auto', flexShrink: 0 }}
                            >×</button>
                            <textarea
                              className="plan-event-notes-input inline"
                              value={draft.notes}
                              onChange={e => setEventDraftField(ev, 'notes', e.target.value)}
                              onBlur={() => commitEventDraft(event, ev)}
                              placeholder="备注（可选）"
                              rows={2}
                            />
                            {error?.message && <div className="plan-event-error">{error.message}</div>}
                          </div>
                        )
                      })}

                      {event.type === 'gap' && gapEvents.length > 0 && remainMinutes > 0 && (
                        <div className="gap-remain-hint">余 {formatDuration(remainMinutes)}</div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                className="btn-export"
                onClick={() => {
                  const csv = exportAsCSV(itinerary)
                  const date = dayjs(itinerary.startTime).format('YYYYMMDD')
                  downloadCSV(csv, `行程_${date}.csv`)
                }}
              >
                导出 CSV
              </button>
            </>
          )}
        </>
      )}
    </aside>
  )
}
