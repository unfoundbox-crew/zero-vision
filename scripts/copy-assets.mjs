// tsc only emits JS. The local-vlm Python runner is a build asset and must land
// next to its compiled caller so the published dist/ is self-contained.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  ["src/engines/local_vlm_runner.py", "dist/engines/local_vlm_runner.py"],
  ["src/engines/local_vlm_daemon.py", "dist/engines/local_vlm_daemon.py"],
];

for (const [from, to] of assets) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
  console.log(`copied ${from} -> ${to}`);
}
