# Canon Lock Cloud

A writer's continuity gate for AI-regenerated scenes. Paste a scene — the locks
you wrote do not move. ALLOW / BLOCK / REVIEW, with the exact line quoted.

Built for [Galuxium Nexus V2](https://galuxium-nexus-v2-29411.devpost.com/).

## How it works

1. Define **locks**: facts that must not change (e.g. "Meera's glass stays empty").
2. Paste a scene.
3. Get a verdict: **ALLOW** (nothing broken), **BLOCK** (a lock broke, with the
   exact offending line quoted), or **REVIEW** (the scene mentions a locked
   thing without settling it — you decide).

The matcher is **deterministic**: same locks + same scene = same verdict, every
time. No AI in the verdict path. No guessing. Evidence is quoted
character-for-character with line numbers.

## Packages

- `packages/matcher` — the deterministic matching engine (TypeScript port of
  the PRD rev. 3 reference implementation). Zero dependencies. Runs in the
  browser and on the server.

## Tiers

- **Free**: 1 project, 20 checks/day, scene never stored.
- **Writer** ($12/mo): 10 projects, saved lock sets, export, check history.
- **Studio** ($49/mo): API key, 5 seats, audit log. `POST /v1/check` at
  $0.02/check after 1,000 included.

## Privacy

Scene text is never stored by default. The verdict is computed from fixed word
rules — no embeddings, no third-party AI sees your scene. Export or delete
your data at any time.

## Known limits (honest)

- Paraphrase is an ALLOW (the matcher checks the lock's words, not meaning).
- Cross-line breaks are not caught (evidence unit is the line).
- Wrong-owner mentions need explicit found-by phrases.

## License

MIT
