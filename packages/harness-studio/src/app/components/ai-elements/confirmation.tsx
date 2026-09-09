// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: native controls, explicit labels and ACP option actions.
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import type { ToolState } from "./tool.js";

type Approval = { id: string; approved?: boolean; reason?: string };
const ConfirmationContext = createContext<{ approval: Approval; state: ToolState } | null>(null);
function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) throw new Error("Confirmation components must be used within Confirmation");
  return context;
}

export const Confirmation = ({ className = "", approval, state, ...props }: ComponentProps<"section"> & { approval?: Approval; state: ToolState }) => {
  const value = useMemo(() => approval ? { approval, state } : null, [approval, state]);
  if (!value || state === "input-streaming" || state === "input-available") return null;
  return <ConfirmationContext.Provider value={value}><section className={`ai-confirmation ${className}`} {...props} /></ConfirmationContext.Provider>;
};
export const ConfirmationTitle = (props: ComponentProps<"strong">) => <strong className="ai-confirmation-title" {...props} />;
export const ConfirmationRequest = ({ children }: { children: ReactNode }) => useConfirmation().state === "approval-requested" ? children : null;
export const ConfirmationActions = ({ className = "", ...props }: ComponentProps<"div">) => useConfirmation().state === "approval-requested" ? <div className={`ai-confirmation-actions ${className}`} {...props} /> : null;
export const ConfirmationAction = (props: ComponentProps<"button">) => <button type="button" {...props} />;
