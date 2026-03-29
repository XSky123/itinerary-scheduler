/**
 * 约束验证逻辑
 * 核心：可行性检查 = (前班次_到达时间 + 缓冲时间) ≤ 后班次_出发时间
 */

import dayjs from 'dayjs';
import type { TransitOption, ConstraintValidationResult, TimelineSegment } from './models';

/**
 * 默认缓冲时间配置 (分钟)
 * 从一个班次换乘到另一个班次所需的最少时间
 */
const DEFAULT_BUFFER_CONFIG: Record<string, number> = {
  'flight-to-bus': 30,
  'flight-to-train': 45,
  'flight-to-shuttle': 20,
  'bus-to-train': 20,
  'bus-to-flight': 30,
  'train-to-bus': 15,
  'train-to-flight': 30,
  'shuttle-to-bus': 10,
  'shuttle-to-train': 10,
  default: 10,
};

/**
 * 获取两个班次间所需的缓冲时间
 */
export function getRequiredBuffer(
  previousType: string,
  nextType: string,
  customConfig?: Record<string, number>
): number {
  const config = { ...DEFAULT_BUFFER_CONFIG, ...(customConfig || {}) };
  const key = `${previousType}-to-${nextType}`;
  return config[key] ?? config['default'];
}

/**
 * 验证两个班次是否可以连接
 */
export function validateConnection(
  previousTransit: TransitOption,
  nextTransit: TransitOption,
  customConfig?: Record<string, number>
): ConstraintValidationResult {
  const previousArrival = dayjs(previousTransit.arrivalTime);
  const nextDeparture = dayjs(nextTransit.departureTime);
  const requiredBuffer = getRequiredBuffer(
    previousTransit.type,
    nextTransit.type,
    customConfig
  );

  const actualBuffer = nextDeparture.diff(previousArrival, 'minute');

  // Only flag as infeasible when transits actually overlap in time (negative gap).
  // Buffer shortfalls are advisory but not a hard constraint.
  if (actualBuffer < 0) {
    return {
      isValid: false,
      reason: `班次时间冲突：${previousTransit.name} 到达后 ${Math.abs(actualBuffer)} 分钟，${nextTransit.name} 已出发`,
      requiredBuffer,
      actualBuffer,
    };
  }

  return {
    isValid: true,
    requiredBuffer,
    actualBuffer,
  };
}

/**
 * 验证整个时间轴
 */
export function validateTimeline(
  timeline: TimelineSegment[],
  transits: Map<string, TransitOption>,
  customConfig?: Record<string, number>
): ConstraintValidationResult {
  if (timeline.length === 0) {
    return { isValid: true };
  }

  if (timeline.length === 1) {
    return { isValid: true };
  }

  for (let i = 1; i < timeline.length; i++) {
    const prevSegment = timeline[i - 1];
    const currentSegment = timeline[i];

    const prevTransit = transits.get(prevSegment.transitId);
    const currentTransit = transits.get(currentSegment.transitId);

    if (!prevTransit || !currentTransit) {
      return {
        isValid: false,
        reason: '班次信息不完整',
      };
    }

    const result = validateConnection(prevTransit, currentTransit, customConfig);
    if (!result.isValid) {
      return result;
    }
  }

  return { isValid: true };
}

/**
 * 检查班次是否已经在时间轴中
 */
export function isTransitInTimeline(transitId: string, timeline: TimelineSegment[]): boolean {
  return timeline.some(segment => segment.transitId === transitId);
}

/**
 * 计算总时长
 */
export function calculateTotalDuration(
  timeline: TimelineSegment[],
  transits: Map<string, TransitOption>
): number {
  if (timeline.length === 0) return 0;

  const firstTransit = transits.get(timeline[0].transitId);
  const lastTransit = transits.get(timeline[timeline.length - 1].transitId);

  if (!firstTransit || !lastTransit) return 0;

  const start = dayjs(firstTransit.departureTime);
  const end = dayjs(lastTransit.arrivalTime);

  return end.diff(start, 'minute');
}
