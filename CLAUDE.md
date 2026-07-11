# CLAUDE.md

Repository guidance for Claude Code.

## Commands

```bash
npm run dev
npm run type-check
npm run build
npm run check
npm run preview
```

## Architecture

- `src/components/TransitLibrary.tsx`: transit creation and editing.
- `src/components/TimelineEditor.tsx`: Gantt rendering, drag/resize preview, plan membership, overlap lanes.
- `src/components/ItineraryPreview.tsx`: generated itinerary and editable plan events.
- `src/store/timelineStore.ts`: Zustand state, persistence, undo/redo, collision invariants.
- `src/lib/validators.ts`: connection-buffer validation.
- `src/lib/scheduler.ts`: itinerary generation and CSV export.

All persisted data stays in localStorage under `itinerary-scheduler-v1`. Maps are serialized as entry arrays.

## Interaction invariants

- Candidate transits may overlap and are stacked into visual lanes.
- Direct plan-transit overlaps remain allowed but invalid and visibly flagged. Non-overlapping buffer shortfalls are advisory.
- Plan events may not overlap a transit or another event in the same plan.
- Dragging writes only a local preview; commit to the store once on pointer release.

## Release rule

Follow `AGENTS.md`. After a major-version or major-feature commit, remind the user and ask whether to publish GitHub Pages. Pages deployment is manual.
