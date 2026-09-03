import path from "node:path";
import { expect, test as setup } from "@playwright/test";

const authFile = path.join(process.cwd(), ".e2e", "auth.json");

setup("register the isolated local admin", async ({ page }) => {
  setup.setTimeout(90_000);
  await page.goto("/register");
  await page.getByLabel("昵称").fill("E2E Admin");
  await page.getByLabel("邮箱").fill("e2e-admin@example.com");
  await page.getByLabel("密码（至少 6 位）").fill("e2e-password");
  await page.getByRole("button", { name: "注册", exact: true }).click();

  await expect(page).toHaveURL(/\/projects\/default-/, { timeout: 45_000 });
  await expect(page.locator('[title="E2E Admin"]')).toBeVisible();
  await page.context().storageState({ path: authFile });
});
