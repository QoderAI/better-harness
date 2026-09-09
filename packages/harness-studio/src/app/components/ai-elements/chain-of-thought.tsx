// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: one Radix disclosure root, Studio icons/tokens.
import * as Collapsible from "@radix-ui/react-collapsible";
import { Brain } from "@phosphor-icons/react/Brain";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Circle } from "@phosphor-icons/react/Circle";
import { CircleHalf } from "@phosphor-icons/react/CircleHalf";
import { memo, type ComponentProps, type ReactNode } from "react";

export const ChainOfThought = memo(({ className = "", ...props }: ComponentProps<typeof Collapsible.Root>) => (
  <Collapsible.Root className={`ai-chain ${className}`} {...props} />
));

export const ChainOfThoughtHeader = memo(({ className = "", children, ...props }: ComponentProps<typeof Collapsible.Trigger>) => (
  <Collapsible.Trigger className={`ai-chain-header ${className}`} {...props}>
    <Brain size={15} aria-hidden="true" /><span>{children}</span><CaretDown className="ai-disclosure-chevron" size={14} aria-hidden="true" />
  </Collapsible.Trigger>
));

export const ChainOfThoughtContent = memo(({ className = "", ...props }: ComponentProps<typeof Collapsible.Content>) => (
  <Collapsible.Content className={`ai-chain-content ${className}`} {...props} />
));

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending";
};
export const ChainOfThoughtStep = memo(({ className = "", label, description, status = "complete", children, ...props }: ChainOfThoughtStepProps) => {
  const Icon = status === "complete" ? CheckCircle : status === "active" ? CircleHalf : Circle;
  return <div className={`ai-chain-step ${className}`} data-status={status} {...props}>
    <div className="ai-chain-step-icon"><Icon size={15} aria-hidden="true" /></div>
    <div className="ai-chain-step-body"><div>{label}</div>{description && <div className="ai-chain-description">{description}</div>}{children}</div>
  </div>;
});
