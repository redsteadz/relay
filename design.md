# WabbitWorks React Native Design & Frontend System

> **Scope**: The entire mobile application—every screen, feature module, form, list, empty state, dialog, modal, bottom sheet, onboarding step, authentication flow, and settings surface.
>
> **Platforms**: iOS and Android. Tablet layouts are supported where they add value.
>
> **UI foundation**: React Native Paper with a custom Material Design 3 theme.
>
> **Aesthetic**: Brutalist editorial—strong typography, deliberate geometry, tactile surfaces, restrained glass and grain, and polished motion. Visual character must never reduce readability, accessibility, or performance.

This document is app-wide. Authentication is one feature that follows these rules; it is not the source of the rules.

---

## 1. Product Design Principles

1. **Paper first**: Use React Native Paper components before building a custom equivalent.
2. **Tokens over one-offs**: Colors, spacing, radii, typography, elevation, and motion come from shared tokens. Feature code must not invent them.
3. **Screens compose; components render**: Screens coordinate navigation and data. Small components own presentation and interaction details.
4. **Feature-local by default**: Keep code beside the feature that owns it. Promote it to `shared/` only after genuine cross-feature reuse.
5. **Motion explains change**: Animation must communicate hierarchy, state, direction, or feedback. It must not delay common actions.
6. **Every state is designed**: Loading, empty, error, offline, permission-denied, disabled, success, and destructive states are part of each screen.
7. **Native behavior wins**: Respect safe areas, keyboard behavior, back gestures, status bars, touch targets, font scaling, and platform conventions.
8. **Lightweight by policy**: Do not add a library for behavior already covered well by React Native, React Native Paper, React Navigation, or Reanimated.

---

## 2. Approved Frontend Stack

Use project-compatible stable releases. Pin versions in the package manager lockfile, not in this design document.

| Concern | Default | Rule |
|---|---|---|
| App framework | React Native; Expo when the project already uses Expo | Do not mix Expo-specific APIs into shared code without an adapter |
| UI components | **React Native Paper** | Primary source for controls, surfaces, feedback, and MD3 behavior |
| Navigation | **React Navigation** with native stack | One navigation system only; use Expo Router only if the existing project is already committed to it |
| Animation | **react-native-reanimated** | Use for custom transitions, gestures, shared values, and layout motion |
| Gestures | **react-native-gesture-handler** | Use with navigation and gesture-driven interactions |
| Server state | **TanStack Query** | Cache remote data; do not copy query data into a global client store |
| Client state | **Zustand** | Only for cross-screen client state that cannot remain local or in navigation params |
| Forms | **React Hook Form** | Field state, validation timing, and submit orchestration |
| Validation | **Zod** with the React Hook Form resolver | Shared runtime schemas and inferred TypeScript types |
| Persistence | AsyncStorage | Preferences and non-sensitive persisted state |
| Secrets | Expo SecureStore or a native secure-storage adapter | Tokens and secrets must never use AsyncStorage |
| Icons | Paper `Icon` / Material Community Icons | One icon family; avoid mixing stroke languages |
| Lists | React Native `FlatList` / `SectionList` | Use FlashList only after profiling proves it is needed |
| Testing | Jest + React Native Testing Library | Test behavior and accessibility, not implementation details |

### 2.1 Dependency Rules

- Prefer platform APIs and the approved stack.
- Do not install a second UI kit, navigation library, animation abstraction, form library, icon family, or date library for convenience.
- New dependencies require a clear use case, maintenance check, bundle/native impact review, and an owner.
- Put vendor-specific code behind a small adapter in `shared/services/` or `shared/platform/`.
- Avoid `Moti`, NativeWind, styled-components, or another styling layer unless the project has already standardized on it. The default is `StyleSheet.create`, Paper theme values, and shared tokens.
- Use `@gorhom/bottom-sheet` only when a draggable, multi-snap sheet is a real product requirement. Use Paper `Dialog` or `Modal` for simpler overlays.

---

## 3. App Theme System

React Native Paper's MD3 theme is the runtime source of truth. The app supports light, dark, and system modes.

### 3.1 Theme Ownership

```text
src/app/theme/
├── colors.ts       # raw brand palettes; never imported by feature UI
├── tokens.ts       # spacing, radius, sizing, elevation, motion
├── typography.ts   # font families, weights, and variants
├── lightTheme.ts   # MD3 light theme
├── darkTheme.ts    # MD3 dark theme
├── navigation.ts   # Paper-to-navigation theme mapping
├── ThemeProvider.tsx
└── index.ts        # public theme API only
```

