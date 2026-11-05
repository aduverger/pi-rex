# Three-state tool output and long-session rendering

Status: implemented on `improve_renderer` (based on main); native iOS acceptance remains outstanding.

## Required behavior

- Keep today's mobile summary: neutral rounded border and scrollbar gutter, one summary content row, pending/tick/cross, tool name and path/command, first error line when present. No green/red background fill in this state. Pi's existing leading separator remains.
- Add native preview between summary and full. Preview sizes and formatting belong to each original renderer (bash uses five visual output rows); do not impose a universal five-line rule.
- Full output retains original renderers, highlighting, details and interactive controls.
- Desktop ownership retains normal Pi formatting. Keep authenticated Rex owner detection, prior desktop expansion preference, stored results and native tool lifecycle behavior unchanged.
- Fix measured repeated work on unchanged historical tools. Do not skip native call/result lifecycle updates to save time: they stop streaming timers and preserve custom state.
- No separate viewer, dependencies, keyboard/fullscreen settings, PTY changes, live reload, publication or unrelated `.pi/` changes.

## Interaction assumptions

- Unhandled left clicks cycle **summary → preview → full → summary**. Existing custom controls consume their own clicks; tapping the frame border advances the tool instead.
- Pi remains owner of the expanded boolean (full output). The extension owns only the additional local preview choice while Pi is collapsed. Pi's native full-expansion click requires a result; this is not bypassed while a tool has not produced output.
- Pi's global expansion shortcut selects full or summary and resets local preview choices when its global preference changes. Read that preference through the public UI getter, not keybinding guesses or private host fields.
- Local choices survive streaming updates, resize and ordinary invalidation. Ownership handoff preserves choices unless Pi's global expansion restoration resets them. Choices are not persisted across reloads.
- Some tools' native previews already omit successful output (read) or show their diff (edit). The extra state retains those native rules, even when preview/full look similar.

## Work sequence

- [x] Trace public renderer/mouse/invalidation/global-expansion contracts and current fallback/lifecycle tests.
- [x] Add per-tool preview selection without duplicating native tool content or introducing another full-expansion authority.
- [x] Cache summary construction/clipping and border formatting by width/content. Still render delegated children to detect independent interactive updates; a blind whole-component cache would make those controls stale.
- [x] Extend native comparisons to preview/full, three-click cycling, global expansion, updates and ownership handoff. Retain ANSI isolation, images/fallbacks, HTML-result and timer-cleanup checks.
- [x] Repair fallback redraw re-entry exposed by actual Pi 1.5 validation. Suppress only nested redraw notifications during controlled inner-component synchronization, not independent asynchronous updates.
- [x] Add deterministic repeated-frame work protection and a reproducible, non-gating long-session benchmark. Compare against native Pi rather than asserting machine-dependent timing thresholds.
- [x] Run Node 22/24 checks, forced-color checks, source package verification and actual Pi 1.5 probes. Record measured scope and remaining device gaps.
- [x] Update README, record decisions below, review scope and commit the task locally.

## Evidence before implementation

Isolated macOS render-only replay, Pi 1.5.0, 5,000 completed bash calls, 40×24 viewport, warm median: native preview 3.58 ms; existing compact output 135.92 ms; same compact output without outer border formatting 56.91 ms; test-only cached whole frame 0.99 ms. Whole-frame memoization was diagnostic only: native/custom child interactions still need to be observed in production. The user's active extension state was not established by these probes.

## Implementation decision ledger — least confident first

1. **Tap behavior.** Choose the announced three-click cycle, keep native custom controls interactive, and use the existing frame edge as an unhandled expansion target. Add no new buttons or labels. If asking were free, I would ask whether preview should instead be the tap endpoint with full output available only through a separate action. Device acceptance remains open.
2. **Global versus local choices.** Keep only a per-tool preview flag and a snapshot of Pi's global preference. The public `getToolsExpanded()` callback is needed because a row in preview already has `context.expanded === false`; that flag alone cannot distinguish ordinary invalidation from a global collapse. Pi still owns full expansion. If asking were free, I would confirm that global controls should reset local previews, matching Pi's existing global-reset behavior.
3. **Bounded caches.** Retain only the current width's clipped summary and the frame produced from the current child lines. Resize recomputes them; updates/theme invalidation clear them. No multi-width cache, persistent metadata, timing worker or full transcript cache. If asking were free, I would ask for a device latency budget before attempting more optimization.
4. **Observe children before reusing decoration.** Existing interactive tests prove that controls mutate their own text without calling the outer invalidator. Therefore compare freshly returned child lines before reusing the border, rather than blindly returning a cached component frame. This preserves behavior instead of requiring new invalidation conventions from other extensions.
5. **Native synchronization guard.** Pi 1.5's public `updateArgs()` requests a redraw. Feeding that request directly back into the outer row during fallback synchronization recurses. Guard that synchronous update boundary, forward independent redraws normally, and clear the guard in `finally`. No runtime-version switch, private host mutation, deferred retry or disabled rendering callback. If asking were free, I would confirm the supported Pi range; both the pinned 1.4 and installed 1.5 are now exercised.
6. **Keep hidden lifecycle work.** Continue delegating call/result updates in summary mode, reusing original components/state. Rendering less text must not stop native timer cleanup or discard custom interactive state. The performance repair targets repeated frame formatting, not speculative lazy execution of renderer callbacks.
7. **Performance evidence.** Use a deterministic formatting-work regression plus a separate timing script, not a wall-clock CI threshold. Actual 1.5 probes use temporary source/test copies and the installed SDK, not a changed version label or production host modification. If asking were free, I would ask for representative device/session traces before attributing all observed latency to this extension.

