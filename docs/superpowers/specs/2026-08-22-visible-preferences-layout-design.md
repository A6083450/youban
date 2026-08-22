# YouBan Visible Preferences Layout Design

## Goal

Make language and appearance controls easy to discover without opening an account menu, while keeping trip creation and trip history as the sidebar's primary workflow.

The visual direction follows familiar Google and Apple productivity layouts: restrained surfaces, explicit labels, compact segmented controls, predictable spacing, and a clear separation between global preferences and account actions.

## Final Layout

Use a permanent preferences section near the bottom of the desktop sidebar and mobile drawer. The section sits below the share-code tool and above the account row.

The vertical order is:

1. Brand and new-plan command.
2. Active task and trip history.
3. Share-code tool.
4. Visible preferences section.
5. Account row.

The preferences section has a subtle top divider and the heading `偏好设置`. It contains two stacked controls rather than placing unrelated controls side by side:

- `语言`: a two-option segmented control with `中文` and `English`.
- `外观`: a two-option segmented control with `暖光` and `清朗`, each paired with a small color swatch.

This placement keeps preferences discoverable while preserving most of the sidebar for travel work. The same structure is reused inside the mobile drawer; the mobile top bar remains compact and does not duplicate preference controls.

## Language Behavior

The visible language choices are limited to Chinese and English:

- `中文` maps to `zh-CN`.
- `English` maps to `en-US`.

Japanese is removed from the selectable locale list. A previously persisted unsupported locale, including `ja-JP`, is normalized to `zh-CN` during initialization so the interface and selected state cannot disagree. Existing Japanese translation files may remain in the repository for compatibility, but they are not exposed as a selectable product language.

## Appearance Behavior

Keep the existing internal skin identifiers and storage values to avoid breaking saved preferences:

- Internal `default` is displayed as `暖光` / `Warm`.
- Internal `google` is displayed as `清朗` / `Clear`.

No product or company name appears in the appearance selector. The labels describe the actual visual character:

- `暖光`: warm neutral surfaces with the existing orange accent.
- `清朗`: bright cool surfaces with the existing blue accent.

Each option includes a stable color swatch so the distinction remains understandable when the surrounding interface is already using the selected appearance.

## Account Actions

The account row remains separate beneath preferences. Its menu continues to contain memory management and user switching because those actions belong to the account, not global display preferences.

Replace the current emoji menu icons with icons from the existing `@ant-design/icons-vue` dependency. Icon size and stroke weight must be visually consistent with the rest of the sidebar.

## Visual Rules

- Use a 4/8 px spacing rhythm.
- Keep section labels at the existing compact sidebar scale; do not use page-heading typography.
- Use one full-width segmented control per preference row.
- Preserve a minimum 44 px interactive target for each option on mobile and desktop.
- Use semantic theme tokens for surfaces, borders, text, focus, and active states.
- Do not add a new page header or duplicate controls in the main content area.
- Do not hide language or appearance behind an avatar, overflow menu, tooltip, or disclosure control.
- Preserve visible keyboard focus, `aria-pressed`, group labels, and logical tab order.
- Respect `prefers-reduced-motion`; state changes must not shift surrounding layout.

## Responsive Behavior

At desktop widths, the section uses the existing 260 px sidebar. At 768 px and below, the same controls appear in the existing 280 px mobile drawer. Labels and option text must fit without horizontal scrolling at 320 px viewport width.

The trip list remains the only flexible-height area. The share tool, preference section, and account row remain reachable at the bottom; if vertical space is constrained, the sidebar itself may scroll without hiding fixed controls behind the viewport edge.

## Implementation Boundaries

The change is limited to the global navigation and preference presentation:

- Update `frontend/src/App.vue` for layout, locale choices, and preference styling.
- Update locale labels in `frontend/src/i18n/locales/zh.json` and `en.json`; keep Japanese files only as inactive compatibility data.
- Update `frontend/src/components/UserBadge.vue` to use library icons instead of emoji.
- Preserve the current skin store identifiers and persisted key.
- Add a small locale-normalization module only if needed to keep initialization testable.

Do not redesign trip cards, chat composition, result pages, backend APIs, or authentication behavior as part of this change.

## Testing And Acceptance

Automated checks:

- Locale normalization accepts only `zh-CN` and `en-US`, with unsupported persisted values falling back to `zh-CN`.
- Skin persistence continues to accept existing `default` and `google` values.
- Frontend unit tests and production build pass.
- Backend tests remain unchanged and do not need to be rerun until the final integration gate.

Browser acceptance uses `browser-use` only, following the repository browser-testing rules:

- Desktop at 1440 px: both preference groups are visible without opening any menu.
- Tablet at 768 px and phone at 375 px: controls fit in the drawer with no horizontal overflow.
- Chinese and English switching updates labels and persists after reload.
- `暖光` and `清朗` switching updates the page and persists after reload.
- Keyboard focus order follows share tool, language options, appearance options, then account row.
- The account menu uses consistent vector icons and still opens memory management and user switching.

The layout is accepted only when the real rendered DOM, persisted state, and responsive browser behavior agree; source inspection alone is insufficient.