Feature and shared components consume `useAppTheme()` or Paper's `useTheme()`. They must not import palette constants directly.

### 3.2 Semantic Color Roles

| Role | Light intent | Dark intent | Typical use |
|---|---|---|---|
| `primary` | Near-black brand action | Near-white brand action | Primary buttons, selected controls, active icons |
| `onPrimary` | White | Near-black | Content on primary |
| `secondary` | Cool neutral | Pale neutral | Secondary emphasis |
| `tertiary` | Burnt orange | Vivid orange | Editorial accent, focus moments, highlights |
| `background` | Warm off-white | Deep neutral | App background |
| `surface` | White | Raised charcoal | Cards, dialogs, sheets |
| `surfaceVariant` | Soft neutral | Mid charcoal | Grouped controls and secondary panels |
| `outline` | Neutral border | Muted light border | Dividers and input outlines |
| `error` | Accessible red | Accessible light red | Errors and destructive feedback |
| custom `success` | Accessible green | Accessible light green | Confirmed completion only |
| custom `warning` | Accessible amber | Accessible light amber | Attention without failure |

Rules:

- No hex, RGB, or named color literals in screen or feature components.
- Do not encode status using color alone; pair it with text and/or an icon.
- Validate text/background combinations against WCAG AA contrast.
- Theme changes update Paper, navigation, status bar, system UI, charts, illustrations, and custom surfaces together.
- User choice is persisted. `system` follows `Appearance` changes without restarting the app.

### 3.3 Spacing, Radius, and Size Tokens

Use a 4-point spacing grid.

```ts
spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
radius  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
size    = { iconSm: 16, iconMd: 20, iconLg: 24, control: 48, touch: 48 };
```

- Standard screen gutter: `16` on phones, `24` on larger phones/tablets.
- Standard section gap: `24`.
- Standard control height: at least `48`.
- Minimum touch target: `48 × 48` logical pixels.
- Avoid arbitrary values. Add a token only when a value is repeated and has semantic meaning.

### 3.4 Typography

Use bundled fonts; never load fonts from a CDN at runtime.

| Role | Family | Intent |
|---|---|---|
| Display and headline | Space Grotesk | Editorial identity, page titles, key metrics |
| Body, label, input | Inter | High readability at mobile sizes |
| Fallback | Platform sans-serif | Immediate, reliable fallback |

- Map fonts into Paper's MD3 typography variants.
- Prefer Paper `Text` variants such as `headlineMedium`, `titleLarge`, `bodyMedium`, and `labelLarge`.
- Allow operating-system font scaling. Never reproduce the web document's global `70%` scale.
- Clamp only decorative display text when extreme scaling would break a composition; body copy and controls remain scalable.
- Use uppercase and wide tracking sparingly for short labels, never for paragraphs or error messages.

### 3.5 Elevation, Glass, and Grain

- Use Paper `Surface` and theme elevation levels for normal depth.
- Create a shared `EditorialSurface` variant for the app's grain/glass treatment.
- Blur is optional and localized. When available, use `BlurView` only for hero, onboarding, or overlay surfaces; provide an opaque `Surface` fallback.
- Grain uses one optimized local texture asset with low opacity. Do not generate SVG filter noise at runtime.
- Never place blur or animated grain behind long scrolling lists.
- A screen should have one dominant elevated surface, not a stack of competing effects.

---

## 4. App Shell, Layout, and Safe Areas

### 4.1 Provider Order

The root app composes providers in one documented location:

```text
GestureHandlerRootView
└── SafeAreaProvider
    └── ThemeProvider
        └── PaperProvider
            └── QueryClientProvider
                └── NavigationContainer
                    └── RootNavigator
```

Do not initialize providers inside features or screens.

### 4.2 Standard Screen Primitive

All screens begin with shared layout primitives rather than duplicating safe-area and spacing code.

```tsx
<AppScreen
  scroll="auto"
  keyboard="handled"
  edges={['top', 'bottom']}
  loading={query.isPending}
  error={query.error}
>
  <ScreenHeader title="Projects" />
  <ProjectsContent />
</AppScreen>
```

`AppScreen` owns:

