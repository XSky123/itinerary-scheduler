/**
 * 排程计算逻辑
 * 从时间轴生成完整的行程时间表
 */

import dayjs from 'dayjs';
import type { Timeline, TransitOption, Itinerary, ItineraryEvent, PlanEventBlock } from './models';

/**
 * 从时间轴和班次库生成最终时间表
 */
export function generateItinerary(
  timeline: Timeline,
  transits: Map<string, TransitOption>
): Itinerary {
  const events: ItineraryEvent[] = [];
  let startTime: string = '';
  let endTime: string = '';

  for (let i = 0; i < timeline.segments.length; i++) {
    const segment = timeline.segments[i];
    const transit = transits.get(segment.transitId);

    if (!transit) continue;

    if (i === 0) startTime = transit.departureTime;
    events.push({
      time: transit.departureTime,
      endTime: transit.arrivalTime,
      type: 'transit',
      description: transit.name,
      duration: transit.duration,
      transitId: transit.id,
    });

    endTime = transit.arrivalTime;

    // 添加间隙事件 (如果不是最后一个班次)
    if (i < timeline.segments.length - 1) {
      const nextSegment = timeline.segments[i + 1];
      const nextTransit = transits.get(nextSegment.transitId);

      if (nextTransit) {
        const arrivalTime = dayjs(transit.arrivalTime);
        const departureTime = dayjs(nextTransit.departureTime);
        const gapDuration = departureTime.diff(arrivalTime, 'minute');

        if (gapDuration > 0) {
          events.push({
            time: transit.arrivalTime,
            endTime: nextTransit.departureTime,
            type: 'gap',
            description: '换乘 / 等候',
            duration: gapDuration,
          });
        }
      }
    }
  }

  const startTimeDayjs = dayjs(startTime);
  const endTimeDayjs = dayjs(endTime);
  const totalDuration = endTimeDayjs.diff(startTimeDayjs, 'minute');

  return {
    id: `itinerary-${timeline.id}`,
    timelineId: timeline.id,
    events: events.sort((a, b) => dayjs(a.time).diff(dayjs(b.time))),
    startTime,
    endTime,
    totalDuration,
    createdAt: timeline.updatedAt,
  };
}

/**
 * 格式化时间戳为可读格式
 */
export function formatTime(isoTime: string, format: string = 'HH:mm'): string {
  return dayjs(isoTime).format(format);
}

/**
 * 格式化时长 (分钟) 为可读格式
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins} 分钟`;
  }

  if (mins === 0) {
    return `${hours} 小时`;
  }

  return `${hours} 小时 ${mins} 分钟`;
}

/**
 * 导出自包含、可打印的 HTML 行程单
 */
