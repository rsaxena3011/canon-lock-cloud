/**
 * Canon Lock matcher: TypeScript port of the rev. 3 reference implementation
 * (verify-v3.py). Implements PRD rev. 3 section 7 (normative) exactly.
 *
 * Deterministic: same locks + same scene always produce the same verdict.
 * No AI, no network, no guessing. Evidence is quoted character-for-character.
 */

export interface Lock {
  name: string;
  type: "state" | "attribute";
  must_stay: string;
  found_by: string[];
  breaks_if: string[];
}

export type LineLabel = "BREAKS" | "CONFIRMS" | "UNSETTLED" | "MENTIONS";
export type LockResult = "BROKEN" | "UNDECIDED" | "HOLDS" | "NOT MENTIONED";
export type Verdict = "BLOCK" | "REVIEW" | "ALLOW";

export interface CheckRow {
  name: string;
  result: LockResult;
  evidence: string[];
  rowLabel: string;
}

export interface CheckResult {
  verdict: Verdict;
  banner: string;
  lines: string[];
  rows: CheckRow[];
}

// ---------------- 7.2 normalization ----------------

function normalize(s: string): string {
  s = s.normalize("NFC");
  s = s.replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019\u02BC\u201B]/g, "'");
  s = s.toLowerCase();
  // 7.4: n't handled at the character level, before tokenizing.
  s = s.replace(/n't\b/g, " not");
  s = s.replace(/[ \t ]+/g, " ");
  return s;
}

const NO_APOS = new Set([
  "isnt", "arent", "wasnt", "werent", "dont", "doesnt", "didnt",
  "havent", "hasnt", "hadnt", "cant", "couldnt", "wont", "wouldnt",
  "shouldnt", "mustnt", "mightnt", "neednt", "darent", "aint", "cannot",
]);

type Tok = { kind: "w" | "p"; text: string };

function isWordChar(ch: string): boolean {
  // Unicode letter/number/mark categories (mirrors Python unicodedata check)
  return /[\p{L}\p{N}\p{M}]/u.test(ch);
}

function tokenize(normText: string): Tok[] {
  const toks: Tok[] = [];
  let cur = "";
  for (const ch of normText) {
    if (isWordChar(ch)) {
      cur += ch;
    } else {
      if (cur) {
        toks.push({ kind: "w", text: cur });
        cur = "";
      }
      if (ch === " ") continue;
      toks.push({ kind: "p", text: ch });
    }
  }
  if (cur) toks.push({ kind: "w", text: cur });
  return toks;
}

function negatorEndPositions(toks: Tok[]): number[] {
  const ends: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "w") continue;
    if (t.text === "not" || t.text === "never" || NO_APOS.has(t.text)) {
      ends.push(i);
    } else if (
      t.text === "longer" &&
      i > 0 &&
      toks[i - 1].kind === "w" &&
      toks[i - 1].text === "no"
    ) {
      ends.push(i);
    }
  }
  return ends;
}

function phraseWords(phrase: string): string[] {
  return tokenize(normalize(phrase))
    .filter((t) => t.kind === "w")
    .map((t) => t.text);
}