- safe-area insets;
- background color;
- standard horizontal gutter;
- optional scrolling;
- keyboard avoidance and tap handling;
- loading, error, and refresh shell behavior;
- status-bar style;
- tablet maximum content width when appropriate.

Use `FlatList` or `SectionList` as the screen's scrolling root for lists. Never nest them inside a same-direction `ScrollView`.

### 4.3 Responsive Layout

- Use `useWindowDimensions`, flexbox, content constraints, and device classes—not web CSS breakpoints.
- Phone is the baseline. Add a two-pane or centered max-width layout on tablets only when it improves the workflow.
- Orientation changes must not lose state or place controls off-screen.
- Use safe-area values for notches and home indicators; never hardcode status-bar or bottom inset heights.
- Forms remain one column on phones. Use multiple columns only when each field retains a comfortable width at the active font scale.

### 4.4 Keyboard Behavior

- Inputs must remain visible when the keyboard opens.
- Use `KeyboardAvoidingView` through `AppScreen`, with platform-specific behavior hidden inside the primitive.
- Tapping outside may dismiss the keyboard, but buttons remain usable with one tap.
- Set `returnKeyType`, `enterKeyHint`, and `onSubmitEditing` to create a natural field-to-field flow.
- Do not automatically focus an input when it would surprise screen-reader or deep-link users.

---

## 5. Navigation and User Flow

### 5.1 Navigator Structure

```text
RootNavigator
├── BootScreen
├── AuthNavigator
│   ├── SignInScreen
│   ├── RegisterScreen
│   ├── ForgotPasswordScreen
│   └── VerifyEmailScreen
└── AppNavigator
    ├── MainTabs
    ├── FeatureStacks
    └── GlobalModals
```

- Use native stack transitions by default.
- Tab roots preserve state; detail screens live in feature stacks.
- Global modals are reserved for flows that can originate from multiple features.
- Feature-specific dialogs, sheets, and routes stay within the owning feature.
- Deep links map to typed routes and handle unauthenticated redirects without losing the intended destination.

### 5.2 Typed Routes

- Define route param lists close to the owning navigator.
- Export typed navigation hooks from `app/navigation`.
- Pass stable identifiers in params, not large objects or server responses.
- Validate external/deep-link params before use.
- Do not navigate from low-level presentational components. Emit callbacks and let the screen or feature controller decide.

### 5.3 Flow Rules

- Every async submit prevents accidental duplicates.
- Back always has a predictable result. Android hardware back, iOS gesture back, app-bar back, and cancel must agree.
- Destructive exits with unsaved changes show a confirmation dialog.
- Success either updates the current view, returns to the previous view with refreshed data, or navigates forward—never all three.
- Snackbars confirm non-blocking outcomes. Dialogs are for decisions. Full screens are for multi-step work.
- A modal must not open another modal. Replace the current overlay or move the flow to a screen.

### 5.4 App Boot Flow

```text
Launch → restore theme → restore secure session → hydrate essential state
       → resolve deep link → show Auth or App navigator
```

Keep the native splash visible only until essential boot state is known. Non-essential data loads after navigation is ready.

---

## 6. Component System and Usage Rules

### 6.1 Component Tiers

| Tier | Location | Examples | Responsibility |
|---|---|---|---|
| Paper primitives | package | `Button`, `TextInput`, `Surface`, `Dialog` | Base accessible UI behavior |
| App primitives | `shared/components` | `AppScreen`, `AppButton`, `AppTextField`, `StateView` | Stable app-wide defaults and variants |
| Composites | shared or feature-local | `SearchField`, `FilterBar`, `UserRow` | Small groups of primitives with one purpose |
| Feature components | `features/<feature>/components` | `ProjectCard`, `PasswordRules` | Domain-aware presentation |
| Screens | `features/<feature>/screens` | `ProjectDetailsScreen` | Route boundary and orchestration |

### 6.2 Paper Component Mapping

| Need | Use |
|---|---|
| Top bar | Paper `Appbar` or shared `ScreenHeader` |
| Primary/secondary action | Paper `Button` through `AppButton` variants |
| Icon action | Paper `IconButton` with an accessibility label |
| Input | Paper `TextInput`, integrated through `Controller` |
| Grouped content | Paper `Surface`, `Card`, or `List.Section` |
| Selectable compact value | Paper `Chip`, `Checkbox`, `RadioButton`, or `SegmentedButtons` |
| Floating primary action | Paper `FAB`; maximum one primary FAB per screen |
| Menu | Paper `Menu` |
| Confirmation | Paper `Dialog` rendered in `Portal` |
| Lightweight overlay | Paper `Modal` rendered in `Portal` |
| Transient feedback | One app-level Paper `Snackbar` queue |
| Loading | Paper `ActivityIndicator` or content-shaped skeleton |
| Empty/error/offline | Shared `StateView` with optional action |

