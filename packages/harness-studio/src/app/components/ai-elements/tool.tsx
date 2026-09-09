// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: local display-state union, Phosphor icons, renderer slots.
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Circle } from "@phosphor-icons/react/Circle";
import { Clock } from "@phosphor-icons/react/Clock";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { XCircle } from "@phosphor-icons/react/XCircle";
import { MinusCircle } from "@phosphor-icons/react/MinusCircle";
import type { ComponentProps, ReactNode } from "react";

/** AI Elements states plus explicit ACP terminal states with no successful result. */
export type ToolState = "input-streaming" | "input-available" | "approval-requested" | "approval-responded" | "output-available" | "output-error" | "output-denied" | "output-unavailable" | "interrupted";
export const Tool = ({ className = "", ...props }: ComponentProps<typeof Collapsible.Root>) => (
  <Collapsible.Root className={`ai-tool ${className}`} {...props} />
);

const statusIcons = {
  "input-streaming": Circle, "input-available": Clock, "approval-requested": Clock,
  "approval-responded": CheckCircle, "output-available": CheckCircle,
  "output-error": XCircle, "output-denied": XCircle,
  "output-unavailable": MinusCircle, interrupted: MinusCircle,
};

export type ToolHeaderProps = ComponentProps<typeof Collapsible.Trigger> & { title: string; state: ToolState; statusLabel: string; summary?: string };
export const ToolHeader = ({ className = "", title, state, statusLabel, summary, ...props }: ToolHeaderProps) => {
  const StatusIcon = statusIcons[state];
  return <Collapsible.Trigger className={`ai-tool-header ${className}`} {...props}>
    <Wrench className="ai-tool-icon" size={15} aria-hidden="true" />
    <span className="ai-tool-title"><strong>{title}</strong>{summary && <code>{summary}</code>}</span>
    <span className="ai-tool-status" data-status={state} aria-live="polite"><StatusIcon size={14} aria-hidden="true" />{statusLabel}</span>
    <CaretDown className="ai-disclosure-chevron" size={14} aria-hidden="true" />
  </Collapsible.Trigger>;
};

export const ToolContent = ({ className = "", ...props }: ComponentProps<typeof Collapsible.Content>) => (
  <Collapsible.Content className={`ai-tool-content ${className}`} {...props} />
);

/** Payloads stay in Studio's existing bounded code viewer, including falsy values. */
export const ToolInput = ({ label, children, ...props }: ComponentProps<"section"> & { label: string }) => (
  <section className="ai-tool-input" {...props}><h4>{label}</h4>{children}</section>
);
export const ToolOutput = ({ label, output, children, ...props }: ComponentProps<"section"> & { label: string; output?: ReactNode }) => (
  <section className="ai-tool-output" {...props}><h4>{label}</h4>{output}{children}</section>
);
