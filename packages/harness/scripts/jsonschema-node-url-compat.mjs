import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Validator, SchemaError } = require("jsonschema");
const { objectGetPath } = require("jsonschema/lib/helpers");
const { version } = require("jsonschema/package.json");

const SUPPORTED_JSONSCHEMA_VERSION = "1.5.0";

/**
 * Carry the focused resolution fix from tdegrunt/jsonschema#424 until it is
 * available in a released langium-cli dependency. Node 24.20+ rejects the
 * opaque URL base used by jsonschema 1.5.0 for local fragment references.
 */
export function installJsonschemaNodeUrlCompatibility() {
  if (version !== SUPPORTED_JSONSCHEMA_VERSION) {
    throw new Error(
      `Unsupported jsonschema version ${version}; review whether the Node URL compatibility layer is still required.`,
    );
  }

  Validator.prototype.resolve = function resolve(schema, switchSchema, context) {
    const resolvedSchema = context.resolve(switchSchema);
    if (context.schemas[resolvedSchema]) {
      return { subschema: context.schemas[resolvedSchema], switchSchema: resolvedSchema };
    }

    const hashIndex = resolvedSchema.indexOf("#");
    const fragment = hashIndex === -1 || hashIndex === resolvedSchema.length - 1 ? "" : resolvedSchema.slice(hashIndex);
    const document = fragment && resolvedSchema.slice(0, resolvedSchema.length - fragment.length);
    if (!document || !context.schemas[document]) {
      throw new SchemaError(`no such schema <${resolvedSchema}>`, schema);
    }
    const subschema = objectGetPath(context.schemas[document], fragment.slice(1));
    if (subschema === undefined) {
      throw new SchemaError(`no such schema ${fragment} located in <${document}>`, schema);
    }
    return { subschema, switchSchema: resolvedSchema };
  };
}