### 6.3 When to Wrap Paper Components

Wrap a Paper component only when the wrapper adds at least one of the following:

- app-wide semantic variants;
- repeated accessibility defaults;
- repeated form-controller integration;
- analytics or haptic behavior required everywhere;
- a stable visual contract used across features.

Do not create wrappers that merely rename props. Keep the underlying Paper API available where sensible.

### 6.4 Reuse Policy

- Start domain-specific UI inside its feature.
- Promote to `shared/components` when it is used by at least two independent features and its API is stable.
- Shared components must not import from `features/`.
- Feature components may import from `shared/` and their own feature only.
- Do not build speculative “universal” components with dozens of boolean props.
- Prefer composition (`header`, `footer`, `renderItem`, `children`) over mode flags.
- Use named variants such as `tone="danger"` instead of styling from call sites.

### 6.5 Component API Rules

- Props describe intent, not internal styling: `tone="danger"`, not `backgroundColor="#f00"`.
- Callback names begin with `on`; internal handlers begin with `handle`.
- Boolean props use positive, unambiguous names: `disabled`, `loading`, `selected`.
- Components never reach into navigation, stores, or API clients unless they are explicitly feature containers.
- Avoid passing whole store or query objects. Pass the minimum values and callbacks.
- Memoize only after measuring or when referential stability is required by a list or animation.

---

## 7. Motion and Micro-Interactions

React Native Paper owns its built-in component transitions. Reanimated owns custom motion. Do not add a third animation system.

### 7.1 Motion Tokens

| Token | Duration | Use |
|---|---:|---|
| `instant` | 0 ms | Reduced-motion replacement or immediate state change |
| `fast` | 120 ms | Press feedback, icon swap, small fade |
| `standard` | 180 ms | Control state and compact expand/collapse |
| `emphasis` | 260 ms | Card insertion, section transition, success feedback |
| `screen` | 360 ms | Branded entrance or large mode change; use rarely |

Standard easing:

- enter: decelerating cubic curve;
- exit: accelerating cubic curve;
- movement: standard in-out curve;
- tactile scale: spring with low overshoot.

Store duration and easing values in `app/theme/tokens.ts`. Do not scatter timing literals through features.

### 7.2 Motion Patterns

| Interaction | Pattern |
|---|---|
| Button press | scale to `0.98`, then spring to `1`; preserve Paper ripple |
| Card/list insertion | fade + translate `8–12` px; stagger at most the first visible items |
| Validation message | fade + small vertical reveal; no shaking while typing |
| Expand/collapse | animate height only for small bounded content; otherwise crossfade or navigate |
| Success | icon scale/fade once, followed by the real state update |
| Theme change | crossfade affected custom surfaces; do not remount the navigation tree |
| Screen navigation | native stack transition; custom transitions only for a strong product reason |
| Shared element | use only when source and destination relationship is meaningful |
| Long press | native press feedback plus optional light haptic |

### 7.3 Performance and Restraint

- Animate `transform` and `opacity` whenever possible.
- Keep custom animation work on the UI thread through Reanimated shared values.
- Do not animate large shadows, blur radius, grain, or full-screen color gradients continuously.
- Infinite loops are limited to subtle decorative elements and indeterminate loading. Pause them when the screen is unfocused.
- At most three decorative elements may animate continuously on a screen.
- Do not stagger every item in long lists; animate only the first viewport or changed item.
- Interactions must respond immediately; animation follows the state change rather than blocking it.

### 7.4 Reduced Motion

Use `AccessibilityInfo.isReduceMotionEnabled()` through a shared `useReducedMotion()` hook.

- Remove parallax, looping decoration, large translations, flips, and bouncy springs.
- Replace them with short fades or immediate changes.
- Preserve loading and success meaning without relying on movement.
- Test reduced-motion behavior on both platforms.

### 7.5 Haptics

Haptics are optional and semantic:

