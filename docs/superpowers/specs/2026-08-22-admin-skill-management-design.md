# YouBan Admin Skill Management Design

## Goal

Add a first-class Skill administration workspace to `/admin` so an administrator can install, review, version, enable, assign, update, edit, archive, and restore the instructions used by YouBan's travel agents.

The feature must preserve the current safety model: Skills contribute reviewed prompt text only. Installing a Skill must not grant shell access, file access, dependency installation, extension loading, or any other execution capability.

## Current State

The TypeScript backend currently loads four repository-owned Skills from `backend-ts/src/agents/skills` through a compile-time allowlist:

- `budget-control`
- `family-accessibility`
- `plan-editing`
- `trip-planning`

The parent assistant receives all four. The five structured subagents receive fixed subsets embedded in `YOUBAN_SUBAGENT_DEFINITIONS`. Agent sessions explicitly disable Pi's ambient Skill discovery and file tools, which is a security property this design keeps.

The current Admin page contains runtime settings and trip management in vertically stacked sections. Skill management requires enough space for a list, content review, version comparison, and agent assignment, so the Admin information architecture also changes.

## Product Decisions

- Support both ZIP upload and Git installation.
- Support public HTTPS Git repositories and private HTTPS repositories authenticated only by a server environment variable.
- Never store or return Git credentials through the browser, API, SQLite, package files, logs, or audit events.
- Every imported, edited, or updated version starts as a candidate and requires explicit administrator activation.
- A Skill has a global enabled state plus assignments to specific agents. Global disable takes precedence over assignments.
- Built-in Skills may be viewed, enabled or disabled, and reassigned. They cannot be edited, archived, or deleted.
- Custom Skills may be edited online, versioned, archived, restored, and updated manually from their Git source.
- Existing active content remains in service while a candidate is reviewed or while a candidate import fails.
- Runtime injection reads only validated `SKILL.md` text. Other package files may be retained for inspection and download but are never executed or exposed to agents.

## Admin Information Architecture

Use a persistent first-level Admin navigation instead of one long page:

1. Runtime Settings
2. Skills
3. Trip Management

At desktop widths, this navigation is a restrained left rail. On narrow screens it becomes a sticky, horizontally arranged top navigation with all three destinations visible; it must not hide Skills behind an overflow or hamburger menu.

The Skills page uses a two-pane work surface:

- The left pane contains searchable, filterable Skill rows with name, source, assigned-agent count, and one unambiguous state badge.
- The right pane contains the selected Skill's details with the tabs `Content & Review`, `Agent Assignment`, and `Version History`.

At narrow widths the panes stack. Selecting a Skill moves focus to its detail section, and a visible back-to-list command returns to the list. No detail or action is removed on mobile.

The page header contains one primary `Install Skill` action. Installation opens a focused dialog or drawer with a segmented source control:

- `Upload ZIP`: file picker, detected Skill name, package validation result, and candidate summary.
- `Git Repository`: HTTPS repository URL, optional branch/tag/commit, optional Skill subdirectory, and a server-side credential-availability indicator. The token value is never rendered.

Candidate review shows the complete `SKILL.md`, current and candidate metadata, source commit when available, content hash, and a readable change comparison. Agent assignments may be selected before activation. The primary action is `Review and Activate`; saving an online edit creates or updates a candidate and never mutates the active version in place.

## Agent Assignment Model

The administrator can assign an enabled Skill to these stable targets:

- `parent-assistant`
- `destination-researcher`
- `segment-planner`
- `summary`
- `itinerary-reviewer`
- `plan-editor`

The four built-in Skills are bootstrapped with their current behavior:

- The parent assistant receives all built-in Skills.
- Each structured subagent keeps the subset currently declared in `subagent-definitions.ts`.

Disabling a Skill excludes it from every target without deleting its assignments. Re-enabling restores the saved assignments. A Skill with no assignments is valid but has no runtime effect.

## Storage Model

Use SQLite for authoritative metadata and prompt content, and a contained data directory for immutable package files.

### `managed_skills`

- Stable generated id and unique normalized name.
- Kind: `builtin` or `custom`.
- Source: `builtin`, `upload`, or `git`.
- Optional sanitized Git URL, requested ref, and Skill subdirectory.
- Global enabled state.
- Active version id and optional candidate version id.
- Monotonic configuration generation.
- Created, updated, and archived timestamps.

### `skill_versions`

- Stable generated id and owning Skill id.
- Monotonic version number.
- State: `candidate`, `active`, `superseded`, or `archived`.
- Validated `SKILL.md` text and parsed name/description.
- Package-relative path and SHA-256 content hash.
- Optional resolved Git commit SHA.
- Created and activated timestamps.

Only one candidate and one active version may exist for a Skill. Saving another candidate replaces the unactivated candidate without changing the active version. Activation changes both version pointers and states in one transaction.

### `skill_agent_assignments`

