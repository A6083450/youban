# Pi Subagents P0.5 Compatibility Report

Date: 2026-08-21

Runtime: Bun 1.4.0, Pi 0.84.2, pi-subagents 0.53.0, pi-hermes-memory 0.9.6.

## Results

- Pi SDK and pi-subagents load together under Bun.
- A real Pi child process completes schema-validated structured delegation against a local OpenAI-compatible mock.
- Child caller tools are empty; the model request exposes only the package-owned `structured_output` protocol tool.
- Two owned leaf requests execute concurrently.
- Exact tuple cancellation (`requestId`, `ownerRunId`, `nodeId`) returns `cancelled` without waiting for the delayed model response.
- An ambient builtin agent is rejected by the session capability ceiling.
- pi-hermes-memory `memory_add` mirrors one write to both `USER.md` and `sessions.db.memories` under Bun.

## Benchmark

Command: `bun run bench:pi-subagents`

Session startup: 91.40 ms. First child: 409.52 ms. Warm child p50: 325.06 ms. Warm child p95: 329.65 ms.

Raw child samples in milliseconds:

```text
409.522666
323.633292
328.070583
329.299625
328.902417
323.843125
329.651459
325.063209
323.015958
320.516542
```

These are local mock-provider process-start measurements, not real model latency or a production soak test.

## Required Adapters

1. `createAgentSession()` must be followed by `session.bindExtensions({})`; otherwise structured delegation returns `unavailable_context`.
2. Runtime agents must be registered on the same `ExtensionAPI` instance passed to pi-subagents. The host uses one wrapper factory that registers agents before invoking the package factory.
3. Structured zero-caller-tool runs cannot use `toolBudget.block="*"` with pi-subagents 0.53.0. It blocks the internal `structured_output` tool and can trigger a retry loop. The host rejects this combination and blocks explicit external tool names instead.
4. pi-subagents ships `src/types/pi-runtime-compat.d.ts` but does not include it in the consumer type graph. The project includes that package-provided declaration explicitly and pins `@types/node` 24.13.3.
5. pi-hermes-memory runtime behavior passes, but its TypeScript source has Pi 0.84.2 header and duplicate pi-tui type conflicts when compiled as application source. The compatibility probe is isolated as JavaScript and the application will integrate only through the public extension entrypoint.
