/** Browser-safe ACP configuration projection shared with action validation. */
export interface AcpConfigChoice { value: string; name: string; description?: string; group?: string }
export interface AcpConfigOption {
  id: string; name: string; description?: string; category?: string;
  type: "select" | "boolean" | "unknown"; value: string | boolean;
  choices: AcpConfigChoice[];
}
export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function parseAcpConfig(value: unknown): AcpConfigOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: AcpConfigOption[] = [];
  for (const raw of value) {
    const option = recordValue(raw);
    if (typeof option?.id !== "string" || typeof option.name !== "string"
      || (typeof option.currentValue !== "string" && typeof option.currentValue !== "boolean")) continue;
    const choices: AcpConfigChoice[] = [];
    for (const item of Array.isArray(option.options) ? option.options : []) {
      const group = recordValue(item);
      const values = Array.isArray(group?.options) ? group.options : [item];
      for (const value of values) {
        const choice = recordValue(value);
        if (typeof choice?.value === "string" && typeof choice.name === "string") choices.push({
          value: choice.value, name: choice.name,
          ...(typeof choice.description === "string" ? { description: choice.description } : {}),
          ...(Array.isArray(group?.options) && typeof group.name === "string" ? { group: group.name } : {}),
        });
      }
    }
    result.push({ id: option.id, name: option.name, value: option.currentValue,
      type: option.type === "boolean" && typeof option.currentValue === "boolean" ? "boolean"
        : option.type === "select" && typeof option.currentValue === "string" ? "select" : "unknown", choices,
      ...(typeof option.description === "string" ? { description: option.description } : {}),
      ...(typeof option.category === "string" ? { category: option.category } : {}),
    });
  }
  return result;
}
export function acceptsAcpConfig(option: AcpConfigOption, value: unknown): value is string | boolean {
  return option.type === "boolean" ? typeof value === "boolean"
    : option.type === "select" && typeof value === "string" && option.choices.some((choice) => choice.value === value);
}