- Skill id and one of the six stable agent ids.
- A composite unique constraint prevents duplicate assignments.

### `skill_audit_events`

- Operation type, Skill id, version id, sanitized source, result, and timestamp.
- No credential, request header, full uploaded archive, or secret-bearing error string is recorded.

Built-in Skills are reconciled at startup. Repository content remains authoritative; a deployment that changes a built-in `SKILL.md` creates a new system version identified by its hash while preserving administrator enablement and assignments.

Package files live below:

```text
DATA_DIR/skills/
  staging/<operation-id>/
  packages/<skill-id>/<version-id>/
  archive/<skill-id>/<version-id>/
```

SQLite stores only relative package paths. Every filesystem operation resolves and verifies containment beneath the expected root.

## Skill Management Service

Introduce a `SkillManagementService` with narrow responsibilities:

- Reconcile built-in Skills and their default assignments.
- List and retrieve sanitized catalog views.
- Validate and stage ZIP or Git imports.
- Create candidate versions from imports or online edits.
- Activate a candidate transactionally.
- Persist enablement and assignments.
- Check a Git source for an updated commit without activating it.
- Archive and restore custom Skills.
- Produce immutable runtime snapshots and notify runtime consumers when the configuration generation changes.

Repository code, HTTP routing, package acquisition, and runtime prompt rendering remain separate units. The HTTP layer does not manipulate Skill directories directly.

## Installation And Validation

### ZIP

ZIP uploads are limited to:

- 100 regular files.
- 10 MiB total uncompressed content.
- 256 KiB for `SKILL.md`.

Reject absolute paths, parent traversal, duplicate normalized paths, symbolic links, hard links, device entries, encrypted entries, and archives without exactly one selected `SKILL.md`. A package may place the Skill at its root or one containing directory; ambiguous multi-Skill archives are rejected in this release.

Extraction happens in a new staging directory located on the same filesystem as the immutable package root. Candidate creation uses one synchronous critical section: atomically rename the validated staging directory to its final version path, write the candidate rows inside a SQLite transaction, and commit. If the database transaction fails, compensation renames the directory back before cleanup; if the initial rename fails, no database write begins. Failed staging directories are removed.

### Git

Accept only `https://` repository URLs. Reject SSH syntax, `file://`, local paths, URL user information, and embedded credentials. Inputs may include an optional branch, tag, commit, and Skill subdirectory.

Private repository authentication reads `YOUBAN_SKILL_GIT_TOKEN` and `YOUBAN_SKILL_GIT_TOKEN_HOST` from the server environment. The credential is used only when the normalized repository host exactly matches the configured host; all other hosts are cloned without credentials. The credential is passed to the Git child process through sanitized environment configuration rather than command arguments and is never returned to callers. Redirect and logging behavior must not expose the credential.

Clone into a new staging directory with bounded history and a timeout. Resolve and persist the exact commit SHA before validation. Manual `Check for Updates` compares the remote resolved SHA with the active or candidate SHA. An unchanged source creates no version. If the server does not have a usable Git executable, Git operations return a stable service-unavailable error while ZIP and online editing continue to work.

### `SKILL.md`

The frontmatter must provide:

- `name`: lowercase ASCII letters, digits, and single hyphen separators.
- `description`: non-empty plain text within a bounded length.

The parsed name must match the installed Skill name. The complete file must be valid UTF-8 and no larger than 256 KiB. Diagnostics are returned as structured, localized-safe error codes with human-readable details.

Package scripts, manifests, assets, and references are retained only as inert files. This release neither executes them nor expands referenced files into the prompt.

## Candidate, Activation, And Removal Semantics

An initial install creates a disabled custom Skill with a candidate version. The administrator reviews content, selects assignments, and explicitly activates it. Activation may also enable the Skill in the same request.

Online editing and Git updates create a candidate beside the currently active version. The old active version continues serving until activation. A validation, storage, or activation failure leaves the old version and runtime generation unchanged.

Custom Skills must be globally disabled before archival. Archival removes them from normal listings and runtime snapshots, preserves audit and version metadata, and moves the Skill's immutable package directory below the archive root. The directory rename and database transaction use compensation: a database failure restores the original directory, and an unrecoverable filesystem failure leaves the database state unchanged. Restore applies the inverse operation, returns the Skill in a disabled state, and requires explicit reactivation or enablement.

Built-in edit, archive, restore, and delete operations are rejected by the service and HTTP layer regardless of frontend state.

## Runtime Integration

Replace the compile-time-only runtime contract with an immutable `SkillCatalogSnapshot` containing:

- Catalog generation.
- Validated active content keyed by Skill id/name.
- Enabled assignments keyed by the six stable agent ids.

Ambient Pi Skill discovery remains disabled. Session creation receives one snapshot and renders only the Skill content assigned to that session's parent and subagent definitions. Subagent definitions become a factory built from the snapshot instead of a module-load constant.

