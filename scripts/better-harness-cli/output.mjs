import { FORMAT_VERSION } from "./registry.mjs";

export function successPayload(data) {
  return {
    ok: true,
    format_version: FORMAT_VERSION,
    data,
  };
}

export function errorPayload({ code, message, hint, retryable }) {
  return {
    ok: false,
    format_version: FORMAT_VERSION,
    error: {
      code,
      message,
      ...(hint ? { hint } : {}),
      ...(retryable === undefined ? {} : { retryable }),
    },
  };
}

export function jsonDocument(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
