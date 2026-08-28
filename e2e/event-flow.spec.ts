import { expect, test } from "@playwright/test";

test("host and two players complete a short game to the podium", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const playerAContext = await browser.newContext();
  const playerBContext = await browser.newContext();
  const host = await hostContext.newPage();
  const playerA = await playerAContext.newPage();
  const playerB = await playerBContext.newPage();

  const session = await hostContext.request.post(`${baseURL}/api/test/host-session`);
  expect(session.ok()).toBeTruthy();

  await host.goto("/host");
  await expect(host.getByRole("button", { name: /start game/i })).toBeVisible();
  await host.getByRole("button", { name: /start game/i }).click();
  await host.waitForURL(/\/host\/\d{6}/);
  const roomCode = host.url().split("/").at(-1) ?? "";
  expect(roomCode).toMatch(/^\d{6}$/);

  await playerA.goto("/");
  await playerA.getByLabel(/game code/i).fill(roomCode);
  await playerA.getByLabel(/display name/i).fill("Alex");
  await playerA.getByRole("button", { name: /join the game/i }).click();
  await expect(playerA.getByText(/lobby/i)).toBeVisible({ timeout: 15_000 });

  await playerB.goto("/");
  await playerB.getByLabel(/game code/i).fill(roomCode);
  await playerB.getByLabel(/display name/i).fill("Bea");
  await playerB.getByRole("button", { name: /join the game/i }).click();
  await expect(playerB.getByText(/lobby/i)).toBeVisible({ timeout: 15_000 });

  await host.getByRole("button", { name: /start question/i }).click();
  await expect(playerA.getByRole("button", { name: /answer 1/i })).toBeVisible();
  await playerA.getByRole("button", { name: /answer 1/i }).click();
  await playerB.getByRole("button", { name: /answer 2/i }).click();
  await expect(playerA.getByText(/answer locked/i)).toBeVisible();

  await host.getByRole("button", { name: /close answers/i }).click();
  await host.getByRole("button", { name: /reveal/i }).click();
  await expect(playerA.getByText(/correct|not this time/i)).toBeVisible();
  await host.getByRole("button", { name: /leaderboard/i }).click();
  host.once("dialog", (dialog) => dialog.accept());
  await host.getByRole("button", { name: /end game/i }).click();
  await expect(host.getByTestId("podium")).toBeVisible({ timeout: 15_000 });
  await expect(playerA.getByTestId("podium")).toBeVisible({ timeout: 15_000 });

  await hostContext.close();
  await playerAContext.close();
  await playerBContext.close();
});
