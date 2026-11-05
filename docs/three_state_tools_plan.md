# Three-state tool output and long-session rendering

> Accepted presentation: summary, native preview and full output are borderless. Preserve native backgrounds/highlighting in preview/full, controls, spacer rows, text inset and scrollbar gutter. The user accepted keeping this design after the local field trial; no tighter layout was requested.

Status: implemented; the borderless follow-up is accepted, not a temporary display mode or setting. Earlier implementation/review evidence below is explicitly historical where it describes borders. Broad device validation and measured phone latency remain open.

## Workspace intent for review

- **User goal and requirements:** make long Pi sessions responsive in the existing Rex iOS terminal, adding native preview between the compact summary and full output. Preserve the first state's tick/cross, neutral summary and no green/red fill, along with native details, interactive controls, desktop behavior and execution/session authority. The later accepted design removes decorative borders in all three states without changing spacing.
- **Accepted operating assumptions:** the announced tap cycle is summary → preview → full → summary; custom controls keep their own clicks. Pi owns full expansion and its global shortcut; local previews reset when that global preference changes. Preview size remains tool-specific, not universally five rows. Mobile presentation follows the actual iOS block owner, not terminal dimensions or a merely connected phone; tapping requires user-enabled fullscreen mode.
- **Agent-chosen mechanisms, not extra product requirements:** bounded summary/frame caches, a local preview flag plus Pi's global preference snapshot, and a synchronous native-fallback redraw guard. Preserve lifecycle/timer cleanup and independent child updates; the particular cache representation or formatting-call counts are not public contracts.
- **Non-goals and rejected approaches:** the separate viewer is set aside. No OpenTUI/Bun frontend, new dependencies, tool re-registration, reconstructed details/grouping, persistent expansion preferences, blanket removal of native expanded backgrounds, keyboard-dismissal workaround, PTY/ownership heuristics, scrollbar changes or speculative workers/retries. Do not automatically enable/disable the live extension, reload, restart or change settings. No npm release is part of this renderer work; PR updates follow the authorized shipping workflow.
- **Tradeoffs and evidence limits:** repeated host-render formatting is reduced without promising constant-time history layout, eliminating cold-frame/GC costs or establishing phone latency. Broad native iOS interaction and Linux validation remain open; public Pi APIs and existing fallback/image/export limitations remain authoritative.

## Required behavior

- Use borderless mobile presentation in all three states. Keep the summary's pending/tick/cross, tool name and path/command, first error line when present, and no green/red background fill. Preserve the existing spacer rows, text inset and scrollbar gutter; Pi's leading separator remains.
- Add native preview between summary and full. Preview sizes and formatting belong to each original renderer (bash uses five visual output rows); do not impose a universal five-line rule.
- Full output retains original renderers, highlighting, details and interactive controls.
- Desktop ownership retains normal Pi formatting. Keep authenticated Rex owner detection, prior desktop expansion preference, stored results and native tool lifecycle behavior unchanged.
- Fix measured repeated work on unchanged historical tools. Preserve streaming timer cleanup and custom state while details are hidden; continued native call/result lifecycle delegation is the chosen mechanism.
- No separate viewer, dependencies, keyboard/fullscreen settings, PTY changes, automatic live reload, npm release or unrelated `.pi/` changes.

## Interaction assumptions

- Unhandled left clicks cycle **summary → preview → full → summary**. Existing custom controls consume their own clicks; tapping unhandled padding advances the tool instead.
- Pi remains owner of the expanded boolean (full output). The extension owns only the additional local preview choice while Pi is collapsed. Pi's native full-expansion click requires a result; this is not bypassed while a tool has not produced output.
- Pi's global expansion shortcut selects full or summary and resets local preview choices when its global preference changes. Read that preference through the public UI getter, not keybinding guesses or private host fields.
- Local choices survive streaming updates, resize and ordinary invalidation. Ownership handoff preserves choices unless Pi's global expansion restoration resets them. Choices are not persisted across reloads.
- Some tools' native previews already omit successful output (read) or show their diff (edit). The extra state retains those native rules, even when preview/full look similar.

## Completed implementation sequence

- [x] Trace public renderer/mouse/invalidation/global-expansion contracts and current fallback/lifecycle tests.
- [x] Add per-tool preview selection without duplicating native tool content or introducing another full-expansion authority.
- [x] Cache summary construction/clipping and mobile output formatting by width/content. Still render delegated children to detect independent interactive updates; a blind whole-component cache would make those controls stale.
- [x] Extend native comparisons to preview/full, three-click cycling, global expansion, updates and ownership handoff. Retain ANSI isolation, images/fallbacks, HTML-result and timer-cleanup checks.
- [x] Repair fallback redraw re-entry exposed by actual Pi 1.5 validation. Suppress only nested redraw notifications during controlled inner-component synchronization, not independent asynchronous updates.
- [x] Add deterministic state/lifecycle/rendering-correctness regressions and a reproducible, non-gating long-session benchmark. Compare against native Pi without asserting machine-dependent timing thresholds or private formatting-call counts.
- [x] Run Node 22/24 checks, forced-color checks, source package verification and actual Pi 1.5 probes. Record measured scope and remaining device gaps.
- [x] Update README, record decisions below, review scope and commit the task locally.

## Evidence before implementation

Isolated macOS render-only replay, Pi 1.5.0, 5,000 completed bash calls, 40×24 viewport, warm median: native preview 3.58 ms; existing compact output 135.92 ms; same compact output without outer border formatting 56.91 ms; test-only cached whole frame 0.99 ms. Whole-frame memoization was diagnostic only: native/custom child interactions still need to be observed in production. The user's active extension state was not established by these probes.

## Original bordered implementation decision ledger — least confident first

1. **Tap behavior.** Choose the announced three-click cycle, keep native custom controls interactive, and use the existing frame edge as an unhandled expansion target. Add no new buttons or labels. If asking were free, I would ask whether preview should instead be the tap endpoint with full output available only through a separate action. Device acceptance remains open.
2. **Global versus local choices.** Keep only a per-tool preview flag and a snapshot of Pi's global preference. The public `getToolsExpanded()` callback is needed because a row in preview already has `context.expanded === false`; that flag alone cannot distinguish ordinary invalidation from a global collapse. Pi still owns full expansion. If asking were free, I would confirm that global controls should reset local previews, matching Pi's existing global-reset behavior.
3. **Bounded caches.** Retain only the current width's clipped summary and the frame produced from the current child lines. Resize recomputes them; updates/theme invalidation clear them. No multi-width cache, persistent metadata, timing worker or full transcript cache. If asking were free, I would ask for a device latency budget before attempting more optimization.
4. **Observe children before reusing decoration.** Existing interactive tests prove that controls mutate their own text without calling the outer invalidator. Therefore compare freshly returned child lines before reusing the border, rather than blindly returning a cached component frame. This preserves behavior instead of requiring new invalidation conventions from other extensions.
5. **Native synchronization guard.** Pi 1.5's public `updateArgs()` requests a redraw. Feeding that request directly back into the outer row during fallback synchronization recurses. Guard that synchronous update boundary, forward independent redraws normally, and clear the guard in `finally`. No runtime-version switch, private host mutation, deferred retry or disabled rendering callback. If asking were free, I would confirm the supported Pi range; both the pinned 1.4 and installed 1.5 are now exercised.
6. **Keep hidden lifecycle work.** Continue delegating call/result updates in summary mode, reusing original components/state. Rendering less text must not stop native timer cleanup or discard custom interactive state. The performance repair targets repeated frame formatting, not speculative lazy execution of renderer callbacks.
7. **Performance evidence.** Use public rendering/state/lifecycle regressions plus a separate timing script, not private formatting-call counts or a wall-clock CI threshold. Actual 1.5 probes use temporary source/test copies and the installed SDK, not a changed version label or production host modification. If asking were free, I would ask for representative device/session traces before attributing all observed latency to this extension.

## Initial bordered implementation validation

