const path = require('path');
const getRootPath = () => {
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  return process['pkg'] ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
};
exports.getRootPath = getRootPath;
const stripAnsi = (value) =>
  String(value || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
exports.stripAnsi = stripAnsi;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.wait = wait;
const randomDelay = (min = 200, max = 600) => (0, exports.wait)(min + Math.random() * (max - min));
exports.randomDelay = randomDelay;
const EVENT_DELAY_MS = 100;
const waitAfterEvent = () => wait(EVENT_DELAY_MS);
exports.EVENT_DELAY_MS = EVENT_DELAY_MS;
exports.waitAfterEvent = waitAfterEvent;
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
exports.shuffleArray = shuffleArray;

const pickRandom = (array) => array[Math.floor(Math.random() * array.length)];
exports.pickRandom = pickRandom;

const parseProxyString = (proxyStr) => {
  if (!proxyStr) return null;
  const parts = proxyStr.trim().split(':');
  if (parts.length >= 4) {
    return {
      server: `http://${parts[0]}:${parts[1]}`,
      username: parts[2],
      password: parts[3],
    };
  }
  return null;
};
exports.parseProxyString = parseProxyString;

const asyncPool = async (iterable, concurrency, task) => {
  const results = [];
  const executing = [];
  for (const item of iterable) {
    const p = Promise.resolve().then(() => task(item, iterable));
    results.push(p);
    if (concurrency <= iterable.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
};
exports.asyncPool = asyncPool;

const mouseTracker = new WeakMap();

const { SelectorError, AppError } = require('./errors');

const updateVisualCursor = async (page, x, y) => {
  await page
    .evaluate(
      ({ x: cursorX, y: cursorY }) => {
        const cursorId = 'ig-bot-visual-cursor';
        let cursor = document.getElementById(cursorId);

        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = cursorId;
          cursor.setAttribute('aria-hidden', 'true');
          cursor.style.cssText = `
            position: fixed;
            left: 0;
            top: 0;
            width: 22px;
            height: 28px;
            z-index: 2147483647;
            pointer-events: none;
            transform: translate3d(${cursorX}px, ${cursorY}px, 0);
            filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45));
            transition: transform 45ms linear;
          `;
          cursor.innerHTML = `
            <svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 1.5L1.9 23.2L7.8 17.6L11.6 26.5L15.5 24.8L11.7 16.1H20.1L1.5 1.5Z"
                fill="white" stroke="black" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
          `;
          document.documentElement.appendChild(cursor);
        }

        cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
      },
      { x, y }
    )
    .catch(() => { });
};

/**
 * Один печатный символ.
 * keyboard.press принимает имена клавиш и падает на кириллице: Unknown key: "В".
 */
const keyboardPressChar = async (page, char) => {
  await page.keyboard.type(char);
  await waitAfterEvent();
};

/**
 * Посимвольный ввод с опечатками и паузами (только события клавиатуры)
 */
const humanTypeChars = async (page, text, timeouts) => {
  const delayMin = timeouts?.typingDelayMin || 30;
  const delayMax = timeouts?.typingDelayMax || 90;
  for (const char of text) {
    // 2% шанс опечатки с исправлением через Backspace
    if (Math.random() < 0.02 && char !== ' ') {
      const incorrectChar = String.fromCharCode(
        char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1)
      );
      await keyboardPressChar(page, incorrectChar);
      await wait(Math.floor(Math.random() * 80) + 50);
      await page.keyboard.press('Backspace');
      await waitAfterEvent();
      await wait(Math.floor(Math.random() * 80) + 50);
    }
    await keyboardPressChar(page, char);
    const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    if (Math.random() < 0.04) await wait(Math.floor(Math.random() * 200) + 150);
    await wait(delay);
  }
};
exports.humanTypeChars = humanTypeChars;

/**
 * Эмуляция человеческого ввода: фокус (опционально) + humanTypeChars
 * @param {object} [options] skipFocus — поле уже в фокусе (после humanClick)
 */
const humanType = async (page, selector, text, timeouts, options = {}) => {
  try {
    const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
    const exists = (await element.count()) > 0;
    if (!exists)
      throw new SelectorError(
        typeof selector === 'string' ? selector : 'Locator',
        'Element for typing not found'
      );

    if (!options.skipFocus) {
      const focused = await element
        .evaluate((el) => el === document.activeElement)
        .catch(() => false);
      if (!focused) await element.focus();
    }

    await humanTypeChars(page, text, timeouts);
  } catch (e) {
    if (e instanceof SelectorError) throw e;
    throw new AppError(`Typing failed: ${e.message}`, {
      selector: typeof selector === 'string' ? selector : 'Locator',
    });
  }
};
exports.humanType = humanType;
exports.keyboardPressChar = keyboardPressChar;

/**
 * Генерирует массив точек для кубической кривой Безье
 */
const getBezierPoints = (p0, p1, p2, p3, steps = 30) => {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x =
      Math.pow(1 - t, 3) * p0.x +
      3 * Math.pow(1 - t, 2) * t * p1.x +
      3 * (1 - t) * Math.pow(t, 2) * p2.x +
      Math.pow(t, 3) * p3.x;
    const y =
      Math.pow(1 - t, 3) * p0.y +
      3 * Math.pow(1 - t, 2) * t * p1.y +
      3 * (1 - t) * Math.pow(t, 2) * p2.y +
      Math.pow(t, 3) * p3.y;
    points.push({ x, y });
  }
  return points;
};
exports.getBezierPoints = getBezierPoints;

