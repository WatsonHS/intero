import { expect, test } from "@playwright/test";

test("account menu, settings categories, custom roles, and password keyboard flow", async ({
  page,
}) => {
  await page.goto("/");

  const email = page.getByTestId("sign-in-email");
  const password = page.getByTestId("sign-in-password");
  const eye = page.getByTestId("sign-in-password-toggle");
  const submit = page.getByTestId("sign-in-password-submit");
  const passkey = page.getByTestId("sign-in-passkey");

  await expect(email).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  await page.screenshot({
    path: "output/playwright/ui-refinement/password-first-login.png",
    fullPage: true,
  });
  await eye.click();
  await expect(password).toHaveAttribute("type", "text");
  await eye.click();
  await expect(password).toHaveAttribute("type", "password");

  await email.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(eye).toBeFocused();

  await email.fill("alex@demo.intero.test");
  await password.fill("Intero-demo-2026!");
  await eye.focus();
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(passkey).toBeFocused();
  await submit.click();
  await expect(page.getByTitle("Team Pulse")).toBeVisible();

  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("profile-menu")).toBeVisible();
  await expect(page.getByText("alex@demo.intero.test")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-menu")).toBeHidden();
  await expect(page.getByTestId("profile-menu-trigger")).toBeFocused();
  await page.getByTestId("profile-menu-trigger").click();
  await page.screenshot({
    path: "output/playwright/ui-refinement/profile-account-menu.png",
    fullPage: true,
  });
  await page.mouse.click(700, 120);
  await expect(page.getByTestId("profile-menu")).toBeHidden();
  await page.getByTestId("profile-menu-trigger").click();

  await page.getByTestId("profile-edit-name").click();
  await page.getByTestId("profile-display-name-input").fill("Alex 演示");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("profile-menu")).toContainText("Alex 演示");

  await page.getByTestId("profile-edit-avatar").click();
  await page.getByTestId("profile-avatar-tone-green").click();
  await page.getByTestId("profile-open-personal").click();

  await expect(page.getByTestId("settings-category-personal")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByTestId("settings-category-team").click();
  const management = page.getByTestId("team-member-management");
  await expect(management).toBeVisible();
  await expect(management.locator("select")).toHaveCount(0);
  await page.screenshot({
    path: "output/playwright/ui-refinement/settings-team-members.png",
    fullPage: true,
  });

  const teamRole = page.getByRole("button", {
    name: "Alex 演示 的团队角色",
  });
  await teamRole.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("listbox", { name: "Alex 演示 的团队角色" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(teamRole).toBeFocused();

  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("profile-edit-name").click();
  await page.getByTestId("profile-display-name-input").fill("Alex Rivera");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByTestId("profile-edit-avatar").click();
  await page.getByTestId("profile-avatar-tone-accent").click();
  await page.getByTestId("profile-sign-out").click();

  await expect(
    page.getByRole("heading", { name: "回到你的团队" }),
  ).toBeVisible();
  await expect(page.getByTestId("sign-in-password-submit")).toBeVisible();
  await expect(page.getByTestId("sign-in-passkey")).toBeVisible();
});
