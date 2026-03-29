import { useState } from 'react'
import dayjs from 'dayjs'
import { useTimelineStore } from '../store/timelineStore'
import { generateItinerary, formatTime, formatDuration, exportAsCSV } from '../lib/scheduler'
import type { Timeline, ItineraryEvent, PlanEventBlock } from '../lib/models'

const EVENT_ICONS: Record<string, string> = {
  depart: '🚀',
  arrive: '📍',
  transit: '🔄',
  gap: '⏱',
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
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

  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const timelines = getAllTimelines()
  const transitMap = new Map(getAllTransits().map(t => [t.id, t]))

  const activeTimeline =
    (selectedTimelineId ? timelines.find(t => t.id === selectedTimelineId) : null) ??
    timelines[0] ?? null

  const itinerary =
    activeTimeline && activeTimeline.segments.length > 0
      ? generateItinerary(sortedTimeline(activeTimeline, transitMap), transitMap)
      : null

  /** Get event blocks that fall within a given gap event's time window */
  const getEventsInGap = (gapEvent: ItineraryEvent): PlanEventBlock[] => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return []
    const gapStartMs = dayjs(gapEvent.time).valueOf()
    const gapEndMs = gapStartMs + gapEvent.duration * 60000
    return getPlanEventsByTimeline(activeTimeline.id)
      .filter(ev => dayjs(ev.startTime).valueOf() >= gapStartMs && dayjs(ev.startTime).valueOf() < gapEndMs)
      .sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime)))
  }

  /** Add a new event block starting from the end of the last event in the gap */
  const handleAddEventInGap = (gapEvent: ItineraryEvent) => {
    if (!activeTimeline || gapEvent.type !== 'gap' || gapEvent.duration === undefined) return
    const gapStartMs = dayjs(gapEvent.time).valueOf()
    const gapEndMs = gapStartMs + gapEvent.duration * 60000
    const existing = getEventsInGap(gapEvent)
    const newStartMs = existing.length > 0
      ? dayjs(existing[existing.length - 1].endTime).valueOf()
      : gapStartMs
    if (newStartMs >= gapEndMs) return
    const newEndMs = Math.min(newStartMs + 3_600_000, gapEndMs)
    addPlanEvent({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timelineId: activeTimeline.id,
      startTime: dayjs(newStartMs).toISOString(),
      endTime: dayjs(newEndMs).toISOString(),
      label: '事项',
    })
  }

  const commitLabelEdit = (ev: PlanEventBlock) => {
    updatePlanEvent(ev.id, { label: editingLabel.trim() || '事项' })
    setEditingEventId(null)
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
        <p className="empty-hint">在时刻表中点击班次块加入计划，此处自动生成行程单</p>
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
                            title={`添加事项（剩余 ${formatDuration(remainMinutes)}）`}
                          >＋</button>
                        )}
                      </div>
                      {/* Event blocks inside this gap */}
                      {gapEvents.map(ev => (
                        <div key={ev.id} className="plan-event-preview-row">
                          <span className="plan-event-pin">📌</span>
                          {editingEventId === ev.id ? (
                            <input
                              className="plan-event-label-input"
                              value={editingLabel}
                              onChange={e => setEditingLabel(e.target.value)}
                              onBlur={() => commitLabelEdit(ev)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                if (e.key === 'Escape') setEditingEventId(null)
                              }}
                              autoFocus
                            />
                          ) : (
                            <span
                              className="plan-event-label"
                              onClick={() => { setEditingEventId(ev.id); setEditingLabel(ev.label) }}
                              title="点击编辑"
                            >{ev.label}</span>
                          )}
                          <span className="plan-event-time-range">
                            {dayjs(ev.startTime).format('HH:mm')}–{dayjs(ev.endTime).format('HH:mm')}
                          </span>
                          <button
                            className="btn-icon"
                            onClick={() => removePlanEvent(ev.id)}
                            title="删除"
                            style={{ marginLeft: 'auto', flexShrink: 0 }}
                          >×</button>
                        </div>
                      ))}
                      {/* Remaining quota indicator */}
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