/**
 * Быстрое дерганное движение мыши: рывки, микропаузa и занос за цель.
 */
const humanMove = async (page, targetX, targetY, options = {}) => {
  try {
    const startPos = mouseTracker.get(page) || {
      x: 100 + Math.random() * 400,
      y: 100 + Math.random() * 400,
    };
    const startX = options.startX || startPos.x;
    const startY = options.startY || startPos.y;
    const distance = Math.hypot(targetX - startX, targetY - startY);
    const steps = options.steps || Math.max(5, Math.min(14, Math.round(distance / 90)));
    const overshootDistance = Math.min(28, Math.max(8, distance * (0.04 + Math.random() * 0.08)));
    const directionX = distance > 0 ? (targetX - startX) / distance : 0;
    const directionY = distance > 0 ? (targetY - startY) / distance : 0;
    const side = Math.random() > 0.5 ? 1 : -1;
    const overshootX = targetX + directionX * overshootDistance - directionY * side * (4 + Math.random() * 8);
    const overshootY = targetY + directionY * overshootDistance + directionX * side * (4 + Math.random() * 8);

    // Контрольные точки для кривой Безье
    const p1 = {
      x: startX + (targetX - startX) * (0.18 + Math.random() * 0.25) + (Math.random() - 0.5) * 90,
      y: startY + (targetY - startY) * (0.18 + Math.random() * 0.25) + (Math.random() - 0.5) * 90,
    };
    const p2 = {
      x: startX + (targetX - startX) * (0.65 + Math.random() * 0.25) + (Math.random() - 0.5) * 70,
      y: startY + (targetY - startY) * (0.65 + Math.random() * 0.25) + (Math.random() - 0.5) * 70,
    };

    const points = getBezierPoints(
      { x: startX, y: startY },
      p1,
      p2,
      { x: overshootX, y: overshootY },
      steps
    );

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // Дрожание крупнее в начале и почти исчезает у цели.
      const progress = i / Math.max(1, points.length - 1);
      const jitter = 9 * (1 - progress) + 1.5;
      const jitterX = (Math.random() - 0.5) * jitter;
      const jitterY = (Math.random() - 0.5) * jitter;

      // Пропуски дают резкие скачки вместо идеально гладкой траектории.
      if (Math.random() > 0.18 || progress > 0.75) {
        const nextX = point.x + jitterX;
        const nextY = point.y + jitterY;
        await page.mouse.move(nextX, nextY);
        await waitAfterEvent();
        await updateVisualCursor(page, nextX, nextY);
      }

      if (Math.random() > 0.72) await wait(8 + Math.random() * 28);
    }

    await wait(18 + Math.random() * 45);
    await page.mouse.move(targetX + (Math.random() - 0.5) * 3, targetY + (Math.random() - 0.5) * 3);
    await waitAfterEvent();
    await updateVisualCursor(page, targetX, targetY);
    await wait(12 + Math.random() * 24);
    await page.mouse.move(targetX, targetY);
    await waitAfterEvent();
    await updateVisualCursor(page, targetX, targetY);
    mouseTracker.set(page, { x: targetX, y: targetY });
  } catch (e) {
    // Fallback or ignore for movement
    await page.mouse.move(targetX, targetY).catch(() => { });
    await waitAfterEvent();
    await updateVisualCursor(page, targetX, targetY);
    mouseTracker.set(page, { x: targetX, y: targetY });
  }
};
exports.humanMove = humanMove;
exports.humanMouseMove = humanMove;

/**
 * Эмуляция наведения мыши
 */
