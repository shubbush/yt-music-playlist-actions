let activeRunToken = 0;

const WAIT_ACTION_BASE_MS = 550;
const WAIT_SCROLL_BASE_MS = 700;
const WAIT_SCROLL_MAX_MS = 2600;
const MAX_SCROLL_ROUNDS = 2400;
const STABLE_ROUNDS_TO_STOP = 6;
const PROGRESS_EVERY = 20;
const MAX_LOG_LINES = 500;

let runLogLines = ['Idle'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimeLabel() {
  return new Date().toLocaleTimeString();
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }

  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function appendLog(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return;
  }

  const line = `[${getTimeLabel()}] ${normalized}`;
  runLogLines.push(line);
  if (runLogLines.length > MAX_LOG_LINES) {
    runLogLines.splice(0, runLogLines.length - MAX_LOG_LINES);
  }

  browser.runtime.sendMessage({ type: 'STATUS', text: line }).catch(() => {
    // Popup may be closed; ignore.
  });
}

function resetRunLogs(startMessage) {
  runLogLines = [];
  appendLog(startMessage || 'New job started.');
}

function isTargetPage() {
  return location.hostname === 'music.youtube.com' && (
    location.pathname.includes('/playlist') ||
    location.pathname.includes('/browse') ||
    location.pathname.includes('/watch')
  );
}

function getTracklistContainer() {
  const selectors = [
    'ytmusic-browse-response ytmusic-two-column-browse-results-renderer #primary ytmusic-playlist-shelf-renderer #contents',
    'ytmusic-browse-response ytmusic-two-column-browse-results-renderer #primary ytmusic-section-list-renderer > #contents',
    'ytmusic-tab-renderer ytmusic-playlist-shelf-renderer #contents',
    'ytmusic-playlist-shelf-renderer #contents'
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (candidate?.querySelector('ytmusic-responsive-list-item-renderer')) {
      return candidate;
    }
  }

  return null;
}

function getSongRows() {
  const container = getTracklistContainer();
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll(':scope > ytmusic-responsive-list-item-renderer'))
    .filter((row) => row.querySelector('a[href*="watch?"]'));
}

function getScrollableContainer() {
  const container = getTracklistContainer();
  const candidates = [];

  if (container) {
    const fromClosest = container.closest('#contents, ytmusic-section-list-renderer, ytmusic-tab-renderer, ytmusic-app-layout, #content');
    if (fromClosest) {
      candidates.push(fromClosest);
    }
  }

  candidates.push(
    document.querySelector('ytmusic-app-layout #content'),
    document.querySelector('ytmusic-app-layout'),
    document.scrollingElement,
    document.documentElement,
    document.body
  );

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const canScroll = candidate.scrollHeight > candidate.clientHeight + 80;
    if (canScroll) {
      return candidate;
    }
  }

  return document.scrollingElement || document.documentElement || document.body;
}

