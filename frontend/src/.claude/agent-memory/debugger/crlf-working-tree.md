---
name: crlf-working-tree
description: frontend/src files are CRLF on disk (core.autocrlf=true) while grep -c on \r misleads in Git Bash; scripted multi-line replaces must normalise line endings
metadata:
  type: feedback
---

Files under frontend/src (Hand.tsx, Stage.tsx, handModel.ts) are CRLF on disk, some others (RoleSelect.tsx, stageContext.ts) LF. A node string `.replace` with `\n` patterns silently misses on CRLF files. The Edit tool preserves endings; for scripts, read, convert to LF, edit, convert back to the original style.

**Why:** a multi-line patch failed with "miss" even though the text was visibly identical.
**How to apply:** check `s.includes('\r\n')` first in any scripted edit.

Also: a shared `++counter % N` sampler across two components of the same kind never samples one of them when N is even (alternating calls); use an odd N or per-instance counters.
