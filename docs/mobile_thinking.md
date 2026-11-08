# Mobile thinking defaults

## Workspace intent

- **User goal:** default thinking blocks to collapsed while the Rex iOS app owns this Pi terminal, preserving Pi's native **Thinking...** label and ability to expand them.
- **Accepted approach:** target this Rex session/block with Ctrl+T; do not invert an already-hidden preference; restore confirmed extension-owned changes on desktop handoff. The user rejected modifying Pi and explicitly rejected replacing its default label.
- **Constraints:** keep execution, model thinking level, saved messages, existing compact-tool rendering and ownership detection unchanged. No Pi patches/prototype replacement, reconstructed thinking output, separate viewer, new dependencies/settings or persisted restoration metadata. Keep the short README intact. Do not automatically reload a live session or release the package.
- **Tradeoff:** this invokes Pi's existing persisted global visibility toggle, not a mobile-only setting. A crash or failed delivery can leave the preference hidden; accepted input cannot be recalled. Device routing remains unverified.
- **Agent mechanisms, not extra user requirements:** the zero-row focus observer, stock-editor/raw-input checks, conservative shortcut-conflict policy, single in-flight toggle, acknowledgement timeout, duplicate-key coalescing and live teardown restoration.

During authenticated Rex iOS block ownership, pi-rex requests Pi's native thinking collapse through `rex send-key`, targeting this Pi process's Rex session and block. Pi keeps its **Thinking...** label, native tap-to-expand behavior, model thinking level and saved message content.

Already-hidden thinking is left alone. A confirmed automatic collapse is reversed on desktop handoff, including ownership-query failure or event-stream exit. Users can expand thinking while mobile; the default is applied once per ownership transition, not continuously.

## Decisions — least confident first

1. **Use a zero-row widget to observe stock-editor focus.** This uses the public widget factory, concrete TUI classes and their public focus getter; it does not replace the editor, alter Pi's prototype or access private fields. Pi's stable TUI reference follows regular/fullscreen renderer changes. Pi already reserves the same above-editor separator with or without widgets. Also defer while Pi's process terminal has released raw input, such as while an external editor is running. The unasked choice was whether to automate custom editors too: defer rather than assume an unknown editor handles Ctrl+T like Pi's stock editor.
2. **Keep the literal Ctrl+T route conservative.** Skip and warn when thinking is remapped/disabled or another user-configured action also claims Ctrl+T. The unasked choice was whether to synthesize arbitrary replacement shortcuts; do not risk triggering another action. Recheck focus, desired state, settings and bindings when input arrives, not just before spawning Rex.
3. **Confirm, do not blindly retry.** Keep one command in flight and wait up to 2.5 seconds for input acknowledgement and Pi's effective `hideThinkingBlock` value. A CLI success alone is not confirmation. Errors or unconfirmed changes warn; another ownership transition can try again. A consumed key can be safely deferred until stock-editor focus returns. The unasked choice was retry policy: omit transport retries because this is a toggle, not an idempotent setter.
4. **Treat simultaneous Ctrl+T input as one automatic operation.** While a toggle is pending, ignore key releases and consume duplicate Ctrl+T presses. This prevents a manual press racing Rex delivery from toggling twice. The unasked choice was how to disambiguate identical manual/synthetic input: briefly coalesce it instead of inventing a custom terminal protocol. Normal manual toggles resume when the operation completes.
5. **Restore only a confirmed extension-owned change.** Do not write settings files or add persistent restoration metadata. Live reload/session replacement attempts restoration before removing the observer. Normal quit does not inject a restoration key: Pi stops reading input before its quit cleanup, and a key could reach the parent shell. The unasked choice was exit behavior: prefer leaving the saved preference hidden over typing into a different program. An unfocused or failed live restoration warns instead of claiming success.

## Review disposition needed

Preserve these existing branch behaviors for review rather than treating them as explicit user requirements or deleting them during simplification:

- Normal quit leaves a confirmed automatic collapse persisted, not only crashes. This was disclosed before implementation but not separately approved; no restoration key is sent after Pi stops reading input.
- Custom editors and remapped/conflicting shortcuts are not automated. This narrows the general mobile-default goal in favor of avoiding unintended actions.
- Pending operations briefly consume duplicate manual Ctrl+T presses. This is an agent-chosen race policy; ordinary manual expansion resumes afterward.
- Live reload/session replacement attempts restoration, and failed restoration warns. This extends the explicitly discussed desktop-handoff behavior.

## Limits

