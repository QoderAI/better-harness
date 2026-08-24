import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import clsx from "clsx";

import styles from "./index.module.css";

function loopDimensions() {
  return [
    {
      title: translate({
        id: "homepage.dimensions.taskUnderstanding.title",
        message: "Task Understanding",
      }),
      question: translate({
        id: "homepage.dimensions.taskUnderstanding.question",
        message: "Does the agent know the goal and what \u201cdone\u201d means?",
      }),
    },
    {
      title: translate({
        id: "homepage.dimensions.controlledExecution.title",
        message: "Controlled Execution",
      }),
      question: translate({
        id: "homepage.dimensions.controlledExecution.question",
        message: "Is the work on supported, repeatable paths?",
      }),
    },
    {
      title: translate({
        id: "homepage.dimensions.changeValidation.title",
        message: "Change Validation",
      }),
      question: translate({
        id: "homepage.dimensions.changeValidation.question",
        message: "Is there evidence the change actually works?",
      }),
    },
    {
      title: translate({
        id: "homepage.dimensions.reliableDelivery.title",
        message: "Reliable Delivery",
      }),
      question: translate({
        id: "homepage.dimensions.reliableDelivery.question",
        message: "Does AI speed bypass quality checks or acceptance?",
      }),
    },
    {
      title: translate({
        id: "homepage.dimensions.learningCapture.title",
        message: "Learning Capture",
      }),
      question: translate({
        id: "homepage.dimensions.learningCapture.question",
        message: "Does the next task benefit from this one?",
      }),
    },
  ];
}

function reportProofs() {
  return [
    {
      title: translate({
        id: "homepage.proof.evidence.title",
        message: "Visible evidence",
      }),
      description: translate({
        id: "homepage.proof.evidence.description",
        message: "See which project or session signal supports each finding.",
      }),
    },
    {
      title: translate({
        id: "homepage.proof.impact.title",
        message: "Prioritized impact",
      }),
      description: translate({
        id: "homepage.proof.impact.description",
        message: "Start with the workflow gap that matters most.",
      }),
    },
    {
      title: translate({
        id: "homepage.proof.repair.title",
        message: "Bounded repair",
      }),
      description: translate({
        id: "homepage.proof.repair.description",
        message: "Keep the proposed change scoped to the observed problem.",
      }),
    },
    {
      title: translate({
        id: "homepage.proof.acceptance.title",
        message: "Acceptance checks",
      }),
      description: translate({
        id: "homepage.proof.acceptance.description",
        message: "Know what evidence would make the improvement reviewable.",
      }),
    },
  ];
}