- light impact for a meaningful selection or snap;
- success notification for confirmed completion;
- warning/error only when an important action fails;
- never on every tap, keystroke, scroll, or navigation action.

Respect device and user settings and provide a no-op adapter when unavailable.

---

## 8. State, Data, Forms, and Errors

### 8.1 State Placement

Use the narrowest valid owner:

1. derived value—calculate it;
2. local transient UI state—`useState` or `useReducer`;
3. form state—React Hook Form;
4. navigation state—React Navigation;
5. server state—TanStack Query;
6. cross-screen client state—small Zustand slice;
7. persisted preference—storage adapter behind a store or hook.

Do not mirror props into state, duplicate query data in Zustand, or use a global store for open/closed state owned by one screen.

### 8.2 API Boundaries

```text
features/<feature>/
├── api/          # request functions, query keys, query/mutation hooks
├── models/       # schemas, domain types, mappers
├── store/        # feature client state only, if needed
└── hooks/        # feature orchestration
```

- API response types do not flow directly into UI when the domain shape differs. Parse and map at the boundary.
- Query keys are factories, not ad hoc arrays repeated across files.
- Mutations define invalidation or optimistic-update behavior beside the mutation hook.
- Convert transport errors into a small typed app error model.
- Never show raw server, stack, or validation-system messages to users.

### 8.3 Forms

- One schema is the source of truth for validation and TypeScript inference.
- Validate on blur by default; revalidate invalid fields on change.
- Submit validates all fields and moves accessibility focus to the first error or an error summary.
- Map form fields to shared Paper field wrappers.
- Disable duplicate submission, but keep entered values intact on failure.
- Explain password, format, or business requirements before submission.
- Server-side field errors attach to the relevant field. Form-wide errors use a visible error surface.
- Never clear a failed form unless the user explicitly resets or leaves it.

### 8.4 Standard Screen States

Each data screen declares these outcomes where applicable:

| State | Required behavior |
|---|---|
| Initial loading | Centered indicator for short waits; skeleton for content-rich waits |
| Refreshing | Preserve current content and show pull-to-refresh or local progress |
| Empty | Explain what is empty and offer the most useful next action |
| Recoverable error | Plain-language message and retry action |
| Offline with cache | Show cached content plus a non-blocking offline indicator |
| Offline without cache | Offline state with retry and relevant guidance |
| Permission denied | Explain why access is useful and offer settings/retry when valid |
| Partial failure | Keep successful content visible and isolate failed sections |
| Success | Update content immediately and use a snackbar only when confirmation adds value |

---

## 9. Folder Architecture

```text
src/
├── app/
│   ├── App.tsx
│   ├── navigation/
│   │   ├── RootNavigator.tsx
│   │   ├── routeTypes.ts
│   │   └── linking.ts
│   ├── providers/
│   │   └── AppProviders.tsx
│   └── theme/
│       ├── colors.ts
│       ├── tokens.ts
│       ├── typography.ts
│       ├── lightTheme.ts
│       ├── darkTheme.ts
│       └── ThemeProvider.tsx
├── features/
│   ├── auth/
│   │   ├── api/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── models/
│   │   ├── screens/
│   │   ├── store/
│   │   ├── utils/
│   │   └── index.ts
│   └── <feature>/
│       └── ...same responsibility-based structure as needed
├── shared/
│   ├── components/
│   │   ├── AppScreen/
│   │   ├── AppButton/
│   │   ├── AppTextField/
│   │   └── StateView/
│   ├── hooks/
│   ├── models/
│   ├── platform/
│   ├── services/
│   ├── storage/
│   ├── test/
│   ├── types/
│   └── utils/
└── assets/
    ├── fonts/
    ├── icons/
    ├── images/
    └── textures/
```

Only create subfolders a feature actually uses. Empty boilerplate directories add noise.

### 9.1 Import Boundaries

```text
app     → features + shared
feature → its own files + shared
shared  → shared only
```

- Features do not import another feature's private files.
- Cross-feature capabilities are exposed through a deliberate public `index.ts` API or moved to `shared/`.
- Avoid deep imports through another module's folders.
- Avoid circular dependencies; move shared contracts downward, not orchestration upward.
- Keep barrel files small and intentional. Do not recursively export an entire directory tree.

### 9.2 Naming

