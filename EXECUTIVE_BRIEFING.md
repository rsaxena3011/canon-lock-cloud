# Canon Lock Cloud: Executive Briefing

Status: DRAFT v1, pending review.
Prepared for: Galuxium Nexus V2 (Devpost).
Live deployment: https://canon-lock-cloud.vercel.app
Repository: https://github.com/rsaxena3011/canon-lock-cloud

## The market friction

Writers increasingly draft with AI, and AI drafting has a specific,
expensive failure mode: regeneration amnesia. A scene is regenerated
to fix dialogue or pacing, and the model silently changes facts the
story has already established: the glass that must stay empty is
filled, the blue coat turns red, a character's injury heals between
paragraphs. Each change is small, plausible, and invisible to the
person who asked for the rewrite, because they are reading for the
thing they asked to fix.

The cost lands downstream. Continuity passes are manual, slow, and
usually done by the writer re-reading their own work, which is the
reader least able to spot the drift. The generic alternative, asking
another AI to "check consistency," is probabilistic: the same scene
can pass on one run and fail on the next, and it requires sending an
unpublished manuscript to a third-party model, which for many writers
is an intellectual-property risk they will not take. The exact pain
point: there is no fast, repeatable, private gate between "the AI
regenerated my scene" and "this draft is safe to keep."

## The product

Canon Lock Cloud is that gate. The writer defines locks: named facts
that must not change, each with the word or phrase that must stay true
("empty"), the words that find the fact in a scene ("glass"), and the
words that would break it ("full", "filled", "brim"). They paste a
regenerated scene and get one of three verdicts: ALLOW (no lock
broke), BLOCK (a lock broke), or REVIEW (the scene mentions a locked
thing without settling it, so a human decides). Every verdict quotes
the exact offending or confirming line, with its line number, so the
fix takes seconds.

Around that core, the shipped product is a complete SaaS workflow:
accounts with projects per writer, saved lock sets, check history,
report export (JSON and Markdown), a public API (POST /v1/check) with
per-account keys, rate limits and an audit log, and tiered plans with
a working test-mode checkout.

## Why it is different

Two design decisions separate Canon Lock Cloud from AI consistency
tools.

First, there is no AI in the verdict path. The matcher is a
deterministic rules engine: the same locks and the same scene always
produce the same verdict, with character-for-character quoted
evidence. It cannot be flattered, rushed, or talked out of a broken
lock, and its known limits are stated plainly in the product (it
checks a lock's words, not its meaning, so a full paraphrase passes;
evidence is per line).

Second, scene text is never stored. A scene is processed in memory to
produce a verdict and then it is gone. Check records keep only the
verdict, the banner, and the short quoted evidence lines. There is no
scene field anywhere in the database schema, and the automated test
suites assert that. An unpublished manuscript never becomes a stored
asset on our servers.

## Architecture

A Next.js 15 application (App Router, TypeScript) deployed on Vercel.
All persistence sits behind one asynchronous Store interface with two
adapters: an in-memory adapter for zero-setup development, and a
Postgres adapter (Neon in production) selected by DATABASE_URL, with
an idempotent schema applied on boot. Accounts use scrypt password
hashing and server-side sessions stored as token hashes; projects are
owner-scoped, and a project the caller does not own answers 404 so
ids cannot be probed. The public API authenticates with keys stored
only as SHA-256 hashes, enforces a per-key fixed-window rate limit,
and writes an audit entry for every call. The web checker, the API,
and billing all run against the same Store and the same matcher, so
behaviour is identical in every entry point. Seven tables: users,
sessions, projects, checks, api_keys, audit_log, billing_sessions.

## Governance and privacy

Governance is a product feature, not a policy page. Scene text is
never persisted (above). API keys and session tokens exist at rest
only as hashes; a leaked table yields no usable credentials. The
audit log records routing metadata only (which key, which account,
which project, the verdict, the HTTP status, and billing event names)
and deliberately has no foreign keys, so the trail survives deletion
of what it references. Writers can export a report of any check and
delete a project together with its history at any time.

## Monetization

Three tiers, enforced by the system rather than described by it:
Free (1 project), Writer at $12/mo (10 projects, saved lock sets,
history, export), and Studio at $49/mo (unlimited projects, API keys,
audit log). Project limits are enforced at creation with a 403 that
names the plan and the limit. API usage on Studio is priced at
$0.02 per check after the first 1,000 included checks; today the
audit log is the metering record, and invoicing arrives with the real
payment provider.

Checkout is live in test mode. Upgrades run through server-side
checkout sessions behind a provider seam (lib/billing): an in-app
checkout page with a test card completes the session, the tier
upgrades immediately, and the event is audited; cancelling a plan
returns the account to Free, also audited. Completion is idempotent
and owner-only, so a replayed success URL changes nothing. No real
charges are taken in test mode and no card data is stored; a
production provider (the Polar / Lemon Squeezy / Dodo class) drops
into the same seam without changing routes or pages.

## Validation, stated honestly

Canon Lock Cloud was conceived and built during the Galuxium Nexus
V2 hackathon window. It is a working, deployed product, not a
validated business: there are no paying customers, no revenue, and no
user metrics to report, and this briefing invents none. What exists
as evidence is engineering evidence: a live deployment judges can
use end to end, a public repository with incremental commit history,
and 232 automated checks (matcher, store, auth, Postgres parity,
public API, and billing suites) passing against the shipped code,
plus a seeded demo account (demo@canonlock.cloud) so the full
workflow, including a test-mode plan upgrade, can be exercised in
minutes.

## Roadmap

Near term: replace the test billing provider with a production
provider behind the existing seam; turn audit-log metering into
overage invoicing; add Studio team seats. Product: lock templates
per genre, batch scene checks through the API, and an advisory
paraphrase signal that flags suspected reworded breaks for human
review while never overriding the deterministic verdict.

## Context: Galuxium Nexus V2

This briefing is the executive documentation for the Canon Lock Cloud
submission to Galuxium Nexus V2. The submission package pairs it with
the live deployment, the public repository, the working MVP, the
test-mode monetization engine described above, and a screencast demo
of the live product, addressing the programme's six mandatory
deliverables in kind.
