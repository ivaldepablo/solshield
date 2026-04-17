# Contributing

SolShield is open to contributions. Keep them tight, keep them auditable.

## Before filing an issue

- Search existing issues first — duplicates dilute the signal.
- For security issues, see [`SECURITY.md`](./SECURITY.md), not the public tracker.
- Include a reproduction: transaction signature, network, commit SHA.

## Before filing a PR

- Small, focused changes land faster than broad refactors. If the change is non-trivial, open an issue first so we can align on approach.
- `pnpm typecheck` and `pnpm lint` must pass before review.
- Prefer a failing test committed first, then the fix in a separate commit.
- No force-pushes on shared branches.

## Commit style

- Lowercase, imperative, terse. `add drainer pattern for <signature>` over `Added drainer pattern for <signature>`.
- One logical change per commit. Squash trivial fixups.
- Reference issues by number when relevant (`fix #42`), but keep the subject line standalone-readable.

## Rule contributions

Detection rules live in `packages/core/rules/`. Every new rule requires:

- A self-contained YAML spec with `id`, `description`, `severity`, and `match` clauses
- At least one positive test — a transaction that *must* trigger
- At least one negative test — a similar-looking transaction that *must not*
- A short prose note explaining the attack the rule catches and, where possible, the on-chain signature where it was first observed

Rules without tests get closed. The whole point of this project is that detections are auditable and regressible.

## AI layer contributions

Prompts and few-shots live in `packages/ai/prompts/`. Changes to classifier behavior must include:

- The before/after eval score on the bundled threat corpus
- A sample of the transactions whose verdict changed
- A note if the change increases token cost materially

## Code style

- Prettier runs on commit. No manual formatting fights.
- TypeScript strict mode. `any` requires a justifying comment.
- Exported APIs need JSDoc; internal helpers generally do not.
- Prefer pure functions. Reach for classes only when state or lifecycle demand it.

## License

By submitting a contribution, you agree it will be licensed under Apache 2.0.
