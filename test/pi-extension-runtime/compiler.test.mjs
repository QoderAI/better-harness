import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "vitest";
import { createExtensionCompiler } from "../../scripts/pi-extension-runtime/compiler.mjs";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(source = 'import { value } from "./helper"; export default () => value;') {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi wasm 空格 "));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const entry = path.join(root, "entry.ts");
  const outfile = path.join(root, "compiled.ts");
  const helper = path.join(root, "helper.ts");
  await writeFile(entry, source);
  await writeFile(helper, 'export const value: string = "v1";');
  const compiler = await createExtensionCompiler({ entry, outfile });
  cleanups.push(() => compiler.dispose());
  return { root, entry, outfile, helper, compiler };
}
const load = async (f, revision) => (await import(`${pathToFileURL(f.outfile).href}?revision=${revision}`)).default();

test("WASM bundles local TypeScript imports and incremental rebuild executes changed code", async () => {
  const f = await fixture();
  const one = await f.compiler.rebuild();
  assert.equal(one.status, "ready");
  assert.equal(await load(f, one.revision), "v1");
  assert.equal((await f.compiler.rebuild()).changed, false);
  await writeFile(f.helper, 'export const value: string = "v2";');
  const two = await f.compiler.rebuild();
  assert.equal(two.status, "ready");
  assert.notEqual(two.revision, one.revision);
  assert.equal(await load(f, two.revision), "v2");
});

test.each([
  ['syntax', 'export default ('],
  ['missing dependency', 'import x from "./missing"; export default () => x;'],
  ['missing default', 'export const value = 1;'],
  ['unsupported runtime import', 'import x from "not-installed"; export default () => x;'],
])("%s failure preserves last published revision and bytes, then recovers", async (_name, source) => {
  const f = await fixture();
  const first = await f.compiler.rebuild();
  const before = await readFile(f.outfile);
  await writeFile(f.entry, source);
  const failure = await f.compiler.rebuild();
  assert.equal(failure.status, "failed");
  assert.equal(failure.revision, first.revision);
  assert.ok(failure.diagnostics.length);
  assert.deepEqual(await readFile(f.outfile), before);
  await writeFile(f.entry, 'export default () => "recovered";');
  const recovered = await f.compiler.rebuild();
  assert.equal(recovered.status, "ready");
  assert.equal(await load(f, recovered.revision), "recovered");
});

test("concurrent builds publish complete output, disposal drains and rejects further work", async () => {
  const f = await fixture();
  const builds = [f.compiler.rebuild(), f.compiler.rebuild()];
  await f.compiler.dispose();
  const results = await Promise.all(builds);
  assert.ok(results.every((r) => r.status === "ready"));
  assert.equal(await load(f, results[1].revision), "v1");
  await assert.rejects(f.compiler.rebuild(), /disposed/);
  await f.compiler.dispose();
});

test("output cannot overwrite entry or imported source", async () => {
  const f = await fixture();
  await assert.rejects(createExtensionCompiler({ entry: f.entry, outfile: f.entry }), /differ/);
  const shared = path.join(f.root, "shared.ts");
  await writeFile(shared, 'export default "source";');
  await writeFile(f.entry, 'import value from "./shared.ts"; export default () => value;');
  const compiler = await createExtensionCompiler({ entry: f.entry, outfile: shared });
  cleanups.push(() => compiler.dispose());
  assert.equal((await compiler.rebuild()).status, "failed");
  assert.equal(await readFile(shared, "utf8"), 'export default "source";');
});

test("rejects output suffixes that can retain stale modules in official Pi", async () => {
  const f = await fixture();
  for (const suffix of [".mjs", ".js", ".cjs"]) {
    await assert.rejects(createExtensionCompiler({ entry: f.entry, outfile: path.join(f.root, `compiled${suffix}`) }), /reloadable/);
  }
});

test("Node builtins execute and Pi imports remain external in the bundle", async () => {
  const f = await fixture('import { basename } from "node:path"; export default () => basename("hello.txt");');
  const result = await f.compiler.rebuild();
  assert.equal(result.status, "ready");
  assert.equal(await load(f, result.revision), "hello.txt");
  // Real Pi resolution of TypeBox is exercised by native-smoke.mjs.
  await writeFile(f.entry, 'import { Type } from "typebox"; export default () => Type.String();');
  assert.equal((await f.compiler.rebuild()).status, "ready");
});
