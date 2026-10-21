import Link from "next/link";

export default function HomePage() {
  return (
    <div className="wrap">
      <section className="hero">
        <h1>Your story bible, enforced.</h1>
        <p>
          AI tools regenerate scenes fast, and just as fast they quietly undo
          the facts you settled chapters ago. Canon Lock Cloud checks every
          regenerated scene against the locks you wrote and returns a
          deterministic verdict: ALLOW, BLOCK, or REVIEW, with the exact line
          quoted as evidence.
        </p>
        <div className="cta-row">
          <Link href="/check" className="btn btn-primary">
            Run a check
          </Link>
          <Link href="#how" className="btn btn-ghost">
            How it works
          </Link>
        </div>
      </section>

      <section className="block" id="accounts">
        <h2>Accounts are live</h2>
        <p className="lede">
          Sign up at the checker and your projects, locks, and check
          history belong to your account alone: no one else can read or
          change them. The demo project stays public: readable by
          everyone, changeable only by its owner.
        </p>
        <p>
          Judges and reviewers: sign in with the demo account{" "}
          <strong>demo@canonlock.cloud</strong> (password{" "}
          <strong>canonlock-demo</strong>) to run checks on The Monsoon
          Draft, or create an account of your own.
        </p>
      </section>

      <section className="block" id="how">
        <h2>How it works</h2>
        <p className="lede">
          Three steps, no setup ritual. The same locks and the same scene
          always produce the same verdict.
        </p>
        <div className="cards">
          <div className="card">
            <h3>1. Define locks</h3>
            <p>
              A lock is a fact that must not change: the glass stays empty,
              the coat stays blue, the letter was never sent. Each lock names
              the words that find it and the words that would break it.
            </p>
          </div>
          <div className="card">
            <h3>2. Paste the scene</h3>
            <p>
              Drop in the regenerated draft, a rewrite, or a fresh generation.
              The scene is processed in memory and is never stored by default.
            </p>
          </div>
          <div className="card">
            <h3>3. Read the verdict</h3>
            <p>
              Every lock is reported as Holds, Broken, or Not settled, with
              the offending or confirming line quoted word for word, line
              number included.
            </p>
          </div>
        </div>
      </section>

      <section className="block" id="verdicts">
        <h2>Three verdicts, no vibes</h2>
        <p className="lede">
          The matcher is a deterministic rules engine, not a language model.
          It cannot be flattered, rushed, or talked out of a broken lock.
        </p>
        <div className="cards">
          <div className="card">
            <span className="chip chip-allow">ALLOW</span>
            <p>
              No lock is broken. Locks the scene confirms are marked Holds,
              and locks it never touches are reported honestly as not
              mentioned.
            </p>
          </div>
          <div className="card">
            <span className="chip chip-block">BLOCK</span>
            <p>
              At least one lock broke. The banner names the broken locks and
              the evidence quotes the exact lines that broke them, so the fix
              takes seconds, not a re-read.
            </p>
          </div>
          <div className="card">
            <span className="chip chip-review">REVIEW</span>
            <p>
              The scene mentions a locked thing without settling it. Canon
              Lock will not guess: the call is yours, and the quoted line
              shows exactly what is unsettled.
            </p>
          </div>
        </div>
      </section>

      <section className="block" id="governance">
        <h2>Built for writers who keep secrets</h2>
        <p className="lede">
          Unpublished manuscripts are crown jewels. The governance rules are
          part of the product, not a footnote.
        </p>
        <div className="cards">
          <div className="card">
            <h3>Scenes are not stored</h3>
            <p>
              Scene text is processed in memory and never written to a log.
              We keep only the verdict and the short quoted evidence lines it
              produced, so your history stays useful without keeping your
              draft.
            </p>
          </div>
          <div className="card">
            <h3>No AI in the verdict path</h3>
            <p>
              No embeddings, no third-party models, no training on your text.
              Fixed word rules produce the verdict, and the same input always
              produces the same output.
            </p>
          </div>
          <div className="card">
            <h3>Your data, your call</h3>
            <p>
              Export a report of any check as JSON or Markdown. Delete a
              project and its history goes with it. No dark patterns, no
              retention games.
            </p>
          </div>
        </div>
      </section>

      <section className="block" id="limits">
        <h2>Known limits, stated plainly</h2>
        <p className="lede">
          A checker that hides its blind spots is worse than no checker. These
          are ours.
        </p>
        <div className="cards">
          <div className="card">
            <h3>Paraphrase passes</h3>
            <p>
              The matcher checks the lock&apos;s words, not its meaning. A
              scene that says the same thing in entirely different words can
              return ALLOW. Locks work best with distinctive wording.
            </p>
          </div>
          <div className="card">
            <h3>Evidence is per line</h3>
            <p>
              A break split across two lines, where neither line alone breaks
              the lock, is not caught. The evidence unit is the line, by
              design, so quotes stay exact.
            </p>
          </div>
          <div className="card">
            <h3>Ownership needs find-words</h3>
            <p>
              If two characters own similar objects, a mention can attach to
              the wrong lock unless the lock&apos;s find-words are specific.
              Name the owner in the find-words to keep rows clean.
            </p>
          </div>
        </div>
      </section>

      <section className="block" id="pricing">
        <h2>Pricing</h2>
        <p className="lede">
          Start free. Upgrade when the manuscript, or the team, gets serious.
        </p>
        <div className="cards">
          <div className="card">
            <h3>Free</h3>
            <p className="price">
              $0<small> / month</small>
            </p>
            <ul>
              <li>1 project</li>
              <li>20 checks per day</li>
              <li>Scene text never stored</li>
              <li>Full verdict evidence</li>
            </ul>
          </div>
          <div className="card featured">
            <h3>Writer</h3>
            <p className="price">
              $12<small> / month</small>
            </p>
            <ul>
              <li>10 projects</li>
              <li>Saved lock sets</li>
              <li>Check history and report export</li>
              <li>Priority support</li>
            </ul>
          </div>
          <div className="card">
            <h3>Studio</h3>
            <p className="price">
              $49<small> / month</small>
            </p>
            <ul>
              <li>Everything in Writer</li>
              <li>5 seats</li>
              <li>API access with your own key</li>
              <li>Audit log</li>
            </ul>
          </div>
        </div>
        <p className="fineprint">
          Prices in USD. The Free checker is live now; paid tiers open as
          billing rolls out. API usage beyond the Studio allowance is billed
          per check.
        </p>
      </section>
    </div>
  );
}
