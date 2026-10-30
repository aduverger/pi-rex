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

- Standard validation: `npm run check` (strict TypeScript plus 28 Node tests), `git diff --check`, and `npm pack --dry-run`.
- Renderer tests use actual Pi tool components for successful/failed read/write/edit/bash, native detail delegation, folding, ANSI styling, Unicode widths, resize/tiny-width fallback, themes, custom child mouse coordinates/focus, and desktop handoff. A custom self-rendering tool checks the codemode-style delegation path; codemode has not been exercised against a model.
- The scrollbar regression uses Pi's actual ScrollView/layout renderer to verify that visible scrollbar cells do not overwrite the frame and that visibility changes do not reflow it.
- CLI fixtures cover ownership changes without resize, unrelated blocks, query failure/recovery, stream exit, missing CLI, malformed JSON, non-TUI startup, and idempotent shutdown.
- Earlier implementation checks included live read-only Rex detection/watcher cleanup, real ownership-event JSON from a disposable session (removed afterward), Pi's extension loader, and rendering an actual README read result folded/expanded.
- The user approved the frame's appearance on Rex iOS. Final gutter appearance and frame interactions after `/reload`, including desktop handoff, still require device validation. Do not claim the keyboard issue is fixed.
- The production-only dependency audit previously reported zero vulnerabilities. Pi 1.4.0's development tree has known `undici` advisories; a dependency update was denied and was not retried. Dependency changes are not part of this simplification.

## Review dispositions

- **R1, fixed:** generic fallback rendering delegates to Pi's public ToolExecutionComponent rather than passing raw result text into Text. Native comparisons cover sanitization, image placeholders, argument formatting, collapsed previews, and expanded/mobile and desktop views, including partially supplied renderers.
- **R2, fixed:** native call/result renderers receive updates while folded; only their display is suppressed. A native streaming-shell regression verifies that completion after an iOS handoff stops periodic redraws without reopening the tool. Pi still owns its timer rules.
- **R3, deferred:** HTML call rendering under iOS ownership can show only the folded pending summary and omit custom-tool arguments from the visible header. Pi 1.4.0 exposes no renderer output target or export lifecycle hook. Arguments remain in embedded session data/JSONL; export after desktop handoff or use JSONL until an upstream integration point allows a reliable distinction. No width/callback heuristics or host patches are introduced. Native export-style parity is not established. The mode, image, padding, and expansion assumptions above remain implementation choices, not user mandates.
- The HTML and scrollbar tests import pinned Pi integration modules because the regressions occur at those boundaries. Those module paths are not public compatibility promises; assertions target retained export content and unchanged visible frame cells.

## Simplification decision ledger

Least-confident first:

1. Retain the owner watcher, delegated-renderer caches, redraw registry, and frame component: they address real ownership handoff, native renderer reuse, and border/mouse geometry requirements. Removing them would change behavior rather than simplify equivalent mechanics.
2. Consolidate icon, foreground, and shell-background selection into one presentation rule, preserving partial-before-error precedence and all existing theme tokens.
3. Inline the one-use summary component instead of retaining a callback-only class. Its text must still be evaluated when drawn because Pi invokes the result renderer after the call renderer, supplying the cached error text later.
4. Replace the iterative plan history with this current intent, explicit non-goals, retained choices, validation limits, and review concerns. No product behavior, public API, or dependency change is intended; pi-ship owns commits.

## Test contracts and counterfactuals

The suite has 28 tests. Each row names wrong observable behavior it should reject and an equivalent implementation change it should tolerate. The native-tool matrix is eight tests; all other rows are individual tests.

