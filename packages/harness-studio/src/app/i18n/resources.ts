import { namespaces as enNamespaces } from "./en/index.js";
import { namespaces as zhCNNamespaces } from "./zh-CN/index.js";

/** Bundled translation payload for every supported language. */
export const resources = {
  en: enNamespaces,
  "zh-CN": zhCNNamespaces,
} as const;

export type StudioResources = typeof resources;