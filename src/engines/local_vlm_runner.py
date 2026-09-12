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

`local_vlm_daemon.py` imports PROMPTS, load_model() and infer() from here so the
warm path and the cold path run the exact same inference. Keep them here.
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


class NoRuntime(Exception):
    """mlx-vlm is not importable in this interpreter."""


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _mlx():
    """Import mlx-vlm, or raise NoRuntime with the actionable message."""
    try:
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config
    except Exception as exc:  # noqa: BLE001 - any import failure is the same story
        raise NoRuntime(
            f"local_vlm_no_runtime: mlx-vlm is not importable ({exc}). "
            "Install it into the interpreter ZRV_PYTHON points at: pip install mlx-vlm"
        ) from exc
    return generate, load, apply_chat_template, load_config


def load_model(model_path):
    """Load weights once. Returns an opaque handle for infer()."""
    generate, load, apply_chat_template, load_config = _mlx()
    model, processor = load(model_path)
    config = load_config(model_path)
    return {
        "path": model_path,
        "model": model,
        "processor": processor,
        "config": config,
        "generate": generate,
        "apply_chat_template": apply_chat_template,
    }


def infer(handle, image, task, max_tokens=512, temperature=0.0):
    """One inference on an already-loaded model. Returns the ok:true payload dict."""
    t0 = time.monotonic()
    prompt = handle["apply_chat_template"](
        handle["processor"], handle["config"], PROMPTS[task], num_images=1
    )
    result = handle["generate"](
        handle["model"],
        handle["processor"],
        prompt,
        image=[image],
        max_tokens=int(max_tokens or 512),
        temperature=float(temperature or 0.0),
        verbose=False,
    )
    text = getattr(result, "text", None)
    if text is None:
        text = str(result)
    out = {
        "ok": True,
        "text": text.strip(),
        "model": handle["path"],
        "ms": int((time.monotonic() - t0) * 1000),
    }
    prompt_tokens = getattr(result, "prompt_tokens", None)
    gen_tokens = getattr(result, "generation_tokens", None)
    if prompt_tokens is not None or gen_tokens is not None:
        out["tokens"] = {"input": int(prompt_tokens or 0), "output": int(gen_tokens or 0)}
    return out


def validate(req):
    """None when the request is usable, else the error string to emit."""
    task = req.get("task", "describe")
    if task not in PROMPTS:
        return f"local_vlm_bad_request: unknown task {task!r}"
    if not req.get("model") or not req.get("image"):
        return "local_vlm_bad_request: model and image are required"
    if not os.path.isfile(req["image"]):
        return f"local_vlm_bad_input: no such image {req['image']}"
    return None


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"local_vlm_bad_request: {exc}"})
        return 1

    bad = validate(req)
    if bad:
        emit({"ok": False, "error": bad})
        return 1

    try:
        handle = load_model(req["model"])
    except NoRuntime as exc:
        emit({"ok": False, "error": str(exc)})
        return 1
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": f"local_vlm_inference_failed: {type(exc).__name__}: {exc}"})
        return 1

    try:
        out = infer(
            handle,
            req["image"],
            req.get("task", "describe"),
            req.get("maxTokens"),
            req.get("temperature"),
        )
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": f"local_vlm_inference_failed: {type(exc).__name__}: {exc}"})
        return 1

    emit(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
