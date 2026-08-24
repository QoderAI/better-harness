const NESTED_TOOL_CALL_RE = /\btools\.([A-Za-z_$][\w$]*)\s*\(/gu;

function displayNestedToolName(name, commandText) {
  if (name === "mcp__node_repl__js") {
    return /(?:browser|Tab|playwright|goto|screenshot)/u.test(commandText) ? "browser" : "node_repl";
  }
  if (name === "web__run") return "web";
  return name.startsWith("mcp__") ? name.slice(5).replaceAll("__", "/") : name;
}

// Codex records the outer orchestration call as `exec`, while the invocation
// source names the actual nested capability. Use the last nested call because
// generated source can contain earlier `tools.*` examples inside string data;
// the executable call is conventionally the final occurrence.
export function attributeSessionToolName(event) {
  const toolName = String(event?.toolName ?? event?.functionCallName ?? "unknown-tool");
  if (toolName !== "exec") return toolName;
  const commandText = String(event?.commandText ?? "");
  const matches = [...commandText.matchAll(NESTED_TOOL_CALL_RE)];
  const nestedName = matches.at(-1)?.[1] ?? null;
  if (nestedName) return displayNestedToolName(nestedName, commandText);
  if (/\bALL_TOOLS\.(?:filter|find|map)\s*\(/u.test(commandText)) return "tool_search";
  return toolName;
}
