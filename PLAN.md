# P0: compact tool output in Rex iOS

## Workspace intent: user requirements

Make Pi's existing terminal output easier to read on Rex mobile, taking visual inspiration from Bergère and the supplied screenshots—not building a separate chat application.

- Detect Rex using its session/block context. Mobile mode follows the **terminal block owner**, not where the session started, any attached phone, or terminal dimensions.
- When an iOS app owns the block, start tools folded to one content line with a name, path/command when available, and running/success/error indication. Keep failures identifiable while folded.
- Use colored status icons without a folded background. Expanded tools must retain their native backgrounds, output/diff formatting, and existing detail renderers, like edit. This applies across tools, with a generic fallback where no renderer exists.
- Add neutral frames around folded and expanded tools to distinguish them from prose. Reserve a stable one-column right gutter so Pi's auto-hiding scrollbar cannot overwrite the border.
- Keep individual expansion/collapse and Pi's keyboard expansion controls. Fullscreen mode is an accepted prerequisite for tapping; do not change that setting automatically.
- Preserve desktop rendering and leave reasoning, assistant Markdown/code fences, editor, footer, tool execution, and saved messages unchanged.
- Keep the implementation simple and scoped to presentation.

## Explicit non-goals and rejected approaches

- No separate frontend/server, terminal-output scraping, transcript rewriting, tool re-registration, custom tool-detail views, or nested-call reconstruction. Pi supplies structured tool data; Rex supplies terminal identity and ownership.
- Tool grouping was discussed and explicitly deferred in favor of frames first. More than five consecutive calls is a possible future rule inspired by Bergère, not a requirement for this branch.
- Do not remove native backgrounds when expanded. An earlier blanket mobile-background removal was rejected and corrected.
- Do not reintroduce the keyboard-dismissal experiment. The user tested remote `client.keyboard.hide`, but automatic hide-after-tap caused double taps, keyboard flicker, and screen movement. That commit was reset. Rex's native keyboard-on-tap behavior remains unresolved; no Remote Control setting changes or keyboard actions belong in this feature.
- Do not hide or retime Pi's scrollbar, redesign other UI, or introduce polling/reconnect workers, retry loops, or speculative configuration.

## Existing implementation path

- `src/rex.ts`: resolve Rex context, query the block owner/client platform, and subscribe to ownership changes through the CLI.
- `src/index.ts`: own watcher lifetime, switch mobile presentation on ownership changes, and invalidate existing tool components.
- `src/render.ts`: wrap Pi's renderer resolver, preserve delegated component state, and frame mobile tool content while leaving execution/results intact.
- Pi creates a component per tool and owns its expansion state. The wrapper uses Pi's self-rendering shell support plus Box/Container, not private TUI mutation. HTML export resolves call/result renderers separately, so standalone result rendering must remain usable.

## Operating choices introduced by the implementation

These are retained design decisions, not additional user requirements:

- Require client `kind: app` and `platform: ios`; unknown ownership/platform or failed queries use ordinary rendering. Prefer `REX_BIN_DIR` when supplied.
- Never auto-start a Rex server. CLI reads use a two-second connection timeout, 2.5-second process timeout, and 1 MiB output limit. Abort pending reads and stop the event process on shutdown.
- Use one event-stream process only in TUI mode. Take an initial snapshot and refresh after the first stream event to close the startup subscription gap. Discard stale asynchronous query results.
- If the stream ends, restore normal presentation and require `/reload`; a failed query can recover on a later owner event. No automatic reconnection is implemented.
- Entering mobile mode saves the global tool-expansion preference and collapses it; leaving restores that preference. Individual row choices otherwise follow Pi's behavior. No independent expansion store or persisted derived state is added.
- Expanded custom self-rendered tools retain their padding, even if framing adds two rows. Standard shells replace their blank vertical padding with border rows. Folded tools share a three-row frame plus Pi's existing separator.
- Borders use rounded box-drawing characters and Pi's `dim` theme token. The gutter is always reserved to avoid reflow. Below six terminal columns, use clipped content without a frame; at one column there is no room beyond the gutter.
- Inline images remain under Pi's image-display setting and outside the text frame. The wrapper does not change global image settings.
- The package uses host-provided Pi peer dependencies and Node's built-in test runner, with Pi 1.4.0 pinned for development. No runtime dependency bundle or extra test framework is added.

## Validation and release prerequisites

- Standard validation: `npm run check` (strict TypeScript plus 26 Node tests), `git diff --check`, and `npm pack --dry-run`.
- Renderer tests use actual Pi tool components for successful/failed read/write/edit/bash, native detail delegation, folding, ANSI styling, Unicode widths, resize/tiny-width fallback, themes, custom child mouse coordinates/focus, and desktop handoff. A custom self-rendering tool checks the codemode-style delegation path; codemode has not been exercised against a model.
- The scrollbar regression uses Pi's actual ScrollView/layout renderer to verify that visible scrollbar cells do not overwrite the frame and that visibility changes do not reflow it.
- CLI fixtures cover ownership changes without resize, unrelated blocks, query failure/recovery, stream exit, missing CLI, malformed JSON, non-TUI startup, and idempotent shutdown.
- Earlier implementation checks included live read-only Rex detection/watcher cleanup, real ownership-event JSON from a disposable session (removed afterward), Pi's extension loader, and rendering an actual README read result folded/expanded.
- The user approved the frame's appearance on Rex iOS. Final gutter appearance and frame interactions after `/reload`, including desktop handoff, still require device validation. Do not claim the keyboard issue is fixed.
- The production-only dependency audit previously reported zero vulnerabilities. Pi 1.4.0's development tree has known `undici` advisories; a dependency update was denied and was not retried. Dependency changes are not part of this simplification.

## Review disposition needed

- **Desktop fallback parity:** inside Rex, tools without native renderers are still wrapped on desktop. A read-only comparison with Pi's native unknown-tool component confirmed different fallback formatting (including header spacing). This conflicts with the unchanged-desktop goal. Preserve it for review disposition rather than silently changing existing branch behavior during simplification.
- The resolver also participates in HTML export inside Rex; preserving result content is tested, but native export-style parity is not established. The mode, image, padding, and expansion assumptions above should not be mistaken for user-mandated implementation mechanisms.
- Tests importing pinned Pi internals or asserting private layout structure are left for the Test phase; those assertions do not define a public compatibility contract.

## Simplification decision ledger

Least-confident first:

1. Retain the owner watcher, delegated-renderer caches, redraw registry, and frame component: they address real ownership handoff, native renderer reuse, and border/mouse geometry requirements. Removing them would change behavior rather than simplify equivalent mechanics.
2. Consolidate icon, foreground, and shell-background selection into one presentation rule, preserving partial-before-error precedence and all existing theme tokens.
3. Inline the one-use summary component instead of retaining a callback-only class. Its text must still be evaluated when drawn because Pi invokes the result renderer after the call renderer, supplying the cached error text later.
4. Replace the iterative plan history with this current intent, explicit non-goals, retained choices, validation limits, and review concerns. No product behavior, public API, dependency, or test-curation change is intended. Do not commit during the pi-ship simplification phase.
