import { test, expect } from "@playwright/test";
test("market research, notes, sources, and download work end to end in demo mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Research you can check" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Market intelligence" }).click();
  await page.getByRole("button", { name: "Use an example" }).click();
  const title = "E2E Market " + Date.now();
  await page.getByLabel("Research title").fill(title);
  await page.getByRole("combobox", { name: "Run mode", exact: true }).click();
  await page
    .getByRole("option", { name: "Demo · no API usage", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Choose a depth to continue", { exact: false }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /Quick scan/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Time limit", exact: true }),
  ).toContainText("5 minutes");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Here is what I understood")).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("radio", { name: "An internal briefing" }).click();
  await page.getByRole("button", { name: "Start research" }).click();
  await expect(page.getByText("Report ready", { exact: false })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Research notes" })
    .fill("Durable E2E note");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).last().click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Research notes" }),
  ).toHaveValue("Durable E2E note");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole("button", { name: "Other download formats" }).click();
  const wordPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Word (.docx)" }).click();
  expect((await wordPromise).suggestedFilename()).toMatch(/\.docx$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("sales workflow produces clearly labelled sample records and blocks CRM export", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sales research" }).click();
  await page.getByRole("button", { name: "Use an example" }).click();
  await page.getByLabel("Research title").fill("E2E Sales " + Date.now());
  await page.getByRole("radio", { name: /Standard/ }).click();
  await page.getByRole("combobox", { name: "Run mode", exact: true }).click();
  await page
    .getByRole("option", { name: "Demo · no API usage", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Here is what I understood")).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("radio", { name: "An internal briefing" }).click();
  await page.getByRole("button", { name: "Start research" }).click();
  await expect(page.getByRole("tab", { name: "Companies (2)" })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("tab", { name: "Companies (2)" }).click();
  await expect(
    page.getByRole("heading", { name: "Example Fleet Systems" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review export" }),
  ).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.csv$/);
});
test("evidence check, grounded questions and versions work in demo mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "How a report gets made" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open research" }).first().click();
  const title = "E2E Evidence " + Date.now();
  await page.getByLabel("Research title").fill(title);
  await page
    .getByLabel("Research brief")
    .fill(
      "How are EV charging operators priced in India and which tariffs apply?",
    );
  await page.getByRole("combobox", { name: "Run mode", exact: true }).click();
  await page
    .getByRole("option", { name: "Demo · no API usage", exact: true })
    .click();
  await page.getByRole("radio", { name: /Deep dive/ }).click();
  await page.getByText("Ask me questions before researching").click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(
    page.locator(".trust-strip").getByText(/backed by their source/),
  ).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText("No source cited").first()).toBeVisible();
  await page.getByRole("tab", { name: "Ask", exact: true }).click();
  await page
    .getByLabel("Ask a question about this research")
    .fill("Who regulates hydrogen fuel stations?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Not in this research")).toBeVisible();
  await page.getByRole("button", { name: "Research this" }).click();
  await expect(page.getByLabel("Keep the research going")).toHaveValue(
    /hydrogen/,
  );
  await page.getByRole("tab", { name: /Versions/ }).click();
  await page.getByRole("button", { name: "Refresh research" }).click();
  await expect(page.getByRole("tab", { name: "Versions (2)" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Versions (2)" }).click();
  await expect(page.getByText(/\+\d+ lines/)).toBeVisible();
});
test("the voice assistant button is always visible and opens the panel", async ({
  page,
}) => {
  await page.goto("/");
  const fab = page.getByRole("button", { name: "Talk to Octo" });
  await expect(fab).toBeVisible();
  const box = (await fab.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(48);
  await fab.click();
  await expect(
    page.getByRole("dialog", { name: "Octo voice assistant" }),
  ).toBeVisible();
  await expect(page.getByLabel("Type to Octo")).toBeVisible();
  await page.getByRole("button", { name: "Close voice assistant" }).click();
  await expect(
    page.getByRole("dialog", { name: "Octo voice assistant" }),
  ).toHaveCount(0);
});
