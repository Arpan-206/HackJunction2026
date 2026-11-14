---
name: anyio-cancel-message-gather
description: Flaky TestClient websocket teardown CancelledError caused by asyncio.gather inside a handler losing anyio's cancel message
metadata:
  type: project
---

Symptom: tests using `client.websocket_connect(...)` flake (~5%) with `concurrent.futures.CancelledError` from `fut.result` in starlette TestClient exit.

Cause: TestClient exit sends disconnect then immediately `cs.cancel()` on the app's anyio scope, so the cancel lands while the handler is in its `finally: await asyncio.gather(children)`. gather re-raises the children's bare `CancelledError('')` (from our own `task.cancel()`), so anyio's scope does not recognise it (`is_anyio_cancellation` checks the message) and lets it escape.

Fix: use `anyio.create_task_group()` in the handler instead of `create_task` + `wait` + `gather` (app/api/ws.py). Diagnose by monkeypatching `anyio._backends._asyncio.CancelScope.__exit__` to print `_pending_uncancellations`, `host_task.cancelling()` and the exception.

Repro loop that works: in-process script looping TestClient connect/disconnect 60-80 times (full pytest loops are slow, ~10s each). The full suite is a moving target when another agent edits tests concurrently; transient failures in unrelated tests happen.
