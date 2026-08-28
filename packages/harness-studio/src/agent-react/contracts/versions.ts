/**
 * Versions that make a Build Snapshot replayable.
 *
 * These are separate from the package version on purpose: a snapshot is only
 * reproducible if the Profile rules, the runtime ABI, and the compiler that
 * translated it are all pinned, and those three move independently.
 */

export const AGENT_REACT_PROFILE_VERSION = "1";
export const AGENT_REACT_RUNTIME_VERSION = "1";
export const AGENT_REACT_RUNTIME_PACKAGE = "@studio/agent-react";
export const AGENT_REACT_JSX_DEV_PACKAGE = "@studio/agent-react/jsx-dev-runtime";
