import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";

import { installJsonschemaNodeUrlCompatibility } from "../scripts/jsonschema-node-url-compat.mjs";

const require = createRequire(import.meta.url);
const { Validator, SchemaError } = require("jsonschema");

describe("jsonschema Node URL compatibility", () => {
  beforeAll(() => installJsonschemaNodeUrlCompatibility());

  it("resolves a local fragment on a schema without an id", () => {
    const schema = {
      $ref: "#/$defs/value",
      $defs: { value: { type: "object" } },
    };

    expect(new Validator().validate({}, schema).valid).toBe(true);
    expect(new Validator().validate(1, schema).valid).toBe(false);
  });

  it("keeps an unknown document on the schema-error path", () => {
    const schema = { $ref: "missing.json#/$defs/value" };
    expect(() => new Validator().validate({}, schema)).toThrow(SchemaError);
  });
});
