---
name: relay-security
description: Reviews Relay ingestion, AI, OAuth, encryption, RLS, notification dismissal, and provider changes. Use for security-sensitive issues and PRs.
---

# Relay Security Review

Check each changed trust boundary:

- Authentication and tenant identity are established before user-controlled identifiers are used.
- Untrusted payloads are schema-validated and size-limited.
- Raw content and credentials are encrypted before persistence and omitted from logs.
- Data keys, nonces, wrapping keys, and key versions are complete and non-reused.
- RLS denies cross-user reads and writes.
- OpenAI receives only documented allowlisted fields after redaction.
- Source text cannot alter system instructions, provider endpoint, credential, or operation.
- Queue and Workflow retries cannot duplicate external effects.
- Irreversible notification dismissal requires explicit deterministic authorization.
- Failure paths preserve audit metadata without plaintext leakage.

Return actionable findings with path, severity, exploit/failure mode, and smallest fix.
