# Web Instructions

- `apps/web` is the public landing site. Vite builds it to `dist/` as a static single-page bundle
  with no server runtime, no environment variables, no cookies, no analytics, no third-party
  requests, and no user data. Relative asset paths keep it hostable from any directory.
- `index.html` is the whole document. There is no render step, so the plugin in `vite.config.ts`
  substitutes the title and description from `content/site.ts` and the before-paint theme script
  from `lib/theme.ts`. That script must stay inline and blocking in `<head>`, ahead of the module
  bundle, or a stored preference flashes the system scheme.
- `vite.config.ts` is loaded by Node rather than the bundler, so it uses explicit `.ts` extensions
  and imports only import-free leaf modules. Do not point it at a component or a CSS module.
- Every string and URL lives in `content/landing.ts`, or in `content/site.ts` for the three head
  strings it spreads into `landing.site`. Section components take props and stay presentational so
  links can change without touching component internals.
- Style with CSS Modules and the tokens in `app/globals.css`, which mirror
  `apps/mobile/theme/palette.json`. Do not add a CSS framework or hard-code colors in components.
- Both color schemes must keep body text at 4.5:1 or better; `lib/theme-contrast.test.ts` enforces
  it against the tokens.
- Copy must match canonical memory. Never promise behavior the pipeline does not implement; say
  plainly what is still a walking skeleton.
- Fonts are self-hosted: `app/fonts.css` declares each face against a Latin `woff2` from the
  `@fontsource-variable` packages, emitted as a build asset. The served page must not call Google.

Canonical context: [vision](../../docs/product/vision.md),
[privacy](../../docs/security/privacy.md), and
[action model](../../docs/architecture/action-model.md).
