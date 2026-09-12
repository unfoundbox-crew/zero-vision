// Hermetic stand-in for src/engines/local_vlm_runner.py. Speaks the same
// JSON-in/JSON-out contract so local-vlm.ts can be tested without MLX or weights.
// Behaviour is driven by FAKE_RUNNER_MODE:
//   ok (default) | bad-json | error | empty | hang | crash
import { stdin, stdout, env, exit } from "node:process";

let raw = "";
for await (const chunk of stdin) raw += chunk;
const req = JSON.parse(raw || "{}");
const mode = env.FAKE_RUNNER_MODE ?? "ok";

if (mode === "hang") {
  // Outlive the test's ZRV_LOCAL_VLM_TIMEOUT_MS; the engine SIGKILLs us.
  setTimeout(() => {}, 60_000);
} else if (mode === "bad-json") {
  stdout.write("this is not json\n");
} else if (mode === "crash") {
  exit(3);
} else if (mode === "error") {
  stdout.write(JSON.stringify({ ok: false, error: "local_vlm_inference_failed: ValueError: boom" }) + "\n");
} else if (mode === "empty") {
  stdout.write(JSON.stringify({ ok: true, text: "   " }) + "\n");
} else {
  stdout.write(
    JSON.stringify({
      ok: true,
      // Echo the request so the test can assert what the engine sent.
      text: `fake ${req.task} of ${req.image} using ${req.model}`,
      model: req.model,
      ms: 7,
      tokens: { input: 11, output: 5 },
    }) + "\n",
  );
}
