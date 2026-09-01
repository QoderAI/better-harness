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
  await expect(page.getByRole("heading", { level: 1, name: "Harness assets" })).toBeVisible();
  await expect(page.getByText("Better Harness Dashboard")).toHaveCount(0);
  await expect(page.getByText("Acme Engineering")).toHaveCount(0);
  await expect(page.getByText("Script-aligned preview")).toHaveCount(0);
  await expect(page.getByText("Preview data")).toHaveCount(0);
  await expect(page.getByText("Skills", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("MCPs", { exact: true })).toBeVisible();
  await expect(page.getByText("Hooks", { exact: true })).toBeVisible();
  await expect(page.getByText(/lint warnings/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data quality" })).toHaveCount(0);
  await expect(page.getByText("First-pass success")).toHaveCount(0);
  await expect(page.getByText("Autonomy portfolio")).toHaveCount(0);
  // Evidence applied through the real CLI and upload endpoint reaches the page.
  await expect(page.getByRole("heading", { name: "Accepted task evidence" })).toBeVisible();
  await expect(page.getByText("TASK-42")).toBeVisible();
  await expect(page.getByText("Prepare Skill feedback")).toBeVisible();
  await expect(page.getByText("better-harness-browser", { exact: false })).toBeVisible();
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
  } else {
    await expect(page.getByRole("heading", { name: "No local session data observed" })).toBeVisible();
  }

  if (await page.getByRole("heading", { name: "Skill activity" }).count()) {
    await expect(page.locator(".skill-chart-card .recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.locator(".skill-chart-card select").first()).toBeVisible();
  }

  if (await page.getByRole("heading", { name: "Token usage" }).count()) {
    await expect(page.locator(".token-chart-card")).toHaveCount(4);
    await expect(page.locator(".token-chart-card .recharts-area-curve")).toHaveCount(4);
    await page.locator(".token-section select").selectOption("7");
    await expect(page.locator(".token-chart-card .recharts-area-curve").first()).toBeVisible();
  }

  if (await page.getByRole("heading", { name: "Model activity" }).count()) {
    await expect(page.locator(".model-chart-card .recharts-bar-rectangle").first()).toBeVisible();
    await page.getByRole("button", { name: "Usage observed", exact: true }).click();
    await expect(page.locator(".model-chart-card .metric-caption")).toContainText("Usage observed");
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "test-results/harness-usage-compact.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1, name: "Harness assets" })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/harness-usage-narrow.png", fullPage: true });
  expect(errors).toEqual([]);
});
