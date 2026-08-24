function renderJsonData(value) {
  return JSON.stringify(value)
    .replaceAll("$", "\\u0024")
    .replaceAll("`", "\\u0060")
    .replaceAll("%", "\\u0025")
    .replaceAll("!", "\\u0021");
}

function renderArg(value) {
  return /^[A-Za-z0-9_./:@=+-]+$/u.test(value)
    ? value
    : renderJsonData(value);
}

function renderCell(value) {
  const encoded = renderJsonData(String(value));
  return encoded.slice(1, -1);
}

function rowLabel(row) {
  return `${row.target.hostId}/${row.target.surfaceId}@${row.target.scope}`;
}

function renderRows(rows) {
  const header = ["TARGET", "HOST", "INSTALL", "ENABLE", "VERSION", "VERIFY"];
  const values = rows.map((row) => [
    rowLabel(row),
    row.hostDiscovery,
    row.installation,
    row.enablement,
    row.version.relation === "unobserved"
      ? "unobserved"
      : `${renderCell(row.version.observed)} (${row.version.relation})`,
    row.verification,
  ]);
  const widths = header.map((value, index) => Math.max(value.length, ...values.map((row) => row[index].length)));
  return [header, ...values]
    .map((row) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd())
    .join("\n");
}

export function renderStatus(result, definition) {
  const lines = [
    `Better Harness plugin ${definition.name}`,
    "",
    renderRows(result.rows),
  ];
  const warnings = result.diagnostics.filter((item) => item.severity !== "info");
  if (warnings.length > 0) {
    lines.push("", "Diagnostics:", ...warnings.map((item) => `  ${item.code}: ${item.message}`));
  }
  return `${lines.join("\n")}\n`;
}

function renderStepInstruction(step) {
  return step.argv
    ? `argv (JSON, not shell): ${renderJsonData(step.argv)}`
    : step.command ?? step.instruction;
}

function verificationArgv(target) {
  const argv = [
    "better-harness",
    "plugin",
    "verify",
    "--host",
    target.hostId,
    "--surface",
    target.surfaceId,
  ];
  if (target.workspace) argv.push("--workspace", target.workspace);
  if (target.hostHome) argv.push("--host-home", target.hostHome);
  return argv;
}

function renderHomeBinding(binding) {
  return renderJsonData({
    variable: binding.variable,
    value: binding.value,
  });
}

export function renderPlan(plan) {
  const lines = [
    `Better Harness plugin ${plan.action} plan`,
    "",
    `Plan: ${plan.planId}`,
    `Target: ${plan.target.hostId}/${plan.target.surfaceId}@${plan.target.scope}`,
    `State: ${plan.state}`,
    `Effects performed now: ${plan.effects}`,
  ];
  if (plan.target.workspace) lines.push(`Workspace: ${renderArg(plan.target.workspace)}`);
  if (plan.target.hostHome) lines.push(`Host home: ${renderArg(plan.target.hostHome)}`);
  if (plan.steps.length > 0) {
    lines.push("", "Planned external steps:");
    for (const step of plan.steps) {
      lines.push(
        `  ${step.id}. [${step.kind}] ${renderStepInstruction(step)}`,
        `     Expect: ${step.expected}`,
      );
      if (step.cwd) lines.push(`     Working directory: ${renderArg(step.cwd)}`);
      if (step.homeBinding) {
        lines.push(`     Host home binding (data): ${renderHomeBinding(step.homeBinding)}`);
        lines.push(`     Binding evidence: ${step.homeBinding.contractEvidence.id} (${step.homeBinding.contractEvidence.observedAt})`);
      }
    }
  }
  if (plan.verificationSteps.length > 0) {
    lines.push("", "Verify after applying externally:");
    for (const step of plan.verificationSteps) {
      lines.push(`  - [${step.kind}] ${renderStepInstruction(step)}`);
      if (step.cwd) lines.push(`    Working directory: ${renderArg(step.cwd)}`);
      if (step.homeBinding) {
        lines.push(`    Host home binding (data): ${renderHomeBinding(step.homeBinding)}`);
        lines.push(`    Binding evidence: ${step.homeBinding.contractEvidence.id} (${step.homeBinding.contractEvidence.observedAt})`);
      }
    }
    lines.push(`  - Better Harness verify argv (JSON, not shell): ${renderJsonData(verificationArgv(plan.target))}`);
  }
  if (plan.notes.length > 0) lines.push("", "Notes:", ...plan.notes.map((note) => `  - ${note}`));
  if (plan.blockers.length > 0) lines.push("", "Blockers:", ...plan.blockers.map((item) => `  - ${item.code}: ${item.message}`));
  lines.push("", "No commands were executed and no files were changed.", "");
  return lines.join("\n");
}
