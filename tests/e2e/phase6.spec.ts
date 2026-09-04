import { expect, test, type Page } from "@playwright/test";

const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://localhost:4320";

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
  await admin.getByLabel("密码", { exact: true }).fill("Intero-demo-2026!");
  await admin.getByRole("button", { name: "使用邮箱和密码登录" }).click();
  await expect(admin.getByTitle("Team Pulse")).toBeVisible();

  await admin.getByRole("button", { name: "通知" }).click();
  await expect(
    admin.getByRole("heading", { name: "需要你处理的事" }),
  ).toBeVisible();
  await expect(admin.getByText("请确认是否推进 10% 灰度发布")).toBeVisible();
  await expect(admin.getByText("替身请求扩大数据范围")).toBeVisible();
  const scopeMute = admin.getByRole("button", {
    name: "范围扩展",
    exact: true,
  });
  if (await scopeMute.isVisible()) {
    await scopeMute.click();
  }
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

  const invitation = await resolveInvitation(admin);
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
  await recipient.goto(
    `/accept-invitation?token=${encodeURIComponent(invitation.token)}`,
  );
  await expect(
    recipient.getByRole("heading", { name: "加入 产品体验" }),
  ).toBeVisible();
  await recipient.getByTestId("invitation-display-name").fill(invitation.name);
  await recipient.getByRole("button", { name: "使用 Passkey 激活" }).click();
  const confirmMembership = recipient.getByRole("button", {
    name: "确认加入团队",
  });
  if (await confirmMembership.isVisible({ timeout: 2_000 })) {
    await confirmMembership.click();
  }
  const joined = recipient.getByText(/已加入 产品体验/);
  const pulseNav = recipient.getByTitle("Team Pulse");
  await expect(joined.or(pulseNav)).toBeVisible();
  if (await joined.isVisible()) {
    await recipient.getByRole("button", { name: /进入 Team Pulse/ }).click();
  }
  await expect(pulseNav).toBeVisible();
  await recipient.getByTestId("profile-menu-trigger").click();
  await expect(recipient.getByTestId("profile-menu")).toContainText(
    invitation.name,
  );
  await recipient.getByRole("button", { name: "关闭账户菜单" }).click();

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
  await recipient.getByTitle("Team Pulse").click();
  await expect(recipient).toHaveURL(/\/pulse$/);
  await expect(recipient.getByRole("heading", { level: 1 })).toBeVisible();

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

async function resolveInvitation(
  admin: Page,
): Promise<{ token: string; name: string; email: string }> {
  const pending = await admin.request.get(
    `${apiUrl}/v1/pilot/invitations/intero-demo-pending-casey`,
  );
  if (pending.ok()) {
    const body = (await pending.json()) as {
      invitation?: { status?: string; email?: string };
      activationRequired?: boolean;
    };
    if (
      body.invitation?.status === "pending" &&
      body.activationRequired === true
    ) {
      return {
        token: "intero-demo-pending-casey",
        name: "Casey Nguyen",
        email: body.invitation.email ?? "casey@demo.intero.test",
      };
    }
  }

  const teamsResponse = await admin.request.get(`${apiUrl}/v1/pilot/teams`);
  expect(teamsResponse.ok()).toBe(true);
  const teamsBody = (await teamsResponse.json()) as {
    teams: Array<{ id: string; name: string }>;
  };
  const team = teamsBody.teams.find(
    (candidate) => candidate.name === "产品体验",
  );
  expect(team).toBeDefined();
  const suffix = Date.now().toString(36);
  const email = `casey.${suffix}@demo.intero.test`;
  const created = await admin.request.post(
    `${apiUrl}/v1/pilot/teams/${team!.id}/invitations`,
    {
      data: { email },
    },
  );
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { token: string };
  expect(createdBody.token).toBeTruthy();
  return { token: createdBody.token, name: "Casey Nguyen", email };
}
