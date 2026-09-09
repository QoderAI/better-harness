// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from PR #448: caret-bound plain-text suggestions, scoped to Studio.
export interface PromptSuggestion {
  id: string;
  trigger: "/" | "@";
  label: string;
  description?: string;
  value: string;
}
export interface PromptMatch { trigger: "/" | "@"; query: string; start: number; end: number }

export function findPromptMatch(value: string, start: number, end = start): PromptMatch | undefined {
  if (start !== end || start < 0 || start > value.length) return;
  const before = value.slice(0, start);
  for (let index = before.length - 1; index >= 0; index--) {
    const trigger = before[index];
    if (/\s/u.test(trigger!)) return;
    if (trigger !== "/" && trigger !== "@") continue;
    const previous = before[index - 1];
    if (index !== 0 && (trigger === "/" ? previous !== "\n" : !/\s/u.test(previous!))) continue;
    return { trigger, query: before.slice(index + 1), start: index, end: start };
  }
}

export function replacePromptMatch(value: string, match: PromptMatch, insertion: string): { value: string; caret: number } {
  const suffix = value.slice(match.end);
  const text = insertion + (suffix.startsWith(" ") ? "" : " ");
  return { value: value.slice(0, match.start) + text + suffix, caret: match.start + text.length };
}
