// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: token styles, instant motion and a labelled scroll action.
import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;
export const Conversation = ({ className = "", ...props }: ConversationProps) => (
  <StickToBottom className={`ai-conversation ${className}`} initial="instant" resize="instant" role="log" {...props} />
);

export const ConversationContent = ({ className = "", scrollClassName = "", ...props }: ComponentProps<typeof StickToBottom.Content>) => (
  <StickToBottom.Content className={`ai-conversation-content ${className}`} scrollClassName={`ai-conversation-scroll ${scrollClassName}`} {...props} />
);

export const ConversationEmptyState = ({ className = "", title, description, children, ...props }: ComponentProps<"div"> & { title?: string; description?: string }) => (
  <div className={`ai-conversation-empty ${className}`} {...props}>{children ?? <><strong>{title}</strong>{description && <p>{description}</p>}</>}</div>
);

export const ConversationScrollButton = ({ className = "", children, onClick, ...props }: ComponentProps<"button">) => {
  const { isAtBottom, scrollToBottom, scrollRef } = useStickToBottomContext();
  return !isAtBottom && <button className={`ai-conversation-latest ${className}`} type="button" {...props} onClick={event => {
    void scrollToBottom({ animation: "instant" });
    scrollRef.current?.focus({ preventScroll: true });
    onClick?.(event);
  }}><ArrowDown size={14} aria-hidden="true" />{children}</button>;
};
