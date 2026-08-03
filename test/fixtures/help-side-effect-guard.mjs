import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const allowedRoot = path.resolve(process.env.BETTER_HARNESS_HELP_GUARD_ALLOWED_ROOT ?? process.cwd());
const expectedOwner = process.env.BETTER_HARNESS_HELP_GUARD_OWNER
  ? path.resolve(process.env.BETTER_HARNESS_HELP_GUARD_OWNER)
  : undefined;
const expectedOwnerArgs = process.env.BETTER_HARNESS_HELP_GUARD_OWNER_ARGS
  ? JSON.parse(process.env.BETTER_HARNESS_HELP_GUARD_OWNER_ARGS)
  : undefined;
const dispatcher = process.env.BETTER_HARNESS_HELP_GUARD_DISPATCHER
  ? path.resolve(process.env.BETTER_HARNESS_HELP_GUARD_DISPATCHER)
  : undefined;

function blocked(kind) {
  const error = new Error(`HELP_GUARD_${kind}`);
  error.code = `HELP_GUARD_${kind}`;
  throw error;
}

function localPath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString();
  return undefined;
}

function mayRead(value) {
  if (typeof value === "number") {
    if (value === 0) blocked("STDIN");
    return true;
  }
  const candidate = localPath(value);
  if (!candidate) blocked("READ");
  const relative = path.relative(allowedRoot, path.resolve(candidate));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return true;
  }
  blocked("READ");
}

function guardRead(object, name) {
  const original = object[name];
  if (typeof original !== "function") return;
  object[name] = function guardedRead(value, ...rest) {
    mayRead(value);
    return original.call(this, value, ...rest);
  };
}

function guardWrite(object, name) {
  const original = object[name];
  if (typeof original !== "function") return;
  object[name] = function guardedWrite() {
    blocked("WRITE");
  };
}

function opensForWriting(flags) {
  if (typeof flags === "number") {
    return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_TRUNC)) !== 0;
  }
  return /[wa+]/u.test(String(flags ?? "r"));
}

function guardOpen(object, name) {
  const original = object[name];
  if (typeof original !== "function") return;
  object[name] = function guardedOpen(value, flags, ...rest) {
    if (opensForWriting(flags)) blocked("WRITE");
    mayRead(value);
    return original.call(this, value, flags, ...rest);
  };
}

for (const name of [
  "accessSync", "createReadStream", "existsSync", "lstatSync", "opendirSync",
  "readFileSync", "readdirSync", "readlinkSync", "realpathSync", "statSync", "watch", "watchFile",
]) {
  guardRead(fs, name);
}
for (const name of ["access", "opendir", "readFile", "readdir", "readlink", "realpath", "stat", "lstat", "watch"]) {
  guardRead(fsPromises, name);
}
guardOpen(fs, "openSync");
guardOpen(fsPromises, "open");
for (const name of [
  "appendFileSync", "chmodSync", "chownSync", "copyFileSync", "cpSync", "createWriteStream", "mkdirSync",
  "renameSync", "rmSync", "rmdirSync", "truncateSync", "unlinkSync", "utimesSync", "writeFileSync",
]) {
  guardWrite(fs, name);
}
for (const name of ["appendFile", "chmod", "chown", "copyFile", "cp", "mkdir", "rename", "rm", "rmdir", "truncate", "unlink", "utimes", "writeFile"]) {
  guardWrite(fsPromises, name);
}

function isExpectedOwner(command, args) {
  return expectedOwner
    && dispatcher
    && process.argv[1]
    && path.resolve(process.argv[1]) === dispatcher
    && path.resolve(command) === path.resolve(process.execPath)
    && Array.isArray(args)
    && path.resolve(args[0]) === expectedOwner
    && JSON.stringify(args.slice(1)) === JSON.stringify(expectedOwnerArgs);
}

for (const name of ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]) {
  const original = childProcess[name];
  if (typeof original !== "function") continue;
  childProcess[name] = function guardedProcess(command, args, ...rest) {
    if (name === "spawnSync" && isExpectedOwner(command, args)) {
      return original.call(this, command, args, ...rest);
    }
    return blocked("PROCESS");
  };
}

for (const [object, names] of [
  [net, ["connect", "createConnection"]],
  [tls, ["connect"]],
  [http, ["get", "request"]],
  [https, ["get", "request"]],
]) {
  for (const name of names) {
    if (typeof object[name] === "function") object[name] = () => blocked("NETWORK");
  }
}
net.Socket.prototype.connect = () => blocked("NETWORK");
globalThis.fetch = () => blocked("NETWORK");

Object.defineProperty(process, "stdin", {
  configurable: true,
  get() {
    return blocked("STDIN");
  },
});

syncBuiltinESMExports();
