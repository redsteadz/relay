# API Instructions

- API is an authentication and validation boundary, not processing engine.
- Validate every body before forwarding it to pipeline.
- Verify external callback signatures or identity tokens before acknowledgement.
- Development identity headers must remain unavailable when `NODE_ENV=production`.
- Never expose service-role keys, connector credentials, or Cloudflare internal secrets to clients.
- Do not use Next.js Edge runtime; OpenNext requires Node runtime compatibility.
- Keep route responses stable and machine-readable.

Canonical context: [system architecture](../../docs/architecture/system.md) and
[Gmail integration](../../docs/integrations/gmail.md).
