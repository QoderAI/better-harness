/**
 * Layer 2 — esbuild Linker.
 *
 * Resolves modules over the Revision's virtual filesystem, externalizes the
 * trusted runtime packages, and emits one ESM bundle. It only ever sees code the
 * kernel already admitted, so it performs no transform of its own: the Profile
 * decides what is allowed, and this layer decides how it is wired together.
 *
 * It is the only layer allowed to import `esbuild-wasm`.
 */

export {
  createAllowedPackageResolver,
  REQUIRED_RUNTIME_SPECIFIERS,
  type AllowedPackageResolver,
  type TrustedRuntimePackage,
} from "./allowed-packages.js";
export { LINK_ENTRY, linkArtifactBundle, type LinkInput, type LinkResult } from "./esbuild-linker.js";
