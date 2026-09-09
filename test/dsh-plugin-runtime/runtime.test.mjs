import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "vitest";
import { createPluginRuntime } from "../../scripts/dsh-plugin-runtime/runtime.mjs";

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh wasm 空格 "));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const entry = path.join(root, "plugin.ts"), helper = path.join(root, "greeting.ts"), home = path.join(root, "home");
  await writeFile(entry, 'import { value } from "./greeting"; export function apply(ctx) { ctx.value = value; }');
  await writeFile(helper, 'export const value: string = "one";');
  const runtime = await createPluginRuntime({ entry, home });
  cleanup.push(() => runtime.dispose());
  return { entry, helper, home, runtime };
}

test("publishes a native Profile and immutable modules; same-length source changes rebuild", async () => {
  const f = await fixture();
  const one = await f.runtime.build();
  assert.equal(one.status, "published");
  assert.equal(one.activation, "pending-native-loader");
  const context = {};
  (await import(pathToFileURL(one.artifact))).apply(context);
  assert.equal(context.value, "one");
  assert.equal((await f.runtime.build({ onlyChanged: true })).status, "unchanged");
  await writeFile(f.helper, 'export const value: string = "two";');
  const two = await f.runtime.build({ onlyChanged: true });
  assert.equal(two.status, "published");
  assert.notEqual(two.artifact, one.artifact);
  (await import(pathToFileURL(two.artifact))).apply(context);
  assert.equal(context.value, "two");
  const patch = JSON.parse(await readFile(two.patch, "utf8"));
  assert.equal(patch[0].insert[0].name, `./modules/${two.revision}.mjs`);
  assert.equal((await f.runtime.build()).changed, false);
  assert.equal((await readdir(path.dirname(two.artifact))).length, 2);
});

test.each([
  ['syntax error', 'export function apply('],
  ['missing import', 'import x from "./missing"; export function apply() { return x; }'],
  ['unsupported package', 'import x from "uninstalled"; export function apply() { return x; }'],
  ['wrong entry contract', 'export default () => {};'],
])("%s retains the previous Profile patch and recovers", async (_name, source) => {
  const f = await fixture();
  const good = await f.runtime.build();
  const before = await readFile(good.patch);
  await writeFile(f.entry, source);
  const result = await f.runtime.build();
  assert.equal(result.status, "failed");
  assert.ok(result.diagnostics.length);
  assert.deepEqual(await readFile(good.patch), before);
  await writeFile(f.entry, 'export function apply(ctx) { ctx.value = "recovered"; }');
  assert.equal((await f.runtime.build()).status, "published");
});

test("refuses a non-owned home and preserves its files", async () => {
  const f = await fixture();
  const home = path.join(f.home, "unowned"); await mkdir(home);
  await writeFile(path.join(home, "settings.yaml"), "untouched");
  await assert.rejects(createPluginRuntime({ entry: f.entry, home }), /empty experiment home/);
  assert.deepEqual(await readdir(home), ["settings.yaml"]);
});

test("refuses a modified Profile manifest and manually changed patch", async () => {
  const f = await fixture();
  const good = await f.runtime.build();
  await writeFile(good.patch, JSON.stringify([{ insert: [{ id: "personal", name: "my-plugin" }] }]));
  assert.equal((await f.runtime.build()).status, "failed");
  assert.equal(JSON.parse(await readFile(good.patch, "utf8"))[0].insert[0].id, "personal");
  const extraPatch = [{ insert: [{ id: "harness-wasm-plugin", name: `./modules/${good.revision}.mjs` }], remove: ["personal"] }];
  await writeFile(good.patch, JSON.stringify(extraPatch));
  assert.equal((await f.runtime.build()).status, "failed");
  assert.deepEqual(JSON.parse(await readFile(good.patch, "utf8")), extraPatch);
  await writeFile(path.join(f.runtime.profile, "package.json"), "{}");
  await assert.rejects(createPluginRuntime({ entry: f.entry, home: f.home }), /manifest was changed/);
});

test("concurrent writers are excluded, then retry works; corrupt immutable modules fail closed", async () => {
  const f = await fixture();
  const lock = path.join(f.home, ".compiler-lock");
  await mkdir(lock);
  assert.equal((await f.runtime.build()).status, "failed");
  assert.deepEqual(await readdir(lock), []);
  await rm(lock, { recursive: true });
  const good = await f.runtime.build();
  await writeFile(good.artifact, "corrupt");
  const failed = await f.runtime.build();
  assert.equal(failed.status, "failed");
  assert.match(failed.diagnostics[0].text, /digest/);
});

test("disposal drains accepted builds, removes the writer lock and rejects later builds", async () => {
  const f = await fixture();
  const pending = f.runtime.build();
  await f.runtime.dispose();
  assert.equal((await pending).status, "published");
  assert.ok(!(await readdir(f.home)).includes(".compiler-lock"));
  await assert.rejects(f.runtime.build(), /disposed/);
  await f.runtime.dispose();
});

test("stages without changing the live patch and publishes only a verified immutable revision", async () => {
  const f = await fixture();
  const initial = await f.runtime.build();
  const before = await readFile(initial.patch);
  await writeFile(f.helper, 'export const value = "staged";');
  const candidate = await f.runtime.build({ publish: false });
  assert.equal(candidate.status, "compiled");
  assert.deepEqual(await readFile(initial.patch), before);
  await f.runtime.publish(candidate);
  assert.equal(JSON.parse(await readFile(initial.patch, "utf8"))[0].insert[0].name, `./modules/${candidate.revision}.mjs`);
  const good = await readFile(initial.patch);
  await writeFile(initial.artifact, "tampered");
  await assert.rejects(f.runtime.publish(initial), /digest/);
  await assert.rejects(f.runtime.publish({ revision: "../outside" }), /Invalid/);
  assert.deepEqual(await readFile(initial.patch), good);
});
