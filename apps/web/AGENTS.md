# Web Instructions

- `apps/web` is the public landing site. It is a Next.js static export with no server runtime, no
  environment variables, no cookies, no analytics, no third-party requests, and no user data.
- Every string and URL lives in `content/landing.ts`. Section components take props and stay
  presentational so links can change without touching component internals.
- Style with CSS Modules and the tokens in `app/globals.css`, which mirror
  `apps/mobile/theme/palette.json`. Do not add a CSS framework or hard-code colors in components.
- Both color schemes must keep body text at 4.5:1 or better; `lib/theme-contrast.test.ts` enforces
  it against the tokens.
- Copy must match canonical memory. Never promise behavior the pipeline does not implement; say
  plainly what is still a walking skeleton.
- Fonts are self-hosted through `next/font` at build time; the served page must not call Google.

Canonical context: [vision](../../docs/product/vision.md),
[privacy](../../docs/security/privacy.md), and
[action model](../../docs/architecture/action-model.md).
