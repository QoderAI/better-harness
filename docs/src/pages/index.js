import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useBaseUrl from "@docusaurus/useBaseUrl";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";
import clsx from "clsx";

import styles from "./index.module.css";

const REPORT_PROMPT =
  "/better-harness review this project's AI coding workflow and generate a report";

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

function hosts() {
  return [
    {
      name: "Claude Code",
      setup: translate({
        id: "homepage.hosts.claudeCode.setup",
        message: "Add the repository marketplace, then install the plugin.",
      }),
      anchor: "claude-code",
    },
    {
      name: "Codex",
      setup: translate({
        id: "homepage.hosts.codex.setup",
        message: "Add the Git marketplace from Desktop settings or the CLI.",
      }),
      anchor: "codex",
    },
    {
      name: "Qoder",
      setup: translate({
        id: "homepage.hosts.qoder.setup",
        message: "Built into Qoder Desktop and CLI\u2014nothing to install.",
      }),
      anchor: "qoder",
    },
    {
      name: "Cursor",
      setup: translate({
        id: "homepage.hosts.cursor.setup",
        message: "Load the source-local plugin with --plugin-dir.",
      }),
      anchor: "cursor",
    },
    {
      name: "Qwen Code",
      setup: translate({
        id: "homepage.hosts.qwenCode.setup",
        message: "Install as a Qwen Code extension.",
      }),
      anchor: "qwen-code",
    },
    {
      name: "GitHub Copilot",
      setup: translate({
        id: "homepage.hosts.githubCopilot.setup",
        message: "Add the marketplace and install the plugin.",
      }),
      anchor: "github-copilot",
    },
  ];
}

function Hero() {
  return (
    <header className={clsx("hero hero--primary", styles.hero)}>
      <div className="container">
        <h1 className="hero__title">Better Harness</h1>
        <p className="hero__subtitle">
          <Translate id="homepage.hero.tagline">
            See how your AI coding workflow works—and make it better, one step
            at a time.
          </Translate>
        </p>
        <p className={styles.heroLead}>
          <Translate id="homepage.hero.lead">
            Better Harness reviews how coding agents understand tasks, make
            changes, verify results, deliver safely, and learn—then shows what
            to improve next, with every finding tied to visible evidence.
          </Translate>
        </p>
        <div className={styles.buttons}>
          <a
            className="button button--secondary button--lg"
            href={useBaseUrl("/demo/better-harness-report/")}
          >
            <Translate id="homepage.hero.viewDemo">
              View live demo report
            </Translate>
          </a>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/introduction"
          >
            <Translate id="homepage.hero.getStarted">Get started</Translate>
          </Link>
        </div>
      </div>
    </header>
  );
}

function LiveDemo() {
  return (
    <section className={styles.section}>
      <div className="container">
        <h2>
          <Translate id="homepage.demo.title">See it in action</Translate>
        </h2>
        <p>
          <Translate
            id="homepage.demo.intro"
            values={{ command: <code>/better-harness</code> }}
          >
            {
              "Ask {command} to review the current task and its surrounding project Harness. The report keeps missing evidence explicit and turns supported gaps into prioritized findings with an impact, expected output, scoped repair, and acceptance checks."
            }
          </Translate>
        </p>
        <p className={styles.demoFrame}>
          <a href={useBaseUrl("/demo/better-harness-report/")}>
            <img
              src={useBaseUrl("/demo/better-harness-findings-report.png")}
              alt="Better Harness HTML report showing an evidence-bounded finding with its impact, expected output, scoped AI fix, and acceptance checks"
            />
          </a>
        </p>
        <p className={styles.demoCaption}>
          <a href={useBaseUrl("/demo/better-harness-report/")}>
            <Translate id="homepage.demo.openReport">
              Open the complete self-contained English HTML report
            </Translate>
          </a>
        </p>
        <p className={styles.demoFrame}>
          <img
            src={useBaseUrl("/demo/twenty-history.gif")}
            alt="Better Harness terminal history demo showing five Agent Work Loop dimensions over time"
          />
        </p>
        <p className={styles.demoCaption}>
          <Translate id="homepage.demo.gifCaption">
            The animation replays historical Harness reports. It shows recorded
            trends, not causal proof of improvement.
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
              "Better Harness combines feedforward guides (AGENTS.md, specs, Skills, acceptance criteria) with feedback sensors (linters, tests, Hooks, review agents), and evaluates five parts of delivery—the {workLoopLink}:"
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
            alt="Better Harness architecture: host integration, three independent evidence agents, unified analysis by one lead agent, findings, host outputs, and repair"
          />
        </p>
        <p className={styles.demoCaption}>
          <Translate id="homepage.how.architectureCaption">
            Three evidence domains stay independent until unified analysis;
            every result retains a visible evidence source, owner, and
            validation route.
          </Translate>
        </p>
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className={styles.section}>
      <div className="container">
        <h2>
          <Translate id="homepage.quickstart.title">Quick start</Translate>
        </h2>
        <p>
          <Translate id="homepage.quickstart.intro">
            Pick your coding agent—you can be looking at your first report in
            minutes. Once installed, ask for the host&apos;s durable report:
          </Translate>
        </p>
        <CodeBlock language="text">{REPORT_PROMPT}</CodeBlock>
        <div className={styles.hostGrid}>
          {hosts().map((host) => (
            <Link
              key={host.name}
              className={styles.hostCard}
              to={`/docs/installation?host=${host.anchor}#${host.anchor}`}
            >
              <h3>{host.name}</h3>
              <p>{host.setup}</p>
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
      description={translate({
        id: "homepage.meta.description",
        message:
          "Better Harness reviews how coding agents understand tasks, make changes, verify results, deliver safely, and learn - with every finding tied to visible evidence.",
      })}
    >
      <Hero />
      <main>
        <QuickStart />
        <LiveDemo />
        <HowItWorks />
      </main>
    </Layout>
  );
}
