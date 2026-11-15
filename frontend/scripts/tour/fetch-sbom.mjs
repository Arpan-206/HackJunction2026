#!/usr/bin/env node
/**
 * Writes the CRACI SBOM of the tour's build job into the built site: <site>/sbom.cdx.json (CycloneDX, as CRACI gives it)
 * and <site>/sbom-summary.json (what the "What's in this site" page shows). Usage:
 *
 *   node scripts/tour/fetch-sbom.mjs <site dir>
 *
 * Environment: CRACI_API_TOKEN (optional; never printed), TOUR_SBOM_JOB_ID (the GitHub job id of the build job),
 * GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, TOUR_SBOM_WAIT_S (how long to wait for the SBOM to be final, default 900).
 * With `--placeholder` it writes only a summary that says the SBOM is added after the build job ends.
 *
 * Status in the summary: ok (components and vulnerability data), empty (0 components), incomplete (components but no
 * vulnerability data), unavailable (no token, no job id, the API refused, or the SBOM was not final in time; with the reason).
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.craci.com';
export const CRACI_JOB_PAGE = 'https://platform.craci.com/projects/hackjunction2026/jobs/';
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'];
const RANK = { none: 0, info: 1, low: 2, medium: 3, moderate: 3, high: 4, critical: 5 };

function* walk(components) {
  for (const c of components ?? []) {
    yield c;
    yield* walk(c.components);
  }
}

/** Counts from a CycloneDX document: packages (the checked-out repository itself left out) and vulnerability entries by severity. */
export function summarise(doc) {
  const props = Object.fromEntries(((doc.metadata ?? {}).properties ?? []).map((p) => [p.name, p.value]));
  const self = `pkg:github/${props['craci:job:repository'] ?? ''}`.toLowerCase();
  let components = 0;
  for (const c of walk(doc.components)) {
    if ((c.purl ?? '').toLowerCase().startsWith(self + '@') || (c.purl ?? '').toLowerCase() === self) continue;
    components++;
  }
  const hasVulnerabilityData = Array.isArray(doc.vulnerabilities);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const v of doc.vulnerabilities ?? []) {
    let best = null;
    for (const r of v.ratings ?? []) {
      const s = String(r.severity ?? '').toLowerCase();
      if (s in RANK && (best === null || RANK[s] > RANK[best])) best = s;
    }
    const bucket = best === 'moderate' ? 'medium' : best && SEVERITIES.includes(best) ? best : 'unknown';
    bySeverity[bucket]++;
  }
  const status = components === 0 ? 'empty' : hasVulnerabilityData ? 'ok' : 'incomplete';
  return { components, hasVulnerabilityData, vulnerabilities: hasVulnerabilityData ? bySeverity : null, vulnerabilityEntries: (doc.vulnerabilities ?? []).length, jobStatus: props['craci:job:job_status'] ?? null, status };
}

async function getSbom(token, repo, jobId) {
  const q = new URLSearchParams({ provider: 'github', repo, job_id: jobId });
  const res = await fetch(`${API}/v1preview1/sbom?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.cyclonedx+json, application/json' } });
  const text = await res.text();
  if (res.ok) return { ok: true, doc: JSON.parse(text) };
  let detail = '';
  try {
    const p = JSON.parse(text);
    detail = [p.title, p.detail].filter(Boolean).join(': ');
  } catch {
    detail = res.statusText;
  }
  return { ok: false, status: res.status, detail };
}

async function main() {
  const site = resolve(process.argv[2] ?? 'dist-tour');
  const placeholder = process.argv.includes('--placeholder');
  const env = process.env;
  const jobId = env.TOUR_SBOM_JOB_ID ?? '';
  const base = {
    commit: env.GITHUB_SHA ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    jobId: jobId || null,
    craciJobUrl: jobId ? CRACI_JOB_PAGE + jobId : null,
    fetchedAt: new Date().toISOString(),
    sbomFile: null,
    components: null,
    vulnerabilities: null,
    vulnerabilityEntries: null,
  };
  const write = (summary) => {
    writeFileSync(join(site, 'sbom-summary.json'), JSON.stringify(summary, null, 1) + '\n');
    console.log(`sbom: status ${summary.status}${summary.reason ? ` (${summary.reason})` : ''}, components ${summary.components}, vulnerabilities ${JSON.stringify(summary.vulnerabilities)}`);
  };
  if (placeholder) return write({ ...base, status: 'unavailable', reason: 'the SBOM is added after the build job ends; this copy of the site was not given one' });
  const token = env.CRACI_API_TOKEN ?? '';
  if (!token) return write({ ...base, status: 'unavailable', reason: 'no API token in this build' });
  if (!jobId || !env.GITHUB_REPOSITORY) return write({ ...base, status: 'unavailable', reason: 'the build job id is not known' });

  const waitS = Number(env.TOUR_SBOM_WAIT_S ?? 900);
  const t0 = Date.now();
  const attempts = [];
  for (;;) {
    let r;
    try {
      r = await getSbom(token, env.GITHUB_REPOSITORY, jobId);
    } catch (e) {
      r = { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
    }
    const waited = Math.round((Date.now() - t0) / 1000);
    if (r.ok) {
      attempts.push({ afterS: waited, result: 'ok' });
      writeFileSync(join(site, 'sbom.cdx.json'), JSON.stringify(r.doc));
      const s = summarise(r.doc);
      const reason = s.status === 'empty' ? 'CRACI returned an SBOM with no packages' : s.status === 'incomplete' ? 'CRACI returned packages but no vulnerability data' : undefined;
      return write({ ...base, fetchedAt: new Date().toISOString(), sbomFile: 'sbom.cdx.json', ...s, reason, attempts: attempts.length, waitedS: waited });
    }
    attempts.push({ afterS: waited, result: `HTTP ${r.status}` });
    // 409: the job is not final yet. Anything else will not change by waiting.
    if (r.status !== 409 || waited >= waitS) {
      const why = r.status === 409 ? `the SBOM was not final after ${waited} s (${r.detail})` : `the CRACI API answered HTTP ${r.status}${r.detail ? `: ${r.detail}` : ''}`;
      return write({ ...base, status: 'unavailable', reason: why, attempts: attempts.length, waitedS: waited });
    }
    await new Promise((ok) => setTimeout(ok, 20000));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
