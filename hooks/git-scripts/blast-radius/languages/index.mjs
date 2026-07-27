import * as go from "./go.mjs";
import * as javascriptLike from "./javascript-like.mjs";
import * as python from "./python.mjs";

export const LANGUAGE_ADAPTERS = {
  go,
  javascript: javascriptLike,
  typescript: javascriptLike,
  tsx: javascriptLike,
  python,
};