- Components and screens: `PascalCase.tsx`.
- Hooks: `useThing.ts`.
- Utilities, schemas, stores, and services: `camelCase.ts`.
- Tests: `Thing.test.tsx` beside the unit or in the feature's `__tests__` folder.
- Use domain names: `ProjectMemberRow`, not `CustomRow2`.
- Route components end in `Screen`; overlay components end in `Dialog`, `Modal`, or `Sheet`.

---

## 10. Modularity and Small-File Rules

The goal is one clear responsibility per file, not arbitrary fragmentation.

### 10.1 File Size Guardrails

| File type | Target | Split when |
|---|---:|---|
| Screen | 80–180 lines | It contains reusable visual sections, multiple forms, or substantial data logic |
| Component | 30–120 lines | It owns unrelated regions, many modes, or several independent effects |
| Hook | 20–100 lines | It mixes fetching, navigation, form logic, and presentation decisions |
| Store slice | 20–100 lines | It owns multiple unrelated domains |
| Utility/model | 10–80 lines | The file becomes a miscellaneous helper collection |
| Theme/config | up to 200 lines | Separate semantic groups become easier to discover independently |

These are review guardrails, not reasons to create meaningless one-line files.

### 10.2 Screen Rules

A screen may:

- read typed route params;
- call feature hooks;
- choose the active screen state;
- compose headers, sections, lists, and actions;
- handle navigation callbacks.

A screen should not:

- contain raw API calls;
- define theme values or large styles;
- implement reusable field, card, row, or state-view markup inline;
- hold complex validation schemas;
- contain several unrelated `useEffect` chains;
- exceed one primary scroll container.

### 10.3 Component Rules

- Prefer one exported component per file.
- Tiny private helpers may remain in the same file when they are not reusable and stay under roughly 20 lines.
- Put styles beside the component with `StyleSheet.create`; extract only shared style primitives or tokens.
- Split container behavior from presentation when it improves testing or reuse, not as ceremony.
- Extract repeated domain logic into hooks and repeated pure calculations into utilities.
- Keep side effects in hooks, services, or stores—not presentational components.

### 10.4 Avoid the Dumping-Ground Pattern

Forbidden catch-all files and folders include:

- a single global `components/` folder containing every feature's UI;
- `helpers.ts`, `utils.ts`, or `constants.ts` with unrelated exports;
- one `screens.tsx` containing multiple route screens;
- one `store.ts` containing every domain;
- a single `styles.ts` for the entire app;
- “base” components whose prop surface attempts to cover every future use.

Name and place code by ownership and purpose.

---

## 11. Accessibility and Inclusive Interaction

- Every icon-only control has `accessibilityLabel` and, when useful, `accessibilityHint`.
- Use the correct `accessibilityRole`, state, and live-region behavior.
- Touch targets are at least `48 × 48` logical pixels even when the visible icon is smaller.
- Screen-reader order matches visual and task order.
- Dialog focus moves into the dialog and returns to the trigger when closed.
- Errors are announced and associated with their fields.
- Text supports system scaling and remains usable at large accessibility sizes.
- Do not rely on hover. Any hover behavior used on tablets with pointers is an enhancement only.
- Do not rely on swipes or long presses as the only way to perform an action.
- Respect reduced motion, bold text, high contrast, and screen-reader settings where the platform exposes them.
- Decorative images and background geometry are hidden from accessibility services.
- Test with VoiceOver and TalkBack, not only automated checks.

---

## 12. Performance Rules

- Measure before optimizing and record the problem a dependency or optimization solves.
- Use `FlatList`/`SectionList` with stable keys, focused item props, and pagination for long collections.
- Keep `renderItem` stable when list profiling shows rerender pressure.
- Resize and compress images for their display size; prefer local vector icons for interface symbols.
- Avoid new inline objects in hot list paths when they invalidate memoized children.
- Defer non-essential work until after the first interactive frame.
- Keep animations off the JavaScript thread where possible.
- Pause video, timers, polling, and decorative loops when a screen is not focused.
- Cache server data with an explicit freshness policy; do not refetch every time a tab is tapped.
- Lazy-load heavy feature routes when the navigation setup supports it.
- Do not trade clear component boundaries for premature micro-optimizations.

Performance targets:

- visible press feedback begins within one frame;
- transitions remain smooth on supported mid-range devices;
- app boot does only essential session/theme work before first navigation;
- scrolling lists do not run blur, animated shadows, or per-row continuous animation.

---

## 13. Testing and Quality Gates

