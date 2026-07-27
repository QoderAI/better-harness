const SIGNAL_ROUTES = {
  "recurring-validation-failure": ["software-fluency", "agent-work-loop"],
  "recurring-review-omission": ["software-fluency", "agent-work-loop", "customization-checkup"],
  "recurring-setup-failure": ["software-fluency", "agent-work-loop", "customization-checkup"],
  "conflicting-instructions": ["customization-checkup", "software-fluency"],
  "permission-friction": ["customization-checkup", "software-fluency", "agent-work-loop"],
  "hook-friction": ["customization-checkup", "agent-work-loop"],
  "capability-use-gap": ["customization-checkup", "skill-discovery"],
};

const OWNER_EVIDENCE = {
  "software-fluency": {
    requiredEvidence: ["opened repository guidance", "runnable checks or gates", "visible acceptance or safety path"],
    claimBoundary: "Session errors may trigger inspection but cannot lower a static capability by themselves.",
  },
  "agent-work-loop": {
    requiredEvidence: ["linked Task Episodes", "task-relevant tool and validation events", "accepted delivery or explicit unobserved boundary"],
    claimBoundary: "Aggregate counts do not prove task behaviour or causality.",
  },
  "customization-checkup": {
    requiredEvidence: ["configured asset or instruction owner", "bounded runtime-use coverage", "unambiguous scope and source identity"],
    claimBoundary: "Configured-only and unobserved are not unused.",
  },
  "skill-discovery": {
    requiredEvidence: ["Loop Discovery selected Skill ownership", "stable trigger and playbook", "existing and built-in coverage check", "validation path"],
    claimBoundary: "A missing capability mention is not a Skill-shaped workflow gap.",
  },
};

function normalizedSignals(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

export function buildRepeatedFrictionTriage(options = {}) {
  const signals = normalizedSignals(options.signals);
  const supportedSignals = signals.filter((signal) => SIGNAL_ROUTES[signal]);
  const observationCount = Number(options.observationCount ?? 0);
  const strength = options.strength ?? (observationCount >= 3 ? "repeated" : "weak");
  const evidenceStrongEnough = strength === "repeated" || observationCount >= 3;
  const ownerReasons = new Map();
  for (const signal of supportedSignals) {
    for (const owner of SIGNAL_ROUTES[signal]) {
      const reasons = ownerReasons.get(owner) ?? [];
      reasons.push(signal);
      ownerReasons.set(owner, reasons);
    }
  }
  const routes = [...ownerReasons.entries()].map(([owner, reasonCodes]) => ({
    owner,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    ...OWNER_EVIDENCE[owner],
  }));
  const status = supportedSignals.length > 0 && evidenceStrongEnough ? "routed" : "needs-more-evidence";
  return {
    kind: "repeated-friction-triage",
    status,
    reasonCodes: supportedSignals.length > 0 ? supportedSignals.sort() : ["unsupported-or-weak-pattern"],
    observationBoundary: {
      source: options.source ?? "user-report",
      strength,
      observationCount,
      window: options.window ?? null,
    },
    candidateCauses: status === "routed"
      ? ["repository affordance gap", "task execution gap", "customization mismatch", "workflow-owner gap"]
      : ["one-off task difficulty", "insufficiently bounded repetition", "unavailable evidence source"],
    routes: status === "routed" ? routes : [],
    skillDiscovery: {
      selected: status === "routed" && routes.some((route) => route.owner === "skill-discovery") && Boolean(options.skillOwnerSelected),
      condition: "Loop Discovery must select Skill ownership before lifecycle recommendation or creation handoff.",
    },
  };
}

function matchesAny(values, patterns) {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

export function buildLifecycleCapabilityRecommendation({ triage, configuredSkills = [], observedSkills = [] } = {}) {
  if (!triage || triage.status !== "routed") return null;
  const reasons = triage.reasonCodes ?? [];
  const review = reasons.includes("recurring-review-omission");
  const verification = reasons.includes("recurring-validation-failure");
  const setup = reasons.includes("recurring-setup-failure");
  const lifecycle = setup ? ["plan"] : [];
  const discipline = [review ? "review" : null, verification || setup ? "verification" : null].filter(Boolean);
  if (lifecycle.length === 0 && discipline.length === 0 && !reasons.includes("capability-use-gap")) return null;

  const observed = observedSkills.map((value) => String(value).toLowerCase());
  const configured = configuredSkills.map((value) => String(value).toLowerCase());
  const patterns = review
    ? [/review/u, /ultra-review/u]
    : verification
      ? [/verif/u, /test/u, /quality/u]
      : [/setup/u, /onboard/u, /doctor/u];
  if (matchesAny(observed, patterns)) {
    return { lifecycle, discipline, evidenceState: "observed", nextStep: "keep", handoff: null };
  }
  if (review) {
    return {
      lifecycle,
      discipline,
      evidenceState: "built-in",
      nextStep: "try-built-in",
      handoff: "Try /ultra-review on one bounded change and confirm that independent review findings are actionable.",
    };
  }
  if (matchesAny(configured, patterns)) {
    return {
      lifecycle,
      discipline,
      evidenceState: "configured",
      nextStep: "try-configured",
      handoff: "Run one matching configured Skill on a bounded task and verify its expected artifact or check.",
    };
  }
  if (!triage.skillDiscovery.selected) {
    return { lifecycle, discipline, evidenceState: "needs-more-evidence", nextStep: "needs-more-evidence", handoff: null };
  }
  return {
    lifecycle,
    discipline,
    evidenceState: "gap",
    nextStep: "create-skill-handoff",
    handoff: "/create-skill Create the smallest repeated workflow with a stable trigger, required context, output, validation, and one failure boundary.",
  };
}
