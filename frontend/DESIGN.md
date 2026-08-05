# Youban Frontend Design System

## 1. Atmosphere & Identity

Youban is a calm, work-focused travel planning surface. Warm paper backgrounds, dark brown text, and a restrained terracotta accent keep dense itinerary data approachable. The signature interaction is the fixed conversation rail beside an independently scrolling planning workspace.

## 2. Color

### Palette

| Role | Token | Light | Usage |
|---|---|---|---|
| Page surface | `--surface-page` | `#FAF7F2` | Result and form backgrounds |
| Soft surface | `--surface-soft` | `#F5F0E8` | Page depth and grouped regions |
| Elevated surface | `--surface-elevated` | `#FFFFFF` | Sidebar, cards, popovers |
| Text primary | `--text-primary` | `#3D3229` | Titles and body text |
| Text secondary | `--text-secondary` | `#6B5D52` | Supporting copy |
| Accent | `--accent-primary` | `#D97757` | Selected tabs and primary emphasis |
| Accent strong | `--accent-strong` | `#C4603D` | Hover and active emphasis |
| Companion mark | `--brand-companion` | `#C17F59` | Second foot in the paired Youban brand mark |
| Border subtle | `--border-subtle` | `rgba(61, 50, 41, 0.1)` | Dividers and card outlines |
| Success | `--status-success` | `#3A9C7A` | Confirmed and city tags |
| Warning | `--status-warning` | `#B8860B` | Transfer and pending states |
| Error | `--status-error` | `#C43C32` | Failed and destructive states |

The current code predates semantic CSS variables and still contains equivalent raw values. New layout-only fixes must preserve this palette and must not add colors.

## 3. Typography

| Level | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| Page title | 34px | 300 | 1 | Summary totals and page emphasis |
| Section title | 20px | 700 | 1.3 | Itinerary and flow headings |
| Card title | 18px | 600 | 1.4 | Day and card headings |
| Feed title | 15px | 600 | 1.45 | Overview waterfall item titles |
| Body | 14px | 400 | 1.6 | Default content |
| Body small | 13px | 400 | 1.5 | Card metadata |
| Caption | 12px | 600 | 1.4 | Labels and badges |

