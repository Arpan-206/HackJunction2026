# 05 Gemini structured output, Gemma local, generative UI

Researched 13 Nov 2026 (day 1 of Junction). Claims marked "(my judgement)" are unsourced.

## 1. Junction 2026: Google DeepMind

What is confirmed:
- Google DeepMind is a headline partner, alongside Arduino and Verda (Verda's own post: "one of the main sponsors at Junction 2026, alongside Arduino and DeepMind") https://verda.com/blog/junction-2026
- Official page copy: "Google DeepMind is teaming up with us for Junction 2026. Something special is planned for the winning teams. More on that soon." https://2026.hackjunction.com/
- Schedule (same page): Fri 13 Nov 18:00 opening ceremony with a Google DeepMind keynote and challenge videos; **20:00 Google DeepMind workshop, Loft, 4th floor** ("Info coming soon"). Preliminary submission Fri 23:59 (platform says 23:55), submissions open Sat 12:00, final submission Sun 10:00, challenge winners announced Sun 15:10.
- One grand-jury judge is Umar Noor, Developer Experience, Google DeepMind (GTM programs, "helping developers and founders go from first prototype to real world impact using AI"). https://2026.hackjunction.com/ So the overall jury has a DeepMind person who will likely care about visible Gemini/Gemma use.
- Tracks listed: Hardware (Arduino), Healthcare, AI Infrastructure (Verda), FinTech, Agentic AI, Data, plus "Tech challenges" that run across every track: "Companies provide credits to their platforms, and some of them award prizes to the best use cases of their technologies." (same page). Google DeepMind is plausibly one of these tech challenges (my judgement).
- Rokoko is also a listed partner on the platform page https://hackjunction.app/hackathons/junction-2026 (relevant for the glove challenge).
- Judging: each Challenge Partner picks its own track winners by its own criteria; main event is peer review to top 5, then live pitch and grand jury.

NOT found (state clearly): no public DeepMind challenge brief, prize amount, judging criteria, "must use Gemini API / Gemma / AI Studio / Vertex" rule, or credit amount. The tech-challenge cards on the page are JS-rendered and did not appear in excerpts. Search excerpts, the platform page, and third-party listings (https://perks.myapps.ai/offers/hackathon-junction-2026/ only says partners include Google DeepMind, OpenAI, NVIDIA, Modal) had nothing more. Verda's credits are claimed via Junction Platform > Hackerpacks, so check Hackerpacks for a Google/DeepMind entry too. Action: go to the 20:00 DeepMind workshop and ask the DeepMind staff directly (or Discord https://discord.gg/nDgvafhRU4) for the brief, credits and whether Gemma counts.

## 2. Gemini API structured output (state as of Nov 2026)

Models (from official pages, Nov 2026):
- Current: `gemini-3.8-flash` (docs' default example model, "most intelligent Flash"), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`; top tier Gemini 4 (`gemini-4-argon`, carbon, hydrogen) announced; alias `gemini-flash-latest` is used in the SDK README. https://ai.google.dev/gemini-api/docs/pricing , https://github.com/googleapis/python-genai
- Free tier: Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite and Gemma 4 are callable free; Gemini 4 Argon is paid only (per a third party summary, https://apidog.com/blog/gemini-api-free-tier/ ).
- Free-tier RPM/RPD: Google no longer prints per-model numbers in docs; you must read your own project at https://aistudio.google.com/rate-limit . Docs only say limits are per project and any one of RPM/TPM/RPD trips a 429 https://ai.google.dev/gemini-api/docs/rate-limits . Free tier content is used to improve Google products (pricing page). Budget for a small RPM and cache generated pages (my judgement). Enabling billing gives instant Tier 1.

Two API surfaces exist now:
1. `generateContent` (classic, still works): `config.responseMimeType = "application/json"` plus `config.responseJsonSchema` (full JSON Schema) or `responseSchema` (OpenAPI-subset). SDK docs: "If response_schema doesn't process your schema correctly, try using response_json_schema instead." https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html
2. Interactions API (docs now mark it "Recommended"): `client.interactions.create(model, input, response_format={type:"text", mime_type:"application/json", schema:...})`, read `interaction.output_text`. https://ai.google.dev/gemini-api/docs/structured-output
Use generateContent for the hackathon since it is the long-stable path with Pydantic/Zod examples (my judgement); both accept the same schema subset.

Python (google-genai), from https://github.com/googleapis/python-genai :
```python
from google import genai

client = genai.Client()  # GEMINI_API_KEY env
r = client.models.generate_content(
    model="gemini-3.8-flash",
    contents=prompt,
    config={
        "response_mime_type": "application/json",
        "response_json_schema": PageSpec.model_json_schema(),
    },
)
spec = PageSpec.model_validate_json(r.text)
```
JS (@google/genai), shape from https://ai.google.dev/api/generate-content :
```js
import { GoogleGenAI } from "@google/genai";
import * as z from "zod";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const r = await ai.models.generateContent({
  model: "gemini-3.8-flash",
  contents: prompt,
  config: { responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(PageSpec) },
});
const spec = PageSpec.parse(JSON.parse(r.text));
```
Do not paste the schema into the prompt too; the SDK README says duplicating it can lower quality.

Supported JSON Schema (https://ai.google.dev/gemini-api/docs/structured-output , https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html):
- Types: string, number, integer, boolean, object, array, null (via type array e.g. `["string","null"]`).
- Supported keywords: `$id $defs $ref $anchor type format title description enum items prefixItems minItems maxItems minimum maximum anyOf oneOf (treated as anyOf) properties additionalProperties required`, plus non-standard `propertyOrdering`.
- Recursion: cyclic `$ref` is unrolled to a limited depth and may only be used in non-required properties. A schema node with `$ref` may not carry other non-`$` keys.
- Property order: implicit, output keys follow schema key order (Gemini 2.5+ announcement https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs ); `propertyOrdering` forces it on the older Schema object.
- NOT enforced (silently stripped, not an error): `minLength maxLength minProperties maxProperties uniqueItems contains minContains maxContains`. So Zod `.min()`/`.max()` on strings will not constrain the model; validate client side. `minItems`/`maxItems` are enforced.
- Limits: no numeric nesting cap is published. Schemas with "too many states" give `400 INVALID_ARGUMENT`. Causes listed: big `maxItems` on nested arrays, long property or enum names, many enum values, long runs of optional properties, `anyOf` with many alternatives, numeric min/max bounds. Fix: shorten names, drop nested array limits, mix required with optional, move rules into descriptions.
- Structured output combined with tools is preview on Gemini 3/4 only.
- Implication for us (my judgement): a discriminated union of 15+ components with `anyOf` could hit the complexity error. Use a flat design: one `Block` object with `type` enum and a small generic `props` (or per-type `anyOf` of 8-12 short-named variants), and keep strict validation in Zod.

## 3. Gemma locally

Latest is **Gemma 4**: released 2 Apr 2026 (E2B, E4B, 26B A4B MoE, 31B), 12B "Unified" added 3 Jun 2026; Apache 2.0; built-in function calling, structured JSON output, system role, configurable thinking. https://gemma.ai/get-started , https://ollama.com/library/gemma4 , license note https://crystal-method.com/blog/gemma-setup/
Ollama tags and download sizes (https://gemma.ai/deployment/ollama/): `gemma4:e2b` 7.2 GB, `e4b` 9.6 GB (also `latest`), `12b` 7.6 GB, `26b` 18 GB, `31b` 20 GB. Bare `gemma4` = e4b, so always name the size. Google calls the 12B "small enough to run locally with just 16GB of VRAM or unified memory" (https://quantacloud.net/guides/gemma-4-gpu-requirements ). Size guide in https://aliteq.com/run-gemma-4-locally : e4b for 8 GB cards, 12b for 12-16 GB, 26b MoE and 31b for 24 GB.
Recommendation (my judgement): 8 GB VRAM use `gemma4:e4b`; 12-16 GB use `gemma4:12b` (best quality that fits). The 26B A4B MoE is fast per token (3.8B active) but needs ~18 GB weights, so only with 24 GB or a Mac with 32 GB+ unified memory. Mac: use the `-mlx` tags (`gemma4:12b-mlx`) or LM Studio. Windows+NVIDIA: Ollama or LM Studio, both fine; llama.cpp for GBNF control.
Context: Ollama defaults to 4K under 24 GiB VRAM; set `OLLAMA_CONTEXT_LENGTH=16000` or `options.num_ctx`, otherwise a long catalog prompt plus 2k output gets truncated. Disable thinking (omit `<|think|>` in the system prompt) for JSON speed.
Forcing JSON: Ollama `format` takes a JSON Schema (grammar-constrained), docs recommend also putting the schema in the prompt. Not supported on Ollama cloud models, so run local. https://docs.ollama.com/capabilities/structured-outputs . Python `format=Model.model_json_schema()`, JS `format: z.toJSONSchema(Schema)`. llama.cpp: `--json-schema` / `response_format` on llama-server or hand-written GBNF (not looked up in this pass, from memory, my judgement).
Speed: no sourced benchmark for 12B on a laptop. One sourced datapoint: 26B A4B on a laptop with ~4.5 GB VRAM via llama.cpp gives 20 to 40 tok/s output after heavy tuning (HN comment cited at https://refusalrate.com/gemma-4-local ). Estimate (my judgement): 12B Q4 on an RTX 3060/4060-class GPU roughly 30 to 60 tok/s, so a 2k-token JSON takes about 35 to 70 s; e4b roughly 60+ tok/s, so about 30 s; Apple Silicon similar. Constrained decoding adds some overhead. Test on the actual laptop before relying on it.
Also: Gemma 4 is callable via the Gemini API free tier (apidog link above), which gives a "Gemma" story without local hardware.

## 4. Generative UI prior art

- **A2UI** (Google): reached **1.0 on 11 Nov 2026**, two days ago. Open protocol; agent streams JSONL messages; official renderers for React, Angular, Lit (web), Flutter, SwiftUI; agent SDKs for Python, TypeScript, Dart; also runs in MCP Apps. https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/ , https://a2ui.org/ , spec https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/a2ui_protocol.md
  - Design: **flat component list (adjacency list) with ids**, because "Requiring an LLM to generate a perfectly nested JSON tree in a single pass is difficult and error-prone" (v0.8 spec https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md ). Messages: create surface, update components, update data model, begin rendering root id. Data binding via JSON-Pointer paths (`{"path":"/user/name"}`) with two-way binding. Components come from a **catalog** (basic catalog or your own catalog JSON Schema, with optional `instructions` markdown for the LLM); validation is JSON Schema against the catalog. The renderer is the only code that runs, no executable code from the model.
  - Usable from React today: yes, an official React renderer exists. Caveat: 1.0 is 2 days old and the docs are shifting (v0.8 to 0.9 to 1.0 message names changed), so budget time for integration pain (my judgement). Custom catalog components (3D hand stage) are the point of catalogs, but cost extra setup.
- **json-render** (Vercel Labs, Apache-2.0): https://json-render.dev/ , https://github.com/vercel-labs/json-render . Define a **catalog with Zod** (component name, `props` Zod schema, `hasChildren`), a **registry** mapping types to React components, spec is a **flat tree**: `{ "root": "card-1", "elements": { "card-1": { "type":"Card","props":{...},"children":["metric-1"] } } }`. Data binding via `$state` paths, `$item`, `$index`. `catalog.prompt()` generates the system prompt, `catalog.validate()` checks output with Zod, streaming via JSONL patches (RFC 6902), and `jsonSchema({strict:true})` yields a subset compatible with Gemini, OpenAI and Anthropic structured output. Has React, React Native, and a React Three Fiber renderer (3D). It documents A2UI interop (https://json-render.dev/docs/a2ui). Core packages: `@json-render/core`, `@json-render/react`.
- Others: Vercel AI SDK generative UI (streamUI / tool-call-to-component mapping), CopilotKit (partners with A2UI, hosts the A2UI playground https://go.copilotkit.ai/a2ui-playground ). Not researched in depth this pass.
- Consensus pattern across all of them: (1) closed catalog of components with typed props, (2) **flat id-keyed element map plus root id** instead of deep nesting, (3) data kept separate from structure and referenced by path, (4) schema validate then render, unknown types rejected, (5) no model-written code.

## 5. Recommendation for 48h (my judgement unless cited)

Pick **json-render style, hand-rolled or via `@json-render/core`**, not full A2UI. Reasons: Zod catalog is exactly our "fixed catalog" need, flat spec is robust, works with a custom React Three Fiber hand stage as just another catalog entry, A2UI 1.0 is two days old. If a DeepMind judge cares, mention that the spec shape follows A2UI's flat adjacency list and can be exported to it.

Architecture:
1. `catalog.ts`: Zod schemas for ~10 components (HandStage3D, StepTimeline, MetricCard, Checklist, Scoreboard, Heading, Text, Section...). Each has short names, few optional fields.
2. Spec shape: `{ root: string, elements: Record<id, {type, props, children?: id[]}> }`. Data-heavy stuff (steps, metrics values, recorded take ids) comes from our app state and is referenced by path, so the LLM only chooses layout and labels, not numbers (reduces hallucination).
3. Generation: Gemini `gemini-3.8-flash` (or `gemini-3.5-flash-lite` if rate-limited) with `responseMimeType: application/json` and a deliberately simple `responseJsonSchema` (type enum plus generic props object), then **full Zod validation** against the strict per-component catalog (since Gemini strips minLength etc. and big `anyOf` can cause `400`).
4. Retry loop: max 2 retries; on Zod failure append the error list to the prompt ("fix these issues") and call again; on 429 or 400, fall back to the next provider; final fallback is a hand-written default template per skill (piano, table tennis) so the demo never shows an error.
5. Fallback order: cloud Gemini first (faster, better quality, free tier), **Gemma 4 local via Ollama (`gemma4:12b` or `e4b`, `format` = schema) as offline or rate-limit fallback**. Same Zod validation for both. Reverse order (local first) is only worth it if venue wifi is bad, because local takes ~30 to 70 s.
6. **Pre-generate and cache**: generate specs for piano and table tennis ahead of time and store them as JSON files; call the LLM live only for a "new skill" demo moment. This protects against free-tier RPM and wifi failure during the Sunday pitch.
7. Demo story for the DeepMind angle: show the same spec generated by Gemini in the cloud and by Gemma 4 on the laptop, validated by the same catalog.

## Sources (main)
- https://2026.hackjunction.com/ , https://hackjunction.app/hackathons/junction-2026 , https://verda.com/blog/junction-2026
- https://ai.google.dev/gemini-api/docs/structured-output , https://ai.google.dev/gemini-api/docs/rate-limits , https://ai.google.dev/gemini-api/docs/pricing
- https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html , https://github.com/googleapis/python-genai
- https://gemma.ai/deployment/ollama/ , https://ollama.com/library/gemma4 , https://docs.ollama.com/capabilities/structured-outputs
- https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/ , https://a2ui.org/ , https://json-render.dev/ , https://github.com/vercel-labs/json-render
