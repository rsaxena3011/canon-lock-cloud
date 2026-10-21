"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lock } from "@/lib/matcher/matcher";
import type { CheckRecord, Project } from "@/lib/store/types";
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
  const [project, setProject] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<LockDraft[]>([]);
  const [scene, setScene] = useState(SCENE_ALLOW);
  const [current, setCurrent] = useState<CheckRecord | null>(null);
  const [history, setHistory] = useState<CheckRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (!window.confirm(`Delete project "${project.name}" and its history?`)) {
      return;
    }
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

  return (
    <div className="wrap" style={{ paddingTop: "2rem" }}>
      <h1 style={{ fontSize: "2rem" }}>Scene checker</h1>
      <p style={{ color: "var(--ink-soft)", maxWidth: "70ch" }}>
        Create a project, define its locks, paste a scene, and get a verdict
        with the exact lines quoted. A demo project is loaded so you can run
        your first check right away.
      </p>

      <div className="privacy-note" style={{ margin: "1.25rem 0" }}>
        <strong>Privacy:</strong> your scene is processed in memory and is
        never stored or logged. We keep only the verdict and the short quoted
        evidence lines it produced, so your history stays useful without
        keeping your draft.
      </div>

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
              <button className="action" onClick={createProject} disabled={busy}>
                Create project
              </button>
              <button
                className="action secondary"
                onClick={deleteProject}
                disabled={busy || !project}
              >
                Delete project
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
                disabled={busy || !project}
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
                disabled={busy || !project || scene.trim().length === 0}
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
