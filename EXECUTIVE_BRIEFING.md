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
scene against two locks is 48 comparisons (the count is the product of
lines and locks, so a 300-line chapter against twelve locks is 3,600),
repeated after every regeneration. The pass is usually done by writers
re-reading their own work, where familiarity works against them. The
generic alternative, asking another AI to "check consistency," is
probabilistic, so the same scene can pass one run and fail the next, and it
means sending an unpublished manuscript to a third-party model, an
intellectual-property exposure the writer has to accept. The missing piece
in that loop is a fast, repeatable, private gate between "the AI
regenerated my scene" and "this draft is safe to keep," where ALLOW means
precisely that no configured lock was detected as broken.

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

Each verdict quotes the line that broke or confirmed a lock, with its line
number and with leading and trailing whitespace trimmed, so the writer
sees exactly what to fix. A lock the scene never mentions returns ALLOW
with no quotation; there is nothing to quote.

Around that core, the shipped product wraps the checker in a SaaS
workflow: per-writer accounts with projects, saved lock sets, check
history, report export (JSON and Markdown), a public API (POST /v1/check)
with per-account keys, rate limits, and an audit log, and tiered plans
with a working test-mode checkout.

## Why it is different

Two design decisions set Canon Lock Cloud apart from AI consistency tools.

No AI in the verdict path. A deterministic rules engine reaches every
verdict. The same locks and the same scene always give the same result,
with the deciding line quoted. Nothing in a scene can flatter it, rush it,
or talk it out of a broken lock. Deterministic means reproducible, and
this briefing claims nothing more than that. There is also a cost
consequence: with no model in the check path there is no per-check
inference bill for metered pricing to carry (see Monetization).

No stored scenes. A scene is processed in memory and then it is gone. Check
records keep only the verdict, the banner, and the short quoted evidence
lines, and those lines are deleted with their project. Governance has the
full detail.

The known limits are published in the product, and all four belong in this
briefing. First, paraphrase passes: the matcher checks a lock's words, not
its meaning, so a scene that says the same thing in entirely different words
can return ALLOW. Second, evidence is per line: a break split across two
lines, where neither line alone breaks the lock, is not caught. Third,
ownership needs find-words: if two characters own similar objects, a mention
can attach to the wrong lock unless the lock's find-words name the owner.
Fourth, matching is per line, not per clause: find-words and break-words
are matched on the same line, so two sentences sharing a line can
cross-trigger, and a break word aimed at a different object on that line
can BLOCK this lock. One sentence per line keeps verdicts cleanest.

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
  rate limit per key, and an audit entry for every handled call, including
  refused ones (bad keys, plan-gate refusals, rate-limit rejections).
- One engine: the web checker and the API share the same Store and the
  same matcher, so behaviour does not drift between entry points; billing
  shares the Store.

The matcher itself is stateless and cheap because no model sits in its
path: one check over a 24-line scene against two locks returns in about
half a millisecond, median of 50 timed runs against the shipped matcher.
That figure is a matcher measurement, not a promise about end-to-end
service latency; the service around it is stateful by design (accounts,
history, audit writes). One scaling limit is stated plainly: the per-key
rate limiter currently counts in memory per running instance, so on
serverless hosting separate instances count separately and a cold start
resets the window. Storage already swaps adapters behind one interface
without changes to the application.

## Governance and privacy

Governance is a product feature, not a policy page, and it is where this
product answers the programme's governance and responsible-AI criteria
directly.

- Scenes are never persisted. A scene is transmitted to the hosted
  application, processed in memory, and not retained; "never stored"
  describes retention, not transmission. The only scene text that remains
  after a check is the quoted evidence lines, which are verbatim
  manuscript text (the cap is on the number of lines, not their length);
  they are stored so the writer can see why a verdict was reached, and
  they are deleted when their project is deleted.
- Credentials are hashed at rest. Passwords use scrypt. Session tokens and
  API keys exist only as hashes, so the stored tables hold no plaintext
  credentials.
