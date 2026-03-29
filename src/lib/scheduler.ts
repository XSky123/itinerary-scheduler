/**
 * 排程计算逻辑
 * 从时间轴生成完整的行程时间表
 */

import dayjs from 'dayjs';
import type { Timeline, TransitOption, Itinerary, ItineraryEvent } from './models';

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

    // 添加出发事件（每个班次都有）
    if (i === 0) startTime = transit.departureTime;
    events.push({
      time: transit.departureTime,
      type: 'depart',
      description: `出发 - ${transit.name}`,
      transitId: transit.id,
    });

    // 添加到达事件
    events.push({
      time: transit.arrivalTime,
      type: 'arrive',
      description: `到达 - ${transit.name}`,
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
            type: 'gap',
            description: '间隙时间',
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
    id: `itinerary-${Date.now()}`,
    timelineId: timeline.id,
    events: events.sort((a, b) => dayjs(a.time).diff(dayjs(b.time))),
    startTime,
    endTime,
    totalDuration,
    createdAt: dayjs().toISOString(),
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
 * 导出时间表为 CSV 格式
 */
export function exportAsCSV(itinerary: Itinerary): string {
  const lines: string[] = [];
  
  // 头部信息
  lines.push(`时间表 - ${dayjs(itinerary.startTime).format('YYYY-MM-DD')}`);
  lines.push(`开始时间,${formatTime(itinerary.startTime, 'HH:mm')}`);
  lines.push(`结束时间,${formatTime(itinerary.endTime, 'HH:mm')}`);
  lines.push(`总时长,${formatDuration(itinerary.totalDuration)}`);
  lines.push(''); // 空行
  
  // 事件表头
  lines.push('时间,事件类型,描述,时长(分钟)');
  
  // 事件数据
  for (const event of itinerary.events) {
    const time = formatTime(event.time, 'HH:mm');
    const type = translateEventType(event.type);
    const description = event.description;
    const duration = event.duration ?? '';
    
    lines.push(`${time},${type},${description},${duration}`);
  }
  
  return lines.join('\n');
}

/**
 * 翻译事件类型
 */
function translateEventType(type: string): string {
  const typeMap: Record<string, string> = {
    depart: '出发',
    arrive: '到达',
    transit: '换乘',
    gap: '间隙',
  };
  
  return typeMap[type] ?? type;
}
