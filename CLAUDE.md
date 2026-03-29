# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start dev server at localhost:3000
npm run build         # Type-check + full production build
npm run build:single  # Build single self-contained HTML (no type-check, faster)
npm run type-check    # TypeScript validation only
npm run lint          # ESLint (strict, 0 warnings allowed)
npm run preview       # Preview production build
```

## Build and preview

The auto-build hook is disabled. After ALL edits in a session are complete, run:
```
./node_modules/.bin/vite build --logLevel error && powershell.exe -Command "Invoke-Item dist\index.html"
```
Do NOT build or open the browser after each individual file edit — only once at the end.

## Architecture

**约束驱动的行程规划工具** — A drag-and-drop itinerary planner where users input transit options, drag them into a timeline, and get a validated schedule with auto-calculated gaps.

### Core Workflow
1. User adds transit options (flights, trains, buses) to a **Transit Library** (left panel)
2. Transits appear as **Gantt chart blocks** (center panel), grouped by `category` field (or type if not set), positioned horizontally by time
3. User **clicks blocks** to add/remove them from the active plan (RESERVED = in plan)
4. Constraint validation runs in real-time; the right panel auto-generates the itinerary

### State persistence
All data (transits, timelines, config) is persisted to **localStorage** via Zustand `persist` middleware (`key: 'itinerary-scheduler-v1'`). Maps are serialised as entry arrays and rehydrated in the `merge` function.

### Key Layers

**Business Logic** (`src/lib/`)
- `models.ts` — TypeScript interfaces: `TransitOption`, `Timeline`, `TimelineSegment`, `Itinerary`, `ConstraintValidationResult`, `AppConfig`
- `validators.ts` — `validateConnection()`, `validateTimeline()`, `getRequiredBuffer()` (buffer times are configurable per transit-type pair, never hardcoded)
- `scheduler.ts` — `generateItinerary()` converts a validated Timeline into the final Itinerary (sorts segments by departure time); also `exportAsCSV()`

**State** (`src/store/timelineStore.ts`)
- Single Zustand store with `persist` middleware → **localStorage** (`key: 'itinerary-scheduler-v1'`)
- Maps serialised as entry arrays; rehydrated via custom `merge` function
- Validation runs automatically on `addSegmentToTimeline`
- `updateConfig()` allows overriding buffer times per transit pair

**UI** (`src/components/`)
- 3-column layout: Transit Library (left) | Gantt Chart / Timeline Editor (center) | Itinerary Preview (right)
- `TransitLibrary.tsx` — form to add transits (with `category` field); card list with type filter
- `TimelineEditor.tsx` — Gantt chart: transits grouped by `category` (or type), positioned on a time axis. Left-click+drag to move block, drag left/right edge to resize. Right-click → context menu to add/remove from any plan. Plan lanes shown at the bottom, always visible. Source blocks show colored plan-membership badges.
- `ItineraryPreview.tsx` — auto-generated itinerary sorted by departure time; CSV export
- No drag-and-drop (removed); primary interaction is click-to-add in the Gantt chart

### Constraint Logic
```
feasible = (previousArrival + bufferTime) <= nextDeparture
```
Default buffers (in `timelineStore.ts`): flight→train: 45 min, flight→bus: 30 min, bus→train: 20 min, etc.

### Conventions
- Time handling: always use `dayjs` (never native Date arithmetic)
- Naming: PascalCase components/types, camelCase functions, UPPER_SNAKE_CASE constants
- State updates: immutable patterns (Zustand)
- Timezone: default `Asia/Shanghai`, configurable via `AppConfig`
- Keyboard accessibility required for all drag operations
- Undo/redo support expected in timeline operations
