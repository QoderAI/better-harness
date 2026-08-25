import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

function environmentTarget(name) {
  const value = process.env[name];
  return value ? path.resolve(value) : null;
}

const publishTarget = environmentTarget("BETTER_HARNESS_FAIL_PUBLISH_TARGET");
const rollbackTarget = environmentTarget("BETTER_HARNESS_FAIL_ROLLBACK_TARGET");
const rename = fs.promises.rename;
let publicationFailed = false;
let rollbackFailed = false;

fs.promises.rename = async (source, destination, ...args) => {
  if (
    !publicationFailed
    && publishTarget
    && path.resolve(destination) === publishTarget
    && path.basename(source).includes(".staging-")
  ) {
    publicationFailed = true;
    const error = new Error("injected report publication failure");
    error.code = "EIO";
    throw error;
  }
  if (
    publicationFailed
    && !rollbackFailed
    && rollbackTarget
    && path.resolve(destination) === rollbackTarget
    && path.basename(source).includes(".backup-")
  ) {
    rollbackFailed = true;
    const error = new Error("injected report rollback failure");
    error.code = "EIO";
    throw error;
  }
  return rename(source, destination, ...args);
};

syncBuiltinESMExports();
