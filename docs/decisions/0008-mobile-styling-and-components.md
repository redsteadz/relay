---
status: accepted
date: 2026-08-28
owners: mobile
---

# ADR-0008: React Native Paper Behind Relay UI Primitives

## Context

The Expo app repeated a dark-only palette and one-off `Pressable`, `TextInput`, and `Switch` styles
across screens. The palette was exported by a page component, so presentation structure was also the
de facto token source. Relay needs Android and React Native Web support, light and dark appearance,
accessible interaction states, and prominent permission disclosures without buying a component pack
or depending on a hosted design service.

The candidates were checked on 2026-08-28 against Expo SDK 57, React Native 0.86, React 19, Android,
React Native Web, accessibility, maintenance, bundle shape, theming, and license compatibility.

| Candidate                 | Compatibility and accessibility                                                                                                                                                                                                    | Maintenance and bundle impact                                                                                                                                                      | Theme and license                                                                              | Result                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| React Native Paper 5.15.3 | Expo setup is documented; its stable package accepts any React and React Native version and only peers on `react-native-safe-area-context`, which Relay already has. It supplies accessible Material controls for Android and web. | Active 5.x releases and 6.x development. The package declares `sideEffects: false`, has three small JavaScript runtime dependencies, and adds no hosted or native runtime service. | Full MD3 light/dark theme roles. MIT.                                                          | Selected and verified by Relay's Android-compatible typecheck and Expo web export.                     |
| Tamagui                   | Strong Expo/native/web support and an optional optimizing compiler, but adopting it well requires Metro, generated CSS, font, and compiler/configuration conventions beyond this issue.                                            | Very active; the compiler can improve web output, but the larger styling system would be a broad architectural commitment for Relay's small UI.                                    | Flexible tokens and MIT repository license.                                                    | Rejected as disproportionate setup and coupling.                                                       |
| gluestack-ui              | Universal, accessible copy-in components, currently centered on Tailwind/NativeWind conventions.                                                                                                                                   | Active and component-level copying limits unused UI, but copied implementations and generated setup become Relay-owned upgrade work.                                               | Flexible tokens; free core is open source, while the project also markets separate pro assets. | Rejected to avoid CLI/generated component maintenance and any ambiguity between core and pro catalogs. |
| React Native Elements     | Android and web support with a centralized theme and broad component catalog.                                                                                                                                                      | The documented current line remains a 4.0 release candidate, and its web guidance carries more setup history than Paper's Expo path.                                               | Customizable and MIT.                                                                          | Rejected in favor of Paper's stable release and closer Expo fit.                                       |

## Decision

Relay uses `react-native-paper@5.15.3` as an implementation dependency behind Relay-owned primitives.
Screens use semantic tokens and primitives from `apps/mobile/theme` and `apps/mobile/components/ui`;
they do not import Paper theme colors or a raw palette. Paper provides control mechanics for buttons,
text inputs, switches, checkboxes, surfaces, progress, and feedback text. Relay retains control of
meaning, wording, spacing, minimum touch size, color roles, and permission disclosure layout.

The default theme preference is `system`. A pure selector also supports explicit `light` and `dark`
preferences without changing token consumers. Both schemes define semantic roles for background,
surfaces, borders, primary and secondary text, accent, focus, disabled state, danger, warning,
success, and information. Body and feedback combinations are tested to at least 4.5:1 contrast.

Only the free local npm package is used. There is no paid component pack, account, telemetry SDK,
hosted theme service, remote asset requirement, or runtime request to Callstack. The MIT license is
compatible with Relay's AGPL-3.0-or-later distribution.

## Consequences

Relay gets consistent accessible state behavior and system light/dark adaptation with a small
dependency surface. Product-specific components remain stable if Paper changes because screens use
Relay wrappers. Contributors must add or extend a shared primitive when interaction semantics repeat;
single-use layout remains local and consumes semantic tokens.

Paper follows Material defaults, so wrappers must continue to prevent decorative defaults from
weakening Relay's quiet tone or obscuring consent. A major Paper upgrade requires checking its peers,
Android and web builds, accessibility states, bundle output, and this ADR's no-service/no-paid-pack
constraint.

## Sources

- [React Native Paper 5.15.3 package metadata](https://github.com/callstack/react-native-paper/blob/v5.15.3/package.json)
- [React Native Paper getting started and bundle guidance](https://oss.callstack.com/react-native-paper/docs/guides/getting-started)
- [React Native Paper theming roles](https://oss.callstack.com/react-native-paper/docs/guides/theming)
- [React Native Paper license](https://github.com/callstack/react-native-paper/blob/main/LICENSE.md)
- [React Native Paper releases](https://github.com/callstack/react-native-paper/releases)
- [Tamagui Expo guide](https://tamagui.dev/docs/guides/expo)
- [Tamagui repository and license](https://github.com/tamagui/tamagui)
- [gluestack-ui introduction](https://gluestack.io/ui/docs/home/overview/introduction)
- [React Native Elements overview](https://reactnativeelements.com/docs/4.0.0-rc.4)
