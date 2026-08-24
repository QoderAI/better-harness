import {
  cliErrorEnvelope,
  commandEnvelope,
  exitCodeFor,
  LifecycleCliError,
  withTimeout,
} from "./contract.mjs";

const COMMON_VALUE_OPTIONS = Object.freeze({
  "--workspace": "workspace",
  "--host-home": "hostHome",
  "--timeout": "timeout",
});

const BOOLEAN_OPTIONS = Object.freeze({
  "--json": "json",
  "--no-color": "noColor",
  "--help": "help",
  "-h": "help",
});

function assignOption(options, seen, key, value, name) {
  if (seen.has(key)) {
    throw new LifecycleCliError(
      "DUPLICATE_OPTION",
      `Option ${name} may be supplied only once.`,
      { kind: "usage" },
    );
  }
  if (typeof value === "string" && value.length === 0) {
    throw new LifecycleCliError(
      "MISSING_OPTION_VALUE",
      `Missing value for ${name}.`,
      { kind: "usage" },
    );
  }
  seen.add(key);
  options[key] = value;
}

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("-")) {
    throw new LifecycleCliError(
      "MISSING_OPTION_VALUE",
      `Missing value for ${name}.`,
      { kind: "usage" },
    );
  }
  return value;
}

export function parseReadOnlyOptions(argv, {
  valueOptions = {},
  defaults = {},
  helpWord = true,
} = {}) {
  const knownValues = { ...COMMON_VALUE_OPTIONS, ...valueOptions };
  const options = {
    json: false,
    noColor: false,
    help: false,
    ...defaults,
  };
  const positionals = [];
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const booleanKey = BOOLEAN_OPTIONS[argument];
    if (booleanKey) {
      assignOption(options, seen, booleanKey, true, argument);
      continue;
    }
    if (helpWord && argument === "help") {
      assignOption(options, seen, "help", true, "help");
      continue;
    }
    if (argument.startsWith("--")) {
      const equalsAt = argument.indexOf("=");
      const name = equalsAt === -1 ? argument : argument.slice(0, equalsAt);
      const key = knownValues[name];
      if (!key) {
        throw new LifecycleCliError(
          "UNKNOWN_OPTION",
          `Unknown option: ${name}`,
          { kind: "usage" },
        );
      }
      const value = equalsAt === -1
        ? optionValue(argv, index, name)
        : argument.slice(equalsAt + 1);
      assignOption(options, seen, key, value, name);
      if (equalsAt === -1) index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new LifecycleCliError(
        "UNKNOWN_OPTION",
        `Unknown option: ${argument}`,
        { kind: "usage" },
      );
    }
    positionals.push(argument);
  }

  return { options, positionals };
}

export function normalizeReadOnlyTimeout(options, {
  defaultTimeout = 5000,
  maximumTimeout = 60_000,
} = {}) {
  if (options.help) return options;
  const timeout = options.timeout == null ? defaultTimeout : Number(options.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > maximumTimeout) {
    throw new LifecycleCliError(
      "INVALID_TIMEOUT",
      `--timeout must be an integer from 1 to ${maximumTimeout} milliseconds.`,
      { kind: "usage" },
    );
  }
  return { ...options, timeout };
}

function defaultEnvelope({ command, result, durationMs }) {
  return commandEnvelope({
    command,
    status: result.status,
    data: result,
    diagnostics: result.diagnostics ?? [],
    durationMs,
  });
}

export async function runReadOnlyCommand({
  argv,
  command,
  parse,
  usage,
  prepare = async (options) => options,
  execute,
  envelope = defaultEnvelope,
  renderHuman,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const startedAt = Date.now();
  const machineRequested = argv.includes("--json");
  let options;
  try {
    options = parse(argv);
    if (options.help) {
      stdout.write(usage());
      return 0;
    }
    options = await prepare(options);
    const result = await withTimeout(() => execute(options), options.timeout);
    if (options.json) {
      stdout.write(`${JSON.stringify(envelope({
        command,
        result,
        durationMs: Date.now() - startedAt,
      }), null, 2)}\n`);
    } else {
      stdout.write(renderHuman(result));
    }
    return exitCodeFor(result.status);
  } catch (error) {
    const failure = cliErrorEnvelope(command, error, Date.now() - startedAt);
    if (machineRequested || options?.json) {
      stdout.write(`${JSON.stringify(failure.envelope, null, 2)}\n`);
    } else {
      const hint = error instanceof LifecycleCliError ? error.hint : undefined;
      stderr.write(`${failure.envelope.diagnostics[0].message}${hint ? `\n\n${hint}` : ""}\n`);
    }
    return failure.exitCode;
  }
}
