// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements: native bounded scrolling and Studio control shapes.
import { useCallback, type ComponentProps } from "react";

export const Suggestions = ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ai-suggestions ${className}`} {...props} />;
export type SuggestionProps = Omit<ComponentProps<"button">, "onClick"> & { suggestion: string; onClick?: (suggestion: string) => void };
export const Suggestion = ({ suggestion, onClick, className = "", children, ...props }: SuggestionProps) => {
  const handleClick = useCallback(() => onClick?.(suggestion), [onClick, suggestion]);
  return <button className={`ai-suggestion ${className}`} type="button" onClick={handleClick} {...props}>{children || suggestion}</button>;
};
