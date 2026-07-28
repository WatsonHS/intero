import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

const password = process.env.INTERO_E2E_PASSWORD ?? "Intero-demo-2026!";
const databaseUrl = process.env.DATABASE_URL;
const demoProjectId = "019f9a00-0000-7000-8000-000000000401";
const demoPrincipalId = "019f9a00-0000-7000-8000-000000000101";
const legacyCoordinationThreadId = "019f9a00-0000-7000-8000-000000000c03";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("邮箱").fill("alex@demo.intero.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "使用邮箱和密码登录" }).click();
  await expect(page.getByTitle("Team Pulse")).toBeVisible();
}

let authenticatedCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  authenticatedCookies = await page.context().cookies();
  await page.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(authenticatedCookies);
});

test("every product route has a stable loading and rendered state", async ({
  page,
}) => {
  const routes = [
    "/pulse",
    "/communications",
    "/coordination",
    `/projects/${demoProjectId}/work`,
    `/projects/${demoProjectId}/specs`,
    "/attention",
    "/search",
    "/admin/members",
    "/settings/personal",
    "/settings/agent",
    "/settings/services",
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByTestId("route-loading")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("route-error")).toHaveCount(0);
    await expect(page.locator("main")).not.toBeEmpty();
  }
});

test("stale and legacy deep links render explicit degraded details", async ({
  page,
}) => {
  const missingThreadId = "019f9a00-0000-7000-8000-00000000dead";

  await page.goto(`/communications/${missingThreadId}`);
  await expect(
    page.getByTestId("communications-degraded-record"),
  ).toContainText("COMMUNICATION_RECORD_UNAVAILABLE");

  await page.goto(`/coordination/${missingThreadId}`);
  await expect(page.getByTestId("coordination-degraded-record")).toContainText(
    "COORDINATION_RECORD_UNAVAILABLE",
  );

  await page.goto(`/coordination/${legacyCoordinationThreadId}`);
  await expect(page.getByTestId("coordination-legacy-detail")).toContainText(
    "COORDINATION_LEGACY_RECORD",
  );
});

test("a partially migrated Coordination record stays visible and read-only", async ({
  page,
}) => {
  test.skip(
    !databaseUrl,
    "DATABASE_URL is required for the migration fixture.",
  );
  const pool = new Pool({ connectionString: databaseUrl });
  const record = await pool.query<{
    id: string;
    organization_id: string;
    data: Record<string, unknown>;
  }>(
    `SELECT id,organization_id,data
     FROM pilot_coordination_threads
     WHERE organization_id='019f9a00-0000-7000-8000-000000000001'
       AND data->'participantIds' ? $1
     ORDER BY created_at
     LIMIT 1`,
    [demoPrincipalId],
  );
  const thread = record.rows[0];
  expect(thread).toBeTruthy();
  await pool.query(
    `UPDATE pilot_coordination_threads
     SET data=jsonb_set(data,'{safeContext}','""'::jsonb)
     WHERE organization_id=$1 AND id=$2`,
    [thread!.organization_id, thread!.id],
  );
  try {
    await page.goto(`/coordination/${thread!.id}`);
    await expect(
      page.getByTestId("coordination-incomplete-detail"),
    ).toContainText("COORDINATION_PARTIAL_MIGRATION");
  } finally {
    await pool.query(
      `UPDATE pilot_coordination_threads
       SET data=$3::jsonb
       WHERE organization_id=$1 AND id=$2`,
      [thread!.organization_id, thread!.id, JSON.stringify(thread!.data)],
    );
    await pool.end();
  }
});

test("an Action Inbox deep link focuses the exact matching item", async ({
  page,
}) => {
  await page.goto("/attention");
  const firstItem = page.locator('article[id^="attention-item-"]').first();
  await expect(firstItem).toBeVisible();
  const itemId = (await firstItem.getAttribute("id"))?.replace(
    "attention-item-",
    "",
  );
  expect(itemId).toBeTruthy();

  await page.goto(`/attention?itemId=${itemId}`);
  await expect(page.locator(`[data-focused="true"]`)).toHaveAttribute(
    "id",
    `attention-item-${itemId}`,
  );
});
