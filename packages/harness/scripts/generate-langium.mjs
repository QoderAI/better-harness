import { installJsonschemaNodeUrlCompatibility } from "./jsonschema-node-url-compat.mjs";

installJsonschemaNodeUrlCompatibility();

const { generate } = await import("langium-cli");
const success = await generate({});
if (!success) process.exitCode = 2;
