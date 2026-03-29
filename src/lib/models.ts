/**
 * 核心数据模型定义
 * 按照项目指导中的约束驱动排程方法论
 */

export type TransitType = 'flight' | 'bus' | 'train' | 'shuttle' | 'custom';

/**
 * 交通班次 - 代表一种交通方式的一个班次
 */
export interface TransitOption {
  id: string;
  type: TransitType;
  name: string;                  // 显示名称 (如: "航班 A1001")
  departureTime: string;         // ISO8601 格式
  arrivalTime: string;           // ISO8601 格式
  duration: number;              // 分钟
  category?: string;             // 分类标签 (可选)
  notes?: string;                // 备注
}

/**
 * 时间轴段 - 时间轴中的一个班次段
 */
export interface TimelineSegment {
  transitId: string;
  order: number;
  validConnection: boolean;      // 与前一班次的连接是否可行
  gaps?: {
    duration: number;            // 间隙时长 (分钟)
    activity?: string;           // 用户注记的活动
  };
}

/**
 * 时间轴 - 由多个班次组成的完整行程链
 */
export interface Timeline {
  id: string;
  name: string;                  // 用户给定的时间轴名称
  segments: TimelineSegment[];
  isValid: boolean;              // 是否通过约束验证
  totalDuration: number;         // 总时长 (分钟)
  createdAt: string;             // 创建时间
  updatedAt: string;             // 更新时间
}

/**
 * 行程事件 - 时间表中的一个事件
 */
export interface ItineraryEvent {
  time: string;                  // ISO8601 格式
  type: 'depart' | 'arrive' | 'transit' | 'gap';
  description: string;
  duration?: number;             // 间隙时长 (分钟)
  transitId?: string;            // 对应的班次 ID
}

/**
 * 最终时间表 - 由时间轴生成的完整行程单
 */
export interface Itinerary {
  id: string;
  timelineId: string;
  events: ItineraryEvent[];      // 按时间排序
  startTime: string;             // 开始时间
  endTime: string;               // 结束时间
  totalDuration: number;         // 总时长 (分钟)
  createdAt: string;
}

/**
 * 约束验证结果
 */
export interface ConstraintValidationResult {
  isValid: boolean;
  reason?: string;               // 失败原因
  requiredBuffer?: number;       // 所需缓冲时间
  actualBuffer?: number;         // 实际缓冲时间
}

/**
 * 计划事项块 - 用户在最终方案间隙中添加的自定义事项
 */
export interface PlanEventBlock {
  id: string;
  timelineId: string;
  startTime: string;   // ISO8601
  endTime: string;     // ISO8601
  label: string;
  notes?: string;
}

/**
 * 应用配置
 */
export interface AppConfig {
  defaultBufferTime: number;     // 默认缓冲时间 (分钟)
  bufferByTransitType: Record<string, number>; // 按班次类型的缓冲时间
  timezone: string;               // 时区
}