## Validation outcomes

- `PI_TRUE_COLOR=0 make check`: strict TypeScript, **34 tests**, exact six-file source package verification.
- Same 34 tests on actual Node **22.19.0** and **24.15.0**, with pinned Pi **1.4.0**. No dependency changes.
- Same 34 tests against installed Pi **1.5.0** in an isolated temporary project, including actual fallback/mouse/layout behavior and Rex CLI fixtures.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/render.test.ts`: **26 renderer tests** pass.
- `PI_TRUE_COLOR=0 npm run pack:check`: prepack tests and exact artifact verification pass. Runtime remains the same three TypeScript source files; docs/tests/benchmark are not bundled.
- Eight native tool success/error cases now compare both preview and full styled cells against Pi; no weakening of highlighting/background checks. Generic fallback previews also compare to native output.
- **120 exact ANSI summary comparisons against main** pass: four built-in tools × pending/success/error × dark/light × five widths, including tiny widths. Summary appearance is unchanged.
- Existing independent custom-control edits remain visible with the cache; original mouse coordinates/focus, theme refresh, wrapping, scrollbar gutter, sanitization, image placeholders, HTML result retention, streaming timer completion and stored-result integrity remain covered.
- New regressions protect native five-row bash previews through updates/resize/handoff, the global-collapse case where the local expanded flag is already false, formatting reuse across historical frames, and synchronous fallback redraw recursion. Both formatting-work and fallback-redraw regressions fail against the pre-change renderer.
- Actual Pi 1.5 initially failed six legacy fallback/geometry cases because of recursive invalidation. After the guard, the complete suite passes; the pinned 1.4 regression explicitly simulates a public redraw notification so this protection is not dependent on the separate 1.5 probe.
- `git diff --check` and Markdown link targets checked. No live session, Rex settings, global extension settings or publication changes.

### Recorded benchmark

Run `PI_TRUE_COLOR=0 node scripts/benchmark-renderer.mjs`. Completed bash outputs contain 100 representative lines, 40×24 viewport, 20 repeated frames. This is host rendering only, not Rex transport, native iOS input, terminal output or phone performance. The same script ran against both SDK versions.

Installed Pi 1.5, local macOS run:

| Tools | Presentation | First frame | Warm median | Warm p95 |
| --- | --- | ---: | ---: | ---: |
| 1,000 | Native preview | 1,137.38 ms | 0.76 ms | 4.73 ms |
| 1,000 | Summary | 47.26 ms | 0.50 ms | 15.37 ms |
| 1,000 | Framed preview | 1,170.07 ms | 0.85 ms | 5.70 ms |
| 5,000 | Native preview | 5,472.09 ms | 3.38 ms | 8.75 ms |
| 5,000 | Summary | 163.23 ms | **1.93 ms** | 23.47 ms |
| 5,000 | Framed preview | 5,866.06 ms | 5.76 ms | 13.70 ms |

The summary warm median was 135.92 ms before the change in the earlier same-shape replay. Allocation/GC outliers still occur, and cold native previews remain expensive. The change does not establish a universal frame-time guarantee or eliminate Pi's full-history layout traversal.

## Remaining acceptance/platform gates

- [ ] Native Rex iOS three-state tapping, custom controls and visual acceptance after a user-directed reload.
- [ ] Real long-session phone scrolling/typing/keyboard-resize latency, including cold frames and GC outliers.
- [ ] Linux validation. Local probes are macOS, not cross-platform certification.

Pi's mandatory leading blank row and the historical iOS HTML custom-call-arguments limitation are unchanged. Preserve existing work and reload only when ready; no automatic reload or restart was performed.