function hosts() {
  const htmlOutput = translate({
    id: "homepage.hosts.output.html",
    message: "HTML + Markdown report",
  });
  const canvasOutput = translate({
    id: "homepage.hosts.output.canvas",
    message: "Canvas report",
  });
  const verifiedStatus = translate({
    id: "homepage.hosts.status.quickstart",
    message: "Verified Quickstart",
  });
  const adapterStatus = translate({
    id: "homepage.hosts.status.adapter",
    message: "Adapter support",
  });
  const setupAction = translate({
    id: "homepage.hosts.setupAction",
    message: "View setup",
  });
  const supportAction = translate({
    id: "homepage.hosts.supportAction",
    message: "View support details",
  });

  return [
    {
      name: "Claude Code",
      method: translate({
        id: "homepage.hosts.claudeCode.method",
        message: "Marketplace plugin",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.claudeCode.setup",
        message: "Add the repository marketplace, then install the plugin.",
      }),
      anchor: "claude-code",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=claude-code#claude-code",
    },
    {
      name: "Codex",
      method: translate({
        id: "homepage.hosts.codex.method",
        message: "Desktop + CLI marketplace",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.codex.setup",
        message: "Choose Desktop or CLI for the correct entrypoint.",
      }),
      anchor: "codex",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=codex#codex",
    },
    {
      name: "Qoder",
      method: translate({
        id: "homepage.hosts.qoder.method",
        message: "Built into Desktop",
      }),
      output: canvasOutput,
      setup: translate({
        id: "homepage.hosts.qoder.setup",
        message:
          "Built into Qoder Desktop; Qoder CLI can reuse it or install separately.",
      }),
      anchor: "qoder",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=qoder#qoder",
    },
    {
      name: "Cursor",
      method: translate({
        id: "homepage.hosts.cursor.method",
        message: "Source-local plugin",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.cursor.setup",
        message: "Load the source-local plugin with --plugin-dir.",
      }),
      anchor: "cursor",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=cursor#cursor",
    },
    {
      name: "Qwen Code",
      method: translate({
        id: "homepage.hosts.qwenCode.method",
        message: "Extension",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.qwenCode.setup",
        message: "Install as a Qwen Code extension.",
      }),
      anchor: "qwen-code",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=qwen-code#qwen-code",
    },
    {
      name: "GitHub Copilot",
      method: translate({
        id: "homepage.hosts.githubCopilot.method",
        message: "CLI marketplace",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.githubCopilot.setup",
        message: "Add the marketplace and install the plugin.",
      }),
      anchor: "github-copilot",
      supportLevel: "quickstart",
      status: verifiedStatus,
      action: setupAction,
      to: "/docs/installation?host=github-copilot#github-copilot",
    },
    {
      name: "Pi",
      method: translate({
        id: "homepage.hosts.pi.method",
        message: "Package + CLI extension",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.pi.setup",
        message:
          "Install the native extension; authorized real-model E2E remains a separate verification gate.",
      }),
      anchor: "pi",
      supportLevel: "adapter",
      status: adapterStatus,
      action: supportAction,
      to: "/docs/hosts/adapter-matrix#pi",
    },
    {
      name: "Kimi Code",
      method: translate({
        id: "homepage.hosts.kimiCode.method",
        message: "Plugin manifest",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.kimiCode.setup",
        message:
          "Plugin, evidence, and report adapters are available; a full interactive report smoke remains pending.",
      }),
      anchor: "kimi-code",
      supportLevel: "adapter",
      status: adapterStatus,
      action: supportAction,
      to: "/docs/hosts/adapter-matrix#kimi-code",
    },
    {
      name: "WorkBuddy",
      method: translate({
        id: "homepage.hosts.workBuddy.method",
        message: "Native Team expert plugin",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.workBuddy.setup",
        message:
          "Discover the repository root with codebuddy --plugin-dir . and run the Review Team.",
      }),
      anchor: "workbuddy",
      supportLevel: "adapter",
      status: adapterStatus,
      action: supportAction,
      to: "/docs/hosts/adapter-matrix#workbuddy",
    },
    {
      name: "Grok",
      method: translate({
        id: "homepage.hosts.grok.method",
        message: "Skill symlink path",
      }),
      output: htmlOutput,
      setup: translate({
        id: "homepage.hosts.grok.setup",
        message:
          "Evidence and report adapters are available; install by symlinking the skill into ~/.grok/skills.",
      }),
      anchor: "grok",
      supportLevel: "adapter",
      status: adapterStatus,
      action: supportAction,
      to: "/docs/hosts/adapter-matrix#grok",
    },
  ];
}

