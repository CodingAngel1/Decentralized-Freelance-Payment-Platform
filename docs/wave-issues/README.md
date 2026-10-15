# Wave issue design notes

These 17 documents are **not an unfiled backlog**. Every one of them was
already filed as a GitHub issue, in order — 01 → [#2][i2], 02 → [#3][i3], …
17 → [#18][i18] — and every one has since been implemented (the `Status`
column and the `Filed as` links below show the mapping).

This directory is kept as the **design notes** behind those issues: title,
context, acceptance criteria, files to touch, how to test, and the suggested
complexity (Trivial / Medium / High).

- **Do not file these as new issues** — they already exist.
- The [issue tracker][tracker] is the source of truth for current state. All
  17 issues are still marked *open* there even though the work has landed, so
  check the tracker (not this page) before picking anything up; maintainers
  can close or re-scope them there.
- For what works today, see the "Project status" table in the root
  [`README.md`](../../README.md).

Conventions the original scoping followed (kept for context):

- One contributor, one week or less per issue.
- A concrete, verifiable outcome — no vague "improve X" tasks.
- Nothing that needs a dedicated security audit to merge safely without being
  flagged.

See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for how complexity maps to
scope, and the tracker for open work.

## Index

| # | Design note | Complexity | Area | Filed as | Status |
|---|-------------|-----------|------|----------|--------|
| 01 | [Add authorization tests for the remaining `require_auth` entry points](./01-remaining-auth-tests.md) | Trivial | contracts | [#2][i2] | ✅ implemented |
| 02 | [Show friendly messages for contract errors in the frontend](./02-friendly-contract-error-messages.md) | Trivial | frontend | [#3][i3] | ✅ implemented |
| 03 | [Give the app a shared layout and consistent status badges](./03-shared-layout-and-status-badges.md) | Trivial | frontend | [#4][i4] | ✅ implemented |
| 04 | [Show the transaction hash and an explorer link after each action](./04-show-transaction-hash-and-explorer-link.md) | Trivial | frontend | [#5][i5] | ✅ implemented |
| 05 | [Add a Vitest test for the milestone ScVal encoding](./05-vitest-milestone-scval-test.md) | Trivial | frontend | [#6][i6] | ✅ implemented |
| 06 | [Document the contract event catalogue for indexers and clients](./06-contract-event-catalogue-docs.md) | Trivial | docs | [#7][i7] | ✅ implemented |
| 07 | [Allow editing milestones before an escrow is funded](./07-milestone-editing-before-funding.md) | Medium | contracts | [#8][i8] | ✅ implemented |
| 08 | [Support releasing part of a milestone](./08-partial-milestone-release.md) | Medium | contracts | [#9][i9] | ✅ implemented |
| 09 | [Show a filterable job list on the Dashboard](./09-job-listing-and-filtering.md) | Medium | frontend | [#10][i10] | ✅ implemented |
| 10 | [Fix the milestone ScVal encoding in `POST /api/escrow/build/create`](./10-fix-backend-create-milestone-encoding.md) | Medium | backend | [#11][i11] | ✅ implemented |
| 11 | [Make frontend transaction state handling robust](./11-frontend-transaction-state-handling.md) | Medium | frontend | [#12][i12] | ✅ implemented |
| 12 | [Emit events that an indexer can rebuild job state from](./12-event-emission-for-indexer.md) | Medium | contracts | [#13][i13] | ✅ implemented |
| 13 | [Persist auth nonces in the database instead of memory](./13-persist-auth-nonce-in-database.md) | Medium | backend ⚠️ | [#14][i14] | ✅ implemented |
| 14 | [Multi-arbitrator disputes and a timelock escape hatch](./14-multi-arbitrator-and-dispute-timelock.md) | High | contracts ⚠️ | [#15][i15] | ✅ implemented |
| 15 | [Support payment assets beyond USDC](./15-support-assets-beyond-usdc.md) | High | frontend + backend | [#16][i16] | ✅ implemented |
| 16 | [Implement the backend contract-event indexer](./16-implement-contract-event-indexer.md) | High | backend | [#17][i17] | ✅ implemented |
| 17 | [Add reputation weighting and anti-spam](./17-reputation-weighting-and-anti-spam.md) | High | contracts ⚠️ | [#18][i18] | ✅ implemented |

⚠️ = required a careful security/design review before merge.

"Implemented" reflects the code and the root README's Project status; the
tracker may still show the issue open until a maintainer closes it.

[tracker]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues
[i2]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/2
[i3]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/3
[i4]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/4
[i5]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/5
[i6]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/6
[i7]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/7
[i8]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/8
[i9]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/9
[i10]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/10
[i11]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/11
[i12]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/12
[i13]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/13
[i14]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/14
[i15]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/15
[i16]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/16
[i17]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/17
[i18]: https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/issues/18
