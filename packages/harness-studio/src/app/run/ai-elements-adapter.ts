import type { ToolState } from "../components/ai-elements/tool.js";
import type { TimelineItem } from "./run-store.js";

type ToolStatus = Extract<TimelineItem, { kind: "tool-call" }>["status"];
const toolStates: Record<ToolStatus, ToolState> = {
  preparing: "input-streaming", running: "input-available", completed: "output-available",
  failed: "output-error", "result-unavailable": "output-unavailable", interrupted: "interrupted",
};
export function toolElementState(status: ToolStatus): ToolState { return toolStates[status]; }
export function planElementState(status: "pending" | "in_progress" | "completed"): "pending" | "active" | "complete" {
  return status === "completed" ? "complete" : status === "in_progress" ? "active" : "pending";
}
