#!/usr/bin/env python3
"""zero-vision local-vlm warm daemon: load the weights once, answer many calls.

Why it exists: `zrv` is a fresh process per call (pet-talk shells out per frame),
so a child kept alive inside one CLI run warms nothing. This daemon outlives the
CLI, owns one model, and is reached over a 0600 Unix socket in the user's own
state directory. Nothing listens on the network.

Usage (spawned by src/engines/local-vlm-warm.ts, not by hand):
  local_vlm_daemon.py --socket <path> --model <weights-dir> [--idle-ms N]
                      [--queue-max N] [--protocol N]

Wire protocol: one JSON object per line, one request per connection.
  {"op":"health"}  -> {"ok":true,"op":"health","protocol":1,"pid":int,
                       "model":str,"loaded":bool,"loadMs":int|null,
                       "requests":int,"inFlight":int,"waiting":int,
                       "uptimeS":float,"idleS":float,"idleMs":int,"queueMax":int}
  {"op":"stop"}    -> {"ok":true,"op":"stop","pid":int}   then the process exits
  {"op":"perceive","model":str,"image":str,"task":str,
   "maxTokens":int,"temperature":float}
                   -> exactly what local_vlm_runner.py emits for the same input
                      {"ok":true,"text":...,"model":...,"ms":...,"tokens":...}
                      {"ok":false,"error":"local_vlm_<name>: ..."}

Fail-closed rules:
  - The model is pinned at spawn. A perceive for a different model is refused
    with local_vlm_daemon_model_mismatch; it is never reloaded in place.
  - One inference at a time. Callers beyond --queue-max waiting get
    local_vlm_busy immediately instead of piling up behind the GPU.
  - A load failure (missing weights, no mlx-vlm) is answered, then the daemon
    exits, so the next call re-evaluates instead of talking to a dead model.
  - Weights are never downloaded: local_vlm_runner sets HF_HUB_OFFLINE=1 at
    import, which happens before anything here touches a model.
  - Only one daemon per socket: an exclusive flock on <socket>.lock.
"""

import argparse
import errno
import fcntl
import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_vlm_runner as runner  # noqa: E402  (path must be set first)

PROTOCOL = 1


class State:
    def __init__(self, model_path, idle_ms, queue_max):
        self.model_path = model_path
        self.idle_ms = idle_ms
        self.queue_max = queue_max
        self.started = time.monotonic()
        self.last_active = time.monotonic()
        self.requests = 0
        self.in_flight = 0
        self.waiting = 0
        self.load_ms = None
        self.handle = None
        self.lock = threading.Lock()          # serializes inference
        self.counters = threading.Lock()      # guards the ints above
        self.stop = threading.Event()
        self.fatal = None


def send(conn, obj):
    try:
        conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))
    except OSError:
        pass


def read_line(conn, limit=1 << 20):
    buf = b""
    while b"\n" not in buf:
        if len(buf) > limit:
            return None
        try:
            chunk = conn.recv(65536)
        except OSError:
            return None
        if not chunk:
            break
        buf += chunk
    if not buf:
        return None
    return buf.split(b"\n", 1)[0]


def health(st):
    now = time.monotonic()
    with st.counters:
        return {
            "ok": True,
            "op": "health",
            "protocol": PROTOCOL,
            "pid": os.getpid(),
            "model": st.model_path,
            "loaded": st.handle is not None,
            "loadMs": st.load_ms,
            "requests": st.requests,
            "inFlight": st.in_flight,
            "waiting": st.waiting,
            "uptimeS": round(now - st.started, 3),
            "idleS": round(now - st.last_active, 3),
            "idleMs": st.idle_ms,
            "queueMax": st.queue_max,
        }


