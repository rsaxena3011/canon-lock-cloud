import type { CheckRow, Lock, Verdict } from "../matcher/matcher";

export interface Project {
  id: string;
  name: string;
  locks: Lock[];
  createdAt: string; // ISO 8601
}

export interface CheckRecord {
  id: string;
  projectId: string;
  createdAt: string; // ISO 8601
  verdict: Verdict;
  banner: string;
  rows: CheckRow[];
  // Governance note: the scene text itself is never stored. A record
  // keeps only the verdict and the quoted evidence lines the matcher
  // produced, which is what the history and export features need.
}

export interface NewCheck {
  verdict: Verdict;
  banner: string;
  rows: CheckRow[];
}

/**
 * Data access for Canon Lock Cloud. All persistence goes through this
 * interface so the storage engine can change (in-memory today, Postgres
 * via Supabase or Neon next) without touching the API routes or the UI.
 */
export interface Store {
  listProjects(): Project[];
  getProject(id: string): Project | undefined;
  createProject(name: string): Project;
  deleteProject(id: string): boolean;
  setLocks(id: string, locks: Lock[]): Project | undefined;
  listChecks(projectId: string): CheckRecord[];
  addCheck(projectId: string, check: NewCheck): CheckRecord | undefined;
}
