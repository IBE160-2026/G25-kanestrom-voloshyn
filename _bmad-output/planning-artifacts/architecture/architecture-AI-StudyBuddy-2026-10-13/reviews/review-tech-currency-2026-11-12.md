---
title: 'Tech-currency review: frontend test-runner amendment'
reviewed: ARCHITECTURE-SPINE.md (uncommitted diff, updated 2026-11-12)
lens: technology currency / reality check
date: '2026-11-12'
verdict: pass with minor findings
---

# Tech-currency review: frontend test-runner amendment

## Scope

Only the amended lines: the Stack rows for Vitest, `@testing-library/react` (+ `@testing-library/dom`), jsdom; the new sentence in the Tests convention row; the rewritten Deferred bullet. Checked against the rest of the Stack (React 19.3, Vite 8.3, Node ≥ 22.22), `frontend/package.json`, `frontend/vite.config.js`, and `Dockerfile`.

## Evidence (npm registry, queried 2026-11-12)

| Package | Spine | npm `latest` | Released | engines | Relevant peers |
|---|---|---|---|---|---|
| vitest | 5.1 | 5.1.0 | 2026-11-02 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | `vite: ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0`, `jsdom: *` (optional) |
| @testing-library/react | 16.3 | 16.3.3 | 2026-08-27 | `>=18` | `react`/`react-dom ^18 \|\| ^19`, `@testing-library/dom ^10.0.0` (required) |
| @testing-library/dom | 10.4 | 10.4.2 | 2026-09-13 | `>=18` | none |
| jsdom | 31.0 | 31.0.0 | 2026-11-05 | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | `@napi-rs/canvas` (optional) |

Project: `react ^19.3.1`, `vite ^8.3.6`, `engines.node ">=22.22"`; local Node is 24.19.0; `Dockerfile` frontend stage uses `node:24`.

## What checks out

- Every version in the amended rows is the current npm `latest`; all were confirmed against the registry, not asserted from memory.
- Vitest 5.1 declares Vite 8 as a supported peer, so it fits Vite 8.3. Its Node range covers the spine's Node floor.
- `@testing-library/react` 16.3 supports React 19 and needs `@testing-library/dom` ^10 as a **required** peer. Naming `@testing-library/dom` 10.4 explicitly is correct, since RTL 16 no longer installs it.
- The jsdom Node constraint in the row (`^22.22.2, ^24.15 or ≥ 26`) is transcribed exactly from jsdom 31.0.0's `engines`.
- "configured in `vite.config.js`" fits the existing project: the file exists, and Vitest reads a `test` block from it.
- Deferred bullet: the change is accurate and narrow. CI stays deferred.

## Findings

### F1 (medium): The project's Node floor is looser than jsdom 31 allows

`frontend/package.json` has `"node": ">=22.22"`, and the spine's Node row says "≥ 22.22; 24 or 26 LTS". jsdom 31 needs `^22.22.2 || ^24.15.0 || >=26`. So Node 22.22.0/22.22.1, 24.0–24.14 and the odd-numbered lines 23 and 25 all pass the project's `engines` but fail jsdom's. The amendment notes this in the row label but does not reconcile it with the Node row or `engines`. The local Node (24.19) and `node:24` in Docker (a floating tag, currently ≥ 24.15) satisfy it today, so nothing is broken now.
**Proposed:** when the story installs jsdom, tighten `engines.node` to `^22.22.2 || ^24.15.0 || >=26` (or lower jsdom to 30.1, see F2), and align the spine's Node row so the parenthetical is not a second, conflicting source of truth.

### F2 (medium): jsdom 31.0 is a 7-day-old major release

jsdom 31.0.0 came out on 2026-11-05. Vitest declares `jsdom: *` as its peer, so nothing in the registry shows that Vitest 5.1 has been tested with jsdom 31. Neither release notes nor compatibility reports were checked as part of this amendment. jsdom 30.1.3 (2026-10-15) is the mature alternative. Picking the newest major is defensible on a greenfield project, but the risk should be a conscious choice.
**Proposed:** keep 31.0 only if the first install plus a smoke test (`render` + a `screen` query under `environment: 'jsdom'`) passes on Node 22.22.2 and 24. Otherwise pin 30.1 and record that in the memlog.

### F3 (low): Vitest 5.1 is also only 10 days old

Vitest 5.1.0 came out on 2026-11-02. It is a minor release on top of 5.0.x (5.0.5, 2026-10-15), so the risk is lower than F2. Pin with `^5.1.0` and let the lockfile hold the resolved version.

### F4 (low): The config hint leaves out the import detail

With Vite 8, a `test` block in `vite.config.js` needs either `defineConfig` from `vitest/config` or a `/// <reference types="vitest/config" />` line. Plain JS still runs without it, but editors won't type-check the block. This was not checked against the Vitest 5 docs. It is an implementation note for the story, not a spine change.

### F5 (info): `npm test` does not exist yet

The convention says `npm test` in `frontend/`. `package.json` has no `test` script yet, so the story must add `"test": "vitest"` (or `vitest run` for CI). This is expected for a forward-looking convention.

## Verdict

**Pass with minor findings.** All named technologies exist, are current, and are mutually compatible with React 19.3 and Vite 8.3, all confirmed against the live npm registry. The real gaps are the Node-floor mismatch (F1) and the unproven jsdom 31 + Vitest 5.1 pairing (F2). Both should be settled during the first frontend-test story. Neither blocks the amendment.
