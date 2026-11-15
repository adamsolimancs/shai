import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const backend = 'http://127.0.0.1:18080';
const runtimeErrors = new WeakMap<Page, string[]>();
async function scenario(request: APIRequestContext, state: Record<string, string>) {
  await request.post(`${backend}/__scenario`, { data: state });
}

// The real Next server, server fetches, search proxy, router and components run.
// Only the backend data boundary and external images are replaced by fixtures.
test.beforeEach(async ({ page, request }) => {
  await scenario(request, {});
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Search failure and an absent team deliberately produce HTTP error responses.
    if (/Failed to load resource:.*(?:404|429|502)/.test(message.text())) return;
    errors.push(message.text());
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (route.request().resourceType() === 'image') return route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>',
    });
    return route.abort();
  });
});

test.afterEach(async ({ request, page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
  expect(await (await request.get(`${backend}/__unknown`)).json()).toEqual([]);
});

// Acting before React hydrates drops focus/input events, and a screenshot's injected caret style
// on server-rendered inputs causes a hydration mismatch. Wait until every control is hydrated.
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => [...document.querySelectorAll('a, button, input')]
    .every(element => Object.keys(element).some(key => key.startsWith('__reactFiber$'))));
}

async function checkPage(page: Page) {
  await expect(page.locator('main')).not.toBeEmpty();
  await expect(page).toHaveTitle(/ShAI|Player profile|404/);
  await expect(page.locator('nextjs-portal [data-nextjs-dialog-overlay]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

// WCAG contrast of the element's text against its background, composited over the page background.
async function textContrast(page: Page, name: string) {
  return page.getByRole('button', { name }).evaluate(element => {
    const parse = (value: string) => {
      const [r, g, b, a = 1] = value.match(/[\d.]+/g)!.map(Number);
      return { r, g, b, a };
    };
    const over = (top: ReturnType<typeof parse>, base: ReturnType<typeof parse>) => ({
      r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1,
    });
    const luminance = ({ r, g, b }: ReturnType<typeof parse>) => {
      const [R, G, B] = [r, g, b].map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const style = getComputedStyle(element);
    const background = over(parse(style.backgroundColor), parse(getComputedStyle(document.body).backgroundColor));
    const [light, dark] = [luminance(parse(style.color)), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  });
}

test('offseason homepage → in-season toggle', async ({ page }) => {
  await open(page, '/?offseason=1');
  await expect(page.getByRole('heading', { name: '2025-2026 NBA Season Recap' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NBA Finals' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'LeBron James' }).first()).toBeVisible();
  await checkPage(page);

  // The dev toggle label must stay legible in both colour modes.
  for (const dark of [false, true]) {
    await page.evaluate(isDark => document.documentElement.classList.toggle('dark', isDark), dark);
    expect(await textContrast(page, 'Dev: offseason')).toBeGreaterThanOrEqual(4.5);
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  await page.getByRole('button', { name: 'Dev: offseason' }).click();
  await expect(page).toHaveURL(/offseason=0/);
  await expect(page.getByRole('heading', { name: 'Recent Games' })).toBeVisible();
  await checkPage(page);
});

test('an explicitly live game remains live after midnight', async ({ page, request }) => {
  await scenario(request, { scores: 'live', tonight: 'empty' });
  await open(page, '/scores');
  await expect(page.getByText('Q3 04:12', { exact: true })).toBeVisible();
  await checkPage(page);
});

for (const mode of ['fresh', 'empty', 'partial', 'stale', 'unknown', 'failed']) {
  test(`scores → box score: ${mode}`, async ({ page, request }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await scenario(request, { scores: mode === 'partial' ? 'fresh' : mode, tonight: mode === 'partial' ? 'failed' : mode, boxscore: mode });
    await open(page, '/scores');
    await expect(page.getByRole('heading', { name: 'Latest results' })).toBeVisible();
    if (mode === 'empty') {
      await expect(page.getByText('No games found for 2025-26.')).toBeVisible();
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
      await expect(page.locator('a[href^="/boxscore/"]')).toHaveCount(0);
    } else if (mode === 'failed') {
      await expect(page.locator('main').getByRole('alert')).toHaveCount(2);
      await expect(page.getByText('No games found for 2025-26.')).toHaveCount(0);
    } else {
      if (mode === 'partial') await expect(page.locator('main').getByRole('alert')).toContainText('Tonight’s game data is unavailable');
      if (mode === 'stale') {
        await expect(page.locator('time[datetime="2026-01-15T18:30:00.000Z"]')).toHaveCount(2);
        await page.screenshot({ path: `/tmp/shai-scores-stale-${testInfo.project.name}.png`, fullPage: true });
      }
      if (mode === 'unknown') await expect(page.getByText(/Source observation time is unknown/)).toHaveCount(2);
      await page.locator('a[href="/boxscore/0022500001"]').last().click();
      await expect(page).toHaveURL(/\/boxscore\/0022500001$/);
      await expect(page.getByText('LAL 110', { exact: true })).toBeVisible();
      await expect(page.getByText('No advanced box score data available for Lakers.', { exact: true })).toBeVisible();
      if (mode === 'partial') await expect(page.getByText(/No traditional box score data available for Lakers/)).toBeVisible();
      else await expect(page.getByText('LeBron James').first()).toBeVisible();
      if (mode === 'stale') {
        await expect(page.locator('time[datetime="2026-01-15T18:30:00.000Z"]')).toHaveCount(1);
        await page.screenshot({ path: `/tmp/shai-boxscore-stale-${testInfo.project.name}.png`, fullPage: true });
      }
      if (mode === 'unknown') await expect(page.getByText(/Source observation time is unknown/)).toBeVisible();
      await checkPage(page);
      await page.getByRole('link', { name: 'Back to scores' }).click();
      await expect(page).toHaveURL(/\/scores$/);
    }
    await checkPage(page);
    expect(errors).toEqual([]);
  });
}

for (const mode of ['empty', 'failed']) {
  test(`scores → box score destination ${mode}`, async ({ page, request }) => {
    await scenario(request, { boxscore: mode });
    await open(page, '/scores');
    await page.locator('a[href="/boxscore/0022500001"]').last().click();
    await expect(page).toHaveURL(/\/boxscore\/0022500001$/);
    if (mode === 'empty') await expect(page.getByText('No box score is available for this game yet.')).toBeVisible();
    else await expect(page.locator('main').getByRole('alert')).toContainText('Box score data is unavailable');
    await page.getByRole('link', { name: 'Back to scores' }).click();
    await expect(page).toHaveURL(/\/scores$/);
    await checkPage(page);
  });
}

for (const entity of ['player', 'team']) {
  for (const mode of ['fresh', 'empty', 'partial', 'stale', 'failed']) {
    test(`search → ${entity}: ${mode}`, async ({ page, request }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await scenario(request, { [entity]: mode });
      await open(page, '/scores');
      const input = page.getByRole('combobox', { name: 'Search players and teams' });
      await input.fill(entity === 'player' ? 'LeBron' : 'Lakers');
      const option = page.getByRole('option', { name: new RegExp(entity === 'player' ? 'LeBron James' : 'Los Angeles Lakers') });
      await expect(option).toBeVisible();
      if (entity === 'player') { await input.press('ArrowDown'); await input.press('ArrowUp'); await input.press('Enter'); }
      else await option.click();
      await expect(page).toHaveURL(entity === 'player' ? /\/players\/2544$/ : /\/teams\/lal$/);
      if (mode === 'failed') await expect(page.locator('main').getByRole('alert')).toContainText(`${entity === 'player' ? 'Player' : 'Team'} data is unavailable`);
      else if (mode === 'empty') await expect(page.getByRole('heading', { name: entity === 'player' ? /this player doesn.t exist/ : /404/ })).toBeVisible();
      else {
        await expect(page.getByRole('heading', { name: entity === 'player' ? 'LeBron James' : 'Los Angeles Lakers (LAL)', exact: true })).toBeVisible();
        if (mode === 'stale') await expect(page.getByText(/Showing older data/)).toBeVisible();
        if (mode === 'partial') {
          if (entity === 'player') await expect(page.getByText('Career statistics are not available yet.')).toBeVisible();
          else await expect(page.getByText('Western Conference division', { exact: true })).toHaveCount(0);
          await expect(page.getByText('undefined', { exact: true })).toHaveCount(0);
          await expect(page.getByText('NaN', { exact: true })).toHaveCount(0);
          await page.screenshot({ path: `/tmp/shai-${entity}-partial-${testInfo.project.name}.png`, fullPage: true });
        }
      }
      await checkPage(page);
      expect(errors).toEqual([]);
    });
  }
}

for (const mode of ['empty', 'failed', 'stalled', 'limited']) {
  test(`search ${mode} and recovery`, async ({ page, request }, testInfo) => {
    await scenario(request, { search: mode });
    await open(page, '/scores');
    const input = page.getByRole('combobox', { name: 'Search players and teams' });
    await input.fill('LeBron');
    await expect(page.locator('p').filter({ hasText: mode === 'empty' ? /^No matching players or teams\.$/ : /^Suggestions are unavailable\. Press Enter to search players\.$/ })).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('option')).toHaveCount(0);
    if (mode === 'stalled') {
      await checkPage(page);
      await page.screenshot({ path: `/tmp/shai-search-timeout-${testInfo.project.name}.png`, fullPage: true });
    }
    await scenario(request, {});
    await input.fill('LeBron James');
    await page.getByRole('option', { name: /LeBron James/ }).click();
    await expect(page).toHaveURL(/\/players\/2544$/);
    await expect(page.getByRole('heading', { name: 'LeBron James', exact: true })).toBeVisible();
  });
}

test('trusted visitor identity crosses Next server fetches and search preserves 429', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'x-fixture-client-ip': '192.0.2.1', 'x-shai-visitor-id': 'forged', 'x-forwarded-for': '198.51.100.1' });
  await open(page, '/scores');
  let records = await (await request.get(`${backend}/__visitors`)).json();
  const scoreVisitor = records.find((record: { path: string }) => record.path === '/v1/games').visitor;
  expect(scoreVisitor).toMatch(/^[0-9a-f]{64}$/);
  await scenario(request, { search: 'limited' });
  const limited = await request.get('/api/search/suggestions?q=LeBron', { headers: { 'x-fixture-client-ip': '192.0.2.1' } });
  expect(limited.status()).toBe(429);
  expect(limited.headers()['retry-after']).toBe('30');
  records = await (await request.get(`${backend}/__visitors`)).json();
  expect(records.at(-1).visitor).toBe(scoreVisitor);
  await request.get('/api/search/suggestions?q=LeBron', { headers: { 'x-fixture-client-ip': '192.0.2.2' } });
  records = await (await request.get(`${backend}/__visitors`)).json();
  expect(records.at(-1).visitor).not.toBe(scoreVisitor);
});
