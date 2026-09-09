// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: Studio tokens and bounded Streamdown rendering.
import { memo, type ComponentProps } from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { responseMarkdownComponents } from "./response-markdown.js";

export type MessageProps = ComponentProps<"div"> & { from: "user" | "assistant" | "system" };

export const Message = ({ className = "", from, ...props }: MessageProps) => (
  <div className={`ai-message is-${from} ${className}`} data-role={from} {...props} />
);

export const MessageContent = ({ className = "", ...props }: ComponentProps<"div">) => (
  <div className={`ai-message-content ${className}`} {...props} />
);

const plugins = { cjk };
/** Stream and settled response use the same Markdown tree and Studio code renderer. */
export const MessageResponse = memo(({ className = "", ...props }: StreamdownProps) => (
  <Streamdown className={`ai-message-response markdown-document ${className}`} plugins={plugins} components={responseMarkdownComponents} controls={false} skipHtml {...props} />
));
