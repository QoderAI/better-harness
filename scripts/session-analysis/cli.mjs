export function parseBooleanFlag(value) {
  if (value === undefined || value === true) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

export function parseArgs(argv) {
  const args = [...argv];
  // Only treat a leading non-flag token as the positional command. A leading
  // flag such as `--json` or `--platform` must be parsed as an option, not
  // mistaken for the command. Consumers apply their own default command.
  const command = args.length > 0 && !args[0].startsWith("-") ? args.shift() : undefined;
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const withoutPrefix = arg.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    if (eqIndex !== -1) {
      const key = withoutPrefix.slice(0, eqIndex);
      options[key] = withoutPrefix.slice(eqIndex + 1);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[withoutPrefix] = true;
    } else {
      options[withoutPrefix] = next;
      index += 1;
    }
  }

  return { command, options };
}
