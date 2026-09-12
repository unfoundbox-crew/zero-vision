#!/usr/bin/env python3
"""zero-vision local-vlm runner: one mlx-vlm inference, JSON in, JSON out.

Contract (stable — src/engines/local-vlm.ts depends on it):
  stdin : {"model": str, "image": str, "task": "transcribe"|"describe",
           "maxTokens": int, "temperature": float}
  stdout: exactly one JSON object, last line:
           {"ok": true,  "text": str, "model": str, "ms": int,
            "tokens": {"input": int, "output": int}}
           {"ok": false, "error": "local_vlm_<name>: ..."}

Never downloads weights: HF_HUB_OFFLINE=1 is set before mlx_vlm is imported, so
a missing snapshot fails closed instead of pulling gigabytes. The Node side
already checked the path; this is the second lock on the same door.
"""

import json
import os
import sys
import time

# Must precede any huggingface_hub / mlx_vlm import.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

PROMPTS = {
    "transcribe": (
        "Transcribe every piece of text in this image verbatim, in reading order. "
        "Output only the text. Do not paraphrase, summarize, translate, or add commentary."
    ),
    "describe": (
        "Describe this image concisely and concretely: layout, notable elements, and "
        "any state a reader would need. If it contains text, quote the text. No preamble."
    ),
}


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"local_vlm_bad_request: {exc}"})
        return 1

    model_path = req.get("model")
    image = req.get("image")
    task = req.get("task", "describe")
    if task not in PROMPTS:
        emit({"ok": False, "error": f"local_vlm_bad_request: unknown task {task!r}"})
        return 1
    if not model_path or not image:
        emit({"ok": False, "error": "local_vlm_bad_request: model and image are required"})
        return 1
    if not os.path.isfile(image):
        emit({"ok": False, "error": f"local_vlm_bad_input: no such image {image}"})
        return 1

    try:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config
    except Exception as exc:  # noqa: BLE001 - any import failure is the same story
        emit(
            {
                "ok": False,
                "error": (
                    f"local_vlm_no_runtime: mlx-vlm is not importable ({exc}). "
                    "Install it into the interpreter ZRV_PYTHON points at: "
                    "pip install mlx-vlm"
                ),
            }
        )
        return 1

    t0 = time.monotonic()
    try:
        model, processor = load(model_path)
        config = load_config(model_path)
        prompt = apply_chat_template(processor, config, PROMPTS[task], num_images=1)
        result = generate(
            model,
            processor,
            prompt,
            image=[image],
            max_tokens=int(req.get("maxTokens") or 512),
            temperature=float(req.get("temperature") or 0.0),
            verbose=False,
        )
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": f"local_vlm_inference_failed: {type(exc).__name__}: {exc}"})
        return 1

    text = getattr(result, "text", None)
    if text is None:
        text = str(result)
    out = {
        "ok": True,
        "text": text.strip(),
        "model": model_path,
        "ms": int((time.monotonic() - t0) * 1000),
    }
    prompt_tokens = getattr(result, "prompt_tokens", None)
    gen_tokens = getattr(result, "generation_tokens", None)
    if prompt_tokens is not None or gen_tokens is not None:
        out["tokens"] = {"input": int(prompt_tokens or 0), "output": int(gen_tokens or 0)}
    emit(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