function normalizeCount(raw) {
  const value = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractTrackCountMatches(text) {
  const matches = [];
  const re = /([\d][\d,.\s]*)\s*(songs?|tracks?)\b/gi;
  let match = re.exec(text);

  while (match) {
    const value = normalizeCount(match[1]);
    if (value) {
      matches.push(value);
    }
    match = re.exec(text);
  }

  return matches;
}

function extractLooseCountFromSubtitle(text) {
  const firstChunk = text.split(/[•·|]/)[0] || text;
  const firstNumber = firstChunk.match(/([\d][\d,.\s]*)/);
  if (!firstNumber) {
    return null;
  }

  return normalizeCount(firstNumber[1]);
}

function getExpectedTrackCount() {
  const currentLoaded = getSongRows().length;

  const preciseSelector = [
    'ytmusic-detail-header-renderer yt-formatted-string#second-subtitle',
    'ytmusic-detail-header-renderer yt-formatted-string.second-subtitle',
    'ytmusic-detail-header-renderer #second-subtitle',
    'ytmusic-responsive-header-renderer yt-formatted-string#second-subtitle',
    'ytmusic-responsive-header-renderer yt-formatted-string.second-subtitle'
  ].join(', ');

  const fallbackSubtitleSelector = [
    'ytmusic-detail-header-renderer yt-formatted-string#subtitle',
    'ytmusic-detail-header-renderer yt-formatted-string.subtitle',
    'ytmusic-responsive-header-renderer yt-formatted-string#subtitle',
    'ytmusic-responsive-header-renderer yt-formatted-string.subtitle'
  ].join(', ');

  const nodes = [
    ...Array.from(document.querySelectorAll(preciseSelector)),
    ...Array.from(document.querySelectorAll(fallbackSubtitleSelector))
  ];

  const explicit = [];
  const loose = [];

  for (const node of nodes) {
    const content = [
      node.textContent || '',
      node.getAttribute('aria-label') || ''
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' • ');

    if (!content) {
      continue;
    }

    explicit.push(...extractTrackCountMatches(content));

    const looseValue = extractLooseCountFromSubtitle(content);
    if (looseValue) {
      loose.push(looseValue);
    }
  }

  const filteredExplicit = explicit.filter((value) => value >= Math.max(1, currentLoaded));
  if (filteredExplicit.length) {
    return Math.max(...filteredExplicit);
  }

  const filteredLoose = loose.filter((value) => value >= Math.max(20, currentLoaded));
  if (filteredLoose.length) {
    return Math.max(...filteredLoose);
  }

  return null;
}

function getLikeButton(row) {
  return row.querySelector(
    'ytmusic-like-button-renderer button[aria-label*="like" i], ytmusic-like-button-renderer #button-shape-like button, button[title*="Like" i]'
  );
}

function isButtonActive(button) {
  if (!button) {
    return false;
  }

  const ariaPressed = button.getAttribute('aria-pressed');
  if (ariaPressed === 'true') {
    return true;
  }

  if (button.classList.contains('style-default-active')) {
    return true;
  }

  const parent = button.closest('ytmusic-toggle-button-renderer, ytmusic-like-button-renderer');
  return !!parent?.hasAttribute('is-toggled');
}

function getAdaptiveScrollDelay(noGrowthRounds) {
  const stepped = WAIT_SCROLL_BASE_MS * Math.pow(1.25, Math.min(noGrowthRounds, 7));
  return Math.min(Math.round(stepped), WAIT_SCROLL_MAX_MS);
}

function getAdaptiveActionDelay(changedCount) {
  const tier = Math.floor(changedCount / 120);
  const stepped = WAIT_ACTION_BASE_MS * Math.pow(1.18, Math.min(tier, 7));
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(Math.round(stepped) + jitter, 2200);
}

async function loadAllSongs(runToken) {
  const expectedCount = getExpectedTrackCount();
  const loadStartMs = Date.now();
  let stableRounds = 0;
  let noGrowthRounds = 0;
  let stallRescueAttempts = 0;
  let lastCount = 0;
  let lastHeight = -1;

  appendLog(
    expectedCount
      ? `Expected tracks from playlist header: ${expectedCount}.`
      : 'Expected tracks from playlist header: unknown (header count not found).'
  );
  await sleep(180);

  appendLog(
    expectedCount
      ? `Loading all songs (auto-scrolling). Target from header: ${expectedCount}...`
      : 'Loading all songs (auto-scrolling)...'
  );

  for (let round = 1; round <= MAX_SCROLL_ROUNDS; round += 1) {
    if (runToken !== activeRunToken) {
      throw new Error('Stopped');
    }

    const scroller = getScrollableContainer();
    const count = getSongRows().length;
    const beforeHeight = scroller.scrollHeight;

    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });

    const rowsBefore = getSongRows();
    const lastRow = rowsBefore[rowsBefore.length - 1];
    if (lastRow) {
      lastRow.scrollIntoView({ behavior: 'auto', block: 'end' });
    }

    const waitMs = getAdaptiveScrollDelay(noGrowthRounds);
    await sleep(waitMs);

    const newCount = getSongRows().length;
    const newHeight = scroller.scrollHeight;
    const hasGrowth = newCount > count || newHeight > Math.max(lastHeight, beforeHeight);

    noGrowthRounds = hasGrowth ? 0 : noGrowthRounds + 1;

    const unchanged = newCount === count && newCount === lastCount && newHeight === lastHeight;
    stableRounds = unchanged ? stableRounds + 1 : 0;

    lastCount = newCount;
    lastHeight = newHeight;

    if (round % 10 === 0 || (noGrowthRounds >= 4 && round % 3 === 0)) {
      const elapsedMs = Date.now() - loadStartMs;
      const eta = expectedCount && newCount > 0
        ? formatEta(((expectedCount - newCount) / (newCount / Math.max(1, elapsedMs))))
        : null;

      appendLog(
        expectedCount
          ? `Loading songs... ${newCount}/${expectedCount} loaded (wait ${waitMs}ms${eta ? `, ETA ${eta}` : ''}).`
          : `Loading songs... found ${newCount} rows so far (wait ${waitMs}ms).`
      );
    }

    if (expectedCount && newCount >= expectedCount) {
      break;
    }

    if (!expectedCount && stableRounds >= STABLE_ROUNDS_TO_STOP) {
      break;
    }

    if (expectedCount && stableRounds >= STABLE_ROUNDS_TO_STOP && newCount >= expectedCount - 2) {
      break;
    }

    if (noGrowthRounds >= 4) {
      stallRescueAttempts += 1;

      scroller.scrollBy({ top: -Math.max(220, Math.floor(scroller.clientHeight * 0.7)), behavior: 'auto' });
      await sleep(260);
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });

      const pageScroller = document.scrollingElement || document.documentElement || document.body;
      if (pageScroller && pageScroller !== scroller) {
        pageScroller.scrollTo({ top: pageScroller.scrollHeight, behavior: 'auto' });
      }

      if (stallRescueAttempts % 3 === 0) {
        appendLog('Still stalled while loading; trying alternate scroll rescue...');
      }
    }
  }

  const total = getSongRows().length;

  if (expectedCount && total < expectedCount) {
    appendLog(`Loading stopped at ${total}/${expectedCount}. YouTube may still be throttling lazy-load; run can continue.`);
  } else {
    appendLog(`Loading complete. Found ${total} playlist/album rows.`);
  }

  return { total, expectedCount };
}

