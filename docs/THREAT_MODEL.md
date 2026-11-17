# Threat model

## Assets

1. User-supplied upstream API keys.
2. The server's outbound network access.
3. Public test records (prompts, answers, group names, masked endpoints).
4. Admin controls.
5. Availability (queue, DB, SSE, provider quotas).

## Trust boundaries

- Browser → Fastify: untrusted input.
- Fastify → user-supplied upstream: untrusted destination and untrusted response body.
- Vendor ModelTrace files: trusted code pinned by commit + MIT license.
- SQLite: trusted local storage on the host/volume.

## Primary threats and mitigations

### API key disclosure

- Not stored in SQLite; only a masked value is written.
- Not included in SSE, list/detail API, or application logs.
- Upstream error bodies are sanitized for `sk-*` tokens, `Authorization`, and `apiKey` patterns.
- Key is cleared from the job object in `finally`.
- Caveat: it exists in server memory and in a process crash dump. Disable core dumps and run as non-root in production.

### SSRF / server used as a proxy

- Only `http`/`https`; production ports 80/443; no userinfo, query, hash, relative path, or redirects.
- URL is normalized and the host is resolved before enqueue.
- all A/AAAA addresses must be public (unicast). Loopback, private, link-local, CGNAT, multicast, reserved, and IPv4-mapped addresses are rejected.
- undici `connect.lookup` re-validates the address at connection time to reduce DNS rebinding.
- Optional `UPSTREAM_ALLOWLIST`.
- The app only appends known OpenAI paths; it cannot be used as a general HTTP proxy.
- Residual risk: network egress firewall is still recommended; a compromised host can bypass application rules.

### Abuse / cost / DoS

- Per-IP create rate, per-IP active jobs, global active jobs, queue cap, SSE per-IP cap.
- 32 KB request body, URL/key/model length caps.
- 300 s total test timeout, 2 MB answer cap, 30 s headers timeout.
- No automatic retries.
- Admin can delete records; retention cleanup hourly.
- Single instance: a determined attacker can still consume the global queue. Add a WAF/reverse-proxy auth or Cloudflare in front for public deployments.

### XSS / prompt injection

- Model output is rendered with `html: false`, image syntax disabled, DOMPurify, KaTeX with `trust: false`.
- Links get `noopener noreferrer`.
- The page never executes model output.
- The prompt asks the model not to use tools, but that is not a security control.
- CSP is set by Helmet; the `/zhishang`-style separate app is not used here.

### Data exposure

- Public records are public by design.
- Original endpoint/key are not stored; group name/pool id are only in schema, not populated by the public API.
- `PUBLIC_LIST_ENABLED=false` hides the list but details remain accessible by ID. If you need fully private records, put the whole site behind reverse-proxy auth and/or add user auth (out of MVP).
- SQLite file may contain full answers, questions, and masked credentials. Protect the volume.

### Supply chain

- Dependencies are pinned by `pnpm-lock.yaml`; review updates.
- ModelTrace is pinned by commit and carries its MIT license.
- Run containers non-root, `no-new-privileges`, read-only root with a writable data volume.
- CI should run `pnpm typecheck`, `pnpm test`, `pnpm build`, and ideally `pnpm e2e`.

## Out of scope

- Full multi-tenant auth, billing, subscriptions.
- Horizontal scaling (SQLite + in-memory SSE/queue is single instance).
- Model identity guarantees; fingerprinting is a closed-set statistical signal.
- Protecting users from their own decisions to submit a valuable key.