import claude from "./profiles/claude.mjs";
import codex from "./profiles/codex.mjs";
import qoder from "./profiles/qoder.mjs";
import cursor from "./profiles/cursor.mjs";
import qwen from "./profiles/qwen.mjs";
import copilot from "./profiles/copilot.mjs";
import pi from "./profiles/pi.mjs";
import workbuddy from "./profiles/workbuddy.mjs";

export { HOST_SUPPORT_SCHEMA_VERSION } from "./profile-builders.mjs";

export const HOST_PROFILES = Object.freeze([
  claude,
  codex,
  qoder,
  cursor,
  qwen,
  copilot,
  pi,
  workbuddy,
]);
