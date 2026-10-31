# Offline SEO reviewer evaluation: privacy and operational gates

The read-only `scripts/seo-reviewer-evaluation.mjs` compares baseline and guarded recommendations against independent adjudications. It does not call Shopify, Google or n8n.

## Accepted input

Use a local JSON array of at most 500 cases, with **exactly** these allowed fields per row:

- `caseId`: opaque study-local ID, 1–80 ASCII letters, digits, underscores or hyphens.
- `baseline`, `guarded`: `change`, `no_change`, or `abstain`.
- `adjudicated`: `change`, `no_change`, or `unknown`.

Unknown fields and duplicate IDs are rejected. The CLI rejects files over 1 MiB. Do not include merchant identifiers, URLs, customer information, search queries, store domains, draft content, tokens or credentials. A valid-looking ID is not proof of anonymization: generate random identifiers without deriving them from merchant data. Keep the case-to-merchant mapping outside the repository and apply a retention policy.

Run `node --test tests/seo-reviewer-evaluation.test.mjs` and `node scripts/seo-reviewer-evaluation.mjs --self-test` before scoring any consented study. Never commit merchant study inputs.

## Decision limits

The tool reports descriptive disagreements, errors, abstentions and paired missing-adjudication bounds. The 30-adjudicated-case flag is a minimum operational threshold, not a power analysis or proof of benefit. An apparent reduction in errors from abstaining is not equivalent to a corrected recommendation. Pre-register reviewer criteria and evaluate actionable coverage, corrections, regressions and labor required to adjudicate each case.

**Release remains blocked** on consented merchant evaluation, verified CI, Shopify installation, Google property verification, n8n licensing and independent review. No automatic publishing, billing, merchant edits or production deployment is authorized.