const humanHover = async (page, selector) => {
  try {
    const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
    const box = await element.boundingBox();
    if (box) {
      const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
      const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

      await humanMove(page, targetX, targetY);
      await wait(500 + Math.random() * 1000);
    } else {
      throw new SelectorError(
        typeof selector === 'string' ? selector : 'Locator',
        'Bounding box not found for hover'
      );
    }
  } catch (e) {
    if (e instanceof SelectorError) throw e;
    throw new AppError(`Hover failed: ${e.message}`, {
      selector: typeof selector === 'string' ? selector : 'Locator',
    });
  }
};
exports.humanHover = humanHover;

/** Случайная точка внутри bbox — preferEdge смещает клик к краям, не в центр */
const getClickPoint = (box, preferEdge = false) => {
  let xRatio;
  let yRatio;
  if (preferEdge) {
    const useLeft = Math.random() < 0.5;
    xRatio = useLeft ? 0.08 + Math.random() * 0.22 : 0.7 + Math.random() * 0.22;
    yRatio = 0.12 + Math.random() * 0.76;
  } else {
    xRatio = 0.3 + Math.random() * 0.4;
    yRatio = 0.3 + Math.random() * 0.4;
  }
  return { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio };
};

/**
 * Эмуляция человеческого клика
 */
const humanClick = async (page, selectorOrHandle, options = {}) => {
  const { preferEdge = false, ...clickOptions } = options;
  try {
    const element =
      typeof selectorOrHandle === 'string'
        ? page.locator(selectorOrHandle).first()
        : selectorOrHandle;
    const box = await element.boundingBox();
    if (box) {
      const { x: targetX, y: targetY } = getClickPoint(box, preferEdge);

      await humanMove(page, targetX, targetY);
      await wait(100 + Math.random() * 200);
      await page.mouse.click(targetX, targetY, clickOptions);
      await waitAfterEvent();
    } else {
      const count = await element.count();
      if (count > 0) {
        await element.click(options);
        await waitAfterEvent();
      } else {
        throw new SelectorError(
          typeof selectorOrHandle === 'string' ? selectorOrHandle : 'Locator',
          'Element for click not found'
        );
      }
    }
  } catch (e) {
    if (e instanceof SelectorError) throw e;
    throw new AppError(`Click failed: ${e.message}`, {
      selector: typeof selectorOrHandle === 'string' ? selectorOrHandle : 'Locator',
    });
  }
};
exports.humanClick = humanClick;
/**
 * Режим "Раздумье" (длительная пауза)
 */
const daydream = async (chance = 0.05) => {
  if (Math.random() < chance) {
    const delay = 15000 + Math.random() * 25000;
    console.log(`👤 [HUMAN] Задумался на ${Math.round(delay / 1000)}с...`);
    await (0, exports.wait)(delay);
  }
};
exports.daydream = daydream;
/**
 * Плавный скролл через JS ивенты
 */
const humanScroll = async (page, selector, direction = 'down', amount = 300) => {
  try {
    const steps = 10 + Math.floor(Math.random() * 10);
    const delta = direction === 'down' ? amount / steps : -(amount / steps);

    for (let i = 0; i < steps; i++) {
      const ease = 1 - Math.pow(1 - i / steps, 2); // Quadratic ease out
      const stepDelta = delta * (1 + (Math.random() - 0.5) * 0.2); // Random variation

      await page.mouse.wheel(0, stepDelta);
      await (0, exports.wait)(30 + Math.random() * 40);
    }
  } catch (e) {
    // Fallback to JS scroll
    await page.evaluate(
      ({ dir, amt }) => {
        window.scrollBy({ top: dir === 'down' ? amt : -amt, behavior: 'smooth' });
      },
      { dir: direction, amt: amount }
    );
  }
};
exports.humanScroll = humanScroll;

/**
 * Плавный скролл к верху страницы (колёсико мыши, с паузами)
 */
const humanScrollToTop = async (page) => {
  try {
    let scrollY = await page.evaluate(() => window.scrollY);
    if (scrollY < 80) {
      await (0, exports.wait)(120 + Math.random() * 180);
      return;
    }

    let steps = 0;
    while (scrollY > 60 && steps < 30) {
      const chunk = Math.min(scrollY, 100 + Math.random() * 260);
      await humanScroll(page, null, 'up', chunk);
      await (0, exports.wait)(70 + Math.random() * 110);
      if (Math.random() < 0.12) {
        await (0, exports.wait)(180 + Math.random() * 350);
      }
      scrollY = await page.evaluate(() => window.scrollY);
      steps++;
    }

    if (scrollY > 15) {
      await humanScroll(page, null, 'up', scrollY);
      await (0, exports.wait)(120 + Math.random() * 200);
    }
  } catch (e) {
    await page
      .evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      .catch(() => {});
    await (0, exports.wait)(450 + Math.random() * 350);
  }
};
exports.humanScrollToTop = humanScrollToTop;

