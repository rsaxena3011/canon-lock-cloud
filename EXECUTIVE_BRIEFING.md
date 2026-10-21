# Canon Lock Cloud: Executive Briefing

Prepared for: Galuxium Nexus V2 (Devpost)
Live deployment: https://canon-lock-cloud.vercel.app
Repository: https://github.com/rsaxena3011/canon-lock-cloud
Demo account: demo@canonlock.cloud / canonlock-demo (also printed on the landing page)

## Summary

Canon Lock Cloud checks AI-regenerated scenes against the facts a writer has
locked. It returns ALLOW, BLOCK, or REVIEW with the deciding line quoted. The
verdict is deterministic, reached by rules rather than a model, and the scene
itself is never stored.

## The market friction

Writers increasingly draft with AI, and AI drafting has one specific, costly
failure mode: regeneration amnesia. A scene is regenerated to fix dialogue or
pacing, and the model silently rewrites facts the story has already
established. The glass that must stay empty is filled. The blue coat turns
red. A character's injury heals between paragraphs. Each change is small and
plausible, and it slips past the person who asked for the rewrite, because
they are reading for the thing they asked to fix.

The cost lands later, and it is measurable in workload. Checking one short
scene by hand means comparing every line against every lock: a 24-line test
scene against two locks is 48 comparisons, and the count scales linearly (a
300-line chapter against twelve locks is 3,600 comparisons), repeated after
every regeneration. The pass is usually done by writers re-reading their own
work, and the author is the reader least able to spot the drift. The generic
alternative, asking another AI to "check consistency," is probabilistic, so
the same scene can pass one run and fail the next, and it means sending an
unpublished manuscript to a third-party model, an intellectual-property risk
many writers will not take. The exact pain point: nothing provides a fast,
repeatable, private gate between "the AI regenerated my scene" and "this
draft is safe to keep," where ALLOW means precisely that no configured lock
was detected as broken.

## Target cohort

Writers who already draft with AI and keep canon across long works: fiction
writers first, and the studios and serial-fiction teams who employ the same
workflow at larger lock counts. The builder is a member of this cohort: a
video production head who drafts with AI and maintains locked canon across
long-form productions, and who built this gate for a workflow he uses
himself. The plans meet the cohort at three sizes: a writer trying the gate
on one project, a working writer running several, and a studio that wants
checks through an API with an audit trail.

## The product

The writer defines locks: named facts that must not change. Each lock has
three parts: the word or phrase that must stay true ("empty"), the words
that find the fact in a scene ("glass"), and the words that would break it
("full", "filled", "brim"). Paste a regenerated scene and one of three
verdicts comes back:

- ALLOW: no lock was found broken.
- BLOCK: a lock broke.
- REVIEW: the scene mentions a locked thing without settling it, so a human
  decides. REVIEW is a first-class verdict, not an error state; it is the
  product's way of refusing to guess.

Each verdict quotes the line that broke or confirmed a lock, word for word
and with its line number, so the writer sees exactly what to fix.

Around that core, the shipped product is a complete SaaS workflow: per-writer
accounts with projects, saved lock sets, check history, report export (JSON
and Markdown), a public API (POST /v1/check) with per-account keys, rate
limits, and an audit log, and tiered plans with a working test-mode checkout.

## Why it is different

Two design decisions set Canon Lock Cloud apart from AI consistency tools.

No AI in the verdict path. A deterministic rules engine reaches every
verdict. The same locks and the same scene always give the same result, with
evidence quoted character for character. Nothing in a scene can flatter it,
rush it, or talk it out of a broken lock. There is also a cost consequence:
with no model in the check path there is no per-check inference bill, which
is what makes flat tiers and metered API pricing workable (see
Monetization).

No stored scenes. A scene is processed in memory and then it is gone. Check
records keep only the verdict, the banner, and the short quoted evidence
lines, and those lines are deleted with their project. Governance has the
full detail.

The known limits are published in the product, and all three belong in this
briefing. First, paraphrase passes: the matcher checks a lock's words, not
its meaning, so a scene that says the same thing in entirely different words
can return ALLOW. Second, evidence is per line: a break split across two
lines, where neither line alone breaks the lock, is not caught. Third,
ownership needs find-words: if two characters own similar objects, a mention
can attach to the wrong lock unless the lock's find-words name the owner.

## Architecture

Every check follows one path. A scene arrives through the web checker or the
public API, the matcher evaluates it in memory against the writer's locks,
and a verdict, a banner, and quoted evidence lines come back. Nothing else
from the scene is kept, and no model is called.

- Application: Next.js 15 (App Router, TypeScript), deployed on Vercel.
- Persistence: one asynchronous Store interface with two adapters, in-memory
  for zero-setup development and Postgres (Neon in production) selected by
  DATABASE_URL, with an idempotent schema applied on boot (npm run
  db:migrate applies the same schema explicitly).
- Data model: seven tables (users, sessions, projects, checks, api_keys,
  audit_log, billing_sessions). There is no scene field anywhere in the
  schema.
