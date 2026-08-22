# Pi Subagents P0.5 Compatibility Report

Date: 2026-08-22

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

Session startup: 87.46 ms. First child: 401.20 ms. Warm child p50: 310.07 ms. Warm child p95: 322.27 ms.

Raw child samples in milliseconds:

```text
401.204875
310.071167
294.097583
318.020750
307.466834
303.267083
302.463959
316.105959
312.319209
322.274000
```

These are local mock-provider process-start measurements, not real model latency or a production soak test.

## Bun 1.4 Performance Evidence

- `bun run profile:cpu` generated a non-empty Markdown CPU profile with hot-function self time and a call tree. The most visible startup work is in pi-subagents agent-directory discovery, synchronous file reads, TypeBox schema construction, streams, and watchdog/channel setup.
- `bun run profile:heap` generated a non-empty Markdown heap profile with type totals, retained sizes, and the largest-object table. The snapshot root retained 38.7 MB at process exit; a single exit snapshot is evidence for inspection, not proof of a leak or long-soak memory stability.
- Both generated profiles live under ignored `backend-ts/profiles/`; they are local diagnostic artifacts rather than repository inputs.
- Three serial backend test runs were 5.43, 5.44, and 5.42 seconds (median 5.43 seconds).
- Three Bun 1.4 isolated four-worker runs were 2.71, 2.37, and 2.32 seconds (median 2.37 seconds), about 56% faster, with all 151 tests passing in every run.
- `bun run test` now uses `--parallel=4`, `--isolate`, and the checked-in `tests/timings.json`; `bun run test:serial` remains available for order-sensitive diagnosis.

## Required Adapters

1. `createAgentSession()` must be followed by `session.bindExtensions({})`; otherwise structured delegation returns `unavailable_context`.
2. Runtime agents must be registered on the same `ExtensionAPI` instance passed to pi-subagents. The host uses one wrapper factory that registers agents before invoking the package factory.
3. Structured zero-caller-tool runs cannot use `toolBudget.block="*"` with pi-subagents 0.53.0. It blocks the internal `structured_output` tool and can trigger a retry loop. The host rejects this combination and blocks explicit external tool names instead.
4. pi-subagents ships `src/types/pi-runtime-compat.d.ts` but does not include it in the consumer type graph. The project includes that package-provided declaration explicitly and pins `@types/node` 24.13.3.
5. pi-hermes-memory runtime behavior passes, but its TypeScript source has Pi 0.84.2 header and duplicate pi-tui type conflicts when compiled as application source. The compatibility probe is isolated as JavaScript and the application will integrate only through the public extension entrypoint.
