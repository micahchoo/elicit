---
title: "Asset: license comparison brief"
labels: [wayfinder:asset]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Not a ticket — the research asset produced for 003-license, kept for the
  record. Micah chose MIT 2026-08-02.
---

# License Decision Brief — Elicit

**Status:** Ready for review  
**Date:** 2026-08-01  
**Ticket:** 003

---

## 1. Dependency License Inventory

Every direct dependency is permissive. No copyleft, no GPL-family, no unusual
terms constrain the project license.

| Package | Version | License | Source |
|---|---|---|---|
| `@mariozechner/pi-ai` | 0.73.1 | MIT | `node_modules/@mariozechner/pi-ai/package.json:94` |
| `gray-matter` | 4.0.3 | MIT | `node_modules/gray-matter/package.json:23` |
| `hono` | 4.12.33 | MIT | `node_modules/hono/package.json:642` |
| `sherpa-onnx-node` | 1.13.2 | Apache-2.0 | `node_modules/sherpa-onnx-node/package.json:54` |
| `sherpa-onnx-linux-x64` | 1.13.4 | Apache-2.0 | `node_modules/sherpa-onnx-linux-x64/package.json:54` |
| `ulid` | 3.0.2 | MIT | `node_modules/ulid/package.json:58` |

Dev dependencies (`typescript`, `tsx`, `vite`, `vitest`, `@types/node`) are
likewise MIT-licensed and impose no distribution obligations.

**Notable entries:**

- **`sherpa-onnx-node` + `sherpa-onnx-linux-x64` (Apache-2.0):** These are the
  only deps not MIT. Apache-2.0 is permissive but carries an explicit patent
  grant and requires preservation of any NOTICE file shipped with the package.
  No NOTICE file is present in the npm packages as installed; the upstream
  repo (`github.com/csukuangfj/sherpa-onnx`) includes one, so if a future
  release bundles it, Elicit must carry it forward. Apache-2.0 is compatible
  with GPLv3 (and therefore AGPL-3.0) but not GPLv2.
- **`@mariozechner/pi-ai`** is the most complex dependency (LLM client
  aggregator with ~10 provider backends). No bundled model weights or
  proprietary data files — it is a pure JS client with model-download
  utilities. No license traps.

**Verdict:** The dependency tree imposes zero constraints on Elicit's license
choice. The field is entirely open.

---

## 2. Candidate Licenses

### A. MIT (or Apache-2.0) — Permissive

MIT permits anyone to use, copy, modify, merge, publish, distribute,
sublicense, and sell the software, provided the copyright notice and
permission notice are included. No patent grant is explicit (unlike
Apache-2.0). Obligations are minimal: keep the license text in a `LICENSE`
file and a one-line copyright header in source files. Compatible with every
dependency listed above — all five are MIT or Apache-2.0, both of which
permit sublicensing under MIT. This is the standard choice for small tools
and libraries: it maximises adoption and minimises overhead. If Micah's
intent is for Elicit to be freely usable by anyone for any purpose with no
reciprocal obligations, MIT is the correct pick.

### B. AGPL-3.0 — Network Copyleft

AGPL-3.0 requires that anyone who modifies the software and makes it
available over a network (including a local web server, if users other than
the operator access it) must make the modified source available under the
same license. For a local-only personal tool, this clause is largely
dormant — it activates only if Elicit is deployed as a shared service or
distributed in modified form. Obligations include: include the full license
text, preserve copyright notices, state all modifications prominently, and
provide source on request (or link to it). AGPL-3.0 is compatible with all
five dependencies: MIT works (MIT → GPLv3 is permitted) and Apache-2.0 is
GPLv3-compatible. Choose AGPL-3.0 if Micah wants to prevent proprietary
forks of Elicit — it ensures any derived work stays open, even if someone
hosts a multi-user version.

### C. PolyForm Noncommercial 1.0.0 (or Functional Source License) — Source-Available

PolyForm Noncommercial permits use, modification, and distribution for
noncommercial purposes only. Commercial use — selling the software, offering
it as a paid service, or embedding it in a commercial product — requires a
separate license from the author. There are no source-disclosure obligations
beyond what the author chooses; forks for noncommercial use need not publish
changes. This is compatible with MIT dependencies (MIT allows sublicensing
under any terms) and with Apache-2.0 (similarly sublicensable). Choose this
if Micah wants to reserve the right to monetise Elicit later while still
allowing personal and research use. The main cost is reduced adoption:
source-available licenses are not "open source" by OSI definition, which
deters some contributors and prevents inclusion in open-source registries
that require an OSI-approved license.

---

## 3. Recommendation

**Recommend MIT.** Elicit is a personal tool with no commercial ambitions
evident in its current design. MIT imposes the least friction — a one-line
copyright header and a `LICENSE` file. It is the default for TypeScript
projects of this scale, it is compatible with every dependency, and it leaves
every future option open (Micah can always relicense later as sole copyright
holder). AGPL-3.0 adds paperwork for a threat model (hosted forks) that does
not apply to a local-only app. PolyForm adds complexity for a monetisation
path that does not exist.

### Apply Step

```bash
# Set the license field and create the LICENSE file
npm pkg set license="MIT" &&
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2026 Micah

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```
