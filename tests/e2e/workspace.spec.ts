import { test, expect } from "@playwright/test";
test("market research, notes, sources, and download work end to end in demo mode", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Research, with a wider lens." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Market intelligence" }).click();
  await page.getByRole("button", { name: "Use an example" }).click();
  await page.getByLabel("Research title").fill("E2E Market " + Date.now());
  await page.getByRole("combobox", { name: "Run mode", exact: true }).click();
  await page
    .getByRole("option", { name: "Demo · no API usage", exact: true })
    .click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
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
  await page
    .getByRole("button", { name: /E2E Market/ })
    .last()
    .click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Research notes" }),
  ).toHaveValue("Durable E2E note");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
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
  await page.getByRole("combobox", { name: "Run mode", exact: true }).click();
  await page
    .getByRole("option", { name: "Demo · no API usage", exact: true })
    .click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
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
