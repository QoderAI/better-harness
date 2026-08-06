#!/usr/bin/env node

import { main } from "./cli.mjs";

process.exitCode = await main(["host-doctor", ...process.argv.slice(2)]);