def perceive(st, req, conn):
    if req.get("model") and req["model"] != st.model_path:
        send(
            conn,
            {
                "ok": False,
                "error": (
                    "local_vlm_daemon_model_mismatch: this daemon holds "
                    f"{st.model_path!r}, request asked for {req['model']!r}"
                ),
            },
        )
        return
    probe = dict(req)
    probe["model"] = st.model_path
    bad = runner.validate(probe)
    if bad:
        send(conn, {"ok": False, "error": bad})
        return

    with st.counters:
        if st.waiting >= st.queue_max:
            send(
                conn,
                {
                    "ok": False,
                    "error": (
                        f"local_vlm_busy: {st.waiting} call(s) already waiting for this "
                        f"daemon (queue max {st.queue_max}); retry or raise "
                        "ZRV_LOCAL_VLM_QUEUE_MAX"
                    ),
                },
            )
            return
        st.waiting += 1

    try:
        with st.lock:
            with st.counters:
                st.waiting -= 1
                st.in_flight += 1
                st.last_active = time.monotonic()
            try:
                if st.handle is None:
                    t0 = time.monotonic()
                    try:
                        st.handle = runner.load_model(st.model_path)
                    except runner.NoRuntime as exc:
                        st.fatal = str(exc)
                        send(conn, {"ok": False, "error": str(exc)})
                        return
                    except Exception as exc:  # noqa: BLE001
                        st.fatal = (
                            f"local_vlm_inference_failed: {type(exc).__name__}: {exc}"
                        )
                        send(conn, {"ok": False, "error": st.fatal})
                        return
                    st.load_ms = int((time.monotonic() - t0) * 1000)
                try:
                    out = runner.infer(
                        st.handle,
                        req["image"],
                        req.get("task", "describe"),
                        req.get("maxTokens"),
                        req.get("temperature"),
                    )
                except Exception as exc:  # noqa: BLE001
                    send(
                        conn,
                        {
                            "ok": False,
                            "error": f"local_vlm_inference_failed: {type(exc).__name__}: {exc}",
                        },
                    )
                    return
                out["warm"] = True
                out["loadMs"] = st.load_ms
                send(conn, out)
            finally:
                with st.counters:
                    st.in_flight -= 1
                    st.requests += 1
                    st.last_active = time.monotonic()
    finally:
        # A load failure is not transient: answer, then go away.
        if st.fatal:
            st.stop.set()


def handle_conn(st, conn):
    try:
        line = read_line(conn)
        if line is None:
            return
        try:
            req = json.loads(line.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            send(conn, {"ok": False, "error": f"local_vlm_bad_request: {exc}"})
            return
        op = req.get("op", "perceive")
        if op == "health":
            send(conn, health(st))
        elif op == "stop":
            send(conn, {"ok": True, "op": "stop", "pid": os.getpid()})
            st.stop.set()
        elif op == "perceive":
            perceive(st, req, conn)
        else:
            send(conn, {"ok": False, "error": f"local_vlm_bad_request: unknown op {op!r}"})
    finally:
        try:
            conn.close()
        except OSError:
            pass


def bind(sock_path):
    """Exclusive socket, or None when another daemon already owns it."""
    os.makedirs(os.path.dirname(sock_path), mode=0o700, exist_ok=True)
    lock_path = sock_path + ".lock"
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        if exc.errno in (errno.EAGAIN, errno.EACCES, errno.EWOULDBLOCK):
            os.close(lock_fd)
            return None, None
        raise
    # We hold the lock, so any socket file here is stale.
    try:
        os.unlink(sock_path)
    except FileNotFoundError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sock_path)
    os.chmod(sock_path, 0o600)
    srv.listen(64)
    srv.settimeout(0.25)
    return srv, lock_fd


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--socket", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--idle-ms", type=int, default=600_000)
    ap.add_argument("--queue-max", type=int, default=2)
    args = ap.parse_args(argv)

    srv, lock_fd = bind(args.socket)
    if srv is None:
        sys.stderr.write(
            f"local_vlm_daemon_taken: another daemon already owns {args.socket}\n"
        )
        return 4

    st = State(args.model, args.idle_ms, max(1, args.queue_max))
    # Readiness is the socket existing and answering; the Node side polls health.
    sys.stderr.write(f"local_vlm_daemon_ready pid={os.getpid()} model={args.model}\n")
    sys.stderr.flush()
    try:
        while not st.stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                with st.counters:
                    idle = (time.monotonic() - st.last_active) * 1000
                    busy = st.in_flight or st.waiting
                if not busy and idle >= st.idle_ms:
                    return 0
                continue
            except OSError:
                break
            threading.Thread(target=handle_conn, args=(st, conn), daemon=True).start()
    finally:
        try:
            srv.close()
        finally:
            try:
                os.unlink(args.socket)
            except FileNotFoundError:
                pass
            os.close(lock_fd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
