# Canon Lock Cloud

A writer's continuity gate for AI-regenerated scenes. Paste a scene: the locks
you wrote do not move. ALLOW / BLOCK / REVIEW, with the exact line quoted.

Built for [Galuxium Nexus V2](https://galuxium-nexus-v2-29411.devpost.com/).

## How it works

1. Define **locks**: facts that must not change (e.g. "Meera's glass stays empty").
2. Paste a scene.
3. Get a verdict: **ALLOW** (nothing broken), **BLOCK** (a lock broke, with the
   exact offending line quoted), or **REVIEW** (the scene mentions a locked
   thing without settling it; you decide).

The matcher is **deterministic**: same locks + same scene = same verdict, every
time. No AI in the verdict path. No guessing. Evidence is quoted
character-for-character with line numbers.

## Status

Working today (day-1 build):

- Next.js app with a landing page and the full checker workflow at `/check`.
- The deterministic matcher in `lib/matcher`, smoke suite green via `npm test`.
- Projects, locks, checks, history, and report export (JSON and Markdown)
  working end to end through API routes, with a seeded demo project.
- A day-1 in-memory store behind a `Store` interface. It keeps data only for
  the life of the server process, and it says so in its own header.

Next, in order:

1. Accounts and sign-in, with per-user project isolation.
2. Postgres persistence (Supabase or Neon) behind the same `Store` interface.
3. Test-mode billing for the Writer and Studio tiers, with plan gates.
4. Hashed API keys and the public `POST /v1/check` endpoint for Studio.
5. Rate limits and the audit log.

## Repository layout

- `app/`: Next.js App Router pages and API routes (landing, `/check`,
  `/api/projects` and friends).
- `lib/matcher/`: the deterministic matching engine, a TypeScript port of
  the PRD rev. 3 reference implementation. Zero dependencies; runs in the
  browser and on the server. Its smoke suite lives in `lib/matcher/test`.
- `lib/store/`: the `Store` interface and the day-1 in-memory implementation.
- `lib/report.ts`: report export as JSON or Markdown.

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev     # http://localhost:3000, checker at /check
npm test        # matcher smoke suite (8 checks)
npm run build   # production build
```

## Tiers

- **Free**: 1 project, 20 checks/day, scene never stored.
- **Writer** ($12/mo): 10 projects, saved lock sets, export, check history.
- **Studio** ($49/mo): API key, 5 seats, audit log. `POST /v1/check` at
  $0.02/check after 1,000 included.

## Privacy

Scene text is never stored by default. The verdict is computed from fixed word
rules: no embeddings, no third-party AI sees your scene. Export or delete
your data at any time.

## Known limits (honest)

- Paraphrase is an ALLOW (the matcher checks the lock's words, not meaning).
- Cross-line breaks are not caught (evidence unit is the line).
- Wrong-owner mentions need explicit found-by phrases.

## License

MIT
