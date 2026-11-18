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
- All upstream answers and errors also remove the exact submitted key, target URL/host, and common URL/JSON encodings before persistence. This cannot detect arbitrary transformations or unrelated credentials intentionally included by an upstream.
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
- Admission includes pending validation and queued work, with reservations made before asynchronous DNS. Proxy trust defaults off; explicitly configured hop counts require network isolation of the backend.
- SSE also has a global cap, backpressure disconnects, socket timeouts and bounded shutdown. Client summaries avoid repeatedly transferring full answers.
- 32 KB request body, URL/key/model length caps.
- Configurable total test timeout (default 300 s) and UTF-8 answer cap (default 2 MiB), a fixed 512 KiB HTML/SVG preview cap for the drawing mode, and a 30 s headers timeout. Preview extraction requires a complete HTML or SVG root and does not repair generated markup. These hosting limits deliberately differ from the reference implementation; see [drawing behavior](DRAWING.md).
- No automatic retries.
- Admin can delete terminal records; retention runs at completion and hourly, preserving active records.
- Single instance: a determined attacker can still consume the global queue. Add a WAF/reverse-proxy auth or Cloudflare in front for public deployments.

### XSS / prompt injection

- Model output is rendered with `html: false`, image syntax disabled, DOMPurify, KaTeX with `trust: false`.
- Large answers use escaped plain text instead of expensive Markdown/math parsing.
- HTML and standalone SVG drawing answers intentionally execute their own inline CSS/JavaScript through the same dedicated `/api/v1/tests/:id/preview` response. Generated markup is not inserted into the host DOM or sanitized into a static image, so animation scripts and controls remain available. Existing credential redaction still applies before source is stored.
- Both the HTTP CSP and iframe enforce `sandbox allow-scripts` without same-origin privileges. The frame cannot access parent DOM/storage, open popups, navigate the top page or submit forms. CSP blocks external resources/connections, workers and nested frames, while permitting inline code, `data:` / `blob:` images and `data:` fonts. A preview-only wrapper runs before generated code to lock down RTC/WebTransport constructors and replace modal APIs (`alert`, `confirm`, `prompt`, `print`) with no-ops. It does not rewrite the stored source or repair the drawing. The app's normal CSP is unchanged. Preview responses are no-store/no-referrer and SAMEORIGIN framed. Opening the preview URL directly retains the HTTP sandbox.
- The drawing sandbox is a browser boundary, not a code correctness or resource-usage guarantee: scripts can still consume CPU or navigate their own frame. No claim of completely eliminating all possible network activity is made. Previews are mounted only for completed records while their detail is open, and are removed on stop/close. Generated code is never evaluated on the server or injected into the main document; source is escaped text. Preview failures and format problems are not model-quality verdicts.
- Links get `noopener noreferrer`.
- The main app document never executes model output; drawing code runs only in the isolated preview.
- Drawing requests include delivery instructions asking the model not to use tools; the app supplies no tools and performs no model fallback or automatic generation retry. The instruction itself is not a security control over the upstream provider.
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
- CI runs dependency audit, type checking, regression tests, production artifact smoke tests, browser tests, and container build/start/restart checks.

## Out of scope

- Full multi-tenant auth, billing, subscriptions.
- Horizontal scaling (SQLite + in-memory SSE/queue is single instance).
- Model identity guarantees; fingerprinting is a closed-set statistical signal.
- Protecting users from their own decisions to submit a valuable key.