This deliberately uses Pi's existing persisted preference; it is not a mobile-only Pi setting. Quitting, crashing or losing delivery can leave thinking hidden. Restore it manually with Ctrl+T in Pi's editor. Custom editors are not automated. Project-level setting overrides or other terminal-input handlers can make an effective-setting confirmation unavailable; unconfirmed operations are reported, not retried or claimed successful.

Rex key delivery remains best effort: a key already accepted by Rex cannot be recalled, including if another program takes input after dispatch. No live Rex block, user settings, model request or phone configuration was changed during automated validation. Device handoff/routing, Linux and SDK versions beyond the exercised versions still need field testing.

## Validation

The Rex CLI fixture sends real input over a temporary Unix socket to Pi's actual TUI, stock editor, keybinding manager and assistant-message components, using an in-memory native settings manager. It rejects incorrect session/block/key values without requiring a particular option order. Tests cover visible/hidden desktop preferences, regular/fullscreen operation through Pi's stable TUI reference, native label/streaming/tapping and unchanged messages, focus changes, released raw input, delayed keys, key releases, manual/synthetic races, manual expansion, transport failure/recovery, intercepted input, remapped/conflicting shortcuts, reload and quit.

Verified checks:

- `PI_TRUE_COLOR=0 make check`: strict types, all 46 tests and package verification pass on Node 24.15.0.
- The same gates pass on actual Node 22.19.0.
- All 46 tests and strict types pass against the installed Pi 1.5 SDK in an isolated project; repository development dependencies remain Pi 1.4.
- `PI_TRUE_COLOR=0 node --test test/rex.test.ts`: all 21 ownership/thinking integration cases pass, including focus changes, transport failure/recovery and teardown.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/*.test.ts`: all 46 cases pass with forced color.
- `PI_TRUE_COLOR=0 make pack-check`: prepack checks and the exact six-file package verification pass. No dependencies, settings, version or release artifacts were added.
- `git diff --check`: passes.

The keybinding-manager and stable-TUI-reference imports are pinned SDK integration fixtures, not production private-host dependencies. Production uses public exports and extension APIs only. The README remains the requested short feature description and developer commands.

## Simplification decisions — least confident first

1. Replace three overlapping teardown flags with one lifecycle value: active, restoring, stopping or disposed. These are the states the existing control flow actually reaches. Repeated disposal after completion is a no-op; restoration still drains the previous command before attempting the current desired state. The unasked choice was representation: keep the same behavior with fewer independent flags rather than redesign the handoff controller.
2. Keep the focus observer and acknowledgement handshake. Pi exposes neither a session-only thinking setter nor direct shortcut invocation. Removing these mechanisms would reintroduce wrong-focus delivery, stale handoff toggles or treating Rex acceptance as Pi confirmation. Do not substitute editor replacement, Pi monkey-patching, arbitrary remapped keys or a retry worker.
3. Flatten shortcut validation into a direct loop, name the desired preference explicitly, and evaluate focus once per received event. The unasked choice was code organization: preserve the existing predicates and caller-specific policy in the Pi extension rather than move it into shared Rex command infrastructure.

The lifecycle cleanup did not change public APIs, configuration or test contracts.

## Regression contracts

Every branch-added or modified test has both counterfactuals below. The seven unchanged Rex ownership/query contracts and 25 unchanged tool-renderer cases remain separate coverage, not pruning candidates for this feature.

| In-scope case | Concrete wrong behavior rejected | Equivalent refactor tolerated |
| --- | --- | --- |
| Tool integration: TUI-only watching and expansion restoration | JSON/RPC/print launches Rex processes, or thinking handoff breaks native desktop tool output/global expansion | Move ownership callbacks or rename lifecycle fields while preserving modes and native rendered output |
| Visible preference, regular mode | Mobile leaves thought text expanded, alters the native label/answer/message, or fails to restore the desktop preference | Reorder Rex's explicit session/block options or reorganize the controller |
| Already-hidden preference, regular mode | Sends an unnecessary toggle for already-hidden thinking or changes its saved desktop preference | Cache the preference or reuse native views without changing output or issuing input |
| Visible preference, fullscreen mode | The stable fullscreen TUI reference is rejected and mobile never collapses thinking | Change focus-check organization while keeping fullscreen eligible |
| Focus loss during delivery and recovery before the old reply | A dialog receives Ctrl+T, or returning editor focus/redrawing before Rex replies permanently stalls the deferred collapse | Change promise/queue representation, provided the known-consumed request is resumed after the pending command completes |
| Pi has released terminal input | An ownership change issues a key while an external program owns the terminal | Reorder readiness checks or change observer implementation without sending during the inactive interval |
| Delayed key after desktop handoff | A stale mobile key hides desktop thinking, or key releases are mistaken for completed input | Use another request identity representation while preserving receipt-time validation |
| Manual Ctrl+T races Rex delivery | The two indistinguishable inputs toggle twice and leave thinking visible | Replace input bookkeeping fields without changing coalescing outcomes |
| Manual expansion after automatic completion | Redraws continuously re-hide the user's manual expansion or send another command on handoff when already restored | Change redraw frequency or caching without enforcing the default repeatedly |
| CLI delivery failure and later recovery | Silently treats an unsuccessful delivery as success, retries a toggle blindly, or cannot recover on a later ownership cycle | Change subprocess error handling or warning wording while retaining a nonempty warning and unchanged preference |
| Input intercepted after CLI acceptance | Treats CLI success/observed input as confirmed visibility despite another listener consuming it, or emits a restoration toggle it does not own | Reword diagnostics or change input-listener plumbing while still warning and confirming the preference |
| Remapped Ctrl+T | Dispatches an unrelated shortcut or silently claims the mobile default was applied | Change binding lookup or warning wording while skipping delivery and warning visibly |
| Conflicting Ctrl+T override | Invokes another editor action, including exit, instead of warning and doing nothing | Normalize user bindings differently or reword warnings |
| Reload restoration and quit | Loses the original preference across reload, or sends a restoration key after Pi stops reading input on quit | Reorganize teardown state/cleanup without changing emitted input or the resulting preference |

No duplicate case lacked a distinct risk. The native SDK keybinding/TUI-reference fixtures and the simulated process-terminal identity/raw flag remain proportionate integration seams: they exercise actual Pi input/rendering while avoiding real user TTY or settings changes. Warning severity/nonempty content are contracts; exact wording is not. Native **Thinking...** text and explicit input targeting remain contractual.

## Deterministic delivery and pending-focus correction

Command attempts are observed through Node's public subprocess diagnostics and `ChildProcess` spawn event, not by waiting for a child-written log/PID file. Socket delivery is recorded after Pi processes the input. Tests wait for delivery, child completion and the next event-loop turn instead of fixed sleeps; public redraws exercise the observer. CLI parsing uses Node's `parseArgs`, accepting reordered short/long options while retaining strict session/block/key checks.

The strengthened focus test holds Rex's reply after the old key was consumed, returns stock-editor focus and forces a redraw, then releases the reply. Before the fix it reached the final visible-preference assertion and timed out: completion only considered ownership changes, so a focus-invalidated attempt could be stranded. The completion check now resynchronizes an unattempted current ownership revision, including that known-consumed case. Failed or unconfirmed delivery retains its attempted revision and is still not retried blindly. This corrects the existing deferred-collapse behavior; it does not introduce a new product policy.

## Test decisions — least confident first

1. Use the public Node spawn diagnostic rather than add a production test hook or stub out Rex transport. The unasked choice was observation level: parent-side issuance makes negative safety checks deterministic even when child startup is delayed; actual native socket delivery remains the outcome boundary.
2. Extend the existing focus case with a held reply instead of adding another nearly identical race test. The unasked choice was consolidation: preserve its pre-send and receipt-time checks while covering the missed completion ordering in the same scenario.
3. Keep all distinct existing cases and retain warning-level/nonempty-message assertions instead of pinning copy. The unasked choice was pruning: no deletion was justified by duplicate protection, so remove incidental timing/argument-order/wording constraints rather than tests.

Added: 0; rewritten existing cases: 13 (the three generated preference/mode cases plus ten individual integration cases); consolidated: 0; removed: 0. The suite remains 46 tests, including 21 ownership/thinking cases. The existing reload/quit case is retained unchanged; its supporting command observer is strengthened.

### Counterfactual evidence

- The focus/reply ordering was reproduced against the prior implementation in `/tmp/pi-rex-thinking-curation-regression.log`; the strengthened existing test failed at the final visibility wait. It passes after the narrowly scoped completion correction.
- `/tmp/pi-rex-thinking-curation.4bduMD/counterfactuals.mjs` mutates only temporary copies. Reordered explicit CLI options/aliases pass all 46 cases; warning rewording passes all 21 ownership/thinking cases. Removing the released-input guard, suppressing the deferred-focus resynchronization, or allowing the duplicate Ctrl+T each fails its named regression test.
- No production system, live input route, credential-dependent integration, automatic reload or package release was invoked. The operational limits and review dispositions above remain open.
