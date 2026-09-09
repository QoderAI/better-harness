// Bundle the React app with the repo-conventional esbuild-wasm toolchain.
import { appDir, buildStudioApp, buildStudioServerRuntime } from "./app-build.mjs";
await buildStudioApp();
// Studio owns the on-demand collection lifecycle, while the existing MJS
// capability remains the no-install public entrypoint. Bundle that capability
// into the server distribution so the npm package and direct scripts share the
// same provider implementations without making browser code import them.
await buildStudioServerRuntime();
process.stdout.write(`Built studio app into ${appDir}\n`);
process.exit(0);
