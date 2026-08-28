# Mobile UI Contributions

Relay's mobile UI uses React Native Paper through Relay-owned primitives. Start with
`components/ui` and the semantic theme in `theme`; do not import colors from a screen or add raw
light/dark palette checks in a component.

## Use tokens and primitives

Use `AppText`, `AppButton`, `AppTextInput`, `AppSwitch`, `AppCheckbox`, `StatusMessage`,
`LoadingState`, `EmptyState`, `Panel`, and `Page` before reaching for Paper directly. These preserve
Relay's typography, feedback semantics, 48px interaction targets, narrow-screen wrapping, and
accessible state announcements.

Use `useRelayTheme()` for layout values that cannot be expressed by a primitive:

```tsx
const theme = useRelayTheme();

return (
  <View
    style={{
      gap: theme.relay.spacing.md,
      borderRadius: theme.relay.radii.md,
      backgroundColor: theme.relay.colors.surfaceRaised,
    }}
  />
);
```

Choose semantic roles such as `textMuted`, `danger`, or `surfaceRaised`; do not encode intent with a
palette value such as “green 300.” Theme selection defaults to the OS setting and resolves through
`RelayThemeProvider`. Every new role needs both light and dark values plus a contrast test when it
carries text or control meaning.

## When to share a component

Create or extend a shared primitive when an interaction, accessibility contract, or styled pattern
appears in two places, or when getting it wrong could hide consent, errors, destructive intent,
loading, or disabled state. Keep a one-screen arrangement local when it is only layout and already
uses tokens and primitives. Avoid thin wrappers that add no Relay semantics.

Permission and consent copy must stay visible before the consequential action. Never replace it with
an icon, tooltip, or transient message. Destructive actions use `tone="destructive"`; loading actions
set `loading`; field errors use `errorMessage`; asynchronous feedback uses `StatusMessage`.

Before a PR, test a narrow Android viewport and React Native Web with light and dark system settings.
Check text scaling, keyboard focus, wrapping, 48px touch targets, disabled/error/loading states, and
that no control or permission consequence is clipped. Then run the repository verification commands
listed in the root `AGENTS.md`.

Related: [ADR-0008](../../docs/decisions/0008-mobile-styling-and-components.md).
