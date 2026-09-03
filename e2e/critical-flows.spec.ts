import path from "node:path";
import fs from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import Database from "better-sqlite3";

const PROJECT_NAME = "E2E Critical Flows";
const PROJECT_DESCRIPTION = "Isolated Playwright regression workspace";
const FIXTURE_PATH = path.join(
  process.cwd(),
  "public",
  "docs-shots",
  "06-image.png"
);

function silentWav(durationSeconds = 3, sampleRate = 8_000): Buffer {
  const samples = Math.floor(durationSeconds * sampleRate);
  const dataBytes = samples * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  return output;
}

async function openFormalProject(page: Page): Promise<string> {
  await page.goto("/projects");
  const projectLink = page.getByRole("link", { name: PROJECT_NAME }).last();
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

function fakeTask(projectId: string, kind: "image" | "video" | "music" | "audio") {
  const now = Date.now();
  return {
    id: `e2e-${kind}-${now}`,
    projectId,
    userId: "e2e-user",
    kind,
    status: "queued",
    modelKey: `e2e-${kind}`,
    inputJson: "{}",
    arkTaskId: null,
    outputAssetId: null,
    contextJson: null,
    error: null,
    errorCode: null,
    errorRequestId: null,
    deletedAt: null,
    usageJson: null,
    createdAt: now,
    updatedAt: now,
  };
}

function insertTerminalTasks(
  projectId: string,
  rows: Array<{ id: string; userId: string }>
) {
  const sqlite = new Database(
    path.join(process.cwd(), ".e2e", "data", "haitun-post-studio.db")
  );
  sqlite.pragma("busy_timeout = 5000");
  const now = Date.now();
  try {
    const insert = sqlite.prepare(`
      INSERT INTO tasks (
        id, project_id, user_id, kind, status, model_key, input_json,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, 'image', 'succeeded', 'e2e-role-test', '{}', 1, ?, ?)
    `);
    const transaction = sqlite.transaction(() => {
      rows.forEach((row) => insert.run(row.id, projectId, row.userId, now, now));
    });
    transaction();
  } finally {
    sqlite.close();
  }
}

function insertDashboardRankFixtures() {
  const sqlite = new Database(
    path.join(process.cwd(), ".e2e", "data", "haitun-post-studio.db")
  );
  sqlite.pragma("busy_timeout = 5000");
  try {
    const admin = sqlite
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("e2e-admin@example.com") as { id: string } | undefined;
    if (!admin) throw new Error("E2E admin not found for dashboard fixtures");
    const now = Date.now();
    const insertProject = sqlite.prepare(`
      INSERT OR IGNORE INTO projects (
        id, name, description, created_by, visibility, created_at, updated_at
      ) VALUES (?, ?, 'Dashboard pagination fixture', ?, 'private', ?, ?)
    `);
    const insertMember = sqlite.prepare(`
      INSERT OR IGNORE INTO project_members (
        project_id, user_id, role, added_at
      ) VALUES (?, ?, 'owner', ?)
    `);
    const insertTask = sqlite.prepare(`
      INSERT OR IGNORE INTO tasks (
        id, project_id, user_id, kind, status, model_key, input_json,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, 'image', 'succeeded', 'e2e-dashboard-rank', '{}', 1, ?, ?)
    `);
    sqlite.transaction(() => {
      for (let index = 1; index <= 12; index++) {
        const suffix = String(index).padStart(2, "0");
        const projectId = `e2e-dashboard-rank-${suffix}`;
        insertProject.run(projectId, `E2E Rank ${suffix}`, admin.id, now, now);
        insertMember.run(projectId, admin.id, now);
        insertTask.run(`task-${projectId}`, projectId, admin.id, now, now);
      }
    })();
  } finally {
    sqlite.close();
  }
}

async function fulfillGeneration(
  route: Route,
  projectId: string,
  kind: "image" | "video" | "music" | "audio"
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ task: fakeTask(projectId, kind) }),
  });
}

type CreatorKind = "image" | "video" | "music" | "tts" | "formula";

async function creatorFrameMetrics(page: Page, kind: CreatorKind) {
  const workspace = page.locator(`[data-creator-workspace="${kind}"]`);
  const composer = page.locator(`[data-creator-composer="${kind}"]`);
  await expect(workspace).toBeVisible();
  await expect(composer).toBeVisible();

  return composer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: Math.round(rect.width),
      borderRadius: style.borderRadius,
      overflowX: style.overflowX,
      pageOverflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function responsiveWorkspaceMetrics(page: Page, kind: CreatorKind) {
  const workspace = page.locator(`[data-creator-workspace="${kind}"]`);
  await expect(workspace).toBeVisible();

  return page.evaluate((creatorKind) => {
    const navigation = document.querySelector("[data-workspace-navigation]");
    const main = document.querySelector("[data-workspace-main]");
    const historyRail = document.querySelector(".creation-history-rail");
    const historyTrigger = document.querySelector(".creator-history-trigger");
    const composer = document.querySelector(
      `[data-creator-composer="${creatorKind}"]`
    );
    if (!navigation || !main || !historyRail || !historyTrigger || !composer) {
      throw new Error("Missing responsive workspace primitives");
    }

    const navigationRect = navigation.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      pageOverflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navigation: {
        width: Math.round(navigationRect.width),
        height: Math.round(navigationRect.height),
        top: Math.round(navigationRect.top),
        bottom: Math.round(navigationRect.bottom),
      },
      main: {
        width: Math.round(mainRect.width),
        height: Math.round(mainRect.height),
        left: Math.round(mainRect.left),
        top: Math.round(mainRect.top),
        bottom: Math.round(mainRect.bottom),
      },
      composerWidth: Math.round(composerRect.width),
      historyRailDisplay: getComputedStyle(historyRail).display,
      historyTriggerDisplay: getComputedStyle(historyTrigger).display,
    };
  }, kind);
}

