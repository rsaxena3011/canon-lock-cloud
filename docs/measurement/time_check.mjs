import { checkScene } from "/home/hatch/workspace/competitions/c090-galuxium-nexus-v2/canon-lock-cloud/lib/matcher/matcher.ts";
import { readFileSync } from "node:fs";
const scene = readFileSync("/home/hatch/workspace/competitions/c090-galuxium-nexus-v2/measurement/scene.txt", "utf8");
const locks = [
  { name: "Meera's glass", type: "state", must_stay: "empty", found_by: ["glass"], breaks_if: ["full","filled","fill","fills","refilled","brim","brimming","pours","poured"] },
  { name: "Arjun's coat", type: "attribute", must_stay: "blue", found_by: ["coat"], breaks_if: ["red","black","grey","gray","green","brown"] },
];
// cold run
let t0 = performance.now(); const cold = checkScene(scene, locks); const coldMs = performance.now() - t0;
const runs = [];
for (let i = 0; i < 50; i++) { t0 = performance.now(); checkScene(scene, locks); runs.push(performance.now() - t0); }
runs.sort((a, b) => a - b);
const median = runs[Math.floor(runs.length / 2)];
console.log("scene lines:", scene.trim().split("\n").length, "| locks:", locks.length);
console.log("verdict:", cold.verdict, "| banner:", cold.banner);
for (const r of cold.rows) console.log("row:", r.lock, "->", r.result, "| evidence:", JSON.stringify(r.evidence ?? r.lines ?? ""));
console.log("cold run ms:", coldMs.toFixed(2), "| median of 50 ms:", median.toFixed(2), "| max ms:", runs[runs.length-1].toFixed(2));
