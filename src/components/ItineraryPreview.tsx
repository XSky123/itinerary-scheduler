import { useState, useMemo } from 'react'
import dayjs from 'dayjs'
import { shallow } from 'zustand/shallow'
import { useTimelineStore } from '../store/timelineStore'
import { generateItinerary, formatTime, formatDuration, exportAsHTML } from '../lib/scheduler'
import type { Timeline, ItineraryEvent, PlanEventBlock } from '../lib/models'

const EVENT_ICONS: Record<string, string> = {
  depart: 'D',
  arrive: 'A',
  transit: 'T',
  gap: 'G',
}

type EventDraft = {
  label: string
  start: string
  end: string
  notes: string
}

function downloadHTML(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8;' })
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
    timelinesMap, transitsMap, planEventsMap, selectedTimelineId, selectTimeline,
    addPlanEvent, updatePlanEvent, removePlanEvent,
  } = useTimelineStore(state => ({
    timelinesMap: state.timelines,
    transitsMap: state.transits,
    planEventsMap: state.planEvents,
    selectedTimelineId: state.selectedTimelineId,
    selectTimeline: state.selectTimeline,
    addPlanEvent: state.addPlanEvent,
    updatePlanEvent: state.updatePlanEvent,
    removePlanEvent: state.removePlanEvent,
  }), shallow)

  const [eventDrafts, setEventDrafts] = useState<Record<string, EventDraft>>({})
  const [eventErrors, setEventErrors] = useState<Record<string, string>>({})

  const timelines = useMemo(() => Array.from(timelinesMap.values()), [timelinesMap])
  const transitMap = transitsMap

  const activeTimeline =
    (selectedTimelineId ? timelines.find(t => t.id === selectedTimelineId) : null) ??
    timelines[0] ?? null

  const itinerary = useMemo(() =>
    activeTimeline && activeTimeline.segments.length > 0
      ? generateItinerary(sortedTimeline(activeTimeline, transitMap), transitMap)
      : null, [activeTimeline, transitMap])

  const activePlanEvents = useMemo(() => {
    if (!activeTimeline) return []
    return Array.from(planEventsMap.values())
      .filter(event => event.timelineId === activeTimeline.id)
      .sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime)))
  }, [activeTimeline, planEventsMap])

  const getEventsInGap = (gapEvent: ItineraryEvent): PlanEventBlock[] => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return []
    const gapStartMs = dayjs(gapEvent.time).valueOf()
    const gapEndMs = gapStartMs + gapEvent.duration * 60000
    return activePlanEvents
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
      [ev.id]: { ...base, [field]: value },
    }))
  }

  const validateEventDraft = (gapEvent: ItineraryEvent, ev: PlanEventBlock, draft: EventDraft) => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return '当前事项暂时无法校验'

    const day = dayjs(gapEvent.time).format('YYYY-MM-DD')
    const start = dayjs(`${day}T${draft.start}`)
    const end = dayjs(`${day}T${draft.end}`)
    const gapStart = dayjs(gapEvent.time)
    const gapEnd = gapStart.add(gapEvent.duration, 'minute')

    if (!start.isValid() || !end.isValid()) return '请输入正确的起止时间'
    if (!end.isAfter(start)) return '结束时间需要晚于开始时间'
    if (start.isBefore(gapStart) || end.isAfter(gapEnd)) return '事项时间不能超出当前间隙'

    const overlaps = getEventsInGap(gapEvent)
      .filter(item => item.id !== ev.id)
      .some(item => start.isBefore(dayjs(item.endTime)) && end.isAfter(dayjs(item.startTime)))

    if (overlaps) return '事项时间不能与其他事项重叠'
    return null
  }

  const commitEventDraft = (gapEvent: ItineraryEvent, ev: PlanEventBlock) => {
    const draft = getEventDraft(ev)
    const error = validateEventDraft(gapEvent, ev, draft)
    if (error) {
      setEventErrors(prev => ({ ...prev, [ev.id]: error }))
      return
    }

    const day = dayjs(gapEvent.time).format('YYYY-MM-DD')
    setEventErrors(prev => {
      const next = { ...prev }
      delete next[ev.id]
      return next
    })
    updatePlanEvent(ev.id, {
      label: draft.label.trim() || '事项',
      startTime: dayjs(`${day}T${draft.start}`).toISOString(),
      endTime: dayjs(`${day}T${draft.end}`).toISOString(),
      notes: draft.notes.trim() || undefined,
    })
    setEventDrafts(prev => {
      const next = { ...prev }
      delete next[ev.id]
      return next
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
                          <div key={ev.id} className="plan-event-preview-card">
                            <div className="plan-event-preview-head">
                              <span className="plan-event-pin">#</span>
                              <input
                                className="plan-event-label-input"
                                value={draft.label}
                                onChange={e => setEventDraftField(ev, 'label', e.target.value)}
                                onBlur={() => commitEventDraft(event, ev)}
                                placeholder="事项标题"
                              />
                              <button
                                className="btn-icon"
                                onClick={() => removePlanEvent(ev.id)}
                                title="删除"
                                style={{ marginLeft: 'auto', flexShrink: 0 }}
                              >×</button>
                            </div>

                            <div className="plan-event-preview-fields">
                              <label className="plan-event-field">
                                <span>开始</span>
                                <input
                                  type="time"
                                  className={`plan-event-time-input${error ? ' input-error' : ''}`}
                                  value={draft.start}
                                  onChange={e => setEventDraftField(ev, 'start', e.target.value)}
                                  onBlur={() => commitEventDraft(event, ev)}
                                />
                              </label>
                              <label className="plan-event-field">
                                <span>结束</span>
                                <input
                                  type="time"
                                  className={`plan-event-time-input${error ? ' input-error' : ''}`}
                                  value={draft.end}
                                  onChange={e => setEventDraftField(ev, 'end', e.target.value)}
                                  onBlur={() => commitEventDraft(event, ev)}
                                />
                              </label>
                            </div>

                            <textarea
                              className="plan-event-notes-input"
                              value={draft.notes}
                              onChange={e => setEventDraftField(ev, 'notes', e.target.value)}
                              onBlur={() => commitEventDraft(event, ev)}
                              placeholder="备注（可选）"
                              rows={2}
                            />

                            {error && <div className="plan-event-error">{error}</div>}
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
                  const html = exportAsHTML(itinerary, activePlanEvents, activeTimeline.name || '行程单')
                  const date = dayjs(itinerary.startTime).format('YYYYMMDD')
                  downloadHTML(html, `行程单_${date}.html`)
                }}
                title="下载排版好的 HTML，打开后可打印为 PDF"
              >
                导出精美行程单
              </button>
            </>
          )}
        </>
      )}
    </aside>
  )
}
