import { checkScene } from "/home/hatch/workspace/competitions/c090-galuxium-nexus-v2/canon-lock-cloud/lib/matcher/matcher.ts";
import { readFileSync } from "node:fs";
const locks = [
  { name: "Meera's glass", type: "state", must_stay: "empty", found_by: ["glass"], breaks_if: ["full","filled","fill","fills","refilled","brim","brimming","pours","poured"] },
  { name: "Arjun's coat", type: "attribute", must_stay: "blue", found_by: ["coat"], breaks_if: ["red","black","grey","gray","green","brown"] },
];
for (const f of ["scene_allow.txt", "scene.txt", "scene_review.txt"]) {
  const r = checkScene(readFileSync(f, "utf8"), locks);
  console.log(f, "=>", r.verdict, "|", r.banner);
  for (const row of r.rows) console.log("   ", row.lock_name ?? row.name ?? "?", row.result, JSON.stringify(row.evidence ?? ""));
}
