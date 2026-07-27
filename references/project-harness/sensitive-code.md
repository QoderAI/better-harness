# Sensitive Code

## Purpose

Sensitive Code defines code and diff patterns that require elevated review. It is not a secret scanner and must not contain real secrets.

Use this rule when a change may affect confidentiality, integrity, availability, identity boundaries, execution boundaries, production safety, or security evidence.

Sensitive code changes must trigger stricter AI review or human review.

## Trigger Categories

### 1. Plaintext Sensitive Information

Trigger when a diff adds, modifies, moves, logs, or exposes:

- API keys, tokens, private keys, passwords, certificates
- `.env`, config secrets, credentials, connection strings
- real accounts, internal URLs, production endpoints
- service credentials or cloud/provider credentials

Escalate to: `secrets-and-credentials-review`

### 2. Credential Handling Code

Trigger when code reads, caches, refreshes, forwards, serializes, prints, stores, rotates, or deletes secrets.

Examples:

- `process.env`
- secret manager clients
- token refresh logic
- credential cache
- secret masking / redaction
- logs containing auth headers or tokens

Required evidence:

- file and line
- secret source
- secret sink
- masking/rotation behavior
- command or test used to verify no leakage

### 3. Identity and Permission Boundaries

Trigger when code changes:

- authentication
- authorization
- role / permission checks
- owner/admin checks
- session, cookie, JWT, OAuth, OIDC
- middleware enforcing access control

Escalate to: `auth-boundary-review`

Required evidence:

- protected resource
- actor/user role
- permission check location
- bypass path considered
- negative test or proof

### 4. Sensitive Data Surface

Trigger when code handles:

- PII
- user-generated content
- logs containing user/session data
- export/delete/retention flows
- backup/restore
- analytics or telemetry
- data masking or redaction

Escalate to: `privacy-data-review`

Required evidence:

- data class
- storage location
- retention/delete behavior
- redaction behavior
- affected users or scope

### 5. Execution Boundaries

Trigger when code invokes or modifies:

- shell/process execution
- dynamic code execution
- plugin execution
- agent/tool calls
- filesystem read/write/delete
- network requests
- sandbox permissions or bypass paths
- webhook/callback URLs

Escalate to: `execution-boundary-review`

Required evidence:

- source of input
- execution sink
- allowlist/denylist behavior
- sandbox boundary
- failure mode
- test command

### 6. Cryptography and Signatures

Trigger when code changes:

- encryption/decryption
- signing/verification
- JWT handling
- webhook signature verification
- hashing
- nonce/random generation
- key rotation or key storage

Escalate to: `crypto-signature-review`

Required evidence:

- algorithm/library
- key source
- verification path
- replay/expiry behavior
- backward compatibility impact

### 7. Release and Supply Chain

Trigger when code changes:

- CI/CD workflows
- release scripts
- install scripts
- dependency update paths
- package manager scripts
- Docker/build files
- generated artifacts
- provenance/signing/attestation
- GitHub Actions permissions or secrets

Escalate to: `supply-chain-release-review`

Required evidence:

- workflow entrypoint
- token permissions
- secret access
- third-party actions/dependencies
- artifact produced
- release path affected

### 8. Destructive or Production-Affecting Operations

Trigger when code can:

- delete data
- run migrations
- perform bulk updates
- change production flags
- elevate privileges
- disable safety checks
- modify backups or restore paths
- change admin-only operations

Escalate to: `destructive-change-review`

Required evidence:

- affected data/resource
- blast radius
- rollback plan
- dry-run/staging result
- approval requirement
- monitoring or alerting evidence

## Review Escalation Rules

A change is sensitive if any of the following is true:

1. It touches a known sensitive path.
2. It introduces a sensitive keyword or sink.
3. It changes a trust boundary.
4. It changes credential, auth, data, execution, crypto, CI/CD, or destructive behavior.
5. It weakens validation, authorization, logging redaction, sandboxing, or review requirements.
6. It adds generated, obfuscated, minified, vendored, or binary content to a release path.
7. It changes code that controls production behavior.

## Required Output

For every sensitive-code finding, the reviewer must output:

- category
- severity
- trigger reason
- file and line
- diff evidence
- affected boundary or asset
- required follow-up skill/reviewer
- command/test/evidence required before merge
- whether human review is mandatory

## Non-Goals

This file does not:

- store actual secrets
- replace gitleaks, trufflehog, GitHub secret scanning, or SAST
- prove exploitability by itself
- automatically approve security-sensitive changes

It classifies sensitive changes and routes them to stricter review.
