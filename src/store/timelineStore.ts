/**
 * 全局状态管理 - 使用 Zustand
 * 管理班次库、时间轴和配置
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import dayjs from 'dayjs';
import type { TransitOption, Timeline, AppConfig, TimelineSegment, PlanEventBlock } from '../lib/models';
import { validateConnection, calculateTotalDuration } from '../lib/validators';

export interface GanttRow {
  id: string;
  name: string;
}

export type HistoryEntry = {
  transits: [string, TransitOption][];
  timelines: [string, Timeline][];
  planEvents: [string, PlanEventBlock][];
  rows: GanttRow[];
  selectedTimelineId: string | null;
};

interface TimelineStore {
  // 数据
  transits: Map<string, TransitOption>;
  timelines: Map<string, Timeline>;
  planEvents: Map<string, PlanEventBlock>;
  rows: GanttRow[];
  config: AppConfig;
  selectedTimelineId: string | null;
  editingTransitId: string | null;
  formPrefill: TransitOption | null;
  past: HistoryEntry[];
  future: HistoryEntry[];

  // 班次管理
  addTransit: (transit: TransitOption) => void;
  importTransits: (transits: TransitOption[]) => void;
  updateTransit: (id: string, transit: Partial<TransitOption>) => boolean;
  removeTransit: (id: string) => void;
  getTransit: (id: string) => TransitOption | undefined;

  // 行程段行管理
  addRow: (name: string) => string;
  updateRow: (rowId: string, name: string) => void;
  removeRow: (rowId: string) => void;
  getAllRows: () => GanttRow[];

  // 时间轴管理
  createTimeline: (name: string) => string;
  deleteTimeline: (id: string) => void;
  renameTimeline: (id: string, name: string) => void;
  addSegmentToTimeline: (timelineId: string, transitId: string) => boolean;
  removeSegmentFromTimeline: (timelineId: string, order: number) => void;
  reorderSegments: (timelineId: string, fromOrder: number, toOrder: number) => void;
  getTimeline: (id: string) => Timeline | undefined;
  selectTimeline: (id: string | null) => void;
  setEditingTransitId: (id: string | null) => void;
  setFormPrefill: (t: TransitOption | null) => void;

  // 撤销/恢复
  undo: () => void;
  redo: () => void;
  pushHistoryEntry: (entry: HistoryEntry) => void;
  clearAll: () => void;

  // 计划事项块
  addPlanEvent: (ev: PlanEventBlock) => void;
  updatePlanEvent: (id: string, updates: Partial<Omit<PlanEventBlock, 'id' | 'timelineId'>>) => void;
  removePlanEvent: (id: string) => void;
  getPlanEventsByTimeline: (timelineId: string) => PlanEventBlock[];

  // 配置
  updateConfig: (config: Partial<AppConfig>) => void;

  // 工具函数
  getAllTimelines: () => Timeline[];
  getAllTransits: () => TransitOption[];
}

const DEFAULT_CONFIG: AppConfig = {
  defaultBufferTime: 10,
  bufferByTransitType: {
    'flight-to-bus': 30,
    'flight-to-train': 45,
    'flight-to-shuttle': 20,
    'bus-to-train': 20,
    'bus-to-flight': 30,
    'train-to-bus': 15,
    'train-to-flight': 30,
    'shuttle-to-bus': 10,
    'shuttle-to-train': 10,
  },
  timezone: 'Asia/Shanghai',
};

function createSampleState() {
  const date = dayjs().format('YYYY-MM-DD');
  const at = (time: string) => `${date}T${time}:00`;
  const createdAt = new Date().toISOString();
  const demoNote = '演示时间，不是实时时刻表；出发前请按官方信息修改。';
  const makeTransit = (
    id: string, type: TransitOption['type'], name: string,
    departure: string, arrival: string, category: string
  ): TransitOption => ({
    id, type, name,
    departureTime: at(departure),
    arrivalTime: at(arrival),
    duration: dayjs(at(arrival)).diff(dayjs(at(departure)), 'minute'),
    category,
    notes: demoNote,
  });
  const rails = [
    makeTransit('sample-train-1', 'train', 'JR 花咲线 1：钏路 → 根室', '05:35', '08:05', 'sample-row-rail'),
    makeTransit('sample-train-2', 'train', 'JR 快速はなさき：钏路 → 根室', '08:50', '11:20', 'sample-row-rail'),
    makeTransit('sample-train-3', 'train', 'JR 花咲线 3：钏路 → 根室', '11:15', '13:45', 'sample-row-rail'),
    makeTransit('sample-train-4', 'train', 'JR 花咲线 4：钏路 → 根室', '13:25', '15:55', 'sample-row-rail'),
    makeTransit('sample-train-5', 'train', 'JR 花咲线 5：钏路 → 根室', '16:12', '18:42', 'sample-row-rail'),
  ];
  const buses = [
    makeTransit('sample-bus-1', 'bus', '根室交通 1：根室站前 → 纳沙布岬', '08:20', '09:00', 'sample-row-bus'),
    makeTransit('sample-bus-2', 'bus', '根室交通 2：根室站前 → 纳沙布岬', '10:10', '10:50', 'sample-row-bus'),
    makeTransit('sample-bus-3', 'bus', '根室交通 3：根室站前 → 纳沙布岬', '12:00', '12:40', 'sample-row-bus'),
    makeTransit('sample-bus-4', 'bus', '根室交通 4：根室站前 → 纳沙布岬', '14:15', '14:55', 'sample-row-bus'),
    makeTransit('sample-bus-5', 'bus', '根室交通 5：根室站前 → 纳沙布岬', '16:10', '16:50', 'sample-row-bus'),
    makeTransit('sample-bus-6', 'bus', '根室交通 6：根室站前 → 纳沙布岬', '17:50', '18:30', 'sample-row-bus'),
  ];
  const selectedRail = rails[0];
  const selectedBus = buses[0];
  const timeline: Timeline = {
    id: 'sample-plan',
    name: '根室：火车转公交（示例）',
    segments: [
      { transitId: selectedRail.id, order: 0, validConnection: true },
      { transitId: selectedBus.id, order: 1, validConnection: true },
    ],
    isValid: true,
    totalDuration: 205,
    createdAt,
    updatedAt: createdAt,
  };
  const event: PlanEventBlock = {
    id: 'sample-event-break',
    timelineId: timeline.id,
    startTime: at('08:08'),
    endTime: at('08:15'),
    label: '根室站休息',
    notes: '示例事项',
  };
  return {
    transits: new Map([...rails, ...buses].map(transit => [transit.id, transit])),
    timelines: new Map([[timeline.id, timeline]]),
    planEvents: new Map([[event.id, event]]),
    rows: [
      { id: 'sample-row-rail', name: '火车' },
      { id: 'sample-row-bus', name: '公交' },
    ],
    selectedTimelineId: timeline.id,
  };
}

function revalidateTimelineSegments(
  timeline: Timeline,
  transitMap: Map<string, TransitOption>,
  bufferConfig: Record<string, number>
): Timeline {
  if (timeline.segments.length === 0) return timeline;

  const sorted = [...timeline.segments].sort((a, b) => {
    const tA = transitMap.get(a.transitId);
    const tB = transitMap.get(b.transitId);
    if (!tA || !tB) return 0;
    return dayjs(tA.departureTime).diff(dayjs(tB.departureTime));
  });

  const validated: TimelineSegment[] = sorted.map((seg, i) => {
    if (i === 0) return { ...seg, order: 0, validConnection: true };
    const prevT = transitMap.get(sorted[i - 1].transitId);
    const currT = transitMap.get(seg.transitId);
    if (!prevT || !currT) return { ...seg, order: i, validConnection: false };
    const result = validateConnection(prevT, currT, bufferConfig);
    return { ...seg, order: i, validConnection: result.isValid };
  });

  return {
    ...timeline,
    segments: validated,
    isValid: validated.every(s => s.validConnection),
    totalDuration: calculateTotalDuration(validated, transitMap),
    updatedAt: new Date().toISOString(),
  };
}

function transitOverlapsPlanEvent(
  transitId: string,
  candidate: TransitOption,
  timelines: Map<string, Timeline>,
  planEvents: Map<string, PlanEventBlock>
): boolean {
  const start = dayjs(candidate.departureTime).valueOf();
  const end = dayjs(candidate.arrivalTime).valueOf();
  for (const timeline of timelines.values()) {
    if (!timeline.segments.some(segment => segment.transitId === transitId)) continue;
    for (const event of planEvents.values()) {
      if (event.timelineId !== timeline.id) continue;
      const eventStart = dayjs(event.startTime).valueOf();
      const eventEnd = dayjs(event.endTime).valueOf();
      if (start < eventEnd && end > eventStart) return true;
    }
  }
  return false;
}

export const useTimelineStore = create<TimelineStore>()(
  persist(
    (set, get) => {
      const sample = createSampleState();

      /** Save all editable schedule data to the undo stack. */
      const pushHistory = () => {
        const s = get();
        const entry: HistoryEntry = {
          transits: Array.from(s.transits.entries()),
          timelines: Array.from(s.timelines.entries()),
          planEvents: Array.from(s.planEvents.entries()),
          rows: [...s.rows],
          selectedTimelineId: s.selectedTimelineId,
        };
        set(st => ({ past: [...st.past.slice(-49), entry], future: [] }));
      };

      /** Find a transit that differs between two maps (for form prefill) */
      const diffTransit = (
        fromMap: Map<string, TransitOption>,
        toMap: Map<string, TransitOption>
      ): TransitOption | null => {
        // Transit in 'from' but not in 'to' → was removed
        for (const [id, t] of fromMap) {
          if (!toMap.has(id)) return t;
        }
        // Transit in 'to' but not in 'from' → was added (return it so form can pre-fill)
        for (const [id, t] of toMap) {
          if (!fromMap.has(id)) return t;
        }
        return null;
      };

      return {
        transits: sample.transits,
        timelines: sample.timelines,
        planEvents: sample.planEvents,
        rows: sample.rows,
        config: DEFAULT_CONFIG,
        selectedTimelineId: sample.selectedTimelineId,
        editingTransitId: null,
        formPrefill: null,
        past: [],
        future: [],

        // 行程段行管理
        addRow: (name: string) => {
          const id = `row-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          set(state => ({ rows: [...state.rows, { id, name }] }));
          return id;
        },

        updateRow: (rowId: string, name: string) => {
          set(state => ({ rows: state.rows.map(r => r.id === rowId ? { ...r, name } : r) }));
        },

        removeRow: (rowId: string) => {
          set(state => {
            const newTransits = new Map(state.transits);
            for (const [id, t] of state.transits) {
              if (t.category === rowId) newTransits.set(id, { ...t, category: undefined });
            }
            return { rows: state.rows.filter(r => r.id !== rowId), transits: newTransits };
          });
        },

        getAllRows: () => get().rows,

        // 班次管理
        addTransit: (transit: TransitOption) => {
          pushHistory();
          set((state) => {
            const newTransits = new Map(state.transits);
            newTransits.set(transit.id, transit);
            return { transits: newTransits };
          });
        },

        importTransits: (transits: TransitOption[]) => {
          if (transits.length === 0) return;
          pushHistory();
          set((state) => {
            const newTransits = new Map(state.transits);
            for (const transit of transits) newTransits.set(transit.id, transit);
            return { transits: newTransits };
          });
        },

        updateTransit: (id: string, updates: Partial<TransitOption>) => {
          const current = get();
          const transit = current.transits.get(id);
          if (!transit) return false;
          const updatedTransit = { ...transit, ...updates };
          if (
            (updates.departureTime !== undefined || updates.arrivalTime !== undefined) &&
            transitOverlapsPlanEvent(id, updatedTransit, current.timelines, current.planEvents)
          ) return false;

          set((state) => {
            const newTransits = new Map(state.transits);
            newTransits.set(id, updatedTransit);

            const newTimelines = new Map(state.timelines);
            for (const [tid, timeline] of state.timelines) {
              if (!timeline.segments.some(s => s.transitId === id)) continue;
              newTimelines.set(tid, revalidateTimelineSegments(
                timeline, newTransits, state.config.bufferByTransitType
              ));
            }

            return { transits: newTransits, timelines: newTimelines };
          });
          return true;
        },

        removeTransit: (id: string) => {
          pushHistory();
          set((state) => {
            const newTransits = new Map(state.transits);
            newTransits.delete(id);

            const newTimelines = new Map(state.timelines);
            for (const [timelineId, timeline] of newTimelines) {
              if (!timeline.segments.some(seg => seg.transitId === id)) continue;
              const newSegments = timeline.segments
                .filter(seg => seg.transitId !== id)
                .map((seg, order) => ({ ...seg, order }));
              newTimelines.set(
                timelineId,
                revalidateTimelineSegments(
                  { ...timeline, segments: newSegments },
                  newTransits,
                  state.config.bufferByTransitType
                )
              );
            }

            return { transits: newTransits, timelines: newTimelines };
          });
        },

        getTransit: (id: string) => get().transits.get(id),

        // 时间轴管理
        createTimeline: (name: string) => {
          const id = `timeline-${Date.now()}`;
          const timeline: Timeline = {
            id, name, segments: [], isValid: true, totalDuration: 0,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          set((state) => {
            const newTimelines = new Map(state.timelines);
            newTimelines.set(id, timeline);
            return { timelines: newTimelines, selectedTimelineId: id };
          });
          return id;
        },

        deleteTimeline: (id: string) => {
          set((state) => {
            const newTimelines = new Map(state.timelines);
            newTimelines.delete(id);
            const newPlanEvents = new Map(state.planEvents);
            for (const [eventId, event] of newPlanEvents) {
              if (event.timelineId === id) newPlanEvents.delete(eventId);
            }
            const selectedId = state.selectedTimelineId === id ? null : state.selectedTimelineId;
            return { timelines: newTimelines, planEvents: newPlanEvents, selectedTimelineId: selectedId };
          });
        },

        renameTimeline: (id: string, name: string) => {
          set((state) => {
            const tl = state.timelines.get(id);
            if (!tl) return state;
            const newTimelines = new Map(state.timelines);
            newTimelines.set(id, { ...tl, name, updatedAt: new Date().toISOString() });
            return { timelines: newTimelines };
          });
        },

        addSegmentToTimeline: (timelineId: string, transitId: string) => {
          const state = get();
          const timeline = state.getTimeline(timelineId);
          if (!timeline) return false;
          if (timeline.segments.some(seg => seg.transitId === transitId)) return false;
          const selectedTransit = state.transits.get(transitId);
          if (!selectedTransit) return false;
          const selectedStart = dayjs(selectedTransit.departureTime).valueOf();
          const selectedEnd = dayjs(selectedTransit.arrivalTime).valueOf();
          const overlapsEvent = Array.from(state.planEvents.values()).some(event =>
            event.timelineId === timelineId &&
            selectedStart < dayjs(event.endTime).valueOf() &&
            selectedEnd > dayjs(event.startTime).valueOf()
          );
          if (overlapsEvent) return false;

          pushHistory();

          set((st) => {
            const newTimelines = new Map(st.timelines);
            // A timetable row is an N-choose-1 candidate group. Selecting a new
            // departure automatically replaces the previous choice from that row.
            const keptSegments = timeline.segments.filter(segment => {
              const existing = st.transits.get(segment.transitId);
              return !selectedTransit.category || existing?.category !== selectedTransit.category;
            });
            const newSegment: TimelineSegment = {
              transitId, order: keptSegments.length, validConnection: true, gaps: undefined,
            };
            const updated = { ...timeline, segments: [...keptSegments, newSegment] };
            const revalidated = revalidateTimelineSegments(updated, st.transits, st.config.bufferByTransitType);
            newTimelines.set(timelineId, revalidated);
            return { timelines: newTimelines };
          });

          return true;
        },

        removeSegmentFromTimeline: (timelineId: string, order: number) => {
          const timeline = get().getTimeline(timelineId);
          if (!timeline) return;

          pushHistory();
          set((state) => {
            const newTimelines = new Map(state.timelines);
            const filtered = timeline.segments
              .filter((seg) => seg.order !== order)
              .map((seg, idx) => ({ ...seg, order: idx }));
            const updated = { ...timeline, segments: filtered };
            const revalidated = revalidateTimelineSegments(updated, state.transits, state.config.bufferByTransitType);
            newTimelines.set(timelineId, revalidated);
            return { timelines: newTimelines };
          });
        },

        reorderSegments: (timelineId: string, fromOrder: number, toOrder: number) => {
          const timeline = get().getTimeline(timelineId);
          if (!timeline) return;

          const newSegments = [...timeline.segments];
          const [movedSegment] = newSegments.splice(fromOrder, 1);
          newSegments.splice(toOrder, 0, movedSegment);

          set((state) => {
            const newTimelines = new Map(state.timelines);
            const updated = {
              ...timeline,
              segments: newSegments.map((seg, idx) => ({ ...seg, order: idx })),
            };
            const revalidated = revalidateTimelineSegments(updated, state.transits, state.config.bufferByTransitType);
            newTimelines.set(timelineId, revalidated);
            return { timelines: newTimelines };
          });
        },

        getTimeline: (id: string) => get().timelines.get(id),

        selectTimeline: (id: string | null) => {
          set({ selectedTimelineId: id });
        },

        setEditingTransitId: (id: string | null) => {
          set({ editingTransitId: id });
        },

        setFormPrefill: (t: TransitOption | null) => {
          set({ formPrefill: t });
        },

        // 撤销/恢复
        undo: () => {
          const state = get();
          if (state.past.length === 0) return;
          const prev = state.past[state.past.length - 1];
          const current: HistoryEntry = {
            transits: Array.from(state.transits.entries()),
            timelines: Array.from(state.timelines.entries()),
            planEvents: Array.from(state.planEvents.entries()),
            rows: [...state.rows],
            selectedTimelineId: state.selectedTimelineId,
          };
          const prevMap = new Map(prev.transits);
          const prefill = diffTransit(state.transits, prevMap);
          set({
            past: state.past.slice(0, -1),
            future: [current, ...state.future.slice(0, 49)],
            transits: new Map(prev.transits),
            timelines: new Map(prev.timelines),
            planEvents: new Map(prev.planEvents),
            rows: [...prev.rows],
            selectedTimelineId: prev.selectedTimelineId,
            formPrefill: prefill,
          });
        },

        redo: () => {
          const state = get();
          if (state.future.length === 0) return;
          const next = state.future[0];
          const current: HistoryEntry = {
            transits: Array.from(state.transits.entries()),
            timelines: Array.from(state.timelines.entries()),
            planEvents: Array.from(state.planEvents.entries()),
            rows: [...state.rows],
            selectedTimelineId: state.selectedTimelineId,
          };
          const nextMap = new Map(next.transits);
          const prefill = diffTransit(state.transits, nextMap);
          set({
            past: [...state.past.slice(-49), current],
            future: state.future.slice(1),
            transits: new Map(next.transits),
            timelines: new Map(next.timelines),
            planEvents: new Map(next.planEvents),
            rows: [...next.rows],
            selectedTimelineId: next.selectedTimelineId,
            formPrefill: prefill,
          });
        },

        pushHistoryEntry: (entry: HistoryEntry) => {
          set(st => ({ past: [...st.past.slice(-49), entry], future: [] }));
        },

        clearAll: () => {
          const state = get();
          if (state.transits.size === 0 && state.timelines.size === 0 &&
              state.planEvents.size === 0 && state.rows.length === 0) return;
          pushHistory();
          set({
            transits: new Map(),
            timelines: new Map(),
            planEvents: new Map(),
            rows: [],
            selectedTimelineId: null,
            editingTransitId: null,
            formPrefill: null,
          });
        },

        // 配置
        updateConfig: (config: Partial<AppConfig>) => {
          set((state) => ({ config: { ...state.config, ...config } }));
        },

        // 计划事项块
        addPlanEvent: (ev: PlanEventBlock) => {
          set(state => { const m = new Map(state.planEvents); m.set(ev.id, ev); return { planEvents: m } });
        },
        updatePlanEvent: (id: string, updates) => {
          set(state => {
            const ev = state.planEvents.get(id); if (!ev) return state;
            const m = new Map(state.planEvents); m.set(id, { ...ev, ...updates }); return { planEvents: m };
          });
        },
        removePlanEvent: (id: string) => {
          set(state => { const m = new Map(state.planEvents); m.delete(id); return { planEvents: m } });
        },
        getPlanEventsByTimeline: (timelineId: string) =>
          Array.from(get().planEvents.values())
            .filter(ev => ev.timelineId === timelineId)
            .sort((a, b) => dayjs(a.startTime).diff(dayjs(b.startTime))),

        // 工具函数
        getAllTimelines: () => Array.from(get().timelines.values()),
        getAllTransits: () => Array.from(get().transits.values()),
      };
    },
    {
      name: 'itinerary-scheduler-v1',
      partialize: (state) => ({
        transits: Array.from(state.transits.entries()),
        timelines: Array.from(state.timelines.entries()),
        planEvents: Array.from(state.planEvents.entries()),
        rows: state.rows,
        config: state.config,
      }),
      merge: (persisted, current) => {
        const p = persisted as {
          transits: [string, TransitOption][];
          timelines: [string, Timeline][];
          planEvents?: [string, PlanEventBlock][];
          rows: typeof current.rows;
          config: AppConfig;
        };
        const persistedTransits = p.transits ?? [];
        const legacyIds = new Set(persistedTransits.map(([id]) => id));
        const isUntouchedLegacySample = persistedTransits.length === 2 &&
          legacyIds.has('sample-transit-rail') && legacyIds.has('sample-transit-bus') &&
          (p.timelines ?? []).length === 1 && p.timelines?.[0]?.[0] === 'sample-plan';
        if (isUntouchedLegacySample) {
          return { ...current, config: p.config ?? current.config };
        }
        const transitMap = new Map<string, TransitOption>(persistedTransits);
        const config = p.config ?? current.config;
        // Re-validate all timelines on load to clear any stale isValid state
        const timelinesMap = new Map<string, Timeline>(
          (p.timelines ?? []).map(([id, tl]: [string, Timeline]) => [
            id,
            revalidateTimelineSegments(tl, transitMap, config.bufferByTransitType ?? {}),
          ])
        );
        return {
          ...current,
          transits: transitMap,
          timelines: timelinesMap,
          planEvents: new Map<string, PlanEventBlock>(p.planEvents ?? []),
          rows: p.rows ?? [],
          config,
        };
      },
    }
  )
);