Activation, enablement, and assignment changes increment the catalog generation:

- New parent and structured-agent sessions use the new generation immediately.
- Idle parent sessions on an old generation are disposed before reuse.
- Busy parent sessions finish their current serialized work, then become stale and are disposed.
- Long-lived structured-agent hosts retain their starting generation during active work, then rotate atomically before the next request.
- Existing trip generation is never aborted solely because Skill configuration changed.

Runtime rotation failures do not roll back the persisted catalog. They surface through logs and health diagnostics, and the affected host retries construction on the next request. The last already-created host is not silently relabeled as the new generation.

## Admin HTTP API

All routes use the existing `X-Admin-Token` authentication and TypeBox request/response schemas.

- `GET /api/admin/skills`: list active and optionally archived Skills with filters.
- `GET /api/admin/skills/:skillId`: return detail, assignments, versions, active content, and candidate content.
- `POST /api/admin/skills/upload`: accept one multipart ZIP and stage a candidate.
- `POST /api/admin/skills/git`: clone a Git source and stage a candidate.
- `POST /api/admin/skills/:skillId/check-update`: resolve the configured Git source and create a candidate only when content changed.
- `PUT /api/admin/skills/:skillId/candidate`: save validated online edits as the candidate.
- `POST /api/admin/skills/:skillId/activate`: activate the candidate with enablement and assignments in one request.
- `PUT /api/admin/skills/:skillId/configuration`: update global enablement and assignments without changing content.
- `DELETE /api/admin/skills/:skillId`: archive an eligible custom Skill.
- `POST /api/admin/skills/:skillId/restore`: restore an archived custom Skill in a disabled state.

Expected error classes include unauthorized, not found, conflict, invalid package, invalid source, import timeout, built-in restriction, and active-before-archive. Responses must not expose local paths, Git credentials, raw child-process commands, or stack traces.

## Frontend Structure

Refactor `AdminView.vue` into a layout shell and focused modules rather than adding another large section to the existing file:

- Admin navigation shell.
- Runtime settings panel.
- Skill management workspace.
- Skill list and filters.
- Skill detail and version review.
- ZIP/Git installation dialog.
- Agent assignment control.
- Existing trip management panel.

API DTOs live in the shared frontend types module and calls remain in `services/api.ts`. Pure formatting, state transition, and validation helpers are extracted so Bun unit tests can cover them without requiring a browser component-test framework.

Use the existing Ant Design Vue and icon dependency for controls. Commands use familiar icons with accessible labels. Status uses text plus restrained color, never color alone. Destructive archival is separated from activation and requires confirmation. Interactive targets are at least 44 px on narrow screens, focus order is logical, and no text or controls overlap at 320 px width.

## Testing And Acceptance

Backend unit and integration tests cover:

- Built-in reconciliation and preserved default assignments.
- ZIP traversal, link, duplicate-path, count, size, encoding, and ambiguous-root rejection.
- Git URL validation, exact commit capture, timeout, unchanged update behavior, and token redaction.
- `SKILL.md` frontmatter, name, description, UTF-8, and size validation.
- Candidate replacement, activation transaction, content hashes, archive, and restore.
- Built-in edit/archive restrictions enforced below HTTP.
- Global enablement and all six assignment targets.
- Runtime snapshots containing only active, enabled, assigned content.
- Parent and structured-agent host rotation without interrupting active work.
- Admin authentication and stable error mapping on every new route.

Frontend unit tests cover DTO normalization, filtering, state badges, source labels, candidate state, assignment updates, and validation messages. The existing frontend suite and production build must remain green.

Browser acceptance follows the repository rule and uses `browser-use` only:

- Log into `/admin` and find Skills as a visible first-level destination.
- Install a valid ZIP, review it as a disabled candidate, assign agents, activate it, and verify the resulting state.
- Reject an invalid ZIP without changing the current active version.
- Install or update from a controlled Git fixture without exposing credentials.
- Edit an active custom Skill, confirm the old version remains active during review, then activate and inspect version history.
- Disable and re-enable a Skill while preserving assignments.
- Verify built-in edit and archive actions are absent and backend calls are rejected.
- Verify desktop two-pane behavior and complete mobile stacked behavior at 375 px and 320 px without horizontal overflow.

The final integration gate runs the complete backend tests, backend typecheck, Python-test disposition audit, frontend unit tests, frontend production build, `git diff --check`, and a clean worktree check. Existing unrelated build warnings must be reported rather than attributed to this feature.

## Non-Goals

- A public Skill marketplace or discovery catalog.
- Automatic periodic Git updates or automatic activation.
- Execution of Skill scripts, package hooks, extensions, MCP servers, or dependencies.
- Browser-managed Git credentials.
- Multiple Skills imported from one ZIP or repository operation.
- Per-user Skill assignments.
- Editing built-in Skill content from the Admin UI.
- Interrupting active trips to apply a newly activated Skill.
