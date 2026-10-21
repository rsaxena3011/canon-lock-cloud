"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lock } from "@/lib/matcher/matcher";
import type {
  CheckRecord,
  Project,
  PublicApiKey,
  PublicUser,
} from "@/lib/store/types";
import { reportToJson, reportToMarkdown } from "@/lib/report";

const SCENE_ALLOW = [
  "INT. MEERA'S KITCHEN - NIGHT",
  "",
  "Rain needles the window. One bulb, swinging.",
  "",
  "The door opens. ARJUN steps in, his blue coat dark with rain.",
  "",
  "                      ARJUN",
  "            You waited up.",
  "",
  "Meera sets the empty glass down between them.",
  "",
  "                      MEERA",
  "            Someone had to.",
].join("\n");

const SCENE_BLOCK = SCENE_ALLOW.replace(
  "Meera sets the empty glass down between them.",
  "Meera fills the glass to the brim and sets it down between them."
);

const SCENE_REVIEW = SCENE_ALLOW.replace(
  "Meera sets the empty glass down between them.",
  "Meera sets the glass down between them."
);

interface LockDraft {
  name: string;
  type: "state" | "attribute";
  must_stay: string;
  found_by: string;
  breaks_if: string;
}

const EMPTY_DRAFT: LockDraft = {
  name: "",
  type: "state",
  must_stay: "",
  found_by: "",
  breaks_if: "",
};