async function applyToAllSongs(mode, runToken) {
  if (!isTargetPage()) {
    return { message: 'Open a YouTube Music playlist or album page first.' };
  }

  const container = getTracklistContainer();
  if (!container) {
    return { message: 'Could not detect the main playlist/album track list on this page.' };
  }

  const { total: loadedCount, expectedCount } = await loadAllSongs(runToken);

  const rows = getSongRows();
  const total = rows.length;

  if (!total) {
    return { message: 'No songs found in the main playlist/album track list.' };
  }

  let changed = 0;
  let skipped = 0;

  const processFromBottom = mode === 'like';
  const orderedRows = processFromBottom ? [...rows].reverse() : rows;
  const actionStartMs = Date.now();

  appendLog(
    `Starting ${mode} for ${total} songs (${processFromBottom ? 'bottom-to-top' : 'top-to-bottom'})...`
  );

  for (let i = 0; i < total; i += 1) {
    if (runToken !== activeRunToken) {
      throw new Error('Stopped');
    }

    const row = orderedRows[i];
    const likeBtn = getLikeButton(row);

    if (!likeBtn) {
      skipped += 1;
      continue;
    }

    const liked = isButtonActive(likeBtn);
    const shouldClick = mode === 'like' ? !liked : liked;

    if (shouldClick) {
      likeBtn.click();
      changed += 1;
      await sleep(getAdaptiveActionDelay(changed));
    } else {
      skipped += 1;
    }

    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === total) {
      const processed = i + 1;
      const elapsedMs = Date.now() - actionStartMs;
      const eta = processed > 0
        ? formatEta(((total - processed) / (processed / Math.max(1, elapsedMs))))
        : null;

      appendLog(
        `${mode === 'like' ? 'Like' : 'Unlike'} progress: ${processed}/${total}` +
        `\nChanged: ${changed}, Skipped: ${skipped}` +
        (expectedCount ? `\nLoaded from page: ${loadedCount}/${expectedCount}` : '') +
        (eta ? `\nETA remaining: ${eta}` : '')
      );
      await sleep(120);
    }
  }

  return {
    message: `Done. Processed ${total} songs. Changed: ${changed}, skipped: ${skipped}.`
  };
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg?.type) {
    return undefined;
  }

  if (msg.type === 'GET_LOGS') {
    return Promise.resolve({ logs: runLogLines });
  }

  if (msg.type === 'STOP') {
    activeRunToken += 1;
    const message = 'Stop requested. Current run will halt.';
    appendLog(message);
    return Promise.resolve({ message });
  }

  if (msg.type === 'START_LIKE_ALL' || msg.type === 'START_UNLIKE_ALL') {
    activeRunToken += 1;
    const runToken = activeRunToken;
    const mode = msg.type === 'START_LIKE_ALL' ? 'like' : 'unlike';

    resetRunLogs(`New job started: ${mode === 'like' ? 'Like all songs' : 'Remove likes'}.`);

    return applyToAllSongs(mode, runToken)
      .then((result) => {
        appendLog(result.message);
        return result;
      })
      .catch((err) => {
        const message = err?.message === 'Stopped'
          ? 'Run stopped.'
          : `Failed: ${err?.message || String(err)}`;
        appendLog(message);
        return { message };
      });
  }

  return undefined;
});