- `PI_TRUE_COLOR=0 make check`: strict TypeScript, **34 tests**, exact six-file source package verification.
- Same 34 tests on actual Node **22.19.0** and **24.15.0**, with pinned Pi **1.4.0**. No dependency changes.
- Same 34 tests against installed Pi **1.5.0** in an isolated temporary project, including actual fallback/mouse/layout behavior and Rex CLI fixtures.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/render.test.ts`: **26 renderer tests** pass.
- `PI_TRUE_COLOR=0 npm run pack:check`: prepack tests and exact artifact verification pass. Runtime remains the same three TypeScript source files; docs/tests/benchmark are not bundled.
- Eight native tool success/error cases now compare both preview and full styled cells against Pi; no weakening of highlighting/background checks. Generic fallback previews also compare to native output.
- **120 exact ANSI summary comparisons against main** pass: four built-in tools × pending/success/error × dark/light × five widths, including tiny widths. Summary appearance is unchanged.
- Existing independent custom-control edits remain visible with the cache; original mouse coordinates/focus, theme refresh, wrapping, scrollbar gutter, sanitization, image placeholders, HTML result retention, streaming timer completion and stored-result integrity remain covered.
- Regressions protect native five-row bash previews through partial updates, final failures, resize and handoff; the global-collapse case where the local expanded flag is already false; independent output/choices for calls sharing a renderer; and synchronous fallback redraw recursion. The original formatting-call-count test was removed as an implementation constraint, not a public behavior. Error refresh remains observable in streaming, shared-renderer and native status tests; rendering cost remains measured by the non-gating benchmark.
- Actual Pi 1.5 initially failed six legacy fallback/geometry cases because of recursive invalidation. After the guard, the complete suite passes; the pinned 1.4 regression explicitly simulates a public redraw notification so this protection is not dependent on the separate 1.5 probe.
- `git diff --check` and Markdown link targets checked. No live session, Rex settings, global extension settings or publication changes.

### Recorded bordered-baseline benchmark

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

- [x] User acceptance of keeping all-state borderless presentation after user-directed field trials.
- [ ] Broad native Rex iOS tapping, custom controls, keyboard/IME and accessibility validation.
- [ ] Real long-session phone scrolling/typing/keyboard-resize latency, including cold frames and GC outliers.
- [ ] Linux validation. Local probes are macOS, not cross-platform certification.

Pi's mandatory leading blank row and the historical iOS HTML custom-call-arguments limitation are unchanged. Preserve existing work and reload only when ready; no automatic reload or restart was performed.

## Initial /ship simplification decision ledger

No new product decisions. Least-confident first:

1. Replace the internal four-label presentation helper with the one summary predicate its consumers actually need. Pi's expanded flag and the existing preview flag still determine all three observable states; global-change synchronization is unchanged. Rename the local `folded` condition to `summaryOnly` because native preview is also collapsed from Pi's perspective. No public API change or additional user decision is needed.
2. Retain the bounded caches, child-output checks, native fallback and synchronization guard. Each addresses measured repeated work, existing interactive behavior or reproduced Pi 1.5 re-entry; removing them would not be behavior-preserving simplification.
3. Build the missing-slot native definition with an explicit conditional instead of nested conditional expressions. Preserve every supplied/missing renderer combination. Keep tests and benchmark methodology unchanged for the separate test-curation phase.

The complete scoped diff was reviewed against main and the existing Pi renderer/mouse/lifecycle path. No intent mismatch was identified. Historical implementation validation above is retained separately from the simplification-phase checks reported to `/ship`; no commit is made by this phase.

## Durable test contracts

The renderer helper changed for this feature, so its existing consumers were reviewed as well as newly edited cases. Each row names a wrong observable behavior and an equivalent implementation change the test must tolerate. Unchanged ownership-query/failure fixtures retain their existing contracts in [compact_tools.md](compact_tools.md); no whole-suite cleanup is intended.

| Test | Regression rejected | Behavior-preserving change tolerated |
| --- | --- | --- |
| Read success | Summary leaks file content or preview/full loses native read presentation. | Replace frame/summary components while preserving terminal cells. |
| Read error | Failure loses its cross, message or native error details. | Reorganize status selection and renderer caching. |
| Write success | Summary exposes write content or preview/full differs from native write rendering. | Change delegated component storage. |
| Write error | Failure looks successful or native detail text disappears. | Recompose the shell without changing visible styles/content. |
| Edit success | Native preview/full diff content or highlighting is lost. | Replace border mechanics and equivalent ANSI encoding. |
| Edit error | Failed edits look successful or lose native error output. | Move status/cache logic into another coherent helper. |
| Bash success | Output leaks into summary or preview/full/desktop formatting changes. | Replace frame or clipping implementation. |
| Bash error | Failed shell calls lose their cross, first message or native output. | Change local presentation bookkeeping. |
| Borderless summaries | Summary gains border glyphs, colored fill, changed spacing or desktop decoration. | Build identical terminal cells without Box/Container. |
| Wrapped edit highlights | Wrapped inverse styles color margins/gutter or drop native diff content. | Use equivalent resets or different shell composition. |
| Short custom highlights | Highlighting spills onto empty padding or the tiny-width gutter. | Change padding/reset mechanics without changing resolved cells. |
| Auto scrollbar | Revealing the scrollbar overwrites tool content or shifts it. | Change internal layout with unchanged visible geometry. |
| Theme changes | Existing tools retain stale theme colors after invalidation. | Rebuild components or refresh styles in place. |
| Child mouse/focus | A custom control receives shifted coordinates or loses focus. | Replace delegation layers while preserving normalized events. |
| Folded streaming/errors | Streaming unfolds summary or final failure leaves a pending/success indicator. | Change lazy/eager summary preparation with identical output. |
| Pending/status styling | Pending full output lacks native background or summary text gets whole-row status fill. | Consolidate appearance helpers or cache styles differently. |
| Unicode/resize | Tiny widths overflow/throw or terminal controls survive in summaries. | Use another safe Unicode clipping/cache implementation. |
| Custom interactive state | Edits to existing controls stay stale or counts reset across folding/handoff. | Replace cache organization while observing independent child updates. |
| HTML results | Independently resolved export result renderers omit expanded output. | Change resolver/component sharing without dropping content. |
| Generic native fallbacks | Missing slots lose sanitization, native previews, arguments or image placeholders. | Replace adapter internals while retaining native output. |
| Streaming timer completion | A completed hidden shell keeps requesting periodic redraws. | Change view caching without changing native lifecycle delivery. |
| Unknown tools | Tools lacking custom renderers cannot reveal arguments/results. | Replace the fallback representation while preserving accessible content. |
| Streaming preview/final failure | A chosen preview collapses during partial/final updates, loses failure details, or does not cycle back to the neutral success summary after a later update. | Change cache/state representation and style lookup frequency. |
| Global expansion | Global collapse leaves a local preview visible because its per-row expanded flag was already false. | Use another representation synchronized from the public global preference. |
| Shared renderer isolation | Updating/expanding one call replaces another call's output or presentation. | Store per-call state anywhere that keeps calls independent. |
| Synchronous fallback notification | A native redraw notification recursively re-enters the update or hides arguments/results. | Change batching/call counts or adapter structure without synchronous re-entry. |
| Extension lifecycle integration | Non-TUI modes start watching, global preference wiring fails, or handoff/shutdown loses desktop expansion. | Change context/getter/watcher storage while keeping public lifecycle effects. |

### Test decisions — least confident first

1. Remove the exact-zero `Theme.fg()` counter test. A fast equivalent implementation may call a cached style accessor every frame; call count is not the performance contract. Timing remains a non-gating native/summary/preview benchmark, not a new CI time threshold. If asking were free, I would ask for a device budget before selecting a performance gate.
2. Add the named missing risk of two calls sharing one renderer. Existing convenience fixtures create separate renderer instances, so they did not prove independent output/local choices. Use two public tool components, not a private-state assertion; retain error refresh here and in the streaming/native cases.
3. Rewrite the fallback notification fixture to detect actual synchronous re-entry instead of rejecting an arbitrary total of 20 otherwise valid updates. Keep the single public-method notification simulation for pinned Pi 1.4 and validate against actual Pi 1.5 separately. Native parity and three-state cycling already have dedicated cases, so do not duplicate their full assertions here.
4. Extend the preview update case through a partial result and final error, preserving its resize/handoff/reversion assertions. This adds a missing lifecycle boundary without another near-identical test.

Isolated counterfactual checks rejected a shared-state mutation and removal of redraw protection at the named regressions. All 26 renderer tests also passed with an extra harmless theme lookup per frame, which the removed exact-zero counter would reject. These experiments changed only temporary copies; production source was not edited.

Net curation: one added case, two rewritten cases, one removed case, no consolidation; still 34 tests. No production or configuration change was required. Device/latency/Linux acceptance gaps above remain open.

## Historical summary-only borderless field trial

Authorized after the user reported residual iOS scrolling lag with all tools collapsed. This is a local diagnostic variant based on `improve_renderer` at `9861007`, not a published design change or new configuration setting.

- Replace only summary border glyphs with neutral spaces. Preserve all four terminal rows (Pi's separator, two decoration rows and the summary row), text width/position, gutter, status/error styling, cache behavior and click targets.
- Keep native preview/full borders, three-state cycling, custom controls, lifecycle and ownership behavior unchanged.
- Do not change fullscreen, keyboard, terminal geometry, live extension settings or the running session automatically.
- Validate the existing tests plus diagnostic geometry, native preview borders, themes, scrollbar isolation and error/reversion paths. Validate with actual Pi 1.5 as well as the pinned SDK.
- To try: once Pi is idle, run `/reload` in the original Pi session, then compare scrolling in Rex iOS with tools collapsed and fullscreen unchanged. Blank space where borders used to be is intentional for this controlled comparison.
- To restore: switch the checkout to `improve_renderer`, then run `/reload` when Pi is idle. No push or npm publication is part of this trial.

### Trial decision ledger — least confident first

1. Keep the now-blank decoration rows rather than tightening layout. This isolates border painting/encoding from changes in viewport density or scroll distance. If asking were free, I would ask about the final borderless layout only after the performance comparison.
2. Use a separate local branch instead of a persistent setting or changing the open PR. This makes the experiment reversible without adding production configuration; a permanent design remains a separate decision.
3. Use the existing summary-only click target to identify the diagnostic decoration change. There is no new mode/component, and preview/full interaction is untouched. This coupling is local to the trial, not a proposed new public renderer contract.

Validation: all 34 tests pass on Node 22/24 and with Pi 1.4/1.5; 26 forced-color renderer tests and the exact six-file package checks pass. The changed geometry fixture checks blank decoration rows, unchanged indentation/height/gutter and no summary border glyphs; preview borders retain their native/style/scrollbar tests.

A synthetic Pi 1.5 fullscreen scrolling replay at the phone's observed 49×42 size (1,000 completed bash widgets plus prose, 240 frames) retained the same scroll range and layout: output fell from 5,699.4 to 2,837.6 bytes/frame, changed-row writes from 40.3 to 26.9/frame, and median host rendering from 1.378 to 0.966 ms. These are memory-terminal measurements, not measured phone latency or proof of the reported cause.

The user subsequently reported slightly better scrolling, then requested border removal in expanded output too. This is subjective device feedback, not a measured phone-latency result. No automatic live reload, settings change, push or publication was performed.

## Accepted borderless preview/full follow-up

The local trial was extended to remove decorative borders from preview and full output as well, then accepted by the user. Native success/error/pending backgrounds, code/diff highlighting, original controls, text width, spacer rows, gutter and three-state/global expansion behavior remain. No fullscreen or keyboard change, automatic live reload, dependency or configuration option is introduced.

The existing mobile wrapper now only handles layout, clipping, ANSI isolation, caching and mouse delegation; its border-only theme dependency and summary-decoration condition are removed. Tests use the unchanged padding-row click target rather than looking for removed corner glyphs. Native styled-cell comparisons remain, while corner/theme-border assertions are replaced by neutral margins, scrollbar/content isolation and native highlighted content after a theme switch.

### Follow-up decisions — least confident first

1. Retain the blank spacer rows and text inset for another controlled comparison, rather than combining border removal with tighter layout. If asking were free, I would ask about final spacing after this trial; no layout redesign was requested.
2. Keep native background colors and syntax/diff styling: the requested removal concerns the decorative frame, not another blanket background change.
3. Remove unused border-specific machinery instead of adding a second display flag or a persistent setting. The renamed mobile shell is the same existing wrapper, not a new UI component.

Validation: `PI_TRUE_COLOR=0 make check` and `PI_TRUE_COLOR=0 npm run pack:check` pass (34 tests and six-file source artifact), as do all 34 tests on Node 22.19.0 and actual Pi 1.5, plus 26 forced-color renderer cases. Preview/full styled content still matches native Pi, including light-theme syntax colors, wrapped diffs, error output, mouse focus/coordinates and scrollbar isolation. Padding-row taps still cycle all three states; streaming completion and fallback-redraw protection remain covered.

The user accepted keeping this presentation. Further latency improvement remains unmeasured; the earlier report of slightly better scrolling is subjective, not proof that border removal resolves the lag. Reload remains user-directed; no automatic live settings change, push or publication was performed during the trial.

## Rebased /ship simplification decision ledger — least confident first

1. Retain the existing shell, bounded caches, local preview/global preference synchronization and fallback redraw guard. They preserve accepted layout/ANSI isolation, independently changing controls, Pi's full-expansion authority and reproduced native redraw behavior. No redundant production layer was found; no production code or public API change is needed.
2. Resolve the documentation mismatch rather than reverting accepted behavior: README and current intent now describe all-state borderless output, while earlier framed requirements/benchmarks are explicitly historical. Preserve spacer rows and native expanded backgrounds; accepting border removal does not authorize tighter layout or blanket background removal.
3. Rename the summary regression to describe accepted behavior instead of a diagnostic. Assertions and test count are unchanged; broader test curation belongs to the next shipping phase. No new product decision, setting, dependency, commit or live-session change is introduced.

### Rebased simplification validation

On Node 24.15.0: `PI_TRUE_COLOR=0 make check` passed strict types, all 34 tests and package verification; `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/render.test.ts` passed all 26 renderer cases; `PI_TRUE_COLOR=0 npm run pack:check` passed prepack checks and the exact six-file artifact verification. These cover three-state/native presentation, custom control updates, streaming failures/completion, synchronous redraw protection and ownership query failure/recovery. Node 22/Pi 1.5 results above are earlier validation, not rerun during this documentation/test-title-only phase. Device, measured phone latency and Linux gaps remain as listed above.
