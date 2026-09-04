import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

const apiUrl = process.env.INTERO_E2E_API_URL ?? "http://127.0.0.1:4320";
const demoPassword = process.env.INTERO_E2E_PASSWORD ?? "Intero-demo-2026!";

const principals = {
  alex: {
    id: "019f9a00-0000-7000-8000-000000000101",
    name: "Alex Rivera",
    email: "alex@demo.intero.test",
  },
  priya: {
    id: "019f9a00-0000-7000-8000-000000000102",
    name: "Priya Shah",
    email: "priya@demo.intero.test",
  },
  morgan: {
    id: "019f9a00-0000-7000-8000-000000000103",
    name: "Morgan Lee",
    email: "morgan@demo.intero.test",
  },
} as const;

type Principal = (typeof principals)[keyof typeof principals];

test.use({
  locale: "en-US",
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

test.describe("chat baseline", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let alexContext: BrowserContext;
  let priyaContext: BrowserContext;
  let morganContext: BrowserContext | undefined;
  let alex: Page;
  let priya: Page;
  let morgan: Page;
  let browserRef: Browser;
  let stamp: string;
  let dmThreadId: string;
  let teamRoomTitle: string;
  let teamRoomId: string;
  let privateRoomTitle: string;
  let searchToken: string;
  let deletedToken: string;
  let linkPreviewOutcome: "card" | "unavailable" | undefined;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    browserRef = browser;
    stamp = Date.now().toString(36);
    teamRoomTitle = `Baseline team ${stamp}`;
    privateRoomTitle = `Baseline private ${stamp}`;
    searchToken = `zxq${stamp}`;
    deletedToken = `del${stamp}`;
    alexContext = await newUserContext(browser);
    priyaContext = await newUserContext(browser);
    alex = await alexContext.newPage();
    priya = await priyaContext.newPage();
    await signIn(alex, principals.alex);
    await signIn(priya, principals.priya);
    dmThreadId = await startDirectMessage(alex, principals.priya);
    await priya.goto(`/communications/${dmThreadId}`);
    await expect(priya.getByTestId("communications-composer")).toBeVisible();
  });

  test.afterAll(async () => {
    await Promise.all([
      alexContext?.close(),
      priyaContext?.close(),
      morganContext?.close(),
    ]);
  });

  test("1. edit and delete a DM message over realtime", async () => {
    const original = `edit-original ${stamp}`;
    const edited = `edit-updated ${stamp}`;
    await openThread(alex, dmThreadId);
    await openThread(priya, dmThreadId);
    await sendMessage(alex, original);
    await expect(messageByText(priya, original)).toBeVisible({
      timeout: 15_000,
    });

    const alexMessage = messageByText(alex, original);
    const messageId = await alexMessage.getAttribute("data-message-id");
    expect(messageId).toBeTruthy();
    await alexMessage.hover();
    await alexMessage.getByTestId("message-edit").click();
    const editor = alex.getByTestId("message-edit-input");
    await expect(editor).toBeVisible();
    await editor.fill(edited);
    await editor.press("Enter");
    const editedMessage = alex.locator(`[data-message-id="${messageId}"]`);
    await expect(
      editedMessage.getByText(edited, { exact: true }),
    ).toBeVisible();
    await expect(editedMessage.getByTestId("message-edited")).toBeVisible();
    const priyaCopy = priya.locator(`[data-message-id="${messageId}"]`);
    await expect(priyaCopy.getByText(edited, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(priyaCopy.getByTestId("message-edited")).toBeVisible();
    await expect(priyaCopy.getByText(original, { exact: true })).toHaveCount(0);

    await priyaCopy.hover();
    await expect(priyaCopy.getByTestId("message-edit")).toHaveCount(0);
    await expect(priyaCopy.getByTestId("message-delete")).toHaveCount(0);

    await editedMessage.hover();
    await editedMessage.getByTestId("message-delete").click();
    await alex.getByTestId("message-delete-confirm").click();
    await expect(editedMessage.getByTestId("message-deleted")).toBeVisible();
    await expect(priyaCopy.getByTestId("message-deleted")).toBeVisible({
      timeout: 15_000,
    });
    await expect(priyaCopy.getByText(edited, { exact: true })).toHaveCount(0);
  });

  test("2. reactions and reply still work after the split", async () => {
    const body = `react-reply ${stamp}`;
    await openThread(alex, dmThreadId);
    await openThread(priya, dmThreadId);
    await sendMessage(alex, body);
    await expect(messageByText(priya, body)).toBeVisible({
      timeout: 15_000,
    });

    const target = messageByText(priya, body);
    await target.hover();
    await target.getByTestId("message-add-reaction").click();
    await priya.getByTestId("message-react-👍").click();
    await expect(target.locator("text=1").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      messageByText(alex, body).locator("text=1").first(),
    ).toBeVisible({ timeout: 15_000 });

    await target.hover();
    await target.getByTestId("message-reply").click();
    await expect(
      priya.getByTestId("communications-reply-preview"),
    ).toBeVisible();
    const reply = `reply-to ${stamp}`;
    await sendMessage(priya, reply);
    await expect(messageByText(alex, reply)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      alex.getByTestId("quoted-message-preview").first(),
    ).toBeVisible();
  });

  test("3. typing indicator expires and presence stays online", async () => {
    await openThread(alex, dmThreadId);
    await openThread(priya, dmThreadId);
    await expect(
      alex
        .locator("header")
        .locator(
          `[data-presence-principal="${principals.priya.id}"] [data-testid="presence-dot"]`,
        ),
    ).toHaveAttribute("data-presence", "online", { timeout: 40_000 });

    await waitForRealtime(alex);
    await waitForRealtime(priya);
    await priya.waitForTimeout(3_500);
    const priyaComposer = priya.getByTestId("communications-composer");
    await priyaComposer.click();
    await priyaComposer.fill("");
    await priyaComposer.pressSequentially("typing now", { delay: 40 });
    await expect(alex.getByTestId("typing-indicator")).toContainText(
      "Priya Shah is typing",
      { timeout: 10_000 },
    );
    await priyaComposer.fill("");
    await expect(alex.getByTestId("typing-indicator")).toHaveCount(0, {
      timeout: 8_000,
    });
  });

  test("4. mute hides the numeric badge and unmute restores it", async () => {
    await openThread(priya, dmThreadId);
    await priya.getByTestId("thread-header-menu").click();
    if (await priya.getByTestId("unmute-thread").isVisible()) {
      await priya.getByTestId("unmute-thread").click();
      await expect(
        threadRow(priya, dmThreadId).getByTestId("thread-muted"),
      ).toHaveCount(0);
      await priya.getByTestId("thread-header-menu").click();
    }
    await priya.getByTestId("mute-indefinitely").click();
    const dmRow = threadRow(priya, dmThreadId);
    await expect(dmRow.getByTestId("thread-muted")).toBeVisible();

    await priya.getByTestId("personal-stand-in-conversation").click();
    await expect(priya).not.toHaveURL(
      new RegExp(`/communications/${dmThreadId}(?:$|[?#])`),
    );

    const mutedNote = `muted-ping ${stamp}`;
    await openThread(alex, dmThreadId);
    await sendMessage(alex, mutedNote);
    await expect(dmRow.getByTestId("thread-unread-dot")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dmRow.getByTestId("thread-unread-badge")).toHaveCount(0);

    await dmRow.click();
    await priya.getByTestId("thread-header-menu").click();
    await priya.getByTestId("unmute-thread").click();
    await priya.getByTestId("personal-stand-in-conversation").click();
    await sendMessage(alex, `unmuted-ping ${stamp}`);
    await expect(dmRow.getByTestId("thread-unread-badge")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dmRow.getByTestId("thread-unread-dot")).toHaveCount(0);
    await dmRow.click();
  });

  test("5. channel directory join, message, leave, and private rooms", async () => {
    morganContext = await newUserContext(browserRef);
    morgan = await morganContext.newPage();
    await signIn(morgan, principals.morgan);
    await openChat(alex);
    const sharedTeamId = await sharedTeamIdFor(alex, morgan);
    teamRoomId = await createRoom(
      alex,
      teamRoomTitle,
      principals.morgan.id,
      sharedTeamId,
    );
    const createdList = await alex.request.get(`${apiUrl}/v1/threads`);
    const createdPayload = (await createdList.json()) as {
      items: Array<{
        thread: { id: string; teamId?: string; visibility?: string };
      }>;
    };
    const createdRoom = createdPayload.items.find(
      (item) => item.thread.id === teamRoomId,
    );
    expect(
      createdRoom?.thread.teamId,
      JSON.stringify(createdRoom?.thread),
    ).toBeTruthy();
    await alex.getByTestId("group-chat-management-trigger").click();
    await alex.getByTestId("visibility-team").click();
    const morganMember = alex.getByTestId(
      `group-member-${principals.morgan.id}`,
    );
    if (await morganMember.count()) await morganMember.click();
    await alex.getByTestId("group-chat-management-save").click();
    await expect(alex.getByTestId("group-chat-management-save")).toHaveCount(
      0,
      {
        timeout: 10_000,
      },
    );
    const savedList = await alex.request.get(`${apiUrl}/v1/threads`);
    const savedRoom = (
      (await savedList.json()) as {
        items: Array<{
          thread: { id: string; teamId?: string; visibility?: string };
        }>;
      }
    ).items.find((item) => item.thread.id === teamRoomId);
    expect(savedRoom?.thread.visibility).toBe("team");
    expect(savedRoom?.thread.teamId).toBeTruthy();

    await openChat(morgan);
    await morgan.getByTestId("browse-channels").click();
    await expect(morgan.getByTestId("channel-directory")).toBeVisible();
    const teamRow = morgan.locator(`[data-channel-title="${teamRoomTitle}"]`);
    const teamChip = morgan.getByTestId(
      `channel-team-${savedRoom?.thread.teamId}`,
    );
    if (await teamChip.count()) await teamChip.click();
    await expect(teamRow).toBeVisible({ timeout: 15_000 });
    await teamRow.getByTestId("channel-join").click();
    await expect(morgan.getByTestId("thread-header-title")).toHaveText(
      teamRoomTitle,
      { timeout: 15_000 },
    );
    const roomNote = `room-hi ${stamp}`;
    await sendMessage(morgan, roomNote);
    await openThread(alex, teamRoomId);
    await expect(messageByText(alex, roomNote)).toBeVisible({
      timeout: 15_000,
    });

    await morgan.getByTestId("browse-channels").click();
    await morgan
      .locator(`[data-channel-title="${teamRoomTitle}"]`)
      .getByTestId("channel-leave")
      .click();
    await expect(
      morgan.locator(`[data-thread-title="${teamRoomTitle}"]`),
    ).toHaveCount(0, { timeout: 15_000 });

    await createRoom(alex, privateRoomTitle, principals.priya.id);
    await openChat(morgan);
    await morgan.getByTestId("browse-channels").click();
    await expect(
      morgan.locator(`[data-channel-title="${privateRoomTitle}"]`),
    ).toHaveCount(0);
    await morgan.keyboard.press("Escape");
    await expect(morgan.getByTestId("channel-directory")).toHaveCount(0);
    await morgan.getByTestId("browse-channels").click();
    await expect(
      morgan.locator(`[data-channel-title="${privateRoomTitle}"]`),
    ).toHaveCount(0);
    await morgan.keyboard.press("Escape");
  });

  test("6. archive a Room for everyone and hide a DM for one viewer", async () => {
    await openThread(alex, teamRoomId);
    await alex.getByTestId("thread-header-menu").click();
    await alex.getByTestId("archive-thread").click();
    await expect(
      alex.locator(`[data-thread-title="${teamRoomTitle}"]`),
    ).toHaveCount(0, { timeout: 10_000 });
    await alex.getByTestId("archived-filter").click();
    await expect(
      alex.locator(`[data-thread-title="${teamRoomTitle}"]`),
    ).toBeVisible();
    await alex.locator(`[data-thread-title="${teamRoomTitle}"]`).click();
    await expect(alex.getByTestId("archived-readonly")).toBeVisible();
    await expect(alex.getByTestId("communications-composer")).toHaveCount(0);

    await alex.getByTestId("thread-header-menu").click();
    await alex.getByTestId("unarchive-thread").click();
    await expect(alex.getByTestId("archived-filter")).toHaveAttribute(
      "aria-pressed",
      "false",
      { timeout: 10_000 },
    );
    await expect(
      alex.locator(`[data-thread-title="${teamRoomTitle}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await alex.locator(`[data-thread-title="${teamRoomTitle}"]`).click();
    await expect(alex.getByTestId("communications-composer")).toBeVisible();

    await openThread(priya, dmThreadId);
    await priya.getByTestId("thread-header-menu").click();
    await priya.getByTestId("archive-thread").click();
    await expect(threadRow(priya, dmThreadId)).toHaveCount(0, {
      timeout: 10_000,
    });
    await openChat(alex);
    await expect(threadRow(alex, dmThreadId)).toBeVisible();
    await priya.getByTestId("archived-filter").click();
    await threadRow(priya, dmThreadId).click();
    await priya.getByTestId("thread-header-menu").click();
    await priya.getByTestId("unarchive-thread").click();
    await expect(priya.getByTestId("archived-filter")).toHaveAttribute(
      "aria-pressed",
      "false",
      { timeout: 10_000 },
    );
    await expect(threadRow(priya, dmThreadId)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("7. global and in-thread message search", async () => {
    await openThread(alex, dmThreadId);
    const bodies = [
      `${searchToken} alpha`,
      `${searchToken} beta`,
      `${searchToken} gamma`,
    ];
    for (const body of bodies) await sendMessage(alex, body);
    await sendMessage(alex, deletedToken);
    const doomed = messageByText(alex, deletedToken);
    await doomed.hover();
    await doomed.getByTestId("message-delete").click();
    await alex.getByTestId("message-delete-confirm").click();
    await expect(alex.getByTestId("message-deleted").last()).toBeVisible();

    await alex.getByTestId("nav-search").click();
    await alex.getByTestId("search-tab-messages").click();
    await alex.getByTestId("search-input").fill(searchToken);
    const hits = alex.getByTestId("search-result");
    await expect(hits).toHaveCount(3, { timeout: 15_000 });
    await expect(hits.first().locator("mark").first()).toBeVisible();

    await alex.getByTestId("search-input").fill(`from:Priya ${searchToken}`);
    await expect(alex.getByTestId("search-result")).toHaveCount(0, {
      timeout: 10_000,
    });

    await alex
      .getByTestId("search-input")
      .fill(`in:${teamRoomId} ${searchToken}`);
    await expect(alex.getByTestId("search-result")).toHaveCount(0, {
      timeout: 10_000,
    });
    await alex
      .getByTestId("search-input")
      .fill(`in:${dmThreadId} ${searchToken}`);
    await expect(alex.getByTestId("search-result").first()).toBeVisible({
      timeout: 10_000,
    });

    await alex.getByTestId("search-input").fill(searchToken);
    await expect(hits).toHaveCount(3, { timeout: 10_000 });
    await hits.filter({ hasText: "gamma" }).click();
    await expect(alex.getByTestId("communications-composer")).toBeVisible();
    await expect(
      alex
        .locator('[data-highlighted="true"]')
        .getByText(`${searchToken} gamma`),
    ).toBeVisible({ timeout: 30_000 });

    await alex.getByTestId("thread-search-toggle").click();
    await alex.getByTestId("thread-search-input").fill(searchToken);
    await expect(alex.getByTestId("thread-search")).toContainText(/1 \/ 3|3/, {
      timeout: 10_000,
    });
    const firstHit = await highlightedMessageId(alex);
    await alex.getByTestId("thread-search-next").click();
    await expect
      .poll(async () => highlightedMessageId(alex), { timeout: 10_000 })
      .not.toBe(firstHit);

    await alex.getByTestId("nav-search").click();
    await alex.getByTestId("search-tab-messages").click();
    await alex.getByTestId("search-input").fill(deletedToken);
    await expect(alex.getByTestId("search-result")).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("8. link preview card or silent failure when unfurl cannot run", async () => {
    await openThread(alex, dmThreadId);
    await openThread(priya, dmThreadId);
    await sendMessage(alex, "see https://example.com/");
    const card = alex.getByTestId("link-preview");
    const appeared = await card
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      linkPreviewOutcome = "card";
      await expect(priya.getByTestId("link-preview")).toBeVisible({
        timeout: 15_000,
      });
      await alex.getByTestId("hide-link-preview").click();
      await expect(alex.getByTestId("link-preview")).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(priya.getByTestId("link-preview")).toHaveCount(0, {
        timeout: 15_000,
      });
    } else {
      linkPreviewOutcome = "unavailable";
      await expect(alex.getByTestId("link-preview")).toHaveCount(0);
      await expect(alex.getByRole("alert")).toHaveCount(0);
      await expect(priya.getByTestId("link-preview")).toHaveCount(0);
    }
    expect(
      linkPreviewOutcome === "card" || linkPreviewOutcome === "unavailable",
    ).toBe(true);
  });

  test("9. PDF attachment opens an in-app viewer with sandbox headers", async () => {
    await openThread(alex, dmThreadId);
    await alex.getByTestId("composer-attach-input").setInputFiles({
      name: `baseline-${stamp}.pdf`,
      mimeType: "application/pdf",
      buffer: minimalPdf(`Intero ${stamp}`),
    });
    await expect(alex.getByTestId("composer-send")).toBeEnabled({
      timeout: 20_000,
    });
    await alex.getByTestId("composer-send").click();
    const pdfCard = alex.locator(
      `[data-testid="pdf-attachment"][title="baseline-${stamp}.pdf"]`,
    );
    await expect(pdfCard).toBeVisible({ timeout: 20_000 });
    const attachmentId = await pdfCard.getAttribute("data-attachment-id");
    expect(attachmentId).toBeTruthy();
    await pdfCard.click();
    await expect(alex.getByTestId("pdf-viewer")).toBeVisible();
    await alex.keyboard.press("Escape");
    await expect(alex.getByTestId("pdf-viewer")).toHaveCount(0);

    const response = await alex.request.get(
      `${apiUrl}/v1/attachments/${attachmentId}/content`,
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-security-policy"]).toBe("sandbox");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("10. notification messages mode persists after reload", async () => {
    await alex.getByTestId("nav-settings").click();
    await expect(alex.getByTestId("notification-settings")).toBeVisible();
    await expect(alex.getByTestId("notification-messages-mode")).toBeVisible();
    await alex.getByTestId("notification-messages-all").click();
    await expect(alex.getByTestId("notification-messages-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await alex.reload();
    await expect(alex.getByTestId("notification-messages-all")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 },
    );
  });

  test("10b. mention toast when the viewer is on another thread", async () => {
    await openThread(alex, teamRoomId);
    await openThread(priya, dmThreadId);
    await waitForRealtime(alex);
    await waitForRealtime(priya);
    await priya.getByTestId("communications-mention-trigger").click();
    await priya
      .getByTestId(`communications-mention-option-${principals.alex.id}`)
      .click();
    await priya
      .getByTestId("communications-composer")
      .pressSequentially(` ping ${stamp}`);
    await priya.getByTestId("communications-composer").press("Enter");
    await expect(alex.getByTestId("app-notification")).toContainText(
      /Alex|mention|Priya|提到/i,
      { timeout: 15_000 },
    );
  });

  test("11. audio call ring and decline signaling", async () => {
    await openThread(alex, dmThreadId);
    await openThread(priya, dmThreadId);
    await waitForRealtime(alex);
    await waitForRealtime(priya);
    const startCall = alex.getByTestId("start-audio-call");
    await expect(startCall).toBeEnabled({ timeout: 20_000 });
    await startCall.click();
    await expect(priya.getByTestId("conversation-call")).toBeVisible({
      timeout: 20_000,
    });
    await priya.getByTestId("reject-call").click();
    await expect(alex.getByTestId("call-declined")).toBeVisible({
      timeout: 15_000,
    });
  });
});

async function newUserContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    locale: "en-US",
    permissions: ["microphone", "camera"],
    reducedMotion: "reduce",
  });
}

async function signIn(page: Page, principal: Principal): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto("/");
    if (
      await page
        .getByTestId("nav-pulse")
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }
    await page.getByTestId("sign-in-email").fill(principal.email);
    await page.getByTestId("sign-in-password").fill(demoPassword);
    await page.getByTestId("sign-in-password-submit").click();
    try {
      await expect(page.getByTestId("nav-pulse")).toBeVisible({
        timeout: 15_000,
      });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
}

async function openChat(page: Page): Promise<void> {
  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("new-conversation")).toBeVisible();
}

async function waitForRealtime(page: Page): Promise<void> {
  await expect(
    page.getByTestId("conversation-realtime-status"),
  ).toHaveAttribute("data-status", "live", { timeout: 30_000 });
}

async function openThread(page: Page, threadId: string): Promise<void> {
  if (!page.url().includes("/communications")) {
    await page.getByTestId("nav-chat").click();
    await expect(page.getByTestId("new-conversation")).toBeVisible();
  }
  const archived = page.getByTestId("archived-filter");
  if ((await archived.getAttribute("aria-pressed")) === "true") {
    await archived.click();
    await expect(archived).toHaveAttribute("aria-pressed", "false");
  }
  const composer = page.getByTestId("communications-composer");
  const onThread = new RegExp(`/communications/${threadId}(?:$|[?#])`).test(
    page.url(),
  );
  if (onThread && (await composer.isVisible().catch(() => false))) {
    return;
  }
  const row = page.getByTestId(`thread-row-${threadId}`);
  if (await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await page.goto(`/communications/${threadId}`);
  }
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/communications/${threadId}`));
}

async function startDirectMessage(
  page: Page,
  peer: Principal,
): Promise<string> {
  await page.goto(`/people/${peer.id}`);
  await page.getByTestId("person-start-dm").click();
  await expect(page).toHaveURL(/\/communications\//, { timeout: 20_000 });
  const threadId = page.url().split("/communications/")[1]?.split(/[?#]/)[0];
  expect(threadId).toBeTruthy();
  await expect(page.getByTestId("communications-composer")).toBeVisible();
  return threadId!;
}

async function sharedTeamIdFor(
  alexPage: Page,
  morganPage: Page,
): Promise<string> {
  const readTeams = async (page: Page) => {
    const response = await page.request.get(`${apiUrl}/v1/pilot/teams`);
    const payload = (await response.json()) as { teams: Array<{ id: string }> };
    return payload.teams.map((team) => team.id);
  };
  const alexTeams = await readTeams(alexPage);
  const morganTeams = await readTeams(morganPage);
  const shared = alexTeams.find((teamId) => morganTeams.includes(teamId));
  expect(shared, "Alex and Morgan must share a team").toBeTruthy();
  return shared!;
}

async function createRoom(
  page: Page,
  title: string,
  memberId?: string,
  owningTeamId?: string,
): Promise<string> {
  await openChat(page);
  await page.getByTestId("new-conversation").click();
  await page.getByTestId("new-conversation-title").fill(title);
  if (owningTeamId) {
    const chip = page.getByTestId(`owning-team-${owningTeamId}`);
    if (await chip.count()) await chip.click();
  }
  if (memberId) {
    await page.getByTestId(`conversation-candidate-${memberId}`).click();
  } else {
    const candidates = page.locator("[data-testid^='conversation-candidate-']");
    const count = await candidates.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const testId = await candidates.nth(index).getAttribute("data-testid");
      if (!testId?.includes(principals.morgan.id)) {
        await candidates.nth(index).click();
        break;
      }
    }
  }
  await page.getByTestId("new-conversation-create").click();
  await expect(page.getByTestId("thread-header-title")).toHaveText(title, {
    timeout: 20_000,
  });
  const threadId = page.url().split("/communications/")[1]?.split(/[?#]/)[0];
  expect(threadId).toBeTruthy();
  return threadId!;
}

async function sendMessage(page: Page, body: string): Promise<void> {
  const composer = page.getByTestId("communications-composer");
  await composer.fill(body);
  await composer.press("Enter");
  await expect(messageByText(page, body)).toBeVisible({
    timeout: 15_000,
  });
}

function threadRow(page: Page, threadId: string): Locator {
  return page.getByTestId(`thread-row-${threadId}`);
}

function messageByText(page: Page, body: string): Locator {
  return page.locator("[data-message-id]", { hasText: body }).last();
}

async function highlightedMessageId(page: Page): Promise<string | null> {
  return page
    .locator('[data-highlighted="true"]')
    .getAttribute("data-message-id");
}

function minimalPdf(text: string): Buffer {
  const safe = text.replaceAll(/[()\\]/g, " ");
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += `${object}\n`;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let index = 1; index <= 5; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}