- Owner isolation. Projects are owner-scoped, and a project the caller does
  not own answers 404, so ids cannot be probed to learn whether a project
  exists. One deliberate exception: the seeded demo project is publicly
  readable so judges can inspect the workflow without an account; it
  holds only the fictional demo manuscript.
- A durable audit trail, with a defined scope. The log covers handled API
  calls and billing events, and keeps routing metadata only (key,
  account, project, verdict, HTTP status, billing event names). It
  deliberately has no foreign keys, so entries survive deletion of what
  they reference; that means the metadata remains, not that the trail is
  tamper-proof. It is not a record of every web check or account action.
  Deleting a project removes its checks and evidence lines; the audit
  trail keeps only that metadata, by design.
- Writer control. Writers can export a report of any check, or delete a
  project with its history, at any time.
- Algorithmic transparency and responsible AI alignment. Fixed rules decide,
  every verdict shows its evidence, the known limits are published in the
  product, and REVIEW hands unsettled cases to a human instead of guessing.
- Subprocessors: hosting on Vercel and database hosting on Neon. No
  third-party model provider receives scene text at any point, because no
  model is called.

## Monetization

Three plans, and the gates below are enforced by the system, not just
described by it:

- Free: 1 project, with the full checker (saved lock sets, check history,
  report export).
- Writer, $12/mo: 10 projects.
- Studio, $49/mo: unlimited projects, API keys, audit log.

Creating a project beyond a plan's limit returns a 403 that names the plan
and the limit. Creating an API key, calling the API, and reading the audit
log each return a 403 for accounts below Studio; a key stops working the
moment its account leaves Studio. The upgrade path follows the work: a
second project needs a paid plan, and API access needs Studio. Studio's
plan price includes 1,000 API checks per billing period; further checks
are priced at $0.02 each. That is the pricing model as designed: today the
audit log is the metering record, and invoicing arrives with the
production payment provider.

Checkout is live in test mode. Upgrades run through server-side checkout
sessions behind a provider seam (lib/billing): a test card on the in-app
checkout page completes the session, the tier upgrades immediately, and
the event is audited. Cancelling a plan returns the account to Free, also
audited. Completion is owner-only, replaying a completed checkout
changes nothing, and completing an older lower-tier checkout never pulls
an account back down. Test mode takes no real charges and stores no card
data. The seam is an integration boundary: a production provider will
also need its signed payment notifications, renewal and reconciliation
handling, which test mode deliberately does not exercise.

## The experience

The interface is one loop: define locks, paste a scene, read the verdict.
With the seeded demo account (demo@canonlock.cloud / canonlock-demo), a
judge can walk the full workflow in minutes: sign in, open the demo
project "The Monsoon Draft", run a check, read the quoted evidence, open
the check history, export a report, and create an API key. Two things to
know in advance. The demo account is shared and already on Studio, so
please do not paste unpublished work into it. And to exercise the upgrade
path, create a fresh free account and upgrade that one through the
test-mode checkout with the test card offered on the checkout page; the
demo account stays on Studio for inspection.

## Validation, stated honestly

Canon Lock Cloud was conceived and built during the Galuxium Nexus V2
hackathon window. It is a working, deployed product, not a validated
business. There are no paying customers, no revenue, and no user metrics to
report, and this briefing invents none. The evidence is engineering
evidence:

- A live deployment judges can use end to end.
- A public repository with an incremental commit history.
- 244 automated tests passing against the shipped code, across the matcher,
  store, auth, Postgres parity, public API, and billing suites. The suites
  live in the repository and run with npm test, so the count is checkable
  rather than merely asserted. The separate real-Postgres integration
  suite runs where a database URL is configured and skips cleanly without
  one; the parity suite runs everywhere.
- A measured cross-check of the core claim: on a 24-line test scene with two
  locks, a careful manual pass (every line compared against every lock,
  written out) reached the same verdict and the same two evidence lines as
  the automated check, which returned its verdict in about half a
  millisecond (median of 50 timed runs). The scene fixtures, the written
  manual pass, and the timing script are published in the repository
  under docs/measurement, so the experiment can be re-run rather than
  taken on trust.
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
