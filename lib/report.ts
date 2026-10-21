import type { CheckRecord, Project } from "./store/types";

/**
 * Export a single check as a downloadable report. The report contains
 * the verdict and the quoted evidence lines. It never contains the full
 * scene text, because the scene is not stored (see lib/store/types.ts).
 */

export function reportToJson(project: Project, record: CheckRecord): string {
  return JSON.stringify(
    {
      tool: "Canon Lock Cloud",
      exportedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name },
      check: {
        id: record.id,
        checkedAt: record.createdAt,
        verdict: record.verdict,
        banner: record.banner,
        rows: record.rows.map((r) => ({
          lock: r.name,
          result: r.result,
          label: r.rowLabel,
          evidence: r.evidence,
        })),
      },
      note: "Scene text is not stored by Canon Lock Cloud and is not part of this report.",
    },
    null,
    2
  );
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function reportToMarkdown(
  project: Project,
  record: CheckRecord
): string {
  const lines: string[] = [
    "# Canon Lock check report",
    "",
    `Project: ${project.name}`,
    `Checked at: ${record.createdAt}`,
    `Verdict: **${record.verdict}**`,
    "",
    record.banner,
    "",
    "| Lock | Result | Evidence |",
    "| --- | --- | --- |",
    ...record.rows.map(
      (r) =>
        `| ${cell(r.name)} | ${cell(r.rowLabel)} | ${cell(
          r.evidence.length > 0 ? r.evidence.join("<br>") : "None"
        )} |`
    ),
    "",
    "Scene text is not stored by Canon Lock Cloud and is not part of this report.",
    "",
  ];
  return lines.join("\n");
}
