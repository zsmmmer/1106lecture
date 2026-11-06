const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const screenshotDir = process.env.QA_DIR;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.zip': 'application/zip'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const prefix = '/1106lecture/';
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404).end();
    return;
  }
  const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(root, relative);
  const info = file.startsWith(root + path.sep) && fs.statSync(file, { throwIfNoEntry: false });
  if (!info || !info.isFile()) {
    response.writeHead(404).end();
    return;
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  if (start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
    return;
  }
  const headers = {
    'Content-Type': types[path.extname(file)],
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes'
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') response.end();
  else {
    const source = fs.createReadStream(file, { start, end });
    source.pipe(response);
    response.on('close', () => source.destroy());
  }
});

async function drag(page, locator, x, y) {
  const area = await locator.boundingBox();
  assert(area);
  const startX = area.x + area.width / 2;
  const startY = area.y + area.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + x, startY + y, { steps: 8 });
  await page.mouse.up();
}

async function desktop(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#main-image').naturalWidth > 0);
  await page.waitForFunction(() => document.querySelector('audio').readyState >= 1);
  assert.equal(await page.locator('.slide-card').count(), 77);
  assert.equal(await page.locator('.marker').count(), 77);
  assert((await page.locator('.cue').count()) >= 120);
  assert(!(await page.locator('#mobile-bar').isVisible()));
  assert.match(await page.locator('#subtitle-line').textContent(), /联合主办/);
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  assert(!(await page.locator('#subtitle-band').isVisible()));
  await page.getByRole('button', { name: '字幕', exact: true }).click();
  assert(await page.locator('#subtitle-band').isVisible());
  await page.screenshot({ path: path.join(screenshotDir, 'desktop.png') });

  const title = page.locator('#caption-title');
  await page.locator('.slide-card').filter({ hasText: '文化遗产数字化与古塔研究' }).click();
  assert.equal(await title.textContent(), '文化遗产数字化与古塔研究');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 160) < 0.12);
  assert.equal(await page.locator('.cue[aria-current=true] .cue-time').textContent(), '02:26');
  await page.waitForFunction(() => {
    const { currentTime } = document.querySelector('audio');
    const line = window.LECTURE_DATA.subtitles.find((cue) => cue.at <= currentTime && currentTime < cue.end);
    return document.querySelector('#subtitle-line').textContent === (line?.text || '');
  });

  await page.locator('.marker[aria-current=true]').hover();
  assert(await page.locator('#marker-preview').isVisible());
  await page.waitForFunction(() => document.querySelector('#preview-image').naturalWidth > 0);

  await page.locator('.cue').filter({ hasText: '还有其他问题吗' }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 4725);
  assert(await page.locator('#qa-view').isVisible());
  await page.screenshot({ path: path.join(screenshotDir, 'qa.png') });

  await page.locator('#transcript-scroll').hover();
  await page.mouse.wheel(0, -150);
  await page.waitForFunction(() => document.querySelector('#follow-toggle').getAttribute('aria-pressed') === 'false');
  await page.locator('#follow-toggle').click();
  assert.equal(await page.locator('#follow-toggle').getAttribute('aria-pressed'), 'true');

  await page.locator('.slide-card').filter({ hasText: '燕园数字孪生演示' }).click();
  const slider = page.locator('#seek');
  const bounds = await slider.boundingBox();
  const clipTime = 456.5;
  const at = (seconds) => bounds.x + 7 + (bounds.width - 14) * seconds / 5642.52;
  await page.mouse.move(at(452.35), bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(clipTime), bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    const video = document.querySelector('video');
    return audio.currentTime > 453.5 && audio.currentTime < 460 &&
      video.readyState >= 2 && Math.abs(video.currentTime - (audio.currentTime - 452.35)) < .55;
  });

  await page.locator('#play-toggle').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused &&
    !document.querySelector('video').paused && document.querySelector('.avatar.is-speaking'));
  assert.equal(await page.locator('video').evaluate((el) => el.muted), true);
  assert.equal(await page.locator('audio').evaluate((el) => el.muted), false);
  await page.locator('#rate').selectOption('1.5');
  assert.equal(await page.locator('video').evaluate((el) => el.playbackRate), 1.5);
  await page.locator('#play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').paused &&
    document.querySelector('video').paused && !document.querySelector('.avatar.is-speaking'));

  const left = page.locator('#slides-panel');
  const right = page.locator('#transcript-panel');
  const bottom = page.locator('#transport');
  const before = [(await left.boundingBox()).width, (await right.boundingBox()).width, (await bottom.boundingBox()).height];
  await drag(page, page.locator('#left-resize'), 45, 0);
  await drag(page, page.locator('#right-resize'), -40, 0);
  await drag(page, page.locator('#bottom-resize'), 0, -36);
  assert((await left.boundingBox()).width > before[0] + 20);
  assert((await right.boundingBox()).width > before[1] + 20);
  assert((await bottom.boundingBox()).height > before[2] + 20);

  await page.locator('#download-open').click();
  assert(await page.locator('#download-dialog').isVisible());
  assert.equal(await page.locator('#download-dialog a[download]').count(), 10);
  const files = await page.locator('#download-dialog a[download]').evaluateAll((items) => items.map((el) => el.href));
  for (const file of files) {
    const response = await page.request.head(file);
    assert(response.ok(), file);
    assert(Number(response.headers()['content-length']) > 1024, file);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /带时间戳的校订稿/ }).click()
  ]);
  assert.match(download.suggestedFilename(), /校订稿\.txt$/);
  await page.keyboard.press('Escape');
  assert(!(await page.locator('#download-dialog').isVisible()));
  assert.deepEqual(errors, []);
  await page.close();
}