| Test | Plausible regression detected | Behavior-preserving refactor tolerated |
| --- | --- | --- |
| Read success | A folded read leaks file contents, or expansion loses native highlighting. | Replace the frame implementation while retaining its visible content and styles. |
| Read error | A failed read looks successful or loses its native expanded error output. | Move status selection into a different helper. |
| Write success | Write content becomes visible while folded, or its native expanded view changes. | Change how delegated call/result components are stored. |
| Write error | A failed write lacks its cross or expanded error details. | Reorganize the renderer's shell composition. |
| Edit success | The self-rendered diff loses native colors or padding when expanded. | Replace the surrounding frame component. |
| Edit error | A folded edit failure appears successful or expanded failure output is lost. | Consolidate status-theme selection. |
| Bash success | A successful bash row exposes output while folded or desktop output differs from Pi. | Inline or extract presentation helpers. |
| Bash error | Failed bash output disappears on expansion or remains wrong after desktop handoff. | Change mobile-mode state storage. |
| Neutral compact frames | Standard folded tools gain colored padding or extra empty rows, or retain frames on desktop. | Build the same frame without Box/Container. |
| Auto scrollbar | Showing the scrollbar overwrites a corner or shifts tool text. | Change frame internals while preserving terminal cells. |
| Theme changes | Existing frames retain dark-theme colors after a switch to light. | Change theme lookup or invalidation mechanics. |
| Child mouse/focus | A framed custom control receives the wrong click position or loses its focus request. | Rewrite coordinate translation while delivering the same local event. |
| Streaming and errors | Partial output unfolds the row, or a completed error omits its first message. | Reorganize summary construction and error caching. |
| Status styling | Pending expansion lacks its native background, or completed folded text is status-colored beyond its icon. | Share or inline icon/background selection. |
| Unicode and resizing | Narrow terminals overflow or throw; embedded control sequences corrupt the summary. | Change clipping helpers or the exact tiny-width frame cutoff. |
| Custom interactive details | Folding or owner handoff resets a custom control, mixes call/result state, or drops result details. | Replace wrapper caches while preserving delegated interactive behavior. |
| HTML results | Independently resolved renderers silently omit expanded exported output. | Change resolver/component caching. |
| Unknown tools | Tools without renderers cannot reveal their arguments and results on mobile. | Replace fallback components while retaining expandable output. |
| Native generic fallbacks | Untrusted output emits terminal controls, image placeholders disappear, or desktop fallback formatting/previews change. | Reorganize the fallback adapter while retaining native Pi output. |
| Streaming completion | A completed tool continues requesting periodic redraws after an iOS handoff hides its details. | Change component storage or folding mechanics while preserving native lifecycle updates. |
| Rex detection | Narrow non-Rex terminals activate the feature, or a supplied Rex binary directory is ignored. | Reorganize environment parsing. |
| Owner platform | A connected but non-owning iOS client, CLI client, unknown platform, or missing owner enables mobile mode. | Change how ownership queries are composed. |
| Ownership events | An unrelated block enables mobile mode, valid handoffs are missed, or stopping leaves mobile mode active. | Rework event dispatch while retaining the callback contract. |
| Query failure/recovery | A failed query leaves mobile mode active or prevents a later valid handoff. | Replace error-handling helpers. |
| Stale ownership response | An old iOS response re-enables mobile presentation after a newer desktop handoff. | Replace the revision counter with another stale-response guard. |
| Stream exit | A dead event stream leaves mobile presentation active. | Reorganize process cleanup. |
| Extension lifecycle | Non-TUI modes start a watcher, or desktop handoff/shutdown loses the previous expansion preference. | Reorganize lifecycle handlers and watcher storage. |
| CLI/JSON failures | Missing executables enable mobile mode or malformed ownership JSON is accepted. | Change command-execution plumbing. |

### Test changes and evidence

- Added one stale-response regression using a held CLI response. Removing the stale-response guard made it fail with an erroneous return to mobile mode.
- Rewrote the custom-state test around two clickable controls and visible counts rather than component identity/type checks. Removing delegated component reuse made it fail when both counts reset after folding.
- Consolidated the separate resize test into the Unicode/control-sequence test; retained tiny-width and repeated-resize protection without pinning the exact unframed cutoff.
- Removed duplicate completed-background/desktop comparisons from the status test; the eight native-tool cases retain those checks. The status test retains its distinct pending-background and icon-only-color risks.
- Extended lifecycle coverage to all three non-TUI modes and a real fixture-driven desktop handoff before shutdown.
- Fixture state updates are atomic, held responses are explicitly released, and the fixture no longer pins the incidental two-second connection-timeout value. The no-autostart safeguard remains enforced.
- Generic-fallback parity and folded streaming completion are now covered by the two approved repairs below. Device interactions, final gutter appearance, real codemode integration, and native HTML styling parity remain unverified.

### Test decision ledger

Least-confident first:

1. Retain the pinned HTML/layout integration seams: substituting a mock would miss independent resolver state and actual scrollbar overlay behavior. A Pi dependency upgrade may require changing those imports without changing these contracts.
2. Keep native-tool output comparisons because preserving native detail formatting is an agreed requirement, not a snapshot of this extension's private implementation.
3. Consolidate only duplicated protections; keep pending styling, theme changes, child focus/coordinates, export content, and lifecycle failures separate because each detects a distinct user-visible regression.

## Approved repair decision ledger

Least-confident first:

1. Use a small adapter around Pi's public ToolExecutionComponent for absent renderer slots: Pi's fallback helpers are not exported. This avoids copying sanitization, preview, and formatting rules or importing private runtime modules. Suppress slots already supplied by custom renderers, and keep their original context and result payloads intact.
2. Leave inline image drawing to the outer Pi component. Remove image blocks only from the fallback component's private input when the host will draw them; otherwise pass them through for native placeholders. Stored results and delegated custom results remain unchanged.
3. Remove only the nested component's leading separator. Its full shell is retained for undefined-tool desktop parity; missing slots of defined tools use an unpadded native shell inside the existing wrapper.
4. Call native renderers even while folded and suppress only attachment of their output. Preserve delegated state and let Pi perform final timer cleanup; no new timer or cleanup policy is added.
5. Give the existing native-tool comparison fixture a recorded duration so comparisons remain deterministic now that hidden shell renderers also start their native clocks. The new timer regression uses Node's mock clock and observes redraws, not private interval fields.
