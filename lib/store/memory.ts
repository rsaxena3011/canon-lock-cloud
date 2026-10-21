import type { Lock } from "../matcher/matcher";
import type { CheckRecord, NewCheck, Project, Store } from "./types";

/**
 * DAY-1 STORE: in-memory implementation of the Store interface.
 *
 * Projects, locks, and check records live in Maps on the server process
 * and are lost on restart. That is deliberate for the first hosted demo:
 * no database credentials exist yet, and none are faked. The next step
 * replaces this class with a Postgres-backed implementation (Supabase or
 * Neon) behind the same interface; nothing else in the app changes.
 *
 * One demo project is seeded so a first-time visitor can run a check
 * immediately. Its locks are the rev. 3 spec examples.
 */

const DEMO_LOCKS: Lock[] = [
  {
    name: "Meera's glass",
    type: "state",
    must_stay: "empty",
    found_by: ["glass"],
    breaks_if: [
      "full",
      "filled",
      "fill",
      "fills",
      "refilled",
      "brim",
      "brimming",
      "pours",
      "poured",
    ],
  },
  {
    name: "Arjun's coat",
    type: "attribute",
    must_stay: "blue",
    found_by: ["coat"],
    breaks_if: ["red", "black", "grey", "gray", "green", "brown"],
  },
];

function cloneLocks(locks: Lock[]): Lock[] {
  return locks.map((l) => ({
    ...l,
    found_by: [...l.found_by],
    breaks_if: [...l.breaks_if],
  }));
}

export class InMemoryStore implements Store {
  private projects = new Map<string, Project>();
  private checks = new Map<string, CheckRecord[]>();

  constructor() {
    const demo: Project = {
      id: crypto.randomUUID(),
      name: "The Monsoon Draft (demo)",
      locks: cloneLocks(DEMO_LOCKS),
      createdAt: new Date().toISOString(),
    };
    this.projects.set(demo.id, demo);
    this.checks.set(demo.id, []);
  }

  listProjects(): Project[] {
    return [...this.projects.values()].map((p) => ({
      ...p,
      locks: cloneLocks(p.locks),
    }));
  }

  getProject(id: string): Project | undefined {
    const p = this.projects.get(id);
    return p ? { ...p, locks: cloneLocks(p.locks) } : undefined;
  }

  createProject(name: string): Project {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      locks: [],
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.checks.set(project.id, []);
    return { ...project, locks: [] };
  }

  deleteProject(id: string): boolean {
    this.checks.delete(id);
    return this.projects.delete(id);
  }

  setLocks(id: string, locks: Lock[]): Project | undefined {
    const p = this.projects.get(id);
    if (!p) return undefined;
    p.locks = cloneLocks(locks);
    return { ...p, locks: cloneLocks(p.locks) };
  }

  listChecks(projectId: string): CheckRecord[] {
    return [...(this.checks.get(projectId) ?? [])].reverse();
  }

  addCheck(projectId: string, check: NewCheck): CheckRecord | undefined {
    if (!this.projects.has(projectId)) return undefined;
    const record: CheckRecord = {
      id: crypto.randomUUID(),
      projectId,
      createdAt: new Date().toISOString(),
      verdict: check.verdict,
      banner: check.banner,
      rows: check.rows.map((r) => ({ ...r, evidence: [...r.evidence] })),
    };
    this.checks.get(projectId)!.push(record);
    return record;
  }
}
