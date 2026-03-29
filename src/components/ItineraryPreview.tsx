import dayjs from 'dayjs'
import { useTimelineStore } from '../store/timelineStore'
import { generateItinerary, formatTime, formatDuration, exportAsCSV } from '../lib/scheduler'
import type { Timeline } from '../lib/models'

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
  const { getAllTimelines, getAllTransits, selectedTimelineId, selectTimeline } = useTimelineStore()
  const timelines = getAllTimelines()
  const transitMap = new Map(getAllTransits().map(t => [t.id, t]))

  const activeTimeline =
    (selectedTimelineId ? timelines.find(t => t.id === selectedTimelineId) : null) ??
    timelines[0] ??
    null

  const itinerary =
    activeTimeline && activeTimeline.segments.length > 0
      ? generateItinerary(sortedTimeline(activeTimeline, transitMap), transitMap)
      : null

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
                {itinerary.events.map((event, idx) => (
                  <div key={idx} className={`event-row event-${event.type}`}>
                    <span className="event-icon">{EVENT_ICONS[event.type] ?? '•'}</span>
                    <span className="event-time">{formatTime(event.time)}</span>
                    <span className="event-desc">{event.description}</span>
                    {event.duration !== undefined && (
                      <span className="event-dur">{formatDuration(event.duration)}</span>
                    )}
                  </div>
                ))}
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