### 13.1 What to Test

- schemas, mappers, and domain calculations with unit tests;
- hooks and stores through public behavior;
- forms: invalid, valid, loading, server error, and successful submit;
- screens: loading, empty, error, offline, content, and permission states;
- navigation decisions and deep-link parsing;
- theme selection and system-theme changes;
- accessibility labels, roles, state, and focus-critical behavior;
- reduced-motion alternatives;
- visual smoke checks in light/dark mode and small/large font sizes.

### 13.2 Definition of Done for Every Screen

- Uses `AppScreen` or an approved list-root equivalent.
- Uses Paper/theme tokens; contains no hardcoded visual constants.
- Has designed loading, empty, error, and offline behavior where relevant.
- Handles safe area, keyboard, and back behavior.
- Works in light, dark, and system themes.
- Works at large font size without clipped primary actions.
- Meets touch-target and accessibility-label requirements.
- Honors reduced motion.
- Uses feature-local components and respects import boundaries.
- Contains no raw API call or secure-storage access in the screen component.
- Has tests for its primary flow and failure path.
- Has been checked on both iOS and Android.

---

## 14. Web-to-Mobile Migration Rules

The previous web-specific implementation guidance is retired.

| Web concept | React Native replacement |
|---|---|
| React DOM elements | React Native primitives and React Native Paper components |
| Vite | Existing React Native/Expo bundler configuration |
| Tailwind/DaisyUI classes | Paper MD3 theme + shared tokens + `StyleSheet.create` |
| CSS `dark:` / `data-theme` | Paper theme object driven by system/user preference |
| Framer Motion | Reanimated + native stack transitions |
| React Router URL params | Typed React Navigation params and deep-link configuration |
| `localStorage` | AsyncStorage for preferences; secure storage for secrets |
| CSS hover | Press, focus, selected, disabled, and optional pointer-hover states |
| Inline SVG turbulence | Optimized local grain asset |
| CSS backdrop filter | Optional native blur with an opaque Paper `Surface` fallback |
| `rem`, media queries, fixed viewport | logical pixels, flexbox, `useWindowDimensions`, safe areas |
| HTML form semantics | Paper fields, React Hook Form, native keyboard configuration, accessibility props |
| CDN fonts/icons | Bundled font assets and one local icon family |

Do not copy web layout values mechanically. Re-evaluate hierarchy, reachability, keyboard usage, gestures, navigation, and density for a handheld device.

---

## 15. Feature Example: Authentication

Authentication follows the same architecture as every other feature:

```text
features/auth/
├── api/
│   ├── authApi.ts
│   └── authMutations.ts
├── components/
│   ├── AuthHeader.tsx
│   ├── PasswordField.tsx
│   ├── PasswordRules.tsx
│   └── SocialSignInButton.tsx
├── hooks/
│   └── useAuthRedirect.ts
├── models/
│   ├── authSchemas.ts
│   └── authTypes.ts
├── screens/
│   ├── SignInScreen.tsx
│   ├── RegisterScreen.tsx
│   ├── ForgotPasswordScreen.tsx
│   └── VerifyEmailScreen.tsx
├── store/
│   └── authSessionStore.ts
└── index.ts
```

- Sign-in, registration, recovery, and verification are separate typed routes, not modes inside one giant screen.
- A shared editorial auth surface may provide consistent background and entrance motion.
- Secure session data uses the secure-storage adapter.
- Route guards preserve the original destination.
- Password requirements and server errors remain accessible with reduced motion enabled.
- The auth design may be visually distinctive, but it still consumes the app-wide theme and component system.

---

## 16. Pull Request Review Checklist

- Is the code in the feature that owns it?
- Is any new shared abstraction already reused and stable?
- Could a Paper component replace custom interaction code?
- Are colors, spacing, radius, type, elevation, and motion tokenized?
- Is the screen mostly composition rather than business logic?
- Are files small enough to understand without jumping through unnecessary layers?
- Are server state and client state in the correct owners?
- Are loading, empty, error, offline, permission, and success states intentional?
- Are safe areas, keyboard, back behavior, touch targets, and screen readers handled?
- Does animation explain change, stay smooth, and honor reduced motion?
- Was a dependency added? If so, is it necessary, maintained, and lighter than implementing the requirement with the approved stack?
- Does the feature work in light and dark mode on both platforms?

---

*Last updated: 2026-08-29*
