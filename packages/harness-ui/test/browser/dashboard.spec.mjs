import { expect, test } from "@playwright/test";

test("keeps script-backed metrics clear across wide, compact, and narrow layouts", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      errors.push(`${message.text()}${location ? ` (${location})` : ""}`);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveTitle("Better Harness");
  // The page leads with one compact identity line, four decision facts, and
  // the primary asset types. Operational evidence does not delay the charts.
  await expect(page.getByRole("heading", { level: 1, name: "better-harness" })).toBeVisible();
  const projectRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/project") projectRequests.push(request.url());
  });
  const projectSelect = page.getByLabel("Project");
  await expect(projectSelect).toBeVisible();
  await expect(projectSelect.locator("option")).toHaveCount(2);
  await projectSelect.selectOption({ label: "harness-ui" });
  await expect(page.getByRole("heading", { level: 1, name: "harness-ui" })).toBeVisible({ timeout: 30_000 });
  await projectSelect.selectOption({ label: "better-harness" });
  await expect(page.getByRole("heading", { level: 1, name: "better-harness" })).toBeVisible();
  expect(projectRequests).toHaveLength(1);
  await expect(page.getByRole("heading", { level: 2, name: "Harness footprint" })).toBeVisible();
  await expect(page.locator(".page-window")).toContainText(/Jul|Aug|Sep/);
  await expect(page.locator(".stat-card")).toHaveCount(4);
  await expect(page.locator(".asset-primary")).toHaveCount(3);
  await expect(page.getByText("Better Harness Dashboard")).toHaveCount(0);
  await expect(page.getByText("Acme Engineering")).toHaveCount(0);
  await expect(page.getByText("Script-aligned preview")).toHaveCount(0);
  await expect(page.getByText("Preview data")).toHaveCount(0);
  await expect(page.getByText("Skills", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("MCPs", { exact: true })).toBeVisible();
  await expect(page.getByText("Hooks", { exact: true })).toBeVisible();
  await expect(page.locator(".finding-summary")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Data quality" })).toHaveCount(0);
  await expect(page.getByText("First-pass success")).toHaveCount(0);
  await expect(page.getByText("Autonomy portfolio")).toHaveCount(0);
  // Evidence applied through the real CLI and upload endpoint reaches the page,
  // carrying the organization the destination accepted it for.
  await expect(page.getByRole("heading", { name: "Task evidence" })).toBeVisible();
  await expect(page.getByText("TASK-42").first()).toBeVisible();
  await expect(page.getByText("Prepare Skill feedback").first()).toBeVisible();
  await expect(page.getByText("better-harness-browser", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".task-evidence-pane")).toContainText("acme-engineering");
  await expect(page.locator(".task-evidence-pane")).toContainText("Packet accepted");
  await expect(page.locator(".evidence-spine li")).toHaveCount(5);
  await expect(page.locator(".evidence-spine")).toContainText("Execution");
  await expect(page.locator(".evidence-spine")).toContainText("Acceptance");
  const taskDetail = page.locator(".task-detail-disclosure");
  await expect(taskDetail).not.toHaveAttribute("open", "");
  await taskDetail.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(taskDetail).toHaveAttribute("open", "");
  await expect(taskDetail).toContainText("Sessions");
  await page.keyboard.press("Enter");
  await expect(taskDetail).not.toHaveAttribute("open", "");
  const taskSummary = taskDetail.locator("summary");
  expect(await taskSummary.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe("0px");
  await taskSummary.evaluate((element) => element.blur());

  const operationalDetails = page.locator(".operational-disclosure");
  await expect(operationalDetails).not.toHaveAttribute("open", "");
  await expect(page.locator(".operational-disclosure > summary")).toBeVisible();
  await page.screenshot({ path: "test-results/harness-usage-wide.png", fullPage: true });

  if (await page.getByRole("heading", { name: "Usage activity" }).count()) {
    await expect(page.locator(".chart-card .recharts-area-curve")).toBeVisible();
    await page.getByRole("button", { name: "Sessions" }).click();
    await expect(page.locator(".chart-card .metric-caption")).toContainText("Session starts");
    await page.locator(".chart-card select").selectOption("7");
    await expect(page.locator(".chart-card .recharts-area-curve")).toBeVisible();
    const activityChart = page.locator(".chart-card .chart-container svg");
    await activityChart.focus();
    const outlineWidth = await activityChart.evaluate((element) => getComputedStyle(element).outlineWidth);
    expect(outlineWidth).not.toBe("0px");
    await activityChart.evaluate((element) => element.blur());
    const activityGeometry = await page.locator(".chart-card").evaluate((element) => {
      const curve = element.querySelector(".recharts-area-curve");
      const horizontalLines = [...element.querySelectorAll(".recharts-cartesian-grid-horizontal line")];
      if (!(curve instanceof SVGGraphicsElement) || horizontalLines.length === 0) return null;
      const curveBounds = curve.getBBox();
      const baseline = Math.max(...horizontalLines.map((line) => Number(line.getAttribute("y1"))));
      return { curveBottom: curveBounds.y + curveBounds.height, baseline };
    });
    expect(activityGeometry).not.toBeNull();
    expect(activityGeometry.curveBottom).toBeLessThanOrEqual(activityGeometry.baseline + 1);
    const activityBeforeOperational = await page.evaluate(() => {
      const activity = document.querySelector(".chart-card");
      const operational = document.querySelector(".operational-evidence");
      return Boolean(activity && operational && (activity.compareDocumentPosition(operational) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(activityBeforeOperational).toBe(true);
  } else {
    await expect(page.getByRole("heading", { name: "No local session data observed" })).toBeVisible();
  }

  if (await page.getByRole("heading", { name: "Skill activity" }).count()) {
    await expect(page.locator(".skill-chart-card .recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.locator(".skill-chart-card select").first()).toBeVisible();
    await expect(page.locator(".skill-chart-card .card-header .eyebrow")).toHaveCount(0);
  }

  if (await page.getByRole("heading", { name: "MCP activity" }).count()) {
    await expect(page.locator(".mcp-chart-card .recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.getByLabel("MCP server")).toBeVisible();
    await expect(page.locator(".mcp-chart-card .card-header .eyebrow")).toHaveCount(0);
    await page.getByLabel("MCP date range").selectOption("7");
    const mcpChart = page.locator(".mcp-chart-card .chart-container svg");
    await mcpChart.focus();
    expect(await mcpChart.evaluate((element) => getComputedStyle(element).outlineWidth)).not.toBe("0px");
    await mcpChart.evaluate((element) => element.blur());
    const placement = await page.evaluate(() => {
      const skill = document.querySelector(".skill-chart-card");
      const mcp = document.querySelector(".mcp-chart-card");
      const token = document.querySelector(".token-section");
      return {
        afterSkill: Boolean(skill && mcp && (skill.compareDocumentPosition(mcp) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforeToken: Boolean(!token || (mcp && (mcp.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING))),
      };
    });
    expect(placement).toEqual({ afterSkill: true, beforeToken: true });
  }

  if (await page.getByRole("heading", { name: "Token usage" }).count()) {
    // Input lanes are only additive inside one cache relationship; the section
    // says which one it observed instead of leaving the sum unqualified.
    await expect(page.locator(".token-section .lane-note")).toBeVisible();
    await expect(page.locator(".token-chart-card")).toHaveCount(4);
    await expect(page.locator(".token-chart-card .recharts-area-curve")).toHaveCount(4);
    await page.locator(".token-section select").selectOption("7");
    await expect(page.locator(".token-chart-card .recharts-area-curve").first()).toBeVisible();
  }

  if (await page.getByRole("heading", { name: "Model activity" }).count()) {
    await expect(page.locator(".model-chart-card .recharts-bar-rectangle").first()).toBeVisible();
    // The chart can only plot responses a host attributed to a model, so the
    // caption states that share rather than implying the full population.
    await expect(page.locator(".model-chart-card .metric-caption")).toContainText("responses carry a model");
    await page.getByRole("button", { name: "Usage observed", exact: true }).click();
    await expect(page.locator(".model-chart-card .metric-caption")).toContainText("Usage observed");
  }

  // Supporting evidence stays available through the native keyboard-operable
  // disclosure, including the bounded host table.
  const operationalSummary = page.locator(".operational-disclosure > summary");
  await operationalSummary.focus();
  await page.keyboard.press("Enter");
  await expect(operationalDetails).toHaveAttribute("open", "");
  if (await page.getByRole("heading", { name: "Validation and closure" }).count()) {
    await expect(page.locator(".delivery-card")).toContainText("Post-edit validation");
    await expect(page.locator(".delivery-card .delivery-fact")).toHaveCount(3);
  }
  if (await page.getByRole("heading", { name: "Delivered change" }).count()) {
    await expect(page.locator(".repo-card")).toContainText("Session-attributed commits");
  }
  if (await page.getByRole("heading", { name: "Agent source activity" }).count()) {
    await expect(page.locator(".breakdown-table tbody tr").first()).toBeVisible();
    const tableOverflow = await page.locator(".table-scroll").evaluate((element) => getComputedStyle(element).overflowX);
    expect(tableOverflow).toBe("auto");
  }
  await page.keyboard.press("Enter");
  await expect(operationalDetails).not.toHaveAttribute("open", "");

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "test-results/harness-usage-compact.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 2, name: "Harness footprint" })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/harness-usage-narrow.png", fullPage: true });
  expect(errors).toEqual([]);
});
