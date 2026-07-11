# Copilot instructions

- Follow the repository-wide rules in `AGENTS.md`.
- The app is a client-only React and TypeScript site. Do not introduce a backend or upload local itinerary data.
- Use `dayjs` for time calculations and immutable Zustand state updates.
- Keep candidate transit overlap, plan validation, and plan-event collision semantics consistent with `README.md`.
- Maintain keyboard-accessible equivalents for pointer drag operations.
- Run `npm run check` before suggesting a commit.
- GitHub Pages is a manual workflow. After a major-version or major-feature commit, remind the user and ask whether to publish Pages.
- Keep version growth conservative: compatible fixes, UI/performance tweaks, documentation, sample data, and small features use a patch bump. Reserve minor versions for explicit milestones or substantial capability sets, and major versions for incompatible changes. Only bump when preparing a release.