export function exportAsHTML(
  itinerary: Itinerary,
  planEvents: PlanEventBlock[] = [],
  title = '行程单'
): string {
  const rows = [
    ...itinerary.events.map(event => ({
      timestamp: dayjs(event.time).valueOf(),
      time: formatTime(event.time),
      endTime: event.endTime
        ? formatTime(event.endTime)
        : event.duration !== undefined
          ? formatTime(dayjs(event.time).add(event.duration, 'minute').toISOString())
          : '',
      type: translateEventType(event.type),
      description: event.description,
      notes: '',
      duration: event.duration === undefined ? '' : formatDuration(event.duration),
      cssClass: event.type,
    })),
    ...planEvents.map(event => ({
      timestamp: dayjs(event.startTime).valueOf(),
      time: formatTime(event.startTime),
      endTime: formatTime(event.endTime),
      type: '事项',
      description: event.label,
      notes: event.notes ?? '',
      duration: formatDuration(dayjs(event.endTime).diff(dayjs(event.startTime), 'minute')),
      cssClass: 'plan-event',
    })),
  ].sort((a, b) => a.timestamp - b.timestamp)

  const rowHtml = rows.map(row => `
    <div class="timeline-row ${row.cssClass}">
      <div class="time"><strong>${escapeHtml(row.time)}</strong>${row.endTime ? `<span class="time-arrow">→</span><strong>${escapeHtml(row.endTime)}</strong>` : ''}</div>
      <div class="marker" aria-hidden="true"></div>
      <div class="detail">
        <div class="detail-head"><span class="type">${escapeHtml(row.type)}</span><strong>${escapeHtml(row.description)}</strong></div>
        ${row.notes ? `<div class="notes">${escapeHtml(row.notes).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
      <div class="duration">${escapeHtml(row.duration)}</div>
    </div>`).join('')

  const safeTitle = escapeHtml(title)
  const date = dayjs(itinerary.startTime).format('YYYY年MM月DD日')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} · ${date}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&amp;family=Noto+Sans+SC:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: light; font-family: "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans SC", "Noto Sans JP", "Microsoft YaHei UI", "Yu Gothic UI", "Hiragino Sans GB", system-ui, sans-serif; color: #1f2937; background: #eef1f8; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; }
    .sheet { width: min(820px, 100%); margin: auto; background: white; border-radius: 18px; box-shadow: 0 18px 55px rgba(31, 41, 55, .12); overflow: hidden; }
    header { padding: 34px 38px 26px; color: white; background: linear-gradient(135deg, #667eea, #764ba2); }
    h1 { margin: 0 0 7px; font-size: 28px; letter-spacing: .04em; }
    .date { opacity: .85; font-size: 14px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    .summary-item { padding: 18px 14px; text-align: center; background: #fff; }
    .summary-label { display: block; margin-bottom: 4px; color: #9ca3af; font-size: 12px; }
    .summary-value { font-size: 21px; font-weight: 750; color: #111827; }
    main { padding: 24px 38px 34px; }
    h2 { margin: 0 0 14px; font-size: 16px; color: #374151; }
    .timeline-row { display: grid; grid-template-columns: 122px 18px minmax(0, 1fr) auto; gap: 10px; min-height: 58px; position: relative; }
    .time { display: flex; align-items: baseline; justify-content: flex-end; gap: 5px; padding-top: 9px; color: #374151; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .time-arrow { color: #9ca3af; font-size: 11px; font-weight: 500; }
    .marker { position: relative; }
    .marker::before { content: ""; position: absolute; top: 16px; left: 6px; width: 8px; height: 8px; border-radius: 50%; background: #667eea; box-shadow: 0 0 0 4px #eef0ff; }
    .marker::after { content: ""; position: absolute; top: 28px; bottom: 0; left: 9.5px; width: 1px; background: #e5e7eb; }
    .timeline-row:last-child .marker::after { display: none; }
    .detail { margin: 3px 0 10px; padding: 10px 12px; border-radius: 10px; background: #f8f9fc; }
    .detail-head { display: flex; align-items: baseline; gap: 8px; }
    .detail strong { font-size: 14px; }
    .type { flex-shrink: 0; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; color: #4f46e5; background: #eef2ff; }
    .notes { margin-top: 5px; color: #6b7280; font-size: 12px; line-height: 1.55; }
    .duration { padding-top: 12px; color: #9ca3af; font-size: 11px; white-space: nowrap; }
    .gap .detail { background: #fffbeb; }
    .gap .type { color: #92400e; background: #fef3c7; }
    .plan-event .detail { background: #f3f4f6; border-left: 3px solid #9ca3af; }
    .plan-event .type { color: #4b5563; background: #e5e7eb; }
    footer { padding: 14px 38px 22px; text-align: right; color: #9ca3af; font-size: 10px; }
    @media (max-width: 560px) {
      body { padding: 0; background: white; }
      .sheet { border-radius: 0; box-shadow: none; }
      header, main { padding-left: 20px; padding-right: 20px; }
      .timeline-row { grid-template-columns: 105px 14px minmax(0, 1fr); gap: 7px; }
      .duration { display: none; }
      .time { font-size: 12px; }
    }
    @media print {
      @page { size: A4; margin: 12mm; }
      body { padding: 0; background: white; }
      .sheet { width: 100%; border-radius: 0; box-shadow: none; }
      header { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .timeline-row { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <header><h1>${safeTitle}</h1><div class="date">${date}</div></header>
    <section class="summary">
      <div class="summary-item"><span class="summary-label">出发</span><span class="summary-value">${formatTime(itinerary.startTime)}</span></div>
      <div class="summary-item"><span class="summary-label">到达</span><span class="summary-value">${formatTime(itinerary.endTime)}</span></div>
      <div class="summary-item"><span class="summary-label">总时长</span><span class="summary-value">${formatDuration(itinerary.totalDuration)}</span></div>
    </section>
    <main><h2>行程时间线</h2>${rowHtml}</main>
    <footer>由行程安排工具生成 · 打开浏览器打印可保存为 PDF</footer>
  </article>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char] ?? char)
}

/**
 * 翻译事件类型
 */
function translateEventType(type: string): string {
  const typeMap: Record<string, string> = {
    depart: '出发',
    arrive: '到达',
    transit: '交通',
    gap: '间隙',
  };
  
  return typeMap[type] ?? type;
}