/**
 * Возврат к началу страницы перед кликами по header.
 */
const scrollToTop = async (page) => {
  try {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await waitAfterEvent();
  } catch (e) {
    await page.keyboard.press('Home').catch(() => {});
    await waitAfterEvent();
  }
};
exports.scrollToTop = scrollToTop;

/** Прокручивает элемент в центр viewport перед кликом */
const scrollIntoView = async (locator, behavior = 'instant') => {
  if (!locator) return false;
  try {
    await locator.evaluate((el, scrollBehavior) => {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: scrollBehavior });
    }, behavior);
    await waitAfterEvent();
    await wait(behavior === 'smooth' ? 280 + Math.random() * 220 : 80 + Math.random() * 120);
    return true;
  } catch {
    return false;
  }
};
exports.scrollIntoView = scrollIntoView;

/**
 * Оверскролл: проскроллить дальше, а потом немного вернуться
 */
const humanOverscroll = async (page, direction = 'down', amount = 300) => {
  try {
    const overshoot = amount * (1.2 + Math.random() * 0.5); // 20-70% overscroll
    await humanScroll(page, null, direction, overshoot);
    await wait(200 + Math.random() * 500);
    await humanScroll(page, null, direction === 'down' ? 'up' : 'down', overshoot - amount);
  } catch (e) { }
};
exports.humanOverscroll = humanOverscroll;

/**
 * Мышка покидает экран (потеря фокуса)
 */
const humanMouseLeave = async (page) => {
  try {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const targetX = Math.random() > 0.5 ? -10 : viewport.width + 10;
    const targetY = Math.random() * viewport.height;
    await humanMove(page, targetX, targetY);
    console.log(`👤 [HUMAN] Mouse left the viewport (simulating distraction).`);
    await wait(800 + Math.random() * 1200); // пауза «отвлёкся»
    mouseTracker.set(page, {
      x: Math.max(0, Math.min(targetX, viewport.width)),
      y: Math.max(0, Math.min(targetY, viewport.height)),
    });
  } catch (e) { }
};
exports.humanMouseLeave = humanMouseLeave;

/**
 * Выделение текста на странице рандомно
 */
const humanSelection = async (page) => {
  try {
    const paragraphs = await page.$$('p, span, h1, h2, h3, li');
    if (paragraphs.length > 0) {
      const p = paragraphs[Math.floor(Math.random() * paragraphs.length)];
      const isVisible = await p.isVisible();
      if (!isVisible) return;
      const box = await p.boundingBox();
      if (box && box.height > 10 && box.width > 20) {
        const startX = box.x + box.width * Math.random();
        const startY = box.y + box.height * Math.random();
        await humanMove(page, startX, startY);
        // Double click behavior vs drag
        if (Math.random() > 0.5) {
          await page.mouse.click(startX, startY, { clickCount: 2 });
          await waitAfterEvent();
          console.log(`👤 [HUMAN] Double clicked random text.`);
        } else {
          await page.mouse.down();
          await wait(100 + Math.random() * 200);
          await humanMove(
            page,
            startX + (Math.random() * 80 - 40),
            startY + (Math.random() * 20 - 10)
          ); // drag
          await page.mouse.up();
          console.log(`👤 [HUMAN] Selected random text by dragging.`);
        }
        await wait(1000 + Math.random() * 3000);
      }
    }
  } catch (e) { }
};
exports.humanSelection = humanSelection;
const { execSync } = require('child_process');
const getScreenResolution = () => {
  try {
    if (process.platform === 'win32') {
      // Use Windows Forms to get logical screen bounds (accounts for Scaling)
      const output = execSync(
        'powershell "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"'
      ).toString();
      const lines = output.trim().split(/\r?\n/);
      if (lines.length >= 2) {
        const width = parseInt(lines[0]);
        const height = parseInt(lines[1]);
        if (!isNaN(width) && !isNaN(height)) {
          return { width, height };
        }
      }
    }
  } catch (e) { }
  // Fallback to a common logical resolution
  return { width: 1920, height: 1300 };
};
exports.getScreenResolution = getScreenResolution;