function Hero() {
  const sampleReportUrl = useBaseUrl("/demo/better-harness-report/");

  return (
    <header className={clsx("hero hero--primary", styles.hero)}>
      <div className={clsx("container", styles.heroGrid)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <Translate id="homepage.hero.eyebrow">
              Better Harness · Open-source insights for the Agent Work Loop
            </Translate>
          </p>
          <h1 className={clsx("hero__title", styles.heroTitle)}>
            <Translate id="homepage.hero.title">
              Delegate coding to agents. Improve the loop around them.
            </Translate>
          </h1>
          <p className={styles.heroLead}>
            <Translate id="homepage.hero.lead">
              Better Harness turns project and session evidence into loop-level
              insights, prioritized improvements, and verifiable next
              steps—inside the coding agent you already use.
            </Translate>
          </p>
          <div className={styles.buttons}>
            <a
              className={clsx("button button--lg", styles.heroPrimaryButton)}
              href="#choose-host"
            >
              <Translate id="homepage.hero.chooseHost">
                Choose your coding agent
              </Translate>
            </a>
            <a
              className={clsx("button button--lg", styles.heroSecondaryButton)}
              href={sampleReportUrl}
            >
              <Translate id="homepage.hero.viewDemo">
                Explore a sample report
              </Translate>
            </a>
          </div>
          <ul className={styles.trustList} aria-label={translate({
            id: "homepage.hero.trustLabel",
            message: "Project trust signals",
          })}>
            <li>
              <Translate id="homepage.hero.trust.openSource">
                Open source · MIT
              </Translate>
            </li>
            <li>
              <Translate id="homepage.hero.trust.hostSpecific">
                Host-specific setup
              </Translate>
            </li>
            <li>
              <Translate id="homepage.hero.trust.evidence">
                Missing evidence stays explicit
              </Translate>
            </li>
          </ul>
        </div>
        <a
          className={styles.heroPreview}
          href={sampleReportUrl}
          aria-label={translate({
            id: "homepage.hero.previewLinkLabel",
            message: "Open the Better Harness sample report",
          })}
        >
          <span className={styles.heroPreviewLabel}>
            <Translate id="homepage.hero.previewLabel">
              Sample finding · evidence-bounded
            </Translate>
          </span>
          <img
            src={useBaseUrl("/demo/better-harness-findings-report.png")}
            alt={translate({
              id: "homepage.demo.reportAlt",
              message:
                "Better Harness sample HTML report showing an evidence-bounded finding with its impact, expected output, scoped AI fix, and acceptance checks",
            })}
            width="1280"
            height="950"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          <span className={styles.heroPreviewCaption}>
            <Translate id="homepage.hero.previewCaption">
              Evidence, impact, bounded repair, and acceptance checks in one
              reviewable report.
            </Translate>
          </span>
        </a>
      </div>
    </header>
  );
}

function LiveDemo() {
  return (
    <section className={styles.section}>
      <div className="container">
        <h2>
          <Translate id="homepage.demo.title">
            Turn evidence into the next concrete improvement
          </Translate>
        </h2>
        <p>
          <Translate id="homepage.demo.intro">
            Better Harness keeps unsupported claims out of the score and turns
            observed workflow gaps into findings a team can inspect, discuss,
            and verify.
          </Translate>
        </p>
        <div className={styles.proofGrid}>
          {reportProofs().map((proof) => (
            <article key={proof.title} className={styles.proofCard}>
              <h3>{proof.title}</h3>
              <p>{proof.description}</p>
            </article>
          ))}
        </div>
        <p className={styles.demoAction}>
          <a
            className="button button--primary button--lg"
            href={useBaseUrl("/demo/better-harness-report/")}
          >
            <Translate id="homepage.demo.openReport">
              Explore the self-contained English sample report
            </Translate>
          </a>
        </p>
        <h3 className={styles.historyTitle}>
          <Translate id="homepage.demo.historyTitle">
            Track recorded change over time
          </Translate>
        </h3>
        <p className={styles.demoFrame}>
          <img
            src={useBaseUrl("/demo/twenty-history.png")}
            alt={translate({
              id: "homepage.demo.historyAlt",
              message:
                "Static final frame of Better Harness report history showing five Agent Work Loop dimensions over time",
            })}
            width="1351"
            height="955"
            loading="lazy"
            decoding="async"
          />
        </p>
        <p className={styles.demoCaption}>
          <Translate id="homepage.demo.historyCaption">
            This static final frame summarizes historical Harness reports. It
            shows recorded trends, not causal proof of improvement.
          </Translate>
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <h2>
          <Translate id="homepage.how.title">
            How Better Harness works
          </Translate>
        </h2>
        <p>
          <Translate
            id="homepage.how.intro"
            values={{
              workLoopLink: (
                <Link to="/docs/concepts/agent-work-loop">
                  <Translate id="homepage.how.workLoopLabel">
                    Agent Work Loop
                  </Translate>
                </Link>
              ),
            }}
          >
            {
              "Better Harness combines feedforward guides (AGENTS.md, specs, Skills, acceptance criteria) with feedback sensors (linters, tests, Hooks, evaluation agents), and evaluates five parts of delivery—the {workLoopLink}:"
            }
          </Translate>
        </p>
        <div className={styles.dimensionGrid}>
          {loopDimensions().map((dimension) => (
            <div key={dimension.title} className={styles.dimensionCard}>
              <h3>{dimension.title}</h3>
              <p>{dimension.question}</p>
            </div>
          ))}
        </div>
        <p className={styles.demoFrame}>
          <img
            src={useBaseUrl("/img/better-harness-architecture-en.svg")}
            alt={translate({
              id: "homepage.how.architectureAlt",
              message:
                "Better Harness architecture: six public Quickstart hosts plus Pi, Kimi Code, WorkBuddy, and Grok adapter support feed three independent evidence agents, unified analysis, host-neutral outputs, and repair",
            })}
            width="1800"
            height="1360"
            loading="lazy"
            decoding="async"
          />
        </p>
        <p className={styles.demoCaption}>
          <Translate id="homepage.how.architectureCaption">
            Ten capability-level host adapters feed the same evidence
            pipeline. Six have verified Quickstart paths; Pi, Kimi Code, WorkBuddy, and Grok keep
            their current adapter-support boundaries explicit.
          </Translate>
        </p>
      </div>
    </section>
  );
}

function InspectorSection() {
  const inspectorUrl = useBaseUrl("/inspector/");
  const architectureUrl = useBaseUrl("/docs/concepts/harness-inspector");

  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <h2>
          <Translate id="homepage.inspector.title">
            Follow delivery from intent to commit
          </Translate>
        </h2>
        <p>
          <Translate id="homepage.inspector.intro">
            Harness Inspector traces product intent through agent activity,
            sessions, files, and commits in one read-only workspace, keeping
            evidence strength and limitations visible.
          </Translate>
        </p>
        <p className={styles.demoFrame}>
          <a href={inspectorUrl}>
            <img
              src={useBaseUrl("/demo/harness-inspector/session-view.png")}
              alt={translate({
                id: "homepage.inspector.alt",
                message:
                  "Harness Inspector session view: a synchronized timeline of prompts, tool calls, and commits with the Evidence Drawer explaining each link",
              })}
              width="1440"
              height="900"
              loading="lazy"
              decoding="async"
            />
          </a>
        </p>
        <p className={styles.demoCaption}>
          <Translate id="homepage.inspector.caption">
            The interactive sample uses fictional English data. It does not
            read your workspace, Git history, or coding-agent sessions.
          </Translate>
        </p>
        <p className={styles.demoAction}>
          <a
            className="button button--primary button--lg"
            href={inspectorUrl}
          >
            <Translate id="homepage.inspector.openSample">
              Open the interactive sample
            </Translate>
          </a>{" "}
          <Link
            className="button button--secondary button--lg"
            to={architectureUrl}
          >
            <Translate id="homepage.inspector.architecture">
              Read the architecture
            </Translate>
          </Link>
        </p>
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section
      id="choose-host"
      className={clsx(styles.section, styles.hostSection)}
    >
      <div className="container">
        <h2>
          <Translate id="homepage.quickstart.title">
            Choose your coding agent
          </Translate>
        </h2>
        <p>
          <Translate id="homepage.quickstart.intro">
            Ten host adapters are supported. Six have verified setup paths;
            Pi, Kimi Code, WorkBuddy, and Grok link to their current support boundaries.
          </Translate>
        </p>
        <div className={styles.hostGrid}>
          {hosts().map((host) => (
            <Link
              key={host.name}
              className={styles.hostCard}
              to={host.to}
              data-support-level={host.supportLevel}
            >
              <h3>{host.name}</h3>
              <div className={styles.hostMeta}>
                <span>{host.method}</span>
                <span>{host.output}</span>
                <span
                  className={clsx(
                    styles.hostStatus,
                    host.supportLevel === "quickstart"
                      ? styles.hostStatusVerified
                      : styles.hostStatusAdapter,
                  )}
                >
                  {host.status}
                </span>
              </div>
              <p>{host.setup}</p>
              <span className={styles.hostAction}>{host.action}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title={translate({
        id: "homepage.meta.title",
        message: "AI Coding Agent Workflow Insights",
      })}
      description={translate({
        id: "homepage.meta.description",
        message:
          "Open-source Agent Work Loop insights that turn coding-agent project and session evidence into prioritized, verifiable improvements.",
      })}
    >
      <Hero />
      <main>
        <QuickStart />
        <InspectorSection />
        <LiveDemo />
        <HowItWorks />
      </main>
    </Layout>
  );
}
