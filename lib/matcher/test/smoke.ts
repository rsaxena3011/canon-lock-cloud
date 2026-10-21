import { checkScene } from "../matcher.ts";
import type { Lock } from "../matcher.ts";

const GLASS: Lock = {
  name: "Meera's glass",
  type: "state",
  must_stay: "empty",
  found_by: ["glass"],
  breaks_if: ["full", "filled", "fill", "fills", "refilled", "brim", "brimming", "pours", "poured"],
};

const COAT: Lock = {
  name: "Arjun's coat",
  type: "attribute",
  must_stay: "blue",
  found_by: ["coat"],
  breaks_if: ["red", "black", "grey", "gray", "green", "brown"],
};

const SCENE_A = [
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

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string) {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}`); }
}

// 1. Scene A: glass CONFIRMS (empty), coat CONFIRMS (blue) -> ALLOW
{
  const r = checkScene(SCENE_A, [GLASS, COAT]);
  check(r.verdict === "ALLOW", "scene-a-allow");
  check(r.rows[0].result === "HOLDS" && r.rows[1].result === "HOLDS", "scene-a-both-hold");
}

// 2. Filled glass -> BLOCK
{
  const lines = SCENE_A.split("\n");
  lines[9] = "Meera fills the glass to the brim and sets it down between them.";
  const r = checkScene(lines.join("\n"), [GLASS]);
  check(r.verdict === "BLOCK", "filled-glass-block");
  check(r.rows[0].evidence[0].includes("Line 10"), "filled-glass-evidence-line10");
}

// 3. Grey coat -> BLOCK
{
  const lines = SCENE_A.split("\n");
  lines[4] = "The door opens. ARJUN steps in, his grey coat dark with rain.";
  const r = checkScene(lines.join("\n"), [COAT]);
  check(r.verdict === "BLOCK", "grey-coat-block");
}

// 4. Negation: "isn't empty" -> BREAKS (negated must-stay)
{
  const lines = SCENE_A.split("\n");
  lines[9] = "Meera sets the glass down between them. It isn't empty.";
  const r = checkScene(lines.join("\n"), [GLASS]);
  check(r.verdict === "BLOCK", "negated-must-stay-block");
}

// 5. Mention without settle -> REVIEW
{
  const lines = SCENE_A.split("\n");
  lines[9] = "Meera sets the glass down between them.";
  const r = checkScene(lines.join("\n"), [GLASS]);
  check(r.verdict === "REVIEW", "mention-without-settle-review");
}

// 6. Determinism: 20x identical
{
  let det = true;
  const first = JSON.stringify(checkScene(SCENE_A, [GLASS, COAT]));
  for (let i = 0; i < 20; i++) {
    if (JSON.stringify(checkScene(SCENE_A, [GLASS, COAT])) !== first) { det = false; break; }
  }
  check(det, "determinism-20x");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