async function mobile(browser, url, width, height, name) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce'
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#main-image').naturalWidth > 0);
  assert(await page.locator('#stage').isVisible());
  assert(!(await page.locator('#left-resize').isVisible()));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert(await page.getByRole('tab', { name: '同步讲稿', selected: true }).isVisible());
  assert(!(await page.locator('#slides-panel').isVisible()));
  const panel = await page.locator('#transcript-panel').boundingBox();
  const transport = await page.locator('#transport').boundingBox();
  assert(panel.height >= 72);
  assert(panel.y + panel.height <= transport.y + 1);
  assert(transport.y + transport.height <= height + 2);
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });

  await page.getByRole('tab', { name: '画面索引' }).tap();
  assert(await page.locator('#slides-panel').isVisible());
  assert(!(await page.locator('#transcript-panel').isVisible()));
  await page.locator('.slide-card').filter({ hasText: '文化遗产数字化与古塔研究' }).tap();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 160) < .12);
  await page.getByRole('tab', { name: '同步讲稿' }).tap();
  assert.equal(await page.locator('.cue[aria-current=true] .cue-time').textContent(), '02:26');

  if (name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    const scrubber = await page.locator('#seek').boundingBox();
    const y = scrubber.y + scrubber.height / 2;
    const x = scrubber.x + 10 + (scrubber.width - 20) * 160 / 5642.52;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 80, y }] });
    await page.waitForFunction(() => !document.querySelector('#marker-preview').hidden);
    assert.equal(await page.locator('audio').evaluate((el) => Math.round(el.currentTime)), 160);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 1000);
    assert(!(await page.locator('#marker-preview').isVisible()));
    await cdp.detach();
  }

  await page.locator('#qa-jump').tap();
  assert(await page.locator('#qa-view').isVisible());
  assert(await page.locator('#qa-topic-select').isVisible());
  assert.equal(await page.locator('#qa-topic-select option').count(), 7);
  await page.locator('#qa-topic-select').selectOption('4757');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 4757) < .12);
  if (name === 'mobile') await page.screenshot({ path: path.join(screenshotDir, 'mobile-qa.png') });
  await page.close();
}

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/1106lecture/`;
  const browser = await chromium.launch();
  try {
    await desktop(browser, url);
    await mobile(browser, url, 390, 844, 'mobile');
    await mobile(browser, url, 320, 568, 'mobile-compact');
    await mobile(browser, url, 932, 430, 'mobile-landscape');
    console.log('Playback, muted video sync, subtitles, navigation, panel resizing, downloads and mobile layouts passed.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
