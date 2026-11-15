#!/usr/bin/env node
/**
 * Key-leak check for a built static site (docs/PUBLIC_TOUR.md). Usage: node scripts/leak-check.mjs <dist dir>
 * Exits 1 on any finding. It scans every text file for:
 *   (a) the value of any variable in this build environment, except the names on ENV_ALLOW;
 *   (b) well-known key shapes (Google API keys, sk- keys, bearer tokens, long secrets next to key, token, secret...);
 *   (c) secret variable names (GEMINI_API_KEY, VERDA_, CRACI_API_TOKEN, HF_TOKEN);
 *   (d) absolute local paths (/Users/, /home/<user>/, C:\Users\);
 *   (e) hosts the tour must never call (localhost:8000, :8765, generativelanguage.googleapis.com, containers.datacrunch.io, verda).
 * Binary files (images, video, the hand mesh) are scanned for (a), (b) and (d) as raw bytes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Variable names whose values are not secrets and may appear by chance (paths, locale, runner layout). */
export const ENV_ALLOW = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHLVL', 'HOSTNAME',
  'TMPDIR', 'TMP', 'TEMP', '_', 'EDITOR', 'PAGER', 'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME',
  'XDG_DATA_DIRS', 'XDG_SESSION_TYPE', 'DEBIAN_FRONTEND', 'INIT_CWD', 'NODE', 'CI', 'LS_COLORS', 'MAIL', 'SSH_AUTH_SOCK',
  'GITHUB_WORKSPACE', 'GITHUB_ACTION_PATH', 'GITHUB_EVENT_PATH', 'GITHUB_PATH', 'GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STATE',
  'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE', 'RUNNER_WORKSPACE', 'AGENT_TOOLSDIRECTORY', 'GITHUB_SERVER_URL',
  'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_ACTION_REPOSITORY', 'GITHUB_ACTIONS', 'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_ENVIRONMENT',
  'ImageOS', 'ImageVersion',
  // Public build metadata that the published SBOM and its summary carry on purpose (commit, repository, run, job).
  'GITHUB_SHA', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_OWNER', 'GITHUB_REPOSITORY_ID', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_HEAD_REF',
  'GITHUB_BASE_REF', 'GITHUB_WORKFLOW', 'GITHUB_WORKFLOW_REF', 'GITHUB_WORKFLOW_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_JOB',
  'GITHUB_ACTOR', 'GITHUB_ACTOR_ID', 'GITHUB_TRIGGERING_ACTOR', 'GITHUB_EVENT_NAME', 'TOUR_SBOM_JOB_ID', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'CONDA', 'GOROOT', 'PIPX_HOME', 'PIPX_BIN_DIR', 'BOOTSTRAP_HASKELL_NONINTERACTIVE',
]);
/** Values shorter than this are too common to mean anything (true, 1, linux, x64). */
export const MIN_ENV_VALUE = 12;
/** Name prefixes that are npm's own settings for the running script, never secrets that reach a bundle. */
const ENV_ALLOW_PREFIX = ['npm_config_', 'npm_package_', 'npm_lifecycle_', 'JAVA_HOME_', 'GOROOT_'];

export const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.map', '.txt', '.md', '.svg', '.urdf', '.xml', '.webmanifest']);

const SHAPES = [
  { kind: 'Google API key shape', re: /AIza[0-9A-Za-z_-]{35}/ },
  { kind: 'sk- key shape', re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'bearer token', re: /\bbearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { kind: 'secret next to a key word', re: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|authorization|password|token)["'`]?\s*[:=]\s*["'`][A-Za-z0-9+/_-]{32,}={0,2}["'`]/i },
  { kind: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
const NAMES = [/GEMINI_API_KEY/, /VERDA_[A-Z]/, /CRACI_API_TOKEN/, /HF_TOKEN/];
const PATHS = [/\/Users\/[A-Za-z]/, /\/home\/(?!runner\b)[a-z][a-z0-9_-]*\//, /[A-Za-z]:\\Users\\/];
const HOSTS = [/localhost:8000/, /:8765\b/, /generativelanguage\.googleapis\.com/, /containers\.datacrunch\.io/, /verda/i];

/** Secret-looking env values: name not allowlisted and value long enough to be specific. */
export function envSecrets(env) {
  const out = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < MIN_ENV_VALUE) continue;
    if (ENV_ALLOW.has(name) || ENV_ALLOW_PREFIX.some((p) => name.startsWith(p))) continue;
    out.push({ name, value });
  }
  return out;
}

/** Findings in one text. `binary` skips the name and host rules, which raw bytes match by chance. */
export function scanText(text, { secrets = [], binary = false } = {}) {
  const found = [];
  for (const { name, value } of secrets) if (text.includes(value)) found.push({ kind: 'env value', detail: `value of ${name}` });
  for (const { kind, re } of SHAPES) {
    const m = re.exec(text);
    if (m) found.push({ kind, detail: mask(m[0]) });
  }
  for (const re of PATHS) {
    const m = re.exec(text);
    if (m) found.push({ kind: 'local path', detail: m[0] });
  }
  if (!binary) {
    for (const re of NAMES) {
      const m = re.exec(text);
      if (m) found.push({ kind: 'secret variable name', detail: m[0] });
    }
    for (const re of HOSTS) {
      const m = re.exec(text);
      if (m) found.push({ kind: 'forbidden host', detail: context(text, m.index, m[0].length) });
    }
  }
  return found;
}

function mask(s) {
  return s.length <= 10 ? '***' : `${s.slice(0, 6)}...(${s.length} chars)`;
}

function context(text, i, n) {
  return text.slice(Math.max(0, i - 30), i + n + 30).replace(/\s+/g, ' ');
}

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Every finding in a built folder, with the file it is in. */
export function scanDir(dir, env = process.env) {
  const secrets = envSecrets(env);
  const findings = [];
  let files = 0;
  for (const file of walk(dir)) {
    files++;
    const binary = !TEXT_EXT.has(extname(file).toLowerCase());
    const text = readFileSync(file, binary ? 'latin1' : 'utf8');
    for (const f of scanText(text, { secrets, binary })) findings.push({ file: relative(dir, file), ...f });
  }
  return { files, secrets: secrets.length, findings };
}

function main() {
  const dir = resolve(process.argv[2] ?? 'dist-tour');
  const { files, secrets, findings } = scanDir(dir);
  console.log(`leak-check: ${files} files in ${dir}, ${secrets} env values checked`);
  for (const f of findings) console.log(`FINDING ${f.file}: ${f.kind}: ${f.detail}`);
  if (findings.length) {
    console.log(`leak-check: FAILED with ${findings.length} finding(s)`);
    process.exit(1);
  }
  console.log('leak-check: clean');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
