# Project rules

- Run `npm run check` before committing user-facing changes.
- Keep the application as a static, client-only site; persisted user data stays in localStorage.
- Candidate transit options may overlap. Source-row overlaps must remain readable through vertical lane layout.
- Direct plan-transit time overlaps are allowed as invalid alternatives and must remain visibly flagged. Buffer shortfalls without overlap remain advisory.
- Plan events must never overlap another plan event or a transit in the same plan. Reject moves or edits that would break this invariant and show a user-facing reason.
- `dist/` is generated output and must not be committed.
- GitHub Pages deployment is manual through `.github/workflows/deploy-pages.yml`.
- After every major-version or major-feature commit, explicitly remind the user and ask whether to publish the new version to GitHub Pages. Do not silently dispatch Pages unless the user already requested publishing in the same task.
- Keep repository text, commit messages, GitHub descriptions, release notes, and API JSON bodies in UTF-8. On Windows, send non-ASCII API payloads as explicit UTF-8 bytes and verify the remote text after publishing.
- Before publishing Pages, render the live app and tutorial at desktop and narrow widths; verify Markdown emphasis, CJK font fallback, version text, and the exported HTML layout visually.
- Keep text files UTF-8 without BOM and LF. `.editorconfig` and `.gitattributes` are authoritative for repository formatting.
