# `@qoder-ai/harness-ui`

Private Next.js Dashboard for local Better Harness script outputs.

The server reads the current workspace with session analysis and agent asset
inventory. Missing sources stay absent instead of being replaced with demo
metrics.

```bash
npm run harness-ui:dev
npm run harness-ui:test
npm run harness-ui:test:browser
```

## Getting task evidence onto the Dashboard

Preparing a plan never sends anything. Applying one sends the reviewed plan to
the endpoint recorded inside it and stores the returned receipt.

```bash
node scripts/better-harness.mjs upload plan --input task-evidence.json --workspace . --destination http://127.0.0.1:3410/api/upload --organization <id> --out upload-plan.json
```

```bash
node scripts/better-harness.mjs upload apply --plan upload-plan.json
```

The bundled `/api/upload` route validates the plan before storing it, keys each
record by its packet digest so a repeated apply reports `duplicate` instead of
storing a second copy, and the collector projects stored packets into the
Dashboard's upload section.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `BETTER_HARNESS_WORKSPACE` | the repository holding this package | Workspace the collector and upload store read. |
| `BETTER_HARNESS_UPLOADS` | `<workspace>/.better-harness/uploads` | Where accepted evidence records are stored and read. |
| `BETTER_HARNESS_PROVIDERS` | every supported session platform | Comma-separated hosts to analyze. Narrow it for a faster first load. |
| `BETTER_HARNESS_SESSION_LIMIT` | unset (every eligible session) | Bounds analysis with `latest-n`, which the page reports as an incomplete selection. |
| `BETTER_HARNESS_REFRESH_MS` | `30000` | How long a collection is reused before the next request recollects. `0` disables reuse. |
| `BETTER_HARNESS_UPLOAD_ORGANIZATIONS` | unset (any) | Comma-separated organizations the local endpoint accepts. |
