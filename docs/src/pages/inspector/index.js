import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";

import styles from "./inspector.module.css";

export default function InspectorPage() {
  const demoUrl = useBaseUrl("/demo/harness-inspector/");
  const installationUrl = useBaseUrl("/docs/installation");
  const architectureUrl = useBaseUrl("/docs/concepts/harness-inspector");

  return (
    <Layout
      title="Harness Inspector"
      description={translate({
        id: "inspector.meta.description",
        message:
          "Explore how Better Harness connects product intent, coding-agent activity, sessions, files, and commits with evidence-bounded explanations.",
      })}
      wrapperClassName={styles.layout}
    >
      <main className={styles.page}>
        <header className={styles.intro}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Better Harness</p>
            <h1>Harness Inspector</h1>
            <p className={styles.lead}>
              <Translate id="inspector.hero.lead">
                Trace product intent through agent activity, sessions, files,
                and commits—while keeping evidence strength and limitations
                visible.
              </Translate>
            </p>
            <div className={styles.quickstart}>
              <span>
                <Translate id="inspector.hero.quickstart">
                  Run in your repository
                </Translate>
              </span>
              <code>npx @qoder-ai/better-harness inspector</code>
            </div>
          </div>
          <div className={styles.actions}>
            <ul
              className={styles.boundaries}
              aria-label={translate({
                id: "inspector.boundaries.label",
                message: "Demo boundaries",
              })}
            >
              <li>
                <Translate id="inspector.boundaries.interactive">
                  Interactive sample
                </Translate>
              </li>
              <li>
                <Translate id="inspector.boundaries.readOnly">Read-only</Translate>
              </li>
              <li>English sample data</li>
            </ul>
            <a
              className={styles.fullscreen}
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Translate id="inspector.actions.fullscreen">
                Open full screen
              </Translate>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>

        <section
          className={styles.demo}
          aria-labelledby="inspector-demo-title"
        >
          <h2 id="inspector-demo-title" className="sr-only">
            <Translate id="inspector.demo.title">
              Interactive Harness Inspector sample
            </Translate>
          </h2>
          <BrowserOnly
            fallback={(
              <div className={styles.loading}>
                <Translate id="inspector.demo.loading">
                  Loading the interactive sample…
                </Translate>
              </div>
            )}
          >
            {() => (
              <iframe
                className={styles.frame}
                src={demoUrl}
                title={translate({
                  id: "inspector.demo.frameTitle",
                  message: "Interactive Harness Inspector sample",
                })}
                allow="clipboard-write"
              />
            )}
          </BrowserOnly>
        </section>

        <p className={styles.note}>
          <Translate id="inspector.demo.note">
            This deterministic sample uses fictional English data. It does not
            read your workspace, Git history, or coding-agent sessions.
          </Translate>
        </p>

        <section className={styles.documentation}>
          <header className={styles.sectionIntro}>
            <p className={styles.eyebrow}>
              <Translate id="inspector.features.eyebrow">What it shows</Translate>
            </p>
            <h2>
              <Translate id="inspector.features.title">
                Follow delivery without losing the evidence boundary
              </Translate>
            </h2>
            <p>
              <Translate id="inspector.features.intro">
                Inspector brings product structure, agent activity, and Git
                outcomes into one read-only workspace. It keeps strong links
                separate from useful—but limited—context.
              </Translate>
            </p>
          </header>

          <div className={styles.featureGrid}>
            <article className={styles.featureCard}>
              <span className={styles.cardIndex}>01</span>
              <h3>
                <Translate id="inspector.features.intent.title">
                  Intent to delivery
                </Translate>
              </h3>
              <p>
                <Translate id="inspector.features.intent.body">
                  Navigate the capability tree from capability and Story intent
                  to the sessions, files, and commits associated with it.
                </Translate>
              </p>
            </article>
            <article className={styles.featureCard}>
              <span className={styles.cardIndex}>02</span>
              <h3>
                <Translate id="inspector.features.session.title">
                  A session in context
                </Translate>
              </h3>
              <p>
                <Translate id="inspector.features.session.body">
                  Review retained prompts, normalized tool activity, file
                  paths, commit events, and the read-only session replay.
                </Translate>
              </p>
            </article>
            <article className={styles.featureCard}>
              <span className={styles.cardIndex}>03</span>
              <h3>
                <Translate id="inspector.features.evidence.title">
                  Explainable evidence
                </Translate>
              </h3>
              <p>
                <Translate id="inspector.features.evidence.body">
                  Synchronized selections and the Evidence Drawer show why a
                  relationship exists, its confidence, and what it does not
                  prove.
                </Translate>
              </p>
            </article>
          </div>

          <section className={styles.howTo} aria-labelledby="inspector-how-title">
            <header className={styles.sectionIntro}>
              <p className={styles.eyebrow}>
                <Translate id="inspector.how.eyebrow">How to use it</Translate>
              </p>
              <h2 id="inspector-how-title">
                <Translate id="inspector.how.title">
                  Start broad, then follow the evidence
                </Translate>
              </h2>
            </header>
            <ol className={styles.steps}>
              <li>
                <div>
                  <h3>
                    <Translate id="inspector.how.scope.title">
                      Choose a scope
                    </Translate>
                  </h3>
                  <p>
                    <Translate id="inspector.how.scope.body">
                      Use Capability for product intent or Date for a
                      time-based view of sessions and commits.
                    </Translate>
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <h3>
                    <Translate id="inspector.how.lanes.title">
                      Read the three lanes
                    </Translate>
                  </h3>
                  <p>
                    <Translate id="inspector.how.lanes.body">
                      Compare user prompts, checkpoint activity, and commits or
                      files without leaving the selected Story or date.
                    </Translate>
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <h3>
                    <Translate id="inspector.how.evidence.title">
                      Inspect the relationship
                    </Translate>
                  </h3>
                  <p>
                    <Translate id="inspector.how.evidence.body">
                      Select a prompt, action, commit, or path. Related items
                      stay highlighted while the Evidence Drawer explains the
                      link and its limits.
                    </Translate>
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <h3>
                    <Translate id="inspector.how.session.title">
                      Open Session View or Replay
                    </Translate>
                  </h3>
                  <p>
                    <Translate id="inspector.how.session.body">
                      Drill into retained turns and normalized tool calls, or
                      replay the observed sequence. Replay never reruns tools or
                      resumes the coding-agent session.
                    </Translate>
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section className={styles.evidenceGuide} aria-labelledby="inspector-evidence-title">
            <header className={styles.sectionIntro}>
              <p className={styles.eyebrow}>
                <Translate id="inspector.evidence.eyebrow">Reading the labels</Translate>
              </p>
              <h2 id="inspector-evidence-title">
                <Translate id="inspector.evidence.title">
                  Correlation is visible; authorship is not assumed
                </Translate>
              </h2>
            </header>
            <dl className={styles.evidenceGrid}>
              <div>
                <dt><span className={styles.explicit}>Explicit / direct</span></dt>
                <dd>
                  <Translate id="inspector.evidence.explicit">
                    A retained reference directly connects the Story, session,
                    or commit.
                  </Translate>
                </dd>
              </div>
              <div>
                <dt><span className={styles.observed}>Observed same-path</span></dt>
                <dd>
                  <Translate id="inspector.evidence.observed">
                    The session and commit share exact repository paths. This
                    supports correlation, not proof of authorship.
                  </Translate>
                </dd>
              </div>
              <div>
                <dt><span className={styles.candidate}>Candidate</span></dt>
                <dd>
                  <Translate id="inspector.evidence.candidate">
                    Structure or timing suggests a useful association that
                    still needs human review.
                  </Translate>
                </dd>
              </div>
              <div>
                <dt><span className={styles.contextual}>Contextual</span></dt>
                <dd>
                  <Translate id="inspector.evidence.contextual">
                    Nearby history helps explain the delivery, but no direct
                    relationship is claimed.
                  </Translate>
                </dd>
              </div>
            </dl>
            <Link className={styles.installLink} to={architectureUrl}>
              <Translate id="inspector.evidence.architecture">
                Read the architecture, evidence model, and boundaries
              </Translate>
              <span aria-hidden="true">→</span>
            </Link>
          </section>

          <aside className={styles.localProject} aria-labelledby="inspector-local-title">
            <div>
              <p className={styles.eyebrow}>
                <Translate id="inspector.local.eyebrow">Use your own evidence</Translate>
              </p>
              <h2 id="inspector-local-title">
                <Translate id="inspector.local.title">
                  Generate a private, self-contained Inspector
                </Translate>
              </h2>
              <p>
                <Translate id="inspector.local.body">
                  Run one command inside a repository. Inspector opens the
                  current workspace with the latest 30 UTC days of activity;
                  collection stays local and the report remains read-only.
                </Translate>
              </p>
              <Link className={styles.installLink} to={installationUrl}>
                <Translate id="inspector.local.installation">
                  View installation options
                </Translate>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className={styles.commandPanel}>
              <code>npx @qoder-ai/better-harness inspector</code>
              <p>
                <Translate id="inspector.local.output">
                  Default output: .qoder/better-harness-runs/harness-inspector/inspector.html
                </Translate>
              </p>
            </div>
          </aside>
        </section>
      </main>
    </Layout>
  );
}