- Primary: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif`
- Mono: not used.
- Body content must remain at least 14px; compact metadata may use the documented 12px or 13px levels.

## 4. Spacing & Layout

- Base unit: 4px.
- Common steps: 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px.
- Desktop shell: 260px fixed sidebar plus a fluid main pane.
- Result content maximum: 1240px, with 20px desktop and 10px mobile outer gutters.
- Viewport breakpoint: 768px changes the fixed sidebar into a drawer.
- Component-local breakpoint: the budget split responds to the result content width, not the viewport width.
- Scroll owner: `.main-area` owns page-level scrolling; `.sidebar-list` owns conversation-history scrolling. The document and `.app-shell` do not scroll.
- On mobile, the result navigation sticks to the top edge of `.main-area`, directly below the separate 52px app top bar. Its opaque surface prevents scrolling content from showing through.
- Every flex or grid child on the result-card path must be shrinkable with `min-inline-size: 0`.

## 5. Components

### Fixed Sidenav Shell
- **Structure**: `.app-shell > .sidebar + .main-area`; the sidebar is ordered as primary actions, active generation, scrollable plan history, then a fixed utility zone.
- **Variants**: desktop fixed rail; mobile drawer with top bar.
- **Spacing**: 260px desktop rail and 52px mobile top bar.
- **States**: drawer closed/open; sidebar list empty/loading/populated.
- **Accessibility**: mobile menu controls have labels; history remains keyboard reachable.
- **Motion**: mobile drawer uses the existing 250ms transform transition.
- **Layout**: fixed-sidenav-shell. `.main-area` is the scroll owner; `.sidebar-list` scrolls only its own records.

### Result Section Surface
- **Structure**: one result frame with a section-specific body (`overview`, `budget`, `days`, `map`, `weather`, or `today`).
- **Variants**: unframed overview, budget split, unframed detailed itinerary, map, weather, and today's executable plan.
- **Spacing**: 20px section separation, 14px to 20px internal spacing.
- **States**: selected tab, empty content, populated content, selected day.
- **Accessibility**: tabs and collapse panels retain Ant Design keyboard behavior and visible focus.
- **Motion**: existing transform/opacity feedback only.
- **Layout**: stack or intrinsic grid. Cards never exceed the result content inline size.

### Overview Waterfall
- **Structure**: the trip overview begins with the route summary and day sequence, followed by an unframed multi-column feed of reusable attraction tiles and plain trip metadata. Route content has no separate primary-navigation entry.
- **Tile anatomy**: variable-ratio attraction media, day badge, day-navigation action, title, and supporting description. The tile itself has no background panel, border, outer radius, or shadow.
- **Layout**: CSS multi-column flow with 5 columns at the widest result container, then 4, 3, and 2 columns as the container narrows. Mobile remains a stable 2-column feed.
- **Spacing**: 16px desktop column gap, 10px mobile column gap, and 20px between tiles in a column.
- **Media**: repeat the documented `4:3`, `3:4`, `1:1`, `4:5`, and `5:4` ratios to create the varied Xiaohongshu-style rhythm while reserving image space before loading.
- **States**: image zoom and title accent on hover; the day-navigation action remains keyboard focusable and visible on touch devices.
- **Accessibility**: CJK titles may wrap to two lines without clipping; focus-visible uses the primary accent; source order and day navigation behavior remain unchanged.

### Route Overview
- **Structure**: route summary, interactive day sequence, highlights, planning logic, and pace summary embedded at the top of the trip overview.
- **States**: AI blueprint, conservative legacy blueprint, empty optional copy.
- **Interaction**: each stage is a native button that selects its first day. The route and inspiration rails accept horizontal pointer or touch dragging without triggering a day selection. The marquee stays paused while the pointer remains over a dragged rail, resumes when it leaves, and resumes after touch release; vertical touch movement remains owned by the page.
- **Layout**: 3-column stage sequence with open edges on wide content; single-column accent rail below 720px. Stage buttons use separators and tonal hover only, never enclosed cards.

### Adaptive Daily Itinerary Stream
- **Structure**: compact `day / week / month` segmented mode control, optional mode-specific group heading, then every day rendered as a continuous section.
- **Variants**: day mode without group headings; trip-relative seven-day week mode; natural calendar-month mode; one-day trips hide the mode control.
- **Default**: day mode for 1-7 days, week mode for 8-30 days, and month mode for 31+ days. A user's override persists while the current plan stays open.
- **States**: selected display mode, populated day, empty day, cross-view scroll target. The daily view has no date selector, disclosure, previous/next control, or horizontal date rail.
- **Layout**: one vertical reading flow on every viewport. Week headings use the form `第 1 周 · 第 1-7 天 · 8月1日-8月7日`; month mode uses one month heading without nested week headings. All groups remain fully expanded.
- **Accessibility**: the segmented control uses radio-group semantics and a visible focus state. Switching modes changes grouping only and never removes day content.
- **Performance**: all day text stays in the DOM while attraction images keep native lazy loading.

### Daily Timeline
- **Structure**: day heading, day summary, reference-time column, semantic marker, content row, and always-visible attraction media/details. Every trip day is rendered in source order.
- **States**: timed, time pending, transfer, attraction with or without image, meal.
- **Layout**: 72px time column on desktop and 56px at 375px; content owns remaining width.
- **Media**: attraction images appear directly beside the details on desktop and above the details on mobile; no disclosure click is required.

### Conversation History Item
- **Structure**: city, date, status, and a contextual delete action.
- **Variants**: default, active, processing, failed.
- **States**: hover, focus-visible, active, processing with an explicit recovery action, failed, delete confirmation.
- **Accessibility**: keyboard activation, labelled delete control, and a visible 44px-high recovery action for processing plans.
- **Layout**: stack within the independently scrolling sidebar list.

### Active Generation Return
- **Structure**: one solid-accent sidebar action containing generation status, destination, date range, and a directional return command.
- **Data source**: the user-scoped active-task record, independent of history refresh timing.
- **States**: generating, hover, press, focus-visible, and reduced motion.
- **Accessibility**: one native button with a complete accessible name and a persistent visible return label.
- **Layout**: full sidebar width inside 12px gutters; the same action appears inside the mobile drawer without truncating CJK labels.

### Brand Loading
- **Structure**: the existing paired-foot Youban mark, the `游伴` wordmark, one live status line, and a three-dot activity cue. Detailed task progress may follow below, but never replaces the brand loading focal point.
- **Variants**: boot before Vue mounts; compact inside the generation-progress surface; regular inside centered result-page waiting states. The boot variant is critical inline HTML/CSS in `index.html`, mirrors the component anatomy and tokens, and is replaced naturally when Vue mounts.
- **States**: active loading and reduced motion.
- **Motion**: the two feet take alternating 1.4s steps while the complete mark sways subtly; only `transform` and `opacity` animate. Reduced motion freezes the feet and replaces movement with a restrained opacity pulse.
- **Accessibility**: the changing status remains real text inside one polite status region; the decorative mark and dots are hidden from assistive technology.
- **Layout**: vertically centered open composition with no nested card. The mark keeps a stable square footprint so animation cannot shift surrounding content.

### Ongoing Trip Return
- **Structure**: a home-page return action for each completed trip whose date range includes today, with status, trip title, current day, and a persistent "view today" command.
- **States**: one or multiple current trips, short or long multi-city titles, hover, press, and focus-visible.
- **Layout**: shares the 640px home content measure. On mobile, cards use two compact rows, clamp long CJK titles to two lines, and top-align the home empty state below the app bar.
- **Accessibility**: each card is one native button with a complete accessible name; document-level horizontal scrolling is prohibited.
- **Motion**: the existing 150ms hover feedback is retained on pointer devices and no entrance animation is added.

### Today Journey Reflection
- **Structure**: one unframed tonal band beneath the day context, containing a compact achievement label, a state-aware reflection title, a supportive summary, and an optional sentence naming completed places. A single transient status pill appears after a status action and never stacks.
- **States**: not started, in progress, mixed completed and deferred, fully completed, and fully deferred. Completion is celebrated; skipped or postponed plans are framed as valid pacing choices rather than failure.
- **Item treatment**: completed itinerary rows retain full readability with a soft success tint and no strike-through. Skipped rows are quieter but remain legible; postponed rows stay grouped under the existing later section.
- **Accessibility**: the persistent reflection is ordinary readable content. The transient action echo uses a polite live status region and never becomes the only indication of the saved state.
- **Layout**: the band is a single horizontal composition on desktop and remains one shrinkable row on mobile. Desktop may name completed places; mobile uses a compact footprint-count sentence to preserve natural CJK phrases. Transient feedback places the destination name and response on separate mobile lines. Copy wraps naturally without introducing document-level overflow.
- **Motion**: the action echo uses a 200ms opacity/translate transition derived from the beui.dev animated-toast-stack status mechanism, stays visible for 3.2 seconds, and is replaced by the next action. Reduced motion removes translation while retaining the state change.

### Share Code Entry
- **Structure**: visible label, single-line code input, primary icon-and-text submit button, and inline validation message.
- **Variants**: full-width login/error-page form; progressive-disclosure sidebar tool reused inside the mobile drawer.
- **Spacing**: 8px label-to-control gap and 8px input-to-button gap, using the 4px base scale.
- **States**: collapsed, expanded with input focus, empty, normalized input, invalid input, and focus-visible.
- **Accessibility**: the 44px disclosure trigger exposes `aria-expanded` and `aria-controls`; opening moves focus to the persistently labelled input; invalid feedback uses `role="alert"`.
- **Layout**: the collapsed trigger lives in the fixed sidebar utility zone below the independently scrolling plan list. The expanded input and action share one shrinkable row without changing plan-history scroll ownership.
- **Motion**: the panel uses the existing 150ms opacity/transform feedback; reduced motion shows and hides it without transition.

### Trip Map
- **Structure**: one map surface containing the AMap canvas, transient loading mask, and optional multi-day legend.
- **States**: inactive, SDK loading, base map ready, route enhancement pending, fully enhanced, and recoverable overlay failure.
- **Interaction**: switching to the map lazily initializes one map instance; repeated switches resize the existing instance instead of loading another SDK instance.
- **Layout**: fills the result map region with a 500px minimum desktop canvas and a 420px minimum mobile canvas. The legend remains a single horizontally scrollable row on mobile.
- **Loading**: the blocking mask covers SDK/base-map setup only. Marker and route enhancement must not hide an already usable base map.
- **Accessibility**: loading copy remains readable text; map controls retain provider keyboard behavior; the surrounding section keeps its existing navigation label.
- **Ownership**: the component owns SDK loading, instance lifecycle, runtime-settings refresh, overlays, and screenshot capture. Result-page navigation and export composition remain outside it.

## 6. Motion & Interaction

- Micro feedback: 150ms ease.
- Standard panel transitions: 200ms to 300ms ease-in-out.
- Transient action echo: 200ms ease, 3.2s readable dwell, latest action replaces the previous one.
- Emphasis entrance: existing 600ms transform/opacity animation.
- Brand loading step: 1.4s ease-in-out, with the second foot offset by half a cycle.
- Motion communicates hover, drawer state, cross-view scroll targeting, or content state only.
- New motion must provide a `prefers-reduced-motion` fallback; older animation coverage remains accepted debt.

## 7. Depth & Surface

Strategy: mixed tonal surfaces, subtle borders, and restrained shadows.

- Result frame: translucent elevated surface with one subtle border and soft warm shadow.
- Route overview, attraction overview, and detailed itinerary remain unframed inside the result frame. Budget may use a pale grouped surface where dense tabular information benefits from separation.
- Sidebar: opaque white with a subtle divider; it does not float over desktop content.
- Overview tiles, blueprint stages, and daily attraction details use open composition or separators instead of nested cards or decorative shadows.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA for contrast and keyboard navigation.
- Interactive controls keep visible focus states.
- Primary content reflows without document-level horizontal scrolling.
- At 375px, the sidebar becomes a drawer and result sections remain a single readable column.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Raw palette values predate semantic tokens | Existing Vue and CSS files | Consolidation is outside this layout-only repair | Replace incrementally during an approved design-system migration |
| Existing entrance and hover animations do not all declare reduced-motion overrides | Result and card components | Pre-existing behavior, not expanded here | Address in a dedicated accessibility pass |
