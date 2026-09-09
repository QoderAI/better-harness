import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreviewWithWasm, unpackedBuildInputPath } from "../src/server/artifacts/registry/esbuild-wasm-runtime.js";

describe('production packager process paths', () => {
  it('resolves the unpacked closure on POSIX, Windows drives and UNC roots', () => {
    for (const [paths, root] of [[posix, '/Applications/Studio.app/Contents/Resources'], [win32, 'C:\\Program Files\\Studio\\resources'], [win32, '\\\\server\\share\\Studio\\resources']] as const) {
      const module = paths.join(root, 'app.asar', 'node_modules', 'esbuild-wasm', 'lib', 'main.js');
      expect(unpackedBuildInputPath(module, paths)).toBe(paths.join(root, 'app.asar.unpacked', 'node_modules', 'esbuild-wasm', 'lib', 'main.js'));
      const ordinary = paths.join(root, 'node_modules', 'esbuild-wasm', 'lib', 'main.js');
      expect(unpackedBuildInputPath(ordinary, paths)).toBe(ordinary);
    }
  });

  it('executes the preserved WASM packager with host plugin callbacks', async () => {
    const result = await buildPreviewWithWasm({ entryPoints: ['fixture'], bundle: true, write: false, format: 'esm',
      plugins: [{ name: 'fixture', setup(api) {
        api.onResolve({ filter: /^fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
        api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default 42;', loader: 'js' }));
      } }],
    });
    expect(result.errors).toEqual([]);
    const module = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles![0]!.text)}`);
    expect(module.default).toBe(42);
  });
});
