import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { envSecrets, scanDir, scanText } from '../scripts/leak-check.mjs';

// Made-up strings, built at run time so this file never holds a key-shaped literal.
const fakeGoogleShape = () => ['AI', 'za'].join('') + 'Tour'.repeat(8) + 'abc';
const fakeEnvSecret = () => ['not', 'a', 'real', 'secret'].join('-') + '-0123456789';

const kinds = (found: { kind: string }[]) => found.map((f) => f.kind);

describe('leak-check scanner', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('passes clean bundle text', () => {
    expect(scanText('const a = fetch("./models/hands/right.glb"); export { a };')).toEqual([]);
  });

  it('finds a planted key shape', () => {
    expect(kinds(scanText(`const k="${fakeGoogleShape()}";`))).toContain('Google API key shape');
  });

  it('finds the value of a build environment variable', () => {
    const secrets = envSecrets({ MY_BUILD_SECRET: fakeEnvSecret(), PATH: '/usr/local/bin:/usr/bin', SHORT: 'abc' });
    expect(secrets.map((s: { name: string }) => s.name)).toEqual(['MY_BUILD_SECRET']);
    expect(kinds(scanText(`x="${fakeEnvSecret()}"`, { secrets }))).toEqual(['env value']);
  });

  it('finds secret names, local paths and forbidden hosts', () => {
    const name = ['GEMINI', 'API', 'KEY'].join('_');
    const found = kinds(scanText(`${name} /Users/someone/x http://localhost:8000/api ws://h:8765/ws`));
    expect(found).toEqual(expect.arrayContaining(['secret variable name', 'local path', 'forbidden host']));
  });

  it('fails a built folder with a planted key and passes it once removed', () => {
    dir = mkdtempSync(join(tmpdir(), 'leak-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'app.js'), `var k="${fakeGoogleShape()}";`);
    expect(scanDir(dir, {}).findings.length).toBeGreaterThan(0);
    writeFileSync(join(dir, 'app.js'), 'var k=1;');
    expect(scanDir(dir, {}).findings).toEqual([]);
  });
});