test.describe.serial("critical local workflows", () => {
  test("local login rejects a wrong password and accepts the valid password", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");

    await page.getByLabel("邮箱").fill("e2e-admin@example.com");
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText("邮箱或密码错误", { exact: true })).toBeVisible();

    await page.getByLabel("密码").fill("e2e-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/default-/);
    await context.close();
  });

  test("creates a formal project and switches between workspaces", async ({ page }) => {
    await page.goto("/projects");
    const projectLinks = page.getByRole("link", { name: PROJECT_NAME });
    if ((await projectLinks.count()) === 0) {
      await page.getByRole("button", { name: "新建项目", exact: true }).click();

      const dialog = page.getByRole("dialog", { name: "新建项目" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("项目名", { exact: true }).fill(PROJECT_NAME);
      await dialog.getByLabel("描述（可选）", { exact: true }).fill(PROJECT_DESCRIPTION);
      await dialog.getByRole("button", { name: "创建", exact: true }).click();
    }

    const projectLink = page.getByRole("link", { name: PROJECT_NAME }).last();
    await expect(projectLink).toBeVisible();
    await projectLink.click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await expect(page.getByRole("heading", { name: PROJECT_NAME })).toBeVisible();

    await page.getByRole("button", { name: "项目", exact: true }).click();
    const switcher = page.locator("aside.project-switcher-panel");
    await expect(switcher).toBeVisible();
    await switcher.getByRole("textbox", { name: "搜索项目", exact: true }).fill("默认创作");
    await switcher.getByText("默认创作", { exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/default-/);

    await page.getByRole("button", { name: "项目", exact: true }).click();
    await switcher.getByRole("textbox", { name: "搜索项目", exact: true }).fill(PROJECT_NAME);
    await switcher.getByText(PROJECT_NAME, { exact: true }).last().click();
    await expect(page.getByRole("heading", { name: PROJECT_NAME })).toBeVisible();
  });

  test("searches, sorts, favorites, and filters project discovery", async ({ page }) => {
    await page.goto("/projects");

    const search = page.getByRole("textbox", { name: "搜索项目", exact: true });
    await search.fill(PROJECT_NAME);
    let projectCard = page.locator(`[data-project-name="${PROJECT_NAME}"]`);
    await expect(projectCard).toHaveCount(1);
    await expect(projectCard).toBeVisible();
    await expect(projectCard).toHaveAttribute("data-project-density", "compact");
    const projectCardDensity = await projectCard.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        pageOverflowX:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(projectCardDensity.height).toBeLessThanOrEqual(160);
    expect(projectCardDensity.pageOverflowX).toBeLessThanOrEqual(0);

    const favorite = projectCard.getByRole("button", {
      name: `收藏项目${PROJECT_NAME}`,
      exact: true,
    });
    await favorite.click();
    await expect(
      projectCard.getByRole("button", {
        name: `取消收藏项目${PROJECT_NAME}`,
        exact: true,
      })
    ).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    projectCard = page.locator(`[data-project-name="${PROJECT_NAME}"]`);
    await expect(
      projectCard.getByRole("button", {
        name: `取消收藏项目${PROJECT_NAME}`,
        exact: true,
      })
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("combobox", { name: "项目排序", exact: true }).click();
    await page.getByRole("option", { name: "名称排序", exact: true }).click();
    const favoritesOnly = page.getByRole("button", { name: /^收藏 \d+$/ });
    await favoritesOnly.click();
    await expect(projectCard).toBeVisible();

    await page.getByRole("button", { name: /^我创建 \d+$/ }).click();
    await expect(projectCard).toBeVisible();
    await page.getByRole("button", { name: /^我参与 \d+$/ }).click();
    await expect(page.getByText("没有匹配的项目", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(projectCard).toBeVisible();

    await projectCard.getByRole("link").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    await page.goto("/projects");
    projectCard = page.locator(`[data-project-name="${PROJECT_NAME}"]`);
    await expect(projectCard.getByText(/最近使用/)).toBeVisible();
    await expect(
      projectCard.getByRole("button", {
        name: `取消收藏项目${PROJECT_NAME}`,
        exact: true,
      })
    ).toHaveAttribute("aria-pressed", "true");

    await projectCard.getByRole("link").click();
    await page.getByRole("button", { name: "项目", exact: true }).click();
    const switcher = page.getByRole("dialog", { name: "切换项目", exact: true });
    await expect(
      switcher.getByRole("combobox", { name: "切换器项目范围", exact: true })
    ).toBeVisible();
    await expect(
      switcher.getByRole("combobox", { name: "切换器项目排序", exact: true })
    ).toBeVisible();
    await expect(
      switcher.getByRole("button", { name: "只看收藏", exact: true })
    ).toBeVisible();
    const switcherDensity = await switcher.evaluate((element) => {
      const items = Array.from(
        element.querySelectorAll<HTMLElement>("[data-project-switcher-item]")
      );
      return {
        itemCount: items.length,
        maxItemHeight: Math.max(
          0,
          ...items.map((item) => Math.round(item.getBoundingClientRect().height))
        ),
        overflowX: element.scrollWidth - element.clientWidth,
      };
    });
    expect(switcherDensity.itemCount).toBeGreaterThanOrEqual(2);
    expect(switcherDensity.maxItemHeight).toBeLessThanOrEqual(58);
    expect(switcherDensity.overflowX).toBeLessThanOrEqual(0);
    await expect(
      switcher.locator('[data-project-switcher-item][aria-current="page"]')
    ).toHaveCount(1);
  });

  test("prompts on duplicate names and manages the project lifecycle", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const lifecycleName = `E2E Lifecycle ${testInfo.retry}`;
    const collaboratorEmail = `e2e-lifecycle-${testInfo.retry}@example.com`;
    const inviteResponse = await page.request.post("/api/invites");
    expect(inviteResponse.ok()).toBeTruthy();
    const invite = (await inviteResponse.json()) as { code: string };
    const collaboratorResponse = await page.request.post("/api/register", {
      data: {
        name: `Lifecycle Member ${testInfo.retry}`,
        email: collaboratorEmail,
        password: "e2e-member-password",
        inviteCode: invite.code,
      },
    });
    expect(collaboratorResponse.ok()).toBeTruthy();

    await page.goto("/projects");
    const projectsLoading = page.getByText("正在加载项目…", { exact: true });
    if (await projectsLoading.isVisible()) {
      await expect(projectsLoading).toBeHidden();
    }
    const newProjectTrigger = page.getByRole("button", {
      name: "新建项目",
      exact: true,
    });
    const existingProjectCard = page.locator(`[data-project-name="${PROJECT_NAME}"]`);
    if ((await existingProjectCard.count()) === 0) {
      await newProjectTrigger.press("Enter");
      const seedDialog = page.getByRole("dialog", { name: "新建项目", exact: true });
      await seedDialog.getByLabel("项目名", { exact: true }).fill(PROJECT_NAME);
      await seedDialog
        .getByLabel("描述（可选）", { exact: true })
        .fill(PROJECT_DESCRIPTION);
      await seedDialog.getByRole("button", { name: "创建", exact: true }).click();
      await expect(seedDialog).toBeHidden();
      await expect(existingProjectCard).toBeVisible();
    }

    await newProjectTrigger.press("Enter");
    let createDialog = page.getByRole("dialog", { name: "新建项目", exact: true });
    await createDialog.getByLabel("项目名", { exact: true }).fill(PROJECT_NAME);
    await createDialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(createDialog.getByText(/已有同名项目/)).toBeVisible();
    await expect(
      createDialog.getByRole("button", {
        name: "仍然创建同名项目",
        exact: true,
      })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(createDialog).toBeHidden();

    await newProjectTrigger.press("Enter");
    createDialog = page.getByRole("dialog", { name: "新建项目", exact: true });
    await createDialog.getByLabel("项目名", { exact: true }).fill(lifecycleName);
    await createDialog
      .getByLabel("描述（可选）", { exact: true })
      .fill("Lifecycle regression workspace");
    await createDialog.getByRole("button", { name: "创建", exact: true }).click();

    let projectCard = page.locator(`[data-project-name="${lifecycleName}"]`);
    await expect(projectCard).toBeVisible();
    const projectHref = await projectCard.getByRole("link").getAttribute("href");
    const projectId = projectHref?.split("/").pop();
    if (!projectId) throw new Error("Lifecycle project link did not expose an id");
    const memberResponse = await page.request.post(
      `/api/projects/${projectId}/members`,
      { data: { email: collaboratorEmail } }
    );
    expect(memberResponse.ok()).toBeTruthy();
    const collaborator = (await memberResponse.json()) as {
      user: { id: string };
    };
    const collisionProjectResponse = await page.request.post("/api/projects", {
      data: {
        name: lifecycleName,
        description: "Transfer duplicate-name guard",
        allowDuplicate: true,
      },
    });
    expect(collisionProjectResponse.ok()).toBeTruthy();
    const collisionProject = (await collisionProjectResponse.json()) as { id: string };
    const collisionMemberResponse = await page.request.post(
      `/api/projects/${collisionProject.id}/members`,
      { data: { email: collaboratorEmail } }
    );
    expect(collisionMemberResponse.ok()).toBeTruthy();
    const collisionTransferResponse = await page.request.patch(
      `/api/projects/${collisionProject.id}/lifecycle`,
      {
        data: {
          action: "transfer-owner",
          userId: collaborator.user.id,
          allowDuplicate: true,
        },
      }
    );
    expect(collisionTransferResponse.ok()).toBeTruthy();
    await projectCard
      .getByRole("button", { name: `管理项目${lifecycleName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "转移所有者", exact: true }).click();
    const transferDialog = page.getByRole("dialog", {
      name: "转移项目所有权",
      exact: true,
    });
    const ownerSelect = transferDialog.getByRole("combobox", {
      name: "选择新项目所有者",
      exact: true,
    });
    await expect(ownerSelect).toBeVisible();
    await ownerSelect.click();
    await page
      .getByRole("option", {
        name: `Lifecycle Member ${testInfo.retry} · 查看者 · ${collaboratorEmail}`,
        exact: true,
      })
      .click();
    await transferDialog.getByRole("button", { name: "确认转移", exact: true }).click();
    await expect(transferDialog.getByText(/目标所有者已有同名项目/)).toBeVisible();
    await transferDialog
      .getByRole("button", { name: "仍然转移所有权", exact: true })
      .click();
    await expect(transferDialog).toBeHidden();
    projectCard = page.locator(`[data-project-card="${projectId}"]`);
    await expect(projectCard.getByText("我参与", { exact: true })).toBeVisible();

    await projectCard
      .getByRole("button", { name: `管理项目${lifecycleName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "归档项目", exact: true }).click();
    const archiveDialog = page.getByRole("dialog", { name: "归档项目", exact: true });
    await archiveDialog.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(archiveDialog).toBeHidden();
    await expect(projectCard).toHaveCount(0);
    const archivedWriteResponse = await page.request.post(
      `/api/projects/${projectId}/generate/video`,
      { data: { prompt: "This archived project must stay read-only" } }
    );
    expect(archivedWriteResponse.status()).toBe(409);
    expect((await archivedWriteResponse.json()).code).toBe("PROJECT_ARCHIVED");

    await page.getByRole("button", { name: /^已归档 \d+$/ }).click();
    projectCard = page.locator(`[data-project-card="${projectId}"]`);
    await expect(projectCard).toBeVisible();
    await expect(projectCard.getByText("已归档", { exact: true })).toBeVisible();
    await projectCard.getByRole("link").click();
    await expect(page.locator("[data-archived-notice]")).toBeVisible();
    await expect(page.getByRole("button", { name: "生成视频", exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/projects");
    await page.getByRole("button", { name: /^已归档 \d+$/ }).click();
    projectCard = page.locator(`[data-project-card="${projectId}"]`);
    await projectCard
      .getByRole("button", { name: `管理项目${lifecycleName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "恢复项目", exact: true }).click();
    const restoreDialog = page.getByRole("dialog", { name: "恢复项目", exact: true });
    await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(restoreDialog).toBeHidden();
    await expect(projectCard).toHaveCount(0);

    await page.getByRole("button", { name: /^活动项目 \d+$/ }).click();
    projectCard = page.locator(`[data-project-card="${projectId}"]`);
    await expect(projectCard).toBeVisible();
    await projectCard
      .getByRole("button", { name: `管理项目${lifecycleName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "归档项目", exact: true }).click();
    const secondArchiveDialog = page.getByRole("dialog", {
      name: "归档项目",
      exact: true,
    });
    await secondArchiveDialog
      .getByRole("button", { name: "确认归档", exact: true })
      .click();
    await expect(secondArchiveDialog).toBeHidden();

    await page.getByRole("button", { name: /^已归档 \d+$/ }).click();
    projectCard = page.locator(`[data-project-card="${projectId}"]`);
    await projectCard
      .getByRole("button", { name: `管理项目${lifecycleName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除项目", exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "删除项目", exact: true });
    const rejectedDelete = await page.request.patch(
      `/api/projects/${projectId}/lifecycle`,
      {
        data: { action: "delete", confirmationName: "incorrect project name" },
      }
    );
    expect(rejectedDelete.status()).toBe(400);
    expect((await rejectedDelete.json()).code).toBe(
      "PROJECT_DELETE_CONFIRMATION_MISMATCH"
    );
    const deleteButton = deleteDialog.getByRole("button", {
      name: "确认删除",
      exact: true,
    });
    await expect(deleteButton).toBeDisabled();
    await deleteDialog.getByLabel("输入项目名称", { exact: true }).fill(lifecycleName);
    await deleteButton.click();
    await expect(deleteDialog).toBeHidden();
    await expect(projectCard).toHaveCount(0);
    const deletedProjectResponse = await page.request.get(`/api/projects/${projectId}`);
    expect(deletedProjectResponse.status()).toBe(404);
  });

  test("enforces Owner, Editor, and Viewer project permissions", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const projectName = `E2E Roles ${testInfo.retry}`;
    const memberName = `Role Member ${testInfo.retry}`;
    const memberEmail = `e2e-roles-${testInfo.retry}@example.com`;
    const memberPassword = "e2e-role-password";

    const inviteResponse = await page.request.post("/api/invites");
    expect(inviteResponse.ok()).toBeTruthy();
    const invite = (await inviteResponse.json()) as { code: string };
    const registerResponse = await page.request.post("/api/register", {
      data: {
        name: memberName,
        email: memberEmail,
        password: memberPassword,
        inviteCode: invite.code,
      },
    });
    expect(registerResponse.ok()).toBeTruthy();

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        description: "Role permission regression workspace",
        visibility: "private",
      },
    });
    expect(projectResponse.ok()).toBeTruthy();
    const project = (await projectResponse.json()) as { id: string };
    const memberResponse = await page.request.post(
      `/api/projects/${project.id}/members`,
      { data: { email: memberEmail, role: "viewer" } }
    );
    expect(memberResponse.ok()).toBeTruthy();
    const member = (await memberResponse.json()) as {
      user: { id: string; role: "viewer" };
    };
    expect(member.user.role).toBe("viewer");

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await memberPage.goto("/login");
      await memberPage.getByLabel("邮箱").fill(memberEmail);
      await memberPage.getByLabel("密码").fill(memberPassword);
      await memberPage.getByRole("button", { name: "登录", exact: true }).click();
      await expect(memberPage).toHaveURL(/\/projects\/default-/);

      const viewerDetailResponse = await memberPage.request.get(
        `/api/projects/${project.id}`
      );
      expect(viewerDetailResponse.ok()).toBeTruthy();
      const viewerDetail = (await viewerDetailResponse.json()) as {
        canEdit: boolean;
        isMember: boolean;
        currentUserRole: string;
      };
      expect(viewerDetail).toMatchObject({
        canEdit: false,
        isMember: true,
        currentUserRole: "viewer",
      });

      await memberPage.goto(`/projects/${project.id}`);
      await expect(memberPage.locator("[data-read-only-notice]")).toContainText(
        "查看者"
      );
      await memberPage.getByRole("button", { name: "任务", exact: true }).click();
      await expect(
        memberPage.getByRole("button", { name: "成员管理", exact: true })
      ).toHaveCount(0);

      const viewerGenerateResponse = await memberPage.request.post(
        `/api/projects/${project.id}/generate/video`,
        { data: { prompt: "Viewer must not create a task" } }
      );
      expect(viewerGenerateResponse.status()).toBe(403);
      expect((await viewerGenerateResponse.json()).code).toBe("PROJECT_VIEW_ONLY");
      const viewerManageResponse = await memberPage.request.post(
        `/api/projects/${project.id}/members`,
        { data: { email: "blocked@example.com", role: "viewer" } }
      );
      expect(viewerManageResponse.status()).toBe(403);
      expect((await viewerManageResponse.json()).code).toBe(
        "PROJECT_MEMBER_MANAGEMENT_FORBIDDEN"
      );

      await page.goto(`/projects/${project.id}`);
      await page.getByRole("button", { name: "任务", exact: true }).click();
      await page.getByRole("button", { name: "成员管理", exact: true }).click();
      const membersDialog = page.getByRole("dialog", {
        name: "项目成员与角色",
        exact: true,
      });
      const roleSelect = membersDialog.getByRole("combobox", {
        name: `成员${memberName}的项目角色`,
        exact: true,
      });
      await expect(roleSelect).toContainText("查看者");
      await expect(
        membersDialog.getByRole("button", {
          name: `移除成员${memberName}`,
          exact: true,
        })
      ).toBeVisible();
      const roleUpdate = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/projects/${project.id}/members`) &&
          response.request().method() === "PATCH"
      );
      await roleSelect.click();
      await page.getByRole("option", { name: "编辑者", exact: true }).click();
      expect((await roleUpdate).ok()).toBeTruthy();
      await page.keyboard.press("Escape");
      await expect(membersDialog).toBeHidden();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "成员管理", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "项目成员与角色", exact: true })
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        )
        .toBeTruthy();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1280, height: 720 });

      const editorDetailResponse = await memberPage.request.get(
        `/api/projects/${project.id}`
      );
      expect(editorDetailResponse.ok()).toBeTruthy();
      expect(await editorDetailResponse.json()).toMatchObject({
        canEdit: true,
        currentUserRole: "editor",
      });
      const editorManageResponse = await memberPage.request.patch(
        `/api/projects/${project.id}/members`,
        { data: { userId: member.user.id, role: "viewer" } }
      );
      expect(editorManageResponse.status()).toBe(403);
      expect((await editorManageResponse.json()).code).toBe(
        "PROJECT_MEMBER_MANAGEMENT_FORBIDDEN"
      );

      const meResponse = await page.request.get("/api/me");
      expect(meResponse.ok()).toBeTruthy();
      const admin = (await meResponse.json()) as { id: string };
      const adminTaskId = `e2e-role-admin-${testInfo.retry}`;
      const editorTaskId = `e2e-role-editor-${testInfo.retry}`;
      insertTerminalTasks(project.id, [
        { id: adminTaskId, userId: admin.id },
        { id: editorTaskId, userId: member.user.id },
      ]);

      const forbiddenDelete = await memberPage.request.delete(
        `/api/projects/${project.id}/tasks`,
        { data: { ids: [adminTaskId] } }
      );
      expect(forbiddenDelete.status()).toBe(403);
      expect((await forbiddenDelete.json()).code).toBe(
        "PROJECT_TASK_MANAGEMENT_FORBIDDEN"
      );
      const ownDelete = await memberPage.request.delete(
        `/api/projects/${project.id}/tasks`,
        { data: { ids: [editorTaskId] } }
      );
      expect(ownDelete.ok()).toBeTruthy();
      expect(await ownDelete.json()).toMatchObject({ deleted: 1 });
      const ownerDelete = await page.request.delete(
        `/api/projects/${project.id}/tasks`,
        { data: { ids: [adminTaskId] } }
      );
      expect(ownerDelete.ok()).toBeTruthy();
      expect(await ownerDelete.json()).toMatchObject({ deleted: 1 });

      await memberPage.reload();
      await memberPage.getByRole("button", { name: "任务", exact: true }).click();
      await expect(memberPage.locator("[data-project-role-badge]")).toHaveText(
        "编辑者"
      );
      await expect(
        memberPage.getByRole("button", { name: "成员管理", exact: true })
      ).toHaveCount(0);

      const removeResponse = await page.request.delete(
        `/api/projects/${project.id}/members`,
        { data: { userId: member.user.id } }
      );
      expect(removeResponse.ok()).toBeTruthy();
      const removedAccess = await memberPage.request.get(
        `/api/projects/${project.id}`
      );
      expect(removedAccess.status()).toBe(403);
    } finally {
      await memberContext.close();
    }
  });

  test("surfaces empty workspace shortcuts and restores failed inputs", async ({ page }) => {
    const retriedTaskIds: string[] = [];
    const failedInputs: Record<
      string,
      { taskKind: "image" | "video" | "music" | "audio"; modelKey: string; input: Record<string, unknown> }
    > = {
      image: {
        taskKind: "image",
        modelKey: "seedream-5.0",
        input: {
          prompt: "E2E recovered image prompt",
          modelKey: "seedream-5.0",
          ratio: "16:9",
          size: "2816x1584",
          refAssetIds: [],
        },
      },
      video: {
        taskKind: "video",
        modelKey: "seedance-2.0",
        input: {
          prompt: "E2E recovered video prompt",
          modelKey: "seedance-2.0",
          resolution: "720p",
          duration: 5,
          ratio: "adaptive",
          refAssetIds: [],
        },
      },
      music: {
        taskKind: "music",
        modelKey: "coze-music",
        input: {
          mode: "bgm",
          text: "E2E recovered music prompt",
          duration: 60,
        },
      },
      audio: {
        taskKind: "audio",
        modelKey: "coze-tts",
        input: {
          provider: "coze",
          text: "E2E recovered voice prompt",
        },
      },
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/tasks/*/retry", async (route) => {
      const taskId = new URL(route.request().url()).pathname.split("/")[3];
      retriedTaskIds.push(taskId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId }),
      });
    });
    await page.route("**/api/projects/*/tasks?*", async (route) => {
      const url = new URL(route.request().url());
      const kind = url.searchParams.get("kind") ?? "";
      const failed = failedInputs[kind];
      if (!failed) {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      const projectId = url.pathname.split("/")[3] ?? "e2e-project";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            ...fakeTask(projectId, failed.taskKind),
            id: `e2e-failed-${kind}`,
            status: "failed",
            modelKey: failed.modelKey,
            inputJson: JSON.stringify(failed.input),
            error: "网络短暂波动，请恢复配置后重试。",
          },
        ]),
      });
    });

    await openFormalProject(page);
    const creatorWidths: number[] = [];

    await page.getByRole("button", { name: "图像", exact: true }).click();
    const imageFrame = await creatorFrameMetrics(page, "image");
    creatorWidths.push(imageFrame.width);
    expect(imageFrame.borderRadius).toBe("8px");
    await expect(page.getByRole("button", { name: "上传参考图", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择创作模板", exact: true })).toBeVisible();
    await expect(page.getByText("上传或从项目素材中选择", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复最近失败", exact: true }).click();
    await expect(page.getByRole("textbox")).toContainText("E2E recovered image prompt");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => retriedTaskIds).toContain("e2e-failed-image");

    await page.getByRole("button", { name: "视频", exact: true }).click();
    const videoFrame = await creatorFrameMetrics(page, "video");
    creatorWidths.push(videoFrame.width);
    expect(videoFrame.borderRadius).toBe("8px");
    await expect(page.getByRole("button", { name: "上传参考素材", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "首尾帧模板", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复最近失败", exact: true }).click();
    await expect(
      page.getByPlaceholder(
        "例如：低机位跟拍赛车驶入雨夜维修区，霓虹倒影划过车身，镜头缓慢推近……"
      )
    ).toHaveValue("E2E recovered video prompt");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => retriedTaskIds).toContain("e2e-failed-video");

    await page.getByRole("button", { name: "音乐", exact: true }).click();
    const musicFrame = await creatorFrameMetrics(page, "music");
    creatorWidths.push(musicFrame.width);
    expect(musicFrame.borderRadius).toBe("8px");
    await expect(page.getByRole("button", { name: "背景音乐模板", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "歌词成曲", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复最近失败", exact: true }).click();
    await expect(page.getByRole("textbox")).toHaveValue("E2E recovered music prompt");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => retriedTaskIds).toContain("e2e-failed-music");

    await page.getByRole("button", { name: "配音", exact: true }).click();
    const ttsFrame = await creatorFrameMetrics(page, "tts");
    creatorWidths.push(ttsFrame.width);
    expect(ttsFrame.borderRadius).toBe("8px");
    await expect(page.getByRole("button", { name: "上传参考音频", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择音色模板", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "恢复最近失败", exact: true }).click();
    await expect(page.getByRole("textbox")).toHaveValue("E2E recovered voice prompt");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => retriedTaskIds).toContain("e2e-failed-audio");
    expect(new Set(creatorWidths).size).toBe(1);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("button", { name: "恢复最近失败", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "恢复最近失败", exact: true })).toBeVisible();
    const mobileTtsFrame = await creatorFrameMetrics(page, "tts");
    expect(mobileTtsFrame.overflowX).toBe("hidden");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
  });

  test("plays and reuses the latest TTS result inside the main creator", async ({
    page,
  }) => {
    const projectId = await openFormalProject(page);
    const assetId = "e2e-inline-tts-asset";
    const taskId = "e2e-inline-tts-task";
    const createdAt = Date.now();
    const spokenText = "端到端主创作器配音结果";
    const audio = silentWav(2);

    await page.route(
      new RegExp(`/api/projects/${projectId}/tasks\\?.*kind=audio`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              ...fakeTask(projectId, "audio"),
              id: taskId,
              status: "succeeded",
              modelKey: "coze-tts",
              inputJson: JSON.stringify({
                provider: "coze",
                text: spokenText,
                voiceId: "7468512265151709211",
                speedRatio: 1,
              }),
              outputAssetId: assetId,
              createdAt,
              updatedAt: createdAt,
              outputAsset: {
                id: assetId,
                projectId,
                userId: "e2e-user",
                kind: "audio",
                objectKey: `media/${assetId}.wav`,
                mime: "audio/wav",
                bytes: audio.length,
                textContent: null,
                metaJson: JSON.stringify({
                  modelKey: "coze-tts",
                  prompt: spokenText,
                }),
                sourceTaskId: taskId,
                reviewStatus: null,
                favorite: false,
                createdAt,
              },
            },
          ]),
        });
      }
    );
    await page.route(`**/api/assets/${assetId}/raw*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: audio,
      });
    });

    await page.getByRole("button", { name: "配音", exact: true }).click();
    const player = page.getByRole("region", {
      name: "最新配音",
      exact: true,
    });
    await expect(player).toBeVisible();
    await expect(player).toContainText(spokenText);

    const audioControl = player.locator("audio");
    await expect(audioControl).toHaveCount(1);
    await expect(audioControl).toHaveAttribute("controls", "");
    await expect(audioControl).toHaveAttribute("preload", "metadata");
    await expect(
      player.getByRole("link", { name: "下载最新配音", exact: true })
    ).toHaveAttribute("href", `/api/assets/${assetId}/raw?download=1`);

    const desktopMetrics = await player.evaluate((element) => ({
      height: Math.round(element.getBoundingClientRect().height),
      overflowX: element.scrollWidth - element.clientWidth,
      pageOverflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(desktopMetrics.height).toBeLessThanOrEqual(120);
    expect(desktopMetrics.overflowX).toBeLessThanOrEqual(0);
    expect(desktopMetrics.pageOverflowX).toBeLessThanOrEqual(0);

    await player
      .getByRole("button", { name: "复用最新配音参数", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "配音文本" })).toHaveValue(
      spokenText
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(player).toBeVisible();
    const mobileMetrics = await player.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const audioElement = element.querySelector("audio");
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        audioWidth: Math.round(audioElement?.getBoundingClientRect().width ?? 0),
        overflowX: element.scrollWidth - element.clientWidth,
        pageOverflowX:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(mobileMetrics.width).toBeGreaterThan(330);
    expect(mobileMetrics.height).toBeLessThanOrEqual(170);
    expect(mobileMetrics.audioWidth).toBeLessThanOrEqual(mobileMetrics.width);
    expect(mobileMetrics.overflowX).toBeLessThanOrEqual(0);
    expect(mobileMetrics.pageOverflowX).toBeLessThanOrEqual(0);
  });

  test("pauses the previous audio when another player starts", async ({ page }) => {
    await openFormalProject(page);
    const wavBase64 = silentWav(3).toString("base64");
    const playback = await page.evaluate(async (base64) => {
      const src = `data:audio/wav;base64,${base64}`;
      const first = document.createElement("audio");
      const second = document.createElement("audio");
      first.src = src;
      second.src = src;
      first.muted = true;
      second.muted = true;
      document.body.append(first, second);
      try {
        await first.play();
        await second.play();
        return { firstPaused: first.paused, secondPaused: second.paused };
      } finally {
        first.pause();
        second.pause();
        first.remove();
        second.remove();
      }
    }, wavBase64);
    expect(playback.firstPaused).toBe(true);
    expect(playback.secondPaused).toBe(false);
  });

  test("transcribes, proofreads, and reuses cached voice clone reference text", async ({
    page,
  }) => {
    const projectId = await openFormalProject(page);
    const assetId = "e2e-reference-transcript-audio";
    const audio = silentWav(3);
    const createdAt = Date.now();
    const recognizedText = "海豚创作工作台自动识别参考原文";
    const correctedText = "海豚创作工作台，自动识别并校对参考原文。";
    let transcript: Record<string, unknown> | null = null;
    let pollCount = 0;
    let savedText = "";
    let healthChecks = 0;

    await page.route("**/api/integrations/qwen-tts/health", async (route) => {
      healthChecks++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          defaultInstance: "public",
          checkedAt: new Date().toISOString(),
          instances: [
            {
              key: "public",
              label: "公共创空间",
              experimental: true,
              configured: true,
              status: "healthy",
              message: "配置与生成接口均可访问。",
              latencyMs: 128,
              capacity: {
                queued: 2,
                running: 1,
                limit: 1,
                utilization: 1,
                hint: "公共 GPU 当前有 3 个本站任务排队或执行；0.6B 通常等待更短，繁忙时可切换自建实例。",
              },
            },
            {
              key: "self-hosted",
              label: "自建实例",
              experimental: false,
              configured: true,
              status: "healthy",
              message: "配置与生成接口均可访问。",
              latencyMs: 35,
              capacity: {
                queued: 0,
                running: 0,
                limit: 1,
                utilization: 0,
                hint: "自建实例由管理员维护；本站按实例串行调用，实际容量取决于 GPU 与模型规格。",
              },
            },
          ],
        }),
      });
    });

    await page.route(
      new RegExp(`/api/projects/${projectId}/assets\\?kind=audio`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: assetId,
              projectId,
              userId: "e2e-user",
              kind: "audio",
              objectKey: `${assetId}.wav`,
              mime: "audio/wav",
              bytes: audio.length,
              textContent: null,
              metaJson: JSON.stringify({ filename: "E2E 参考声音.wav" }),
              sourceTaskId: null,
              reviewStatus: null,
              favorite: false,
              createdAt,
            },
          ]),
        });
      }
    );
    await page.route(`**/api/assets/${assetId}/raw*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: audio,
      });
    });
    await page.route(`**/api/assets/${assetId}/transcript`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        transcript = {
          assetId,
          taskId: "e2e-transcription-task",
          status: "queued",
          sourceText: null,
          text: null,
          error: null,
          errorCode: null,
          updatedAt: Date.now(),
        };
        pollCount = 0;
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ transcript, cached: false }),
        });
        return;
      }
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { text: string };
        savedText = body.text;
        transcript = {
          assetId,
          taskId: "e2e-transcription-task",
          status: "succeeded",
          sourceText: recognizedText,
          text: body.text,
          error: null,
          errorCode: null,
          updatedAt: Date.now(),
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ transcript }),
        });
        return;
      }
      if (transcript?.status === "queued" || transcript?.status === "running") {
        pollCount++;
        transcript =
          pollCount < 2
            ? { ...transcript, status: "running" }
            : {
                assetId,
                taskId: "e2e-transcription-task",
                status: "succeeded",
                sourceText: recognizedText,
                text: recognizedText,
                error: null,
                errorCode: null,
                updatedAt: Date.now(),
              };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ transcript }),
      });
    });

    async function selectReferenceAudioAndOpenProofreader() {
      await page.getByRole("button", { name: "配音", exact: true }).click();
      await page
        .getByRole("combobox", { name: "配音合成引擎", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Qwen3-TTS 声音克隆", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "声音克隆参考音频", exact: true })
        .click();
      await page
        .getByRole("option", { name: "E2E 参考声音.wav", exact: true })
        .click();
      await page.getByRole("button", { name: "转写与校对", exact: true }).click();
      return page.getByRole("dialog", {
        name: "配音与声音克隆设置",
        exact: true,
      });
    }

    let dialog = await selectReferenceAudioAndOpenProofreader();
    await expect(dialog).toBeVisible();
    const serviceStatus = dialog.getByRole("region", {
      name: "声音克隆服务状态",
      exact: true,
    });
    await expect(serviceStatus).toContainText("实验性公共创空间");
    await expect(serviceStatus).toContainText("公共 GPU 当前有 3 个本站任务");
    await serviceStatus
      .getByRole("combobox", { name: "声音克隆服务实例", exact: true })
      .click();
    await page
      .getByRole("option", { name: "自建实例", exact: true })
      .click();
    await expect(serviceStatus).toContainText("自建实例由管理员维护");
    await serviceStatus
      .getByRole("button", { name: "重新检查声音克隆服务", exact: true })
      .click();
    await expect.poll(() => healthChecks).toBeGreaterThan(1);
    await expect(dialog.locator("audio")).toHaveAttribute("controls", "");
    await dialog.getByRole("button", { name: "语音转文字", exact: true }).click();
    await expect(
      dialog.getByText("正在后台识别语音，完成后会自动回填原文。", {
        exact: true,
      })
    ).toBeVisible();

    const transcriptInput = dialog.getByRole("textbox", {
      name: "参考音频原文",
      exact: true,
    });
    await expect(transcriptInput).toHaveValue(recognizedText, {
      timeout: 10_000,
    });
    await transcriptInput.fill(correctedText);
    await dialog.getByRole("button", { name: "保存校对", exact: true }).click();
    await expect(
      dialog.getByText("校对文本已缓存，重新选择该音频时会自动回填。", {
        exact: true,
      })
    ).toBeVisible();
    expect(savedText).toBe(correctedText);

    await dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "转写与校对", exact: true }).click();
    dialog = page.getByRole("dialog", {
      name: "配音与声音克隆设置",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const mobile = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        pageOverflowX:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(mobile.left).toBeGreaterThanOrEqual(0);
    expect(mobile.right).toBeLessThanOrEqual(390);
    expect(mobile.width).toBeLessThanOrEqual(390);
    expect(mobile.pageOverflowX).toBeLessThanOrEqual(0);

    await page.reload();
    dialog = await selectReferenceAudioAndOpenProofreader();
    await expect(
      dialog.getByRole("textbox", {
        name: "参考音频原文",
        exact: true,
      })
    ).toHaveValue(correctedText);
  });

  test("degrades creator history and navigation across smaller screens", async ({ page }) => {
    await openFormalProject(page);
    await page.getByRole("button", { name: "视频", exact: true }).click();

    await page.setViewportSize({ width: 1280, height: 900 });
    const wide = await responsiveWorkspaceMetrics(page, "video");
    expect(wide.historyRailDisplay).toBe("flex");
    expect(wide.historyTriggerDisplay).toBe("none");
    expect(wide.composerWidth).toBeGreaterThan(900);
    expect(wide.pageOverflowX).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 1024, height: 720 });
    const smallDesktop = await responsiveWorkspaceMetrics(page, "video");
    expect(smallDesktop.historyRailDisplay).toBe("none");
    expect(smallDesktop.historyTriggerDisplay).toBe("flex");
    expect(smallDesktop.main.width).toBeGreaterThan(900);
    expect(smallDesktop.composerWidth).toBeGreaterThan(850);
    expect(smallDesktop.pageOverflowX).toBeLessThanOrEqual(0);

    const historyTrigger = page.getByRole("button", {
      name: "打开视频创作历史记录",
      exact: true,
    });
    await historyTrigger.click();
    const historyDialog = page.getByRole("dialog", {
      name: "视频创作历史记录",
      exact: true,
    });
    await expect(historyDialog).toBeVisible();
    await historyDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(historyDialog).toBeHidden();
    await expect(historyTrigger).toBeFocused();

    await page.setViewportSize({ width: 768, height: 1024 });
    const tablet = await responsiveWorkspaceMetrics(page, "video");
    expect(tablet.navigation.width).toBe(68);
    expect(tablet.main.width).toBe(700);
    expect(tablet.composerWidth).toBeGreaterThan(640);
    expect(tablet.historyRailDisplay).toBe("none");
    expect(tablet.pageOverflowX).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await responsiveWorkspaceMetrics(page, "video");
    expect(mobile.main.left).toBe(0);
    expect(mobile.main.width).toBe(390);
    expect(mobile.navigation.width).toBe(390);
    expect(mobile.navigation.top).toBe(mobile.main.bottom);
    expect(mobile.navigation.bottom).toBe(844);
    expect(mobile.composerWidth).toBeGreaterThan(340);
    expect(mobile.historyRailDisplay).toBe("none");
    expect(mobile.historyTriggerDisplay).toBe("flex");
    expect(mobile.pageOverflowX).toBeLessThanOrEqual(0);

    await historyTrigger.click();
    await expect(historyDialog).toBeVisible();
    await expect
      .poll(async () => {
        const box = await historyDialog.boundingBox();
        return Math.round(box?.width ?? 0);
      })
      .toBeGreaterThan(340);
    const mobileHistory = await historyDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      };
    });
    expect(mobileHistory.width).toBeGreaterThan(340);
    expect(mobileHistory.right).toBeLessThanOrEqual(374);
    expect(mobileHistory.bottom).toBeLessThanOrEqual(828);
    await historyDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(historyDialog).toBeHidden();

    await page.getByRole("button", { name: "项目", exact: true }).click();
    const projectPanel = page.locator("aside.project-switcher-panel");
    await expect(projectPanel).toBeVisible();
    const projectPanelMetrics = await projectPanel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        overflowX: element.scrollWidth - element.clientWidth,
        maxItemHeight: Math.max(
          0,
          ...Array.from(
            element.querySelectorAll<HTMLElement>("[data-project-switcher-item]")
          ).map((item) => Math.round(item.getBoundingClientRect().height))
        ),
      };
    });
    expect(projectPanelMetrics.width).toBeLessThanOrEqual(360);
    expect(projectPanelMetrics.right).toBeLessThanOrEqual(390);
    expect(projectPanelMetrics.bottom).toBeLessThanOrEqual(mobile.main.bottom);
    expect(projectPanelMetrics.overflowX).toBeLessThanOrEqual(0);
    expect(projectPanelMetrics.maxItemHeight).toBeLessThanOrEqual(58);
    await projectPanel.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(projectPanel).toBeHidden();
  });

  test("exposes accessible names for creator and library controls", async ({ page }) => {
    await openFormalProject(page);

    const creatorControls = [
      {
        creator: "图像",
        textbox: "图像提示词",
        comboboxes: ["图像模型", "图像创作类型", "图像分辨率", "图像画幅比例"],
      },
      {
        creator: "视频",
        textbox: "视频提示词",
        comboboxes: ["视频模型", "视频创作模式", "视频分辨率", "视频画幅比例", "视频时长"],
      },
      {
        creator: "音乐",
        textbox: "音乐提示词",
        comboboxes: ["音乐创作模式", "音乐时长", "音乐曲风"],
      },
      {
        creator: "配音",
        textbox: "配音文本",
        comboboxes: ["配音合成引擎", "配音音色", "配音语速"],
      },
    ] as const;

    for (const controlSet of creatorControls) {
      await page.getByRole("button", { name: controlSet.creator, exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: controlSet.textbox, exact: true })
      ).toBeVisible();
      for (const name of controlSet.comboboxes) {
        await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
      }
    }

    await page.getByRole("button", { name: "资产", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "搜索素材", exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "按创建人筛选素材", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "按素材类型筛选", exact: true })
    ).toBeVisible();
  });

  test("shows non-color markers for selected choices and toggle states", async ({ page }) => {
    await page.goto("/dashboard");

    const range30 = page.getByRole("button", { name: "近 30 天", exact: true });
    const range7 = page.getByRole("button", { name: "近 7 天", exact: true });
    await expect(range30).toHaveAttribute("aria-pressed", "true");
    const range30Indicator = range30.locator("[data-selection-indicator]");
    await expect(range30Indicator).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(range30Indicator).toBeVisible();
    await range7.click();
    await expect(range7).toHaveAttribute("aria-pressed", "true");
    const range7Indicator = range7.locator("[data-selection-indicator]");
    await expect(range7Indicator).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(range7Indicator).toBeVisible();
    await expect(range30).toHaveAttribute("aria-pressed", "false");
    await expect(range30Indicator).toBeHidden();

    const projectRanking = page.getByRole("button", { name: "按项目", exact: true });
    await expect(projectRanking).toHaveAttribute("aria-pressed", "true");
    await expect(
      projectRanking.locator("[data-selection-indicator]")
    ).toHaveAttribute("data-selected", "true");

    await page.goto("/projects");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const projectDialog = page.getByRole("dialog", { name: "新建项目", exact: true });
    const privateChoice = projectDialog.getByRole("button", { name: /^私有/ });
    const publicChoice = projectDialog.getByRole("button", { name: /^全公司公开/ });
    await expect(privateChoice).toHaveAttribute("aria-pressed", "true");
    const privateIndicator = privateChoice.locator("[data-selection-indicator]");
    await expect(privateIndicator).toHaveAttribute("data-selected", "true");
    await expect(privateIndicator).toBeVisible();
    await publicChoice.click();
    await expect(publicChoice).toHaveAttribute("aria-pressed", "true");
    const publicIndicator = publicChoice.locator("[data-selection-indicator]");
    await expect(publicIndicator).toHaveAttribute("data-selected", "true");
    await expect(publicIndicator).toBeVisible();
    await expect(privateIndicator).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(projectDialog).toBeHidden();

    await openFormalProject(page);
    const settingsTrigger = page.getByRole("button", { name: "更多设置", exact: true });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole("dialog", {
      name: "视频生成设置",
      exact: true,
    });
    const audioOn = settingsDialog.getByRole("button", {
      name: "同步音频 ON",
      exact: true,
    });
    await expect(audioOn).toHaveAttribute("aria-pressed", "true");
    await audioOn.click();
    const audioOff = settingsDialog.getByRole("button", {
      name: "同步音频 OFF",
      exact: true,
    });
    await expect(audioOff).toHaveAttribute("aria-pressed", "false");
  });

  test("supports keyboard focus flows and announces async state", async ({ page }) => {
    const projectId = await openFormalProject(page);

    const projectTrigger = page.getByRole("button", { name: "项目", exact: true });
    await projectTrigger.focus();
    await page.keyboard.press("Enter");

    const projectDialog = page.getByRole("dialog", { name: "切换项目", exact: true });
    await expect(projectDialog).toBeVisible();
    const projectSearch = projectDialog.getByRole("textbox", {
      name: "搜索项目",
      exact: true,
    });
    await expect(projectSearch).toBeFocused();

    const projectClose = projectDialog.getByRole("button", { name: "关闭", exact: true });
    await page.keyboard.press("Shift+Tab");
    await expect(projectClose).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(
      await projectDialog.evaluate((element) => element.contains(document.activeElement))
    ).toBeTruthy();

    await page.keyboard.press("Escape");
    await expect(projectDialog).toBeHidden();
    await expect(projectTrigger).toBeFocused();

    const settingsTrigger = page.getByRole("button", { name: "更多设置", exact: true });
    await settingsTrigger.focus();
    await page.keyboard.press("Enter");

    const settingsDialog = page.getByRole("dialog", {
      name: "视频生成设置",
      exact: true,
    });
    await expect(settingsDialog).toBeVisible();
    const settingsClose = settingsDialog.getByRole("button", {
      name: "关闭设置",
      exact: true,
    });
    await expect(settingsClose).toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await settingsDialog.evaluate((element) => element.contains(document.activeElement))
    ).toBeTruthy();
    await page.keyboard.press("Escape");
    await expect(settingsDialog).toBeHidden();
    await expect(settingsTrigger).toBeFocused();

    await page.getByRole("button", { name: "资产", exact: true }).click();
    const uploadZone = page.getByRole("button", { name: "上传素材", exact: true });
    await uploadZone.focus();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Space");
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([]);

    await page.route(`**/api/projects/${projectId}/generate/video`, async (route) => {
      await fulfillGeneration(route, projectId, "video");
    });
    await page.getByRole("button", { name: "视频", exact: true }).click();
    await page.getByRole("textbox", { name: "视频提示词", exact: true }).fill(
      "E2E keyboard announcement prompt"
    );
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    const submittedStatus = page.getByRole("status").filter({ hasText: "任务已提交" });
    await expect(submittedStatus).toBeVisible();
    await expect(submittedStatus).toHaveAttribute("aria-live", "polite");
    await expect(submittedStatus).toHaveAttribute("aria-atomic", "true");
  });

  test("uploads, previews, and tombstones a deleted asset", async ({ page }) => {
    await openFormalProject(page);
    await page.getByRole("button", { name: "资产", exact: true }).click();

    const input = page.locator('input[type="file"]');
    await expect(input).toHaveCount(1);
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/upload")
    );
    await input.setInputFiles(FIXTURE_PATH);
    const uploadResponse = await uploaded;
    expect(uploadResponse.status()).toBe(200);

    const filename = page.getByText("06-image.png", { exact: true });
    await expect(filename).toBeVisible();
    await filename.click();
    const detail = page.getByRole("dialog", { name: "素材详情" });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("用户上传：06-image.png");

    const databasePath = path.join(
      process.cwd(),
      ".e2e",
      "data",
      "haitun-post-studio.db"
    );
    const assetDatabase = new Database(databasePath, { readonly: true });
    let uploadedAsset: { id: string; objectKey: string };
    try {
      const row = assetDatabase
        .prepare(`
          SELECT id, object_key objectKey
          FROM assets
          WHERE json_extract(meta_json, '$.filename') = '06-image.png'
          ORDER BY created_at DESC
          LIMIT 1
        `)
        .get() as { id: string; objectKey: string } | undefined;
      if (!row) throw new Error("Uploaded E2E asset not found");
      uploadedAsset = row;
    } finally {
      assetDatabase.close();
    }

    const deleted = await page.request.delete(`/api/assets/${uploadedAsset.id}`);
    expect(deleted.ok()).toBeTruthy();
    const sqlite = new Database(databasePath);
    try {
      const tombstone = sqlite
        .prepare(`
          SELECT asset_id, asset_json, deleted_at, purge_after, remote_purged_at
          FROM backup_media_tombstones
          WHERE object_key = ?
        `)
        .get(uploadedAsset.objectKey) as
        | {
            asset_id: string;
            asset_json: string;
            deleted_at: number;
            purge_after: number;
            remote_purged_at: number | null;
          }
        | undefined;
      expect(tombstone?.asset_id).toBe(uploadedAsset.id);
      expect(JSON.parse(tombstone?.asset_json ?? "{}").id).toBe(
        uploadedAsset.id
      );
      expect((tombstone?.purge_after ?? 0) - (tombstone?.deleted_at ?? 0)).toBe(
        30 * 24 * 60 * 60 * 1000
      );
      expect(tombstone?.remote_purged_at).toBeNull();
    } finally {
      sqlite.close();
    }
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          ".e2e",
          "data",
          "media",
          uploadedAsset.objectKey
        )
      )
    ).toBe(false);
  });

  test("edits audio selection with keyboard-accessible inputs", async ({ page }) => {
    await openFormalProject(page);
    await page.getByRole("button", { name: "资产", exact: true }).click();

    const input = page.locator('input[type="file"]');
    await expect(input).toHaveCount(1);
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/upload")
    );
    await input.setInputFiles({
      name: "e2e-keyboard-audio.wav",
      mimeType: "audio/wav",
      buffer: silentWav(),
    });
    expect((await uploaded).status()).toBe(200);

    const filename = page.getByText("e2e-keyboard-audio.wav", { exact: true });
    await expect(filename).toBeVisible();
    await filename.click();

    const detail = page.getByRole("dialog", { name: "素材详情", exact: true });
    const selectionStart = detail.getByLabel("入点（秒）", { exact: true });
    const selectionEnd = detail.getByLabel("出点（秒）", { exact: true });
    await expect(selectionStart).toBeVisible();
    await expect(selectionEnd).toBeVisible();
    await selectionStart.fill("0.5");
    await selectionEnd.fill("2.5");

    const selectionStatus = detail.getByRole("status").filter({ hasText: "0:00.5" });
    await expect(selectionStatus).toContainText("0:02.5");
    await expect(selectionStatus).toHaveAttribute("aria-atomic", "true");
  });

  test("keeps audio transcode guidance after adding another reference", async ({ page }) => {
    await openFormalProject(page);
    await page.getByRole("button", { name: "视频", exact: true }).click();
    await page.getByRole("combobox", { name: "视频创作模式", exact: true }).click();
    await page.getByRole("option", { name: "全能参考", exact: true }).click();

    await page.getByRole("button", { name: "添加素材", exact: true }).click();
    let picker = page.getByRole("dialog", { name: "选择参考素材" });
    await picker.locator('input[type="file"]').setInputFiles({
      name: "e2e-reference.wav",
      mimeType: "audio/wav",
      buffer: silentWav(),
    });
    await expect(page.getByText(/单声道 44\.1kHz、128kbps MP3/)).toBeVisible();
    await expect(page.getByText(/音频不能单独作为参考/)).toBeVisible();

    await page.getByRole("button", { name: "添加素材", exact: true }).click();
    picker = page.getByRole("dialog", { name: "选择参考素材" });
    await picker.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/单声道 44\.1kHz、128kbps MP3/)).toBeVisible();
    await expect(page.getByText(/音频不能单独作为参考/)).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
    await page.setViewportSize({ width: 768, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
  });

  test("renders generated history with an asset-backed result", async ({ page }) => {
    const projectId = await openFormalProject(page);
    const assetsResponse = await page.request.get(
      `/api/projects/${projectId}/assets?kind=image&limit=50`
    );
    expect(assetsResponse.ok()).toBeTruthy();
    const assets = (await assetsResponse.json()) as {
      items: Array<Record<string, unknown>>;
    };
    const outputAsset = assets.items[0];
    expect(outputAsset).toBeTruthy();

    const now = Date.now();
    await page.route(
      new RegExp(`/api/projects/${projectId}/tasks\\?.*kind=image`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              ...fakeTask(projectId, "image"),
              id: "e2e-history-image",
              status: "succeeded",
              modelKey: "seedream-5.0",
              inputJson: JSON.stringify({
                prompt: "E2E history prompt",
                modelKey: "seedream-5.0",
                ratio: "16:9",
                size: "2816x1584",
                refAssetIds: [],
                webSearch: true,
              }),
              usageJson: JSON.stringify({
                images: 1,
                outputTokens: 17_424,
                totalTokens: 17_424,
                webSearchCalls: 2,
                tools: ["web_search"],
                source: "actual",
              }),
              attemptCount: 1,
              startedAt: now - 1500,
              completedAt: now,
              outputAssetId: outputAsset.id,
              outputAsset,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        });
      }
    );

    await page.getByRole("button", { name: "图像", exact: true }).click();
    await expect(page.getByText("E2E history prompt", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "复用", exact: true })).toBeVisible();

    const detailTrigger = page.getByRole("button", { name: "详情", exact: true });
    await detailTrigger.click();
    const detail = page.getByRole("dialog", { name: "任务详情", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Seedream 5.0 Lite · 火山方舟");
    await expect(detail).toContainText("¥0.22");
    await expect(detail).toContainText("2 次 · 公开标价 ¥0.0080");
    await expect(detail).toContainText("每月前 2 万次免费额度");
    await expect(detail).toContainText("2816x1584");
    await expect(detail).toContainText("供应商未返回");
    await expect(detail).toContainText("e2e-history-image");
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(detailTrigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "打开图片创作历史记录", exact: true }).click();
    const mobileHistory = page.getByRole("dialog", { name: "图片创作历史记录", exact: true });
    const mobileDetailTrigger = mobileHistory.getByRole("button", { name: "详情", exact: true });
    await mobileDetailTrigger.click();
    await expect(detail).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBeTruthy();
    const detailBox = await detail.boundingBox();
    expect(detailBox?.width).toBeLessThanOrEqual(390.5);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(mobileDetailTrigger).toBeFocused();
  });

  test("tracks downloads, reuse, and regeneration as real result usage", async ({
    page,
  }) => {
    const projectId = await openFormalProject(page);
    const upload = await page.request.post(
      `/api/projects/${projectId}/upload`,
      {
        data: fs.readFileSync(FIXTURE_PATH),
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": encodeURIComponent("e2e-product-metrics.png"),
        },
      }
    );
    expect(upload.ok()).toBeTruthy();
    const asset = (await upload.json()) as { id: string; userId: string };
    const taskId = `e2e-product-metrics-${Date.now()}`;
    const prompt = "E2E product metrics result";
    const databasePath = path.join(
      process.cwd(),
      ".e2e",
      "data",
      "haitun-post-studio.db"
    );
    const sqlite = new Database(databasePath);
    sqlite.pragma("busy_timeout = 5000");
    try {
      const now = Date.now();
      sqlite.transaction(() => {
        sqlite
          .prepare("UPDATE assets SET source_task_id = ? WHERE id = ?")
          .run(taskId, asset.id);
        sqlite
          .prepare(`
            INSERT INTO tasks (
              id, project_id, user_id, kind, status, model_key, input_json,
              output_asset_id, attempt_count, started_at, completed_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, 'image', 'succeeded', 'seedream-5.0', ?, ?, 1, ?, ?, ?, ?)
          `)
          .run(
            taskId,
            projectId,
            asset.userId,
            JSON.stringify({
              prompt,
              modelKey: "seedream-5.0",
              ratio: "16:9",
              size: "2816x1584",
              refAssetIds: [],
            }),
            asset.id,
            now - 1_000,
            now,
            now - 1_500,
            now
          );
      })();
    } finally {
      sqlite.close();
    }

    await page.reload();
    await page.getByRole("button", { name: "图像", exact: true }).click();
    const historyItem = page.locator("article").filter({ hasText: prompt }).first();
    await expect(historyItem).toBeVisible();

    const reuseRecorded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/tasks/${taskId}/events`)
    );
    await historyItem.getByRole("button", { name: "复用", exact: true }).click();
    expect((await reuseRecorded).ok()).toBeTruthy();

    await page.route(`**/api/projects/${projectId}/generate/image`, async (route) => {
      await fulfillGeneration(route, projectId, "image");
    });
    const regenerateRecorded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/tasks/${taskId}/events`)
    );
    await historyItem
      .getByRole("button", { name: "再生成", exact: true })
      .click();
    expect((await regenerateRecorded).ok()).toBeTruthy();

    const download = await page.request.get(
      `/api/assets/${asset.id}/raw?download=1`
    );
    expect(download.ok()).toBeTruthy();

    await expect
      .poll(() => {
        const eventDatabase = new Database(databasePath, { readonly: true });
        try {
          return eventDatabase
            .prepare(`
              SELECT action
              FROM product_events
              WHERE task_id = ?
              ORDER BY action ASC
            `)
            .all(taskId)
            .map((row) => (row as { action: string }).action);
        } finally {
          eventDatabase.close();
        }
      })
      .toEqual(["download", "regenerate", "reuse"]);

    const statsResponse = await page.request.get(
      "/api/stats?days=29&projectPage=1&userPage=1&pageSize=10"
    );
    expect(statsResponse.ok()).toBeTruthy();
    const stats = (await statsResponse.json()) as {
      engagement: {
        resultCount: number;
        downloadedCount: number;
        reusedCount: number;
        regeneratedCount: number;
      };
    };
    expect(stats.engagement.resultCount).toBeGreaterThanOrEqual(1);
    expect(stats.engagement.downloadedCount).toBeGreaterThanOrEqual(1);
    expect(stats.engagement.reusedCount).toBeGreaterThanOrEqual(1);
    expect(stats.engagement.regeneratedCount).toBeGreaterThanOrEqual(1);

    await page.goto("/dashboard");
    const usageCard = page.locator('[data-kpi="结果使用"]');
    await expect(usageCard).toContainText("下载");
    await expect(usageCard).toContainText("复用");
    await expect(usageCard).toContainText("再次生成");
  });

  test("keeps large dashboard cost values inside the KPI card", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto("/dashboard");

    const costCard = page.locator('[data-kpi="预估消耗"]');
    const costValue = costCard.locator("[data-kpi-value]");
    await expect(costCard).toBeVisible();
    await costValue.evaluate((element) => {
      element.textContent = "¥15,282.65";
    });

    const cardMetrics = await costCard.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    const valueMetrics = await costValue.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));

    expect(cardMetrics.scrollWidth).toBeLessThanOrEqual(cardMetrics.clientWidth + 1);
    expect(valueMetrics.scrollWidth).toBeLessThanOrEqual(valueMetrics.clientWidth + 1);
  });

  test("paginates dashboard rankings and reuses the short stats cache", async ({
    page,
  }) => {
    insertDashboardRankFixtures();

    const first = await page.request.get(
      "/api/stats?days=31&projectPage=1&userPage=1&pageSize=5"
    );
    expect(first.ok()).toBeTruthy();
    expect(first.headers()["x-stats-cache"]).toBe("MISS");
    const firstData = (await first.json()) as {
      byProject: Array<{ id: string }>;
      byModel: Array<{
        modelKey: string;
        timing: {
          terminalCount: number;
          sampleCount: number;
          queueP50DurationMs: number | null;
          executionP95DurationMs: number | null;
        };
      }>;
      pagination: { projects: { total: number; hasNext: boolean } };
    };
    expect(firstData.byProject).toHaveLength(5);
    expect(firstData.pagination.projects.total).toBeGreaterThan(10);
    expect(firstData.pagination.projects.hasNext).toBeTruthy();
    const fixtureModel = firstData.byModel.find(
      (row) => row.modelKey === "e2e-dashboard-rank"
    );
    expect(fixtureModel?.timing).toMatchObject({
      terminalCount: 12,
      sampleCount: 0,
      queueP50DurationMs: null,
      executionP95DurationMs: null,
    });

    const cached = await page.request.get(
      "/api/stats?days=31&projectPage=2&userPage=1&pageSize=5"
    );
    expect(cached.ok()).toBeTruthy();
    expect(cached.headers()["x-stats-cache"]).toBe("HIT");
    const cachedData = (await cached.json()) as {
      byProject: Array<{ id: string }>;
      pagination: { projects: { page: number; hasPrevious: boolean } };
    };
    expect(cachedData.byProject).toHaveLength(5);
    expect(cachedData.pagination.projects.page).toBe(2);
    expect(cachedData.pagination.projects.hasPrevious).toBeTruthy();

    await page.goto("/dashboard");
    const nextPage = page.getByRole("button", {
      name: "下一页项目排行",
      exact: true,
    });
    await expect(nextPage).toBeEnabled();
    await nextPage.click();
    await expect(
      page.getByRole("button", { name: "上一页项目排行", exact: true })
    ).toBeEnabled();
    await expect(page.getByText(/第 2 \/ \d+ 页 · 共 \d+ 项/)).toBeVisible();

    await page.getByRole("button", { name: "全部", exact: true }).click();
    const modelRow = page.getByRole("button", {
      name: "e2e-dashboard-rank 12 次 100% —",
      exact: true,
    });
    await expect(modelRow).toBeVisible();
    await modelRow.click();

    await expect(page.locator('[data-kpi="执行 P95"]')).toBeVisible();
    await expect(
      page.getByText(/历史回退不进入耗时分位数/)
    ).toBeVisible();
    const modelTiming = page.locator(
      '[data-model-timing="e2e-dashboard-rank"]'
    );
    await expect(modelTiming).toContainText("精确计时 0/12");
    await expect(modelTiming).toContainText("排队 P50 —");
    await expect(modelTiming).toContainText("执行 P95 —");

    const distribution = page.locator(
      '[data-model-distribution="e2e-dashboard-rank"]'
    );
    await expect(distribution).toContainText("Top 5 / 共 12 个项目");
    await expect(
      distribution.locator("[data-model-distribution-row]")
    ).toHaveCount(5);

    const memberDistribution = page.getByRole("button", {
      name: "按成员查看 e2e-dashboard-rank 分布",
      exact: true,
    });
    await expect(memberDistribution).toBeEnabled();
    await memberDistribution.click();
    await expect(distribution).toContainText("Top 1 / 共 1 位成员");
    await expect(
      distribution.locator("[data-model-distribution-row]")
    ).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    const distributionMetrics = await distribution.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(distributionMetrics.scrollWidth).toBeLessThanOrEqual(
      distributionMetrics.clientWidth + 1
    );
    expect(distributionMetrics.pageScrollWidth).toBeLessThanOrEqual(
      distributionMetrics.pageClientWidth + 1
    );
  });

  test("manages model availability without exposing credentials", async ({
    page,
  }) => {
    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: "E2E Model Runtime Config",
        description: "Managed model configuration regression workspace",
        visibility: "private",
      },
    });
    expect(projectResponse.ok()).toBeTruthy();
    const project = (await projectResponse.json()) as { id: string };
    const projectId = project.id;
    const adminResponse = await page.request.get("/api/admin/models");
    expect(adminResponse.ok()).toBeTruthy();
    const adminData = (await adminResponse.json()) as {
      items: Array<{
        key: string;
        enabled: boolean;
        endpoint: string | null;
        capabilities: Record<string, unknown>;
        credentialConfigured: boolean;
      }>;
    };
    const target = adminData.items.find((item) => item.key === "seedream-4.0");
    expect(target).toBeTruthy();
    expect(JSON.stringify(target)).not.toContain("apiKey");
    expect(JSON.stringify(target)).not.toContain("token");

    const disabled = await page.request.patch("/api/admin/models", {
      data: {
        key: target!.key,
        enabled: false,
        endpoint: target!.endpoint,
        capabilities: target!.capabilities,
      },
    });
    expect(disabled.ok()).toBeTruthy();

    const publicCatalog = await page.request.get("/api/models");
    expect(publicCatalog.ok()).toBeTruthy();
    const publicData = (await publicCatalog.json()) as {
      items: Array<{ key: string; enabled: boolean; endpoint?: unknown }>;
    };
    const disabledPublic = publicData.items.find(
      (item) => item.key === target!.key
    );
    expect(disabledPublic?.enabled).toBeFalsy();
    expect(disabledPublic).not.toHaveProperty("endpoint");

    const rejectedGeneration = await page.request.post(
      `/api/projects/${projectId}/generate/image`,
      {
        data: {
          prompt: "E2E disabled model request",
          modelKey: target!.key,
          size: "2048x2048",
          refAssetIds: [],
        },
      }
    );
    expect(rejectedGeneration.status()).toBe(503);
    expect((await rejectedGeneration.json()).code).toBe("MODEL_DISABLED");

    const invalidCapabilities = await page.request.patch("/api/admin/models", {
      data: {
        key: target!.key,
        enabled: true,
        endpoint: target!.endpoint,
        capabilities: { ...target!.capabilities, tiers: [] },
      },
    });
    expect(invalidCapabilities.status()).toBe(400);
    expect((await invalidCapabilities.json()).code).toBe(
      "MODEL_CAPABILITY_INVALID"
    );

    await page.goto("/dashboard/models");
    const card = page.locator('[data-model-config="seedream-4.0"]');
    await expect(card).toBeVisible();
    const enabledToggle = card.getByRole("checkbox", {
      name: "接受新任务",
      exact: true,
    });
    await expect(enabledToggle).not.toBeChecked();
    await enabledToggle.check();
    await card
      .getByRole("button", { name: "保存配置", exact: true })
      .click();

    await expect
      .poll(async () => {
        const response = await page.request.get("/api/models");
        const body = (await response.json()) as {
          items: Array<{ key: string; enabled: boolean }>;
        };
        return body.items.find((item) => item.key === target!.key)?.enabled;
      })
      .toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBeTruthy();
  });

  test("submits all four creators without calling external providers", async ({ page }) => {
    const projectId = await openFormalProject(page);
    const payloads: Record<string, Record<string, unknown>> = {};

    await page.route(`**/api/projects/${projectId}/generate/image`, async (route) => {
      payloads.image = route.request().postDataJSON();
      await fulfillGeneration(route, projectId, "image");
    });
    await page.route(`**/api/projects/${projectId}/generate/video`, async (route) => {
      payloads.video = route.request().postDataJSON();
      await fulfillGeneration(route, projectId, "video");
    });
    await page.route(`**/api/projects/${projectId}/generate/music`, async (route) => {
      payloads.music = route.request().postDataJSON();
      await fulfillGeneration(route, projectId, "music");
    });
    await page.route(`**/api/projects/${projectId}/generate/tts`, async (route) => {
      payloads.tts = route.request().postDataJSON();
      await fulfillGeneration(route, projectId, "audio");
    });

    await page.getByRole("button", { name: "图像", exact: true }).click();
    await page.getByRole("textbox").fill("E2E image prompt");
    await page.getByRole("button", { name: "生成图像", exact: true }).click();
    await expect.poll(() => payloads.image?.prompt).toBe("E2E image prompt");

    await page.getByRole("button", { name: "视频", exact: true }).click();
    await page
      .getByPlaceholder(
        "例如：低机位跟拍赛车驶入雨夜维修区，霓虹倒影划过车身，镜头缓慢推近……"
      )
      .fill("E2E video prompt");
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await expect.poll(() => payloads.video?.prompt).toBe("E2E video prompt");

    await page.getByRole("button", { name: "音乐", exact: true }).click();
    await page
      .getByPlaceholder("例如：一首关于深海与月光的歌，写给追梦的人……")
      .fill("一首轻快的测试歌曲");
    await page.getByRole("button", { name: "生成音乐", exact: true }).click();
    await expect.poll(() => payloads.music?.text).toBe("一首轻快的测试歌曲");

    await page.getByRole("button", { name: "配音", exact: true }).click();
    await page
      .getByPlaceholder("输入要合成的旁白 / 台词，支持中英文混合……")
      .fill("这是一段端到端测试旁白。");
    await page.getByRole("button", { name: "生成配音", exact: true }).click();
    await expect.poll(() => payloads.tts?.text).toBe("这是一段端到端测试旁白。");
  });

  test("blocks music text beyond the provider limit before submitting", async ({ page }) => {
    const projectId = await openFormalProject(page);
    let generationRequests = 0;
    await page.route(`**/api/projects/${projectId}/generate/music`, async (route) => {
      generationRequests += 1;
      await route.abort();
    });

    await page.getByRole("button", { name: "音乐", exact: true }).click();
    const prompt = page.getByRole("textbox", { name: "音乐提示词", exact: true });
    await prompt.fill("字".repeat(500));
    await expect(page.getByText(/灵感提示词最多 499 字/)).toBeVisible();
    await expect(page.getByRole("button", { name: "生成音乐", exact: true })).toBeDisabled();
    expect(generationRequests).toBe(0);

    const response = await page.request.post(
      `/api/projects/${projectId}/generate/music`,
      {
        data: {
          mode: "song",
          text: "字".repeat(500),
          duration: 60,
        },
      }
    );
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/灵感提示词最多 499 字/),
      code: "MUSIC_TEXT_TOO_LONG",
    });
  });

  test("renders formulas locally and exports standalone SVG and PNG", async ({ page }) => {
    const projectId = await openFormalProject(page);
    const generationRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes(`/api/projects/${projectId}/generate/`)
      ) {
        generationRequests.push(request.url());
      }
    });

    await page.evaluate(async () => {
      const response = await fetch("/vendor/formula-fonts/stix-two-text-400-normal.woff2");
      const fontBytes = await response.arrayBuffer();
      Object.defineProperty(window, "queryLocalFonts", {
        configurable: true,
        value: async () => [{
          family: "E2E Local Font",
          fullName: "E2E Local Font Regular",
          postscriptName: "E2ELocalFont-Regular",
          style: "Regular",
          blob: async () => new Blob([fontBytes], { type: "font/woff2" }),
        }],
      });
    });

    await page.getByRole("button", { name: "公式", exact: true }).click();
    await expect(page.locator('[data-creator-workspace="formula"]')).toBeVisible();
    const latexInput = page.getByRole("textbox", { name: "LaTeX 公式", exact: true });
    await expect(latexInput).toBeVisible();
    await expect
      .poll(() => page.locator(".formula-preview-output svg").count(), { timeout: 20_000 })
      .toBe(1);

    const safeAreaToggle = page.getByRole("button", { name: "公式安全区辅助线", exact: true });
    await expect(safeAreaToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-formula-safe-area-guides="true"]')).toHaveCount(0);
    await safeAreaToggle.click();
    await expect(safeAreaToggle).toHaveAttribute("aria-pressed", "true");
    const safeAreaGuides = page.locator('[data-formula-safe-area-guides="true"]');
    await expect(safeAreaGuides).toBeVisible();
    await expect(safeAreaGuides).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator('[data-formula-safe-area-status="true"]')).toHaveText("安全区 90% / 80%");
    await expect
      .poll(() => safeAreaGuides.evaluate((node) => getComputedStyle(node).pointerEvents))
      .toBe("none");
    await safeAreaToggle.click();
    await expect(safeAreaToggle).toHaveAttribute("aria-pressed", "false");
    await expect(safeAreaGuides).toHaveCount(0);
    await expect(page.locator('[data-formula-safe-area-status="true"]')).toHaveCount(0);

    const desktopLayout = await page.evaluate(() => {
      const board = document.querySelector(".formula-preview-board")?.getBoundingClientRect();
      const composer = document.querySelector('[data-creator-composer="formula"]')?.getBoundingClientRect();
      const stage = document.querySelector('[data-composer-layout="side"]');
      return {
        boardRight: board?.right ?? 0,
        composerLeft: composer?.left ?? 0,
        composerBottom: composer?.bottom ?? 0,
        viewportHeight: window.innerHeight,
        layout: stage?.getAttribute("data-composer-layout"),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(desktopLayout.layout).toBe("side");
    expect(desktopLayout.composerLeft).toBeGreaterThanOrEqual(desktopLayout.boardRight - 1);
    expect(desktopLayout.composerBottom).toBeLessThanOrEqual(desktopLayout.viewportHeight + 1);
    expect(desktopLayout.pageOverflow).toBeLessThanOrEqual(1);

    const fontSelect = page.getByRole("combobox", { name: "公式字体选择", exact: true });
    await fontSelect.click();
    await expect(page.getByRole("option", { name: /STIX Two Math/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await latexInput.fill("\\frac{a+b}{c+d}");
    await expect
      .poll(() => page.locator('[data-formula-active-latex="true"]').textContent(), { timeout: 20_000 })
      .toMatch(/\\frac\{.*a\+b.*\}\{.*c\+d.*\}/);

    const fractionPaddingSelect = page.getByRole("combobox", { name: "公式分数留白", exact: true });
    await fractionPaddingSelect.click();
    await page.getByRole("option", { name: "不额外增加", exact: true }).click();
    await expect
      .poll(() => page.locator('[data-formula-active-latex="true"]').textContent(), { timeout: 20_000 })
      .toContain("\\frac{a+b}{c+d}");
    const noPaddingViewBox = await page.locator(".formula-preview-output svg").getAttribute("viewBox");

    await fractionPaddingSelect.click();
    await page.getByRole("option", { name: "更宽", exact: true }).click();
    await expect
      .poll(() => page.locator('[data-formula-active-latex="true"]').textContent(), { timeout: 20_000 })
      .toContain("\\mkern6mu");
    const widePaddingViewBox = await page.locator(".formula-preview-output svg").getAttribute("viewBox");
    expect(widePaddingViewBox).not.toBe(noPaddingViewBox);

    const svgDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 AE SVG", exact: true }).click();
    const svgDownload = await svgDownloadPromise;
    expect(svgDownload.suggestedFilename()).toBe("haitun-formula.svg");
    const svgPath = await svgDownload.path();
    expect(svgPath).toBeTruthy();
    const svgText = await fs.promises.readFile(svgPath!, "utf8");
    expect(svgText).toContain("<svg");
    expect(svgText).not.toMatch(/<use\b/);
    expect(svgText).not.toMatch(/(?:href|xlink:href|src)=["']https?:\/\//);

    const pngDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出透明 PNG", exact: true }).click();
    expect((await pngDownloadPromise).suggestedFilename()).toBe(
      "haitun-formula-1920x1080.png"
    );

    await page.getByRole("button", { name: "读取本机字体", exact: true }).click();
    await expect(page.locator('[data-formula-font-status="true"]')).toContainText("已读取 1 个本机字体");
    await fontSelect.click();
    const localFontOption = page.getByRole("option", { name: /E2E Local Font/ });
    await expect(localFontOption).toBeVisible();
    await localFontOption.click();
    await expect(page.locator('[data-formula-font-status="true"]')).toContainText("已加载并内嵌本机字体：E2E Local Font");

    await page.getByRole("tab", { name: "中文近似", exact: true }).click();
    const textInput = page.getByRole("textbox", { name: "线性或中文表达", exact: true });
    await textInput.fill("根号下 x 加 y 平方等于 1");
    await expect
      .poll(() => page.locator(".formula-preview-output svg").count(), { timeout: 20_000 })
      .toBe(1);

    await page.getByRole("tab", { name: "LaTeX 代码", exact: true }).click();
    await latexInput.fill("\\text{中文} + x^2");
    await expect
      .poll(() => page.locator('[data-formula-active-latex="true"]').textContent(), { timeout: 20_000 })
      .toMatch(/\\unicode\{x4e2d\}\\unicode\{x6587\}/);
    const cjkSvgDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 AE SVG", exact: true }).click();
    const cjkSvgDownload = await cjkSvgDownloadPromise;
    const cjkSvgPath = await cjkSvgDownload.path();
    const cjkSvgText = await fs.promises.readFile(cjkSvgPath!, "utf8");
    expect(cjkSvgText).toContain("<svg");
    expect(cjkSvgText).toMatch(/<text[^>]*>[^<]*中[^<]*文[^<]*<\/text>/);
    expect(cjkSvgText).toMatch(/font-family=/);
    expect(cjkSvgText).toContain("E2E Local Font");
    expect(cjkSvgText).toMatch(/@font-face/);
    expect(cjkSvgText).not.toMatch(/data-c="3F"/);
    expect(cjkSvgText).not.toMatch(/<use\b/);
    expect(cjkSvgText).not.toMatch(/(?:href|xlink:href|src)=["']https?:\/\//);

    const saveFormulaButton = page.getByRole("button", { name: "保存到项目资产库", exact: true });
    await expect(saveFormulaButton).toBeEnabled();
    await saveFormulaButton.click();
    await expect(page.locator('[data-formula-active-latex="true"]')).toContainText("\\text");
    await expect(page.getByText(/已保存到项目资产库/)).toBeVisible();

    const assetResponse = await page.request.get(`/api/projects/${projectId}/assets?kind=image&limit=100`);
    expect(assetResponse.ok()).toBeTruthy();
    const assetPage = (await assetResponse.json()) as { items: Array<{ id: string; metaJson: string }> };
    const formulaAsset = assetPage.items.find((asset) => {
      try {
        const meta = JSON.parse(asset.metaJson) as { formula?: { activeLatex?: string } };
        return meta.formula?.activeLatex?.includes("\\text") ?? false;
      } catch {
        return false;
      }
    });
    expect(formulaAsset).toBeTruthy();
    const savedFormulaMeta = JSON.parse(formulaAsset!.metaJson) as {
      formula: { fractionPadding: string; cjkFont: string; renderedWidth: number };
    };
    expect(savedFormulaMeta.formula.fractionPadding).toBe("wide");
    expect(savedFormulaMeta.formula.cjkFont).toContain("E2E Local Font");
    expect(savedFormulaMeta.formula.renderedWidth).toBeGreaterThan(0);

    await page.getByRole("button", { name: "资产", exact: true }).click();
    const savedCard = page.locator(`[data-asset-id="${formulaAsset!.id}"]`);
    await expect(savedCard).toBeVisible();
    await savedCard.click();
    await expect(page.getByRole("button", { name: "编辑公式", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "编辑公式", exact: true }).click();
    await expect(page.locator('[data-creator-workspace="formula"]')).toBeVisible();
    await expect(page.getByRole("textbox", { name: "LaTeX 公式", exact: true })).toHaveValue("\\text{中文} + x^2");
    await expect(page.getByRole("combobox", { name: "公式分数留白", exact: true })).toContainText("更宽");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBeTruthy();
    expect(generationRequests).toEqual([]);
  });

  test("submits frames mode without a duration field", async ({ page }) => {
    const projectId = await openFormalProject(page);
    let payload: Record<string, unknown> | undefined;

    await page.route(`**/api/projects/${projectId}/generate/video`, async (route) => {
      payload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillGeneration(route, projectId, "video");
    });

    await page.getByRole("button", { name: "视频", exact: true }).click();
    await page.getByRole("combobox", { name: "视频模型", exact: true }).click();
    const modelOption = page.getByRole("option", {
      name: "Seedance 1.0 Pro精确帧数；支持 2–12 秒与小数秒视频",
      exact: true,
    });
    await expect(modelOption).toHaveCount(1);
    await modelOption.click();

    await page.getByRole("combobox", { name: "视频长度模式", exact: true }).click();
    await page.getByRole("option", { name: "按帧数", exact: true }).click();
    await page.getByRole("textbox", { name: "视频提示词", exact: true }).fill(
      "E2E fractional frame prompt"
    );
    await page.getByRole("spinbutton", { name: "视频帧数", exact: true }).fill("57");
    await page.getByRole("button", { name: "生成视频", exact: true }).click();

    await expect.poll(() => payload?.prompt).toBe("E2E fractional frame prompt");
    expect(payload?.frames).toBe(57);
    expect(payload?.duration).toBeUndefined();
    expect(payload?.durationMode).toBe("frames");

    await page.getByRole("combobox", { name: "视频长度模式", exact: true }).click();
    await page.getByRole("option", { name: "按时长", exact: true }).click();
    await page.getByRole("combobox", { name: "视频时长", exact: true }).click();
    await page.getByRole("option", { name: "5 秒", exact: true }).click();
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await expect.poll(() => payload?.duration).toBe(5);
    expect(payload?.frames).toBeUndefined();
    expect(payload?.durationMode).toBe("duration");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBeTruthy();

    const accepted = await page.request.post(
      `/api/projects/${projectId}/generate/video`,
      {
        data: {
          prompt: "server frames validation",
          modelKey: "seedance-1.0-pro",
          resolution: "720p",
          frames: 57,
        },
      }
    );
    expect(accepted.ok()).toBeTruthy();
    const acceptedTask = (await accepted.json()) as { task: { inputJson: string } };
    const acceptedInput = JSON.parse(acceptedTask.task.inputJson) as Record<string, unknown>;
    expect(acceptedInput.frames).toBe(57);
    expect(acceptedInput.duration).toBeUndefined();
    expect(acceptedInput.ratio).toBe("16:9");

    const conflict = await page.request.post(
      `/api/projects/${projectId}/generate/video`,
      {
        data: {
          prompt: "server frames conflict",
          modelKey: "seedance-1.0-pro",
          duration: 3,
          frames: 57,
        },
      }
    );
    expect(conflict.status()).toBe(400);
    expect((await conflict.json()).code).toBe("VIDEO_LENGTH_MODE_CONFLICT");
  });
});