function toDraft(lock: Lock): LockDraft {
  return {
    name: lock.name,
    type: lock.type,
    must_stay: lock.must_stay,
    found_by: lock.found_by.join(", "),
    breaks_if: lock.breaks_if.join(", "),
  };
}

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fromDraft(d: LockDraft): Lock {
  return {
    name: d.name.trim(),
    type: d.type,
    must_stay: d.must_stay.trim(),
    found_by: parseList(d.found_by),
    breaks_if: parseList(d.breaks_if),
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function resultClass(result: string): string {
  if (result === "BROKEN") return "result-BROKEN";
  if (result === "UNDECIDED") return "result-UNDECIDED";
  if (result === "HOLDS") return "result-HOLDS";
  return "result-NOT";
}

export default function CheckPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  // Inline two-step confirm for destructive actions: the first click
  // arms the button ("Click again to confirm"), the second runs it.
  // Native window.confirm dialogs are avoided on purpose: they block
  // automation, screen recording, and any embedded webview.
  const [armed, setArmed] = useState<string | null>(null);
  function armOrRun(id: string, fn: () => void) {
    if (armed === id) {
      setArmed(null);
      fn();
    } else {
      setArmed(id);
      window.setTimeout(
        () => setArmed((a) => (a === id ? null : a)),
        4000,
      );
    }
  }
  const [project, setProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<LockDraft[]>([]);
  const [scene, setScene] = useState(SCENE_ALLOW);
  const [current, setCurrent] = useState<CheckRecord | null>(null);
  const [history, setHistory] = useState<CheckRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [apiKeys, setApiKeys] = useState<PublicApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const loadProject = useCallback(async (id: string) => {
    const data = await api<{ project: Project; checks: CheckRecord[] }>(
      `/api/projects/${id}`
    );
    setProject(data.project);
    setDrafts(data.project.locks.map(toDraft));
    setHistory(data.checks);
    setCurrent(data.checks[0] ?? null);
  }, []);

  const refreshProjects = useCallback(async (selectId?: string) => {
    const data = await api<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects);
    const target = selectId ?? data.projects[0]?.id;
    if (target) {
      await loadProject(target);
    } else {
      setProject(null);
      setDrafts([]);
      setHistory([]);
      setCurrent(null);
    }
  }, [loadProject]);

  useEffect(() => {
    refreshProjects().catch((e: Error) => setError(e.message));
  }, [refreshProjects]);

  useEffect(() => {
    api<{ user: PublicUser | null }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  const loadKeys = useCallback(async () => {
    const data = await api<{ keys: PublicApiKey[] }>("/api/keys");
    setApiKeys(data.keys);
  }, []);

  useEffect(() => {
    if (user) {
      loadKeys().catch(() => setApiKeys([]));
    } else {
      setApiKeys([]);
      setCreatedSecret(null);
    }
  }, [user, loadKeys]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    const res = await run(() =>
      api<{ user: PublicUser }>("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      })
    );
    if (res) {
      setUser(res.user);
      setAuthPassword("");
      await refreshProjects();
      setNotice("Signed in. Your projects are listed below.");
    }
  }

  async function signUpAccount() {
    const res = await run(() =>
      api<{ user: PublicUser }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      })
    );
    if (res) {
      setUser(res.user);
      setAuthPassword("");
      await refreshProjects();
      setNotice("Account created and signed in. Create your first project below.");
    }
  }

  async function signOutAccount() {
    await run(() => api("/api/auth/signout", { method: "POST" }));
    setUser(null);
    await refreshProjects();
    setNotice("Signed out. You are viewing the public demo project again.");
  }

  async function startUpgrade(tier: "Writer" | "Studio") {
    const res = await run(() =>
      api<{ redirectUrl: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ tier }),
      })
    );
    if (res) {
      window.location.href = res.redirectUrl;
    }
  }

  async function cancelPlanUi() {
    const res = await run(() =>
      api<{ user: PublicUser }>("/api/billing/cancel-plan", {
        method: "POST",
      })
    );
    if (res) {
      setUser(res.user);
      setNotice("Plan cancelled. You are on the Free plan now (test mode).");
    }
  }

  // Returning from the test-mode checkout page: report the outcome.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("billing");
    if (outcome === "success") {
      setNotice(
        "Plan upgraded in test mode. No real charge was made; card data was never stored."
      );
    } else if (outcome === "cancelled") {
      setNotice("Checkout cancelled. Your plan did not change.");
    }
  }, []);

  async function createKey() {
    if (newKeyName.trim().length === 0) {
      setError("Give the key a name first");
      return;
    }
    const res = await run(() =>
      api<{ key: PublicApiKey; secret: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName }),
      })
    );
    if (res) {
      setNewKeyName("");
      // The secret is shown exactly once, right here. Only its hash
      // is stored, so it cannot be recovered later.
      setCreatedSecret(res.secret);
      await loadKeys();
    }
  }

  async function revokeKey(key: PublicApiKey) {
    const res = await run(() =>
      api<{ revoked: boolean }>(`/api/keys/${key.id}`, { method: "DELETE" })
    );
    if (res) {
      await loadKeys();
      setNotice(`API key "${key.name}" revoked.`);
    }
  }

  async function createProject() {
    if (newName.trim().length === 0) {
      setError("Give the project a name first");
      return;
    }
    const created = await run(() =>
      api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      })
    );
    if (created) {
      setNewName("");
      await refreshProjects(created.project.id);
      setNotice("Project created. Add locks, save them, then paste a scene.");
    }
  }

  async function deleteProject() {
    if (!project) return;
    const id = project.id;
    const ok = await run(() =>
      api<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" })
    );
    if (ok) {
      setProject(null);
      await refreshProjects();
      setNotice("Project deleted.");
    }
  }

  async function saveLocks() {
    if (!project) return;
    const invalid = drafts.some(
      (d) => d.name.trim().length === 0 || d.must_stay.trim().length === 0
    );
    if (invalid) {
      setError("Every lock needs a name and a must-stay word or phrase.");
      return;
    }
    const saved = await run(() =>
      api<{ project: Project }>(`/api/projects/${project.id}/locks`, {
        method: "PUT",
        body: JSON.stringify({ locks: drafts.map(fromDraft) }),
      })
    );
    if (saved) {
      setProject(saved.project);
      setDrafts(saved.project.locks.map(toDraft));
      setNotice("Locks saved.");
    }
  }

  async function runCheck() {
    if (!project) return;
    const result = await run(() =>
      api<{ check: CheckRecord }>(`/api/projects/${project.id}/checks`, {
        method: "POST",
        body: JSON.stringify({ scene }),
      })
    );
    if (result) {
      setCurrent(result.check);
      setHistory((h) => [result.check, ...h]);
    }
  }

  function updateDraft(index: number, patch: Partial<LockDraft>) {
    setDrafts((ds) => ds.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  // Writes follow ownership: a project can only be changed by the
  // account that owns it. The public demo project is therefore
  // read-only until you sign in with the demo account.
  const readOnly =
    project !== null && (user === null || user.id !== project.ownerId);

  return (
    <div className="wrap" style={{ paddingTop: "2rem" }}>
      <h1 style={{ fontSize: "2rem" }}>Scene checker</h1>
      <p style={{ color: "var(--ink-soft)", maxWidth: "70ch" }}>
        Create a project, define its locks, paste a scene, and get a verdict
        with the exact lines quoted. The demo project below is readable
        without an account; sign in to run checks on it and to keep
        projects of your own.
      </p>

      <div className="privacy-note" style={{ margin: "1.25rem 0" }}>
        <strong>Privacy:</strong> your scene is processed in memory and is
        never stored or logged. We keep only the verdict and the short quoted
        evidence lines it produced, so your history stays useful without
        keeping your draft.
      </div>

      <div className="panel" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>Account</h2>
        {user ? (
          <>
            <div className="row-actions" style={{ alignItems: "center" }}>
              <span>
                Signed in as <strong>{user.email}</strong> (plan:{" "}
                <strong>{user.tier}</strong>). Your projects are yours alone:
                nobody else can read or change them.
              </span>
              <button
                className="action secondary"
                onClick={signOutAccount}
                disabled={busy}
              >
                Sign out
              </button>
            </div>
            <div style={{ marginTop: "0.9rem" }}>
              <span className="chip chip-review">TEST MODE billing</span>
              <span
                style={{
                  color: "var(--ink-soft)",
                  fontSize: "0.94rem",
                  marginLeft: "0.5rem",
                }}
              >
                Upgrades run through a simulated checkout: no real charge,
                no card data stored. Project limits by plan: Free 1,
                Writer 10, Studio unlimited.
              </span>
              <div className="row-actions" style={{ marginTop: "0.6rem" }}>
                {user.tier === "Free" && (
                  <button
                    className="action"
                    onClick={() => startUpgrade("Writer")}
                    disabled={busy}
                  >
                    Upgrade to Writer ($12/mo)
                  </button>
                )}
                {user.tier !== "Studio" && (
                  <button
                    className="action"
                    onClick={() => startUpgrade("Studio")}
                    disabled={busy}
                  >
                    Upgrade to Studio ($49/mo)
                  </button>
                )}
                {user.tier !== "Free" && (
                  <button
                    className="action secondary"
                    onClick={() =>
                      armOrRun("cancel-plan", () => void cancelPlanUi())
                    }
                    disabled={busy}
                  >
                    {armed === "cancel-plan"
                      ? "Click again to confirm cancel"
                      : "Cancel plan (back to Free)"}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row-actions">
              <input
                type="email"
                placeholder="you@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                aria-label="Email"
              />
              <input
                type="password"
                placeholder="Password (8+ characters)"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                aria-label="Password"
              />
              <button className="action" onClick={signIn} disabled={busy}>
                Sign in
              </button>
              <button
                className="action secondary"
                onClick={signUpAccount}
                disabled={busy}
              >
                Create account
              </button>
            </div>
            <p style={{ color: "var(--ink-soft)", fontSize: "0.94rem" }}>
              Judges and reviewers: sign in with the demo account{" "}
              <strong>demo@canonlock.cloud</strong> (password{" "}
              <strong>canonlock-demo</strong>) to run checks on The Monsoon
              Draft, or create an account of your own.
            </p>
          </>
        )}
      </div>

      {user && (
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ marginTop: 0 }}>API keys</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: "0.94rem" }}>
            Keys authenticate the public API endpoint{" "}
            <strong>POST /v1/check</strong> (see the README for the request
            format). A key is shown once, at creation; only its hash is
            stored, so a lost key cannot be recovered, only revoked and
            replaced. Revoking takes effect immediately.
          </p>
          {createdSecret && (
            <div className="privacy-note" style={{ marginBottom: "1rem" }}>
              <strong>Your new API key (shown once, copy it now):</strong>
              <div
                className="evidence"
                style={{ wordBreak: "break-all", marginTop: "0.35rem" }}
              >
                {createdSecret}
              </div>
              <button
                className="mini"
                style={{ marginTop: "0.5rem" }}
                onClick={() => setCreatedSecret(null)}
              >
                I have copied it, hide it
              </button>
            </div>
          )}
          {apiKeys.length === 0 && (
            <p style={{ color: "var(--ink-soft)" }}>No API keys yet.</p>
          )}
          {apiKeys.map((k) => (
            <div className="history-item" key={k.id}>
              <strong>{k.name}</strong>{" "}
              <span className="evidence">{k.prefix}...</span>{" "}
              {k.revoked ? (
                <span className="result-tag result-BROKEN">Revoked</span>
              ) : (
                <span className="result-tag result-HOLDS">Active</span>
              )}
              <div className="meta">
                Created {new Date(k.createdAt).toLocaleString()}
                {" · "}
                {k.lastUsedAt
                  ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}`
                  : "Never used"}
              </div>
              {!k.revoked && (
                <button
                  className="mini"
                  onClick={() =>
                    armOrRun(`revoke-${k.id}`, () => void revokeKey(k))
                  }
                  disabled={busy}
                >
                  {armed === `revoke-${k.id}` ? "Confirm revoke" : "Revoke"}
                </button>
              )}
            </div>
          ))}
          <div className="row-actions" style={{ marginTop: "0.75rem" }}>
            <input
              type="text"
              placeholder="Key name, e.g. CI pipeline"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              aria-label="New API key name"
            />
            <button className="action" onClick={createKey} disabled={busy}>
              Create API key
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      {notice && (
        <div className="privacy-note" style={{ marginBottom: "1rem" }}>
          {notice}
        </div>
      )}

      <div className="checker-grid">
        <div>
          <div className="panel">
            <h2>Project</h2>
            <label className="field" htmlFor="project-select">
              Current project
            </label>
            <select
              id="project-select"
              value={project?.id ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                run(() => loadProject(id));
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {readOnly && project && (
              <p style={{ color: "var(--ink-soft)", fontSize: "0.94rem" }}>
                Read-only: this is the public demo project. Sign in with
                the demo account to run checks on it, or with your own
                account to work on your own projects.
              </p>
            )}

            <label className="field" htmlFor="new-name">
              New project name
            </label>
            <input
              id="new-name"
              type="text"
              value={newName}
              placeholder="e.g. The Glass Archive, book one"
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="row-actions">
              <button
                className="action"
                onClick={createProject}
                disabled={busy || !user}
              >
                Create project
              </button>
              <button
                className="action secondary"
                onClick={() =>
                  armOrRun("delete-project", () => void deleteProject())
                }
                disabled={busy || !project || readOnly}
              >
                {armed === "delete-project"
                  ? "Click again to confirm delete"
                  : "Delete project"}
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Locks</h2>
            <p style={{ color: "var(--ink-soft)", fontSize: "0.94rem" }}>
              A lock names a thing, the word or phrase that must stay true of
              it, the words that find it in a scene, and the words that would
              break it. Separate find and break words with commas. Checks run
              against the saved locks, so save after editing.
            </p>
            {drafts.map((d, i) => (
              <div className="lock-box" key={i}>
                <div className="lock-head">
                  <strong>{d.name || `Lock ${i + 1}`}</strong>
                  <button
                    className="mini"
                    onClick={() =>
                      setDrafts((ds) => ds.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </button>
                </div>
                <label className="field">Name</label>
                <input
                  type="text"
                  value={d.name}
                  placeholder="e.g. Meera's glass"
                  onChange={(e) => updateDraft(i, { name: e.target.value })}
                />
                <label className="field">Type</label>
                <select
                  value={d.type}
                  onChange={(e) =>
                    updateDraft(i, {
                      type: e.target.value as "state" | "attribute",
                    })
                  }
                >
                  <option value="state">state (what is true of it)</option>
                  <option value="attribute">attribute (what it is like)</option>
                </select>
                <label className="field">Must stay</label>
                <input
                  type="text"
                  value={d.must_stay}
                  placeholder="e.g. empty"
                  onChange={(e) =>
                    updateDraft(i, { must_stay: e.target.value })
                  }
                />
                <label className="field">Found by (comma separated)</label>
                <input
                  type="text"
                  value={d.found_by}
                  placeholder="e.g. glass"
                  onChange={(e) =>
                    updateDraft(i, { found_by: e.target.value })
                  }
                />
                <label className="field">Breaks if (comma separated)</label>
                <input
                  type="text"
                  value={d.breaks_if}
                  placeholder="e.g. full, filled, brim"
                  onChange={(e) =>
                    updateDraft(i, { breaks_if: e.target.value })
                  }
                />
              </div>
            ))}
            <div className="row-actions">
              <button
                className="action secondary"
                onClick={() => setDrafts((ds) => [...ds, { ...EMPTY_DRAFT }])}
              >
                Add a lock
              </button>
              <button
                className="action"
                onClick={saveLocks}
                disabled={busy || !project || readOnly}
              >
                Save locks
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Scene</h2>
            <div className="row-actions" style={{ margin: "0 0 0.75rem" }}>
              <button className="mini" onClick={() => setScene(SCENE_ALLOW)}>
                Demo: locks hold (ALLOW)
              </button>
              <button className="mini" onClick={() => setScene(SCENE_BLOCK)}>
                Demo: glass filled (BLOCK)
              </button>
              <button className="mini" onClick={() => setScene(SCENE_REVIEW)}>
                Demo: mention only (REVIEW)
              </button>
            </div>
            <textarea
              className="scene"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              placeholder="Paste the scene here, one line per line."
            />
            <div className="row-actions">
              <button
                className="action"
                onClick={runCheck}
                disabled={
                  busy || !project || readOnly || scene.trim().length === 0
                }
              >
                Run check
              </button>
            </div>
          </div>

          {current && project && (
            <div className="panel">
              <div
                className={`verdict-banner verdict-${current.verdict.toLowerCase()}`}
              >
                {current.banner}
              </div>
              <table className="rows">
                <thead>
                  <tr>
                    <th>Lock</th>
                    <th>Result</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>
                        <span className={`result-tag ${resultClass(r.result)}`}>
                          {r.rowLabel}
                        </span>
                      </td>
                      <td>
                        {r.evidence.length === 0
                          ? "No line quoted"
                          : r.evidence.map((ev, j) => (
                              <div className="evidence" key={j}>
                                {ev}
                              </div>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row-actions">
                <button
                  className="action secondary"
                  onClick={() =>
                    download(
                      "canon-lock-report.json",
                      reportToJson(project, current),
                      "application/json"
                    )
                  }
                >
                  Export report (JSON)
                </button>
                <button
                  className="action secondary"
                  onClick={() =>
                    download(
                      "canon-lock-report.md",
                      reportToMarkdown(project, current),
                      "text/markdown"
                    )
                  }
                >
                  Export report (Markdown)
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <h2>History</h2>
            {history.length === 0 && (
              <p style={{ color: "var(--ink-soft)" }}>
                No checks yet for this project. Run one and it will appear
                here, newest first.
              </p>
            )}
            {history.map((h) => (
              <div
                className="history-item"
                key={h.id}
                onClick={() => setCurrent(h)}
              >
                <span className={`result-tag ${resultClass(
                  h.verdict === "BLOCK"
                    ? "BROKEN"
                    : h.verdict === "REVIEW"
                      ? "UNDECIDED"
                      : "HOLDS"
                )}`}
                >
                  {h.verdict}
                </span>{" "}
                {h.banner}
                <div className="meta">
                  {new Date(h.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
