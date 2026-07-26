import { expect, test } from "@playwright/test";

test("two users activate, authenticate, receive targeted attention, and search safely", async ({
  browser,
}) => {
  const adminContext = await browser.newContext({ reducedMotion: "reduce" });
  const recipientContext = await browser.newContext({
    reducedMotion: "reduce",
  });
  const admin = await adminContext.newPage();
  const recipient = await recipientContext.newPage();

  await admin.goto("/");
  await admin.getByLabel("邮箱").fill("alex@demo.intero.test");
  await admin.getByLabel("密码").fill("Intero-demo-2026!");
  await admin.getByRole("button", { name: "使用邮箱和密码登录" }).click();
  await expect(admin.getByTitle("Team Pulse")).toBeVisible();

  await admin.getByRole("button", { name: "通知" }).click();
  await expect(
    admin.getByRole("heading", { name: "需要你处理的事" }),
  ).toBeVisible();
  await expect(admin.getByText("请确认是否推进 10% 灰度发布")).toBeVisible();
  await expect(admin.getByText("替身请求扩大数据范围")).toBeVisible();
  await admin.getByRole("button", { name: "范围扩展", exact: true }).click();
  await expect(
    admin.getByRole("button", { name: "范围扩展 · 已静音" }),
  ).toBeVisible();
  await admin.screenshot({
    path: "output/playwright/phase6/admin-action-inbox.png",
    fullPage: true,
  });

  await admin.getByRole("button", { name: /搜索/ }).first().click();
  await admin.getByPlaceholder("输入至少两个字符").fill("发布");
  await expect(admin.getByText("租户安全的渐进式发布").first()).toBeVisible();
  await expect(
    admin.getByText("执行 10% 租户安全灰度", { exact: true }),
  ).toBeVisible();

  const cdp = await recipientContext.newCDPSession(recipient);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await recipient.goto("/accept-invitation?token=intero-demo-pending-casey");
  await expect(
    recipient.getByRole("heading", { name: "加入 产品体验" }),
  ).toBeVisible();
  await recipient.getByRole("button", { name: "使用 Passkey 激活" }).click();
  const confirmMembership = recipient.getByRole("button", {
    name: "确认加入团队",
  });
  if (await confirmMembership.isVisible({ timeout: 2_000 })) {
    await confirmMembership.click();
  }
  await expect(recipient.getByText(/已加入 产品体验/)).toBeVisible();
  await recipient.getByRole("button", { name: /进入 Team Pulse/ }).click();
  await expect(recipient.getByTitle("Team Pulse")).toBeVisible();

  await recipient.getByTitle("设置").click();
  await expect(
    recipient.getByTestId("account-security-settings"),
  ).toBeVisible();
  await recipient.getByRole("button", { name: "退出当前账号" }).click();
  await expect(
    recipient.getByRole("heading", { name: "回到你的团队" }),
  ).toBeVisible();
  await recipient.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(recipient.getByTitle("Team Pulse")).toBeVisible();

  await admin.screenshot({
    path: "output/playwright/phase6/admin-inbox-search.png",
    fullPage: true,
  });
  await recipient.screenshot({
    path: "output/playwright/phase6/recipient-passkey-team-pulse.png",
    fullPage: true,
  });

  await adminContext.close();
  await recipientContext.close();
});