- Public API: per-account keys stored only as SHA-256 hashes, a fixed-window
  rate limit per key, and an audit entry for every call.
- One engine: the same Store and the same matcher back the web checker, the
  API, and billing, so behaviour does not drift between entry points.

Two properties help at scale: checks are stateless and cheap because no
model sits in the path (one check over a 24-line scene against two locks
returns in about half a millisecond, median of 50 timed runs against the
shipped matcher), and storage already swaps adapters behind one interface
without changes to the application.

## Governance and privacy

Governance is a product feature, not a policy page, and it is where this
product answers the programme's governance and responsible-AI criteria
directly.

- Scenes are never persisted. The only scene text that remains after a check
  is the short quoted evidence lines, which are word-for-word manuscript
  text; they are stored so the writer can see why a verdict was reached, and
  they are deleted when their project is deleted.
- Credentials are hashed at rest. Passwords use scrypt. Session tokens and
  API keys exist only as hashes, so the stored tables hold no plaintext
  credentials.
- Owner isolation. Projects are owner-scoped, and a project the caller does
  not own answers 404, so ids cannot be probed to learn whether a project
  exists.
- A durable audit trail. The log keeps routing metadata only (key, account,
  project, verdict, HTTP status, billing event names) and deliberately has
  no foreign keys, so the trail survives deletion of what it references.
  Deleting a project removes its checks and evidence lines; the audit trail
  keeps only that metadata, by design.
- Writer control. Writers can export a report of any check, or delete a
  project with its history, at any time.
- Algorithmic transparency and responsible AI alignment. Fixed rules decide,
  every verdict shows its evidence, the known limits are published in the
  product, and REVIEW hands unsettled cases to a human instead of guessing.
- Subprocessors: hosting on Vercel and database hosting on Neon. No
  third-party model provider receives scene text at any point, because no
  model is called.

## Monetization

Three plans, enforced by the system rather than described by it:

- Free: 1 project.
- Writer, $12/mo: 10 projects, saved lock sets, history, export.
- Studio, $49/mo: unlimited projects, API keys, audit log.

Creating a project beyond a plan's limit returns a 403 that names the plan
and the limit. The upgrade path follows the work: a second project needs a
paid plan, and API access needs Studio. Studio's plan price includes 1,000
API checks per billing period; further checks are priced at $0.02 each. That
is the pricing model as designed: today the audit log is the metering
record, and invoicing arrives with the production payment provider.

Checkout is live in test mode. Upgrades run through server-side checkout
sessions behind a provider seam (lib/billing): a test card on the in-app
checkout page completes the session, the tier upgrades immediately, and the
event is audited. Cancelling a plan returns the account to Free, also
audited. Completion is idempotent and owner-only, so a replayed success URL
changes nothing. Test mode takes no real charges and stores no card data.
The seam is designed so a production payment provider drops in without
changes to routes or pages.

## The experience

The interface is one loop: define locks, paste a scene, read the verdict.
With the seeded demo account (demo@canonlock.cloud / canonlock-demo), a
judge can walk the full workflow in minutes: sign in, open the demo project
"The Monsoon Draft", run a check, read the quoted evidence, open the check
history, export a report, and create an API key. One trap to know in
advance: the demo account is already on Studio, so to exercise the upgrade
path, cancel the plan first (which returns the account to Free), then
upgrade through the test-mode checkout with the test card offered on the
checkout page.

## Validation, stated honestly

Canon Lock Cloud was conceived and built during the Galuxium Nexus V2
hackathon window. It is a working, deployed product, not a validated
business. There are no paying customers, no revenue, and no user metrics to
report, and this briefing invents none. The evidence is engineering
evidence:

- A live deployment judges can use end to end.
- A public repository with an incremental commit history.
- 232 automated tests passing against the shipped code, across the matcher,
  store, auth, Postgres parity, public API, and billing suites. The suites
  live in the repository and run with npm test, so the count is checkable
  rather than merely asserted.
- A measured cross-check of the core claim: on a 24-line test scene with two
  locks, a careful manual pass (every line compared against every lock,
  written out) reached the same verdict and the same two evidence lines as
  the automated check, which returned its verdict in about half a
  millisecond (median of 50 timed runs).
- The seeded demo account described above.

## Roadmap

Near term: replace the test billing provider with a production provider
behind the existing seam, turn audit-log metering into overage invoicing,
and add Studio team seats. Product: lock templates per genre, batch scene
checks through the API, and an advisory paraphrase signal that flags
suspected reworded breaks for human review and never overrides the
deterministic verdict. Longer term: shared workspaces for writing teams and
per-genre lock libraries, so a studio's canon survives staff changes the way
a single writer's canon survives regeneration.

## Submission package

The programme's six mandatory deliverables, and where to find each:

- Live deployment: https://canon-lock-cloud.vercel.app
- Public repository: https://github.com/rsaxena3011/canon-lock-cloud
- Working MVP: the live deployment, end to end
- Executive briefing: this document
- Monetization engine: the test-mode checkout described under Monetization
- Product demo: a screencast of the live product, linked from the Devpost
  submission
