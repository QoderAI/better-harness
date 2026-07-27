export const MODEL_PRICING_SCHEMA_VERSION = 1;

const TOKEN_RATE_FIELDS = Object.freeze({
  inputTokens: "inputPerMillion",
  outputTokens: "outputPerMillion",
  cacheReadInputTokens: "cacheReadPerMillion",
  cacheCreationInputTokens: "cacheCreationPerMillion",
});

export function validateModelPricing(table) {
  const errors = [];
  if (!table || typeof table !== "object" || Array.isArray(table)) return ["pricing table must be an object"];
  if (table.schemaVersion !== MODEL_PRICING_SCHEMA_VERSION) errors.push(`pricing schemaVersion must be ${MODEL_PRICING_SCHEMA_VERSION}`);
  if (typeof table.version !== "string" || !table.version.trim()) errors.push("pricing version is required");
  if (typeof table.currency !== "string" || !/^[A-Z]{3}$/u.test(table.currency)) errors.push("pricing currency must be a three-letter code");
  if (!table.models || typeof table.models !== "object" || Array.isArray(table.models)) {
    errors.push("pricing models must be an object");
    return errors;
  }
  for (const [model, rates] of Object.entries(table.models)) {
    if (!model.trim()) errors.push("pricing model names must not be empty");
    for (const field of Object.values(TOKEN_RATE_FIELDS)) {
      if (rates?.[field] !== undefined && (!Number.isFinite(Number(rates[field])) || Number(rates[field]) < 0)) {
        errors.push(`pricing model ${model}.${field} must be a non-negative number`);
      }
    }
    if (!Number.isFinite(Number(rates?.inputPerMillion)) || !Number.isFinite(Number(rates?.outputPerMillion))) {
      errors.push(`pricing model ${model} requires inputPerMillion and outputPerMillion`);
    }
  }
  return errors;
}

export function calculateExactModelCost(responses = [], table) {
  const errors = validateModelPricing(table);
  if (errors.length > 0) return { available: false, reason: "invalid-pricing-table", errors };
  if (responses.length === 0) return { available: false, reason: "no-model-responses" };
  const missingModels = new Set();
  let amount = 0;
  for (const response of responses) {
    if (!response?.model || !hasCompleteUsage(response)) {
      return { available: false, reason: "incomplete-response-usage", missingModels: [] };
    }
    const rates = table.models[response.model];
    if (!rates) {
      missingModels.add(response.model);
      continue;
    }
    for (const [tokenField, rateField] of Object.entries(TOKEN_RATE_FIELDS)) {
      const tokens = Number(response.modelUsage?.[tokenField] ?? 0);
      const rate = Number(rates[rateField] ?? 0);
      amount += (tokens * rate) / 1_000_000;
    }
  }
  if (missingModels.size > 0) {
    return { available: false, reason: "missing-model-rates", missingModels: [...missingModels].sort() };
  }
  return {
    available: true,
    amount: Number(amount.toFixed(8)),
    currency: table.currency,
    pricingVersion: table.version,
  };
}

function hasCompleteUsage(response) {
  return response.usageFieldsObserved === true
    && response.modelUsage
    && Number.isFinite(Number(response.modelUsage.inputTokens))
    && Number.isFinite(Number(response.modelUsage.outputTokens));
}