function findMatches(
  toks: Tok[],
  pwords: string[]
): Array<[number, number]> {
  const widx: Array<[number, string]> = [];
  toks.forEach((t, i) => {
    if (t.kind === "w") widx.push([i, t.text]);
  });
  const n = pwords.length;
  const out: Array<[number, number]> = [];
  for (let j = 0; j <= widx.length - n; j++) {
    let ok = true;
    for (let d = 0; d < n; d++) {
      if (widx[j + d][1] !== pwords[d]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push([widx[j][0], widx[j + n - 1][0]]);
  }
  return out;
}

function isNegated(toks: Tok[], startTok: number, negEnds: number[]): boolean {
  // 7.4 attachment: negator ends at most one word-token before the
  // phrase starts, with no punctuation token between.
  for (const e of negEnds) {
    if (e === startTok - 1 || e === startTok - 2) {
      let punctBetween = false;
      for (let k = e + 1; k < startTok; k++) {
        if (toks[k].kind === "p") {
          punctBetween = true;
          break;
        }
      }
      if (!punctBetween) return true;
    }
  }
  return false;
}

// ---------------- 7.3 line labeling ----------------

function labelLine(line: string, lock: Lock): LineLabel | null {
  const toks = tokenize(normalize(line));
  const negEnds = negatorEndPositions(toks);
  const fbHit = lock.found_by.some(
    (p) => findMatches(toks, phraseWords(p)).length > 0
  );
  if (!fbHit) return null;

  const ms: Array<[number, number]> = findMatches(
    toks,
    phraseWords(lock.must_stay)
  );
  const bi: Array<[number, number]> = [];
  for (const p of lock.breaks_if) {
    bi.push(...findMatches(toks, phraseWords(p)));
  }

  const biUnnegated = bi.some(([s]) => !isNegated(toks, s, negEnds));
  const msNegated = ms.some(([s]) => isNegated(toks, s, negEnds));
  if (biUnnegated || msNegated) return "BREAKS";

  const msUnnegated = ms.some(([s]) => !isNegated(toks, s, negEnds));
  if (msUnnegated) return "CONFIRMS";

  const biNegated = bi.some(([s]) => isNegated(toks, s, negEnds));
  if (biNegated) return "UNSETTLED";

  return "MENTIONS";
}

function splitLines(scene: string): string[] {
  return scene.split(/\r\n|[\r\n]/);
}

function capEvidence(ev: string[]): string[] {
  if (ev.length > 3) {
    return [...ev.slice(0, 3), `${ev.length - 3} more`];
  }
  return ev;
}

// ---------------- 7.5 lock result ----------------

function checkLock(
  lines: string[],
  lock: Lock
): { result: LockResult; evidence: string[] } {
  const labels: Array<[number, LineLabel | null]> = lines.map((ln, i) => [
    i,
    labelLine(ln, lock),
  ]);
  const fired = labels.filter(([, l]) => l !== null) as Array<
    [number, LineLabel]
  >;
  if (fired.length === 0) return { result: "NOT MENTIONED", evidence: [] };

  const breaks = fired.filter(([, l]) => l === "BREAKS").map(([i]) => i);
  if (breaks.length > 0) {
    const ev = capEvidence(
      breaks.map((i) => `Line ${i + 1}: ${lines[i].trim()}`)
    );
    return { result: "BROKEN", evidence: ev };
  }

  const unsettled = fired.filter(([, l]) => l === "UNSETTLED").map(([i]) => i);
  const confirms = fired.filter(([, l]) => l === "CONFIRMS").map(([i]) => i);
  if (unsettled.length > 0 || confirms.length === 0) {
    const src =
      unsettled.length > 0
        ? unsettled
        : fired.filter(([, l]) => l === "MENTIONS").map(([i]) => i);
    const ev = capEvidence(src.map((i) => `Line ${i + 1}: ${lines[i].trim()}`));
    return { result: "UNDECIDED", evidence: ev };
  }

  const i = confirms[0];
  return { result: "HOLDS", evidence: [`Line ${i + 1}: ${lines[i].trim()}`] };
}

// ---------------- 7.6 verdict, section 8 copy ----------------

const ROW_LABEL: Record<LockResult, string> = {
  BROKEN: "Broken",
  UNDECIDED: "Not settled, you decide",
  HOLDS: "Holds",
  "NOT MENTIONED": "Not mentioned in this scene",
};

const ROW_ORDER: Record<LockResult, number> = {
  BROKEN: 0,
  UNDECIDED: 1,
  HOLDS: 2,
  "NOT MENTIONED": 3,
};

export function checkScene(scene: string, locks: Lock[]): CheckResult {
  const lines = splitLines(scene);
  const results = locks.map((lk) => checkLock(lines, lk));
  const order = locks
    .map((_, i) => i)
    .sort((a, b) => ROW_ORDER[results[a].result] - ROW_ORDER[results[b].result] || a - b);

  const b = results.filter((r) => r.result === "BROKEN").length;
  const u = results.filter((r) => r.result === "UNDECIDED").length;
  const verdict: Verdict = b > 0 ? "BLOCK" : u > 0 ? "REVIEW" : "ALLOW";

  const namesB = locks
    .filter((_, i) => results[i].result === "BROKEN")
    .map((l) => l.name);
  const namesU = locks
    .filter((_, i) => results[i].result === "UNDECIDED")
    .map((l) => l.name);

  let banner: string;
  if (verdict === "BLOCK") {
    banner =
      b === 1
        ? `BLOCK - 1 lock broken: ${namesB[0]}`
        : `BLOCK - ${b} locks broken: ${namesB.join(", ")}`;
  } else if (verdict === "REVIEW") {
    banner =
      u === 1
        ? "REVIEW - You decide: 1 lock isn't settled by this scene"
        : `REVIEW - You decide: ${u} locks aren't settled by this scene`;
  } else {
    banner =
      locks.length === 1 ? "ALLOW - No lock broken" : "ALLOW - No locks broken";
  }

  return {
    verdict,
    banner,
    lines,
    rows: order.map((i) => ({
      name: locks[i].name,
      result: results[i].result,
      evidence: results[i].evidence,
      rowLabel: ROW_LABEL[results[i].result],
    })),
  };
}
