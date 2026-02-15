let activeRunToken = 0;

const WAIT_ACTION_BASE_MS = 550;
const WAIT_SCROLL_BASE_MS = 700;
const WAIT_SCROLL_MAX_MS = 2600;
const MAX_SCROLL_ROUNDS = 2400;
const STABLE_ROUNDS_TO_STOP = 6;
const PROGRESS_EVERY = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcastStatus(text) {
  browser.runtime.sendMessage({ type: 'STATUS', text }).catch(() => {
    // Popup may be closed; ignore.
  });
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
  if (container) {
    const scrollParent = container.closest('#contents, ytmusic-section-list-renderer, ytmusic-app-layout, #content');
    if (scrollParent) {
      return scrollParent;
    }
  }

  return document.scrollingElement || document.documentElement || document.body;
}

function getExpectedTrackCount() {
  const candidates = [
    ...document.querySelectorAll('ytmusic-detail-header-renderer .subtitle, ytmusic-detail-header-renderer #subtitle'),
    ...document.querySelectorAll('yt-formatted-string.subtitle, ytmusic-description-shelf-renderer')
  ];

  for (const node of candidates) {
    const text = (node.textContent || '').trim();
    if (!text) {
      continue;
    }

    const songMatch = text.match(/([\d,.\s]+)\s*(songs?|tracks?)/i);
    if (songMatch) {
      const value = parseInt(songMatch[1].replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
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
  const scroller = getScrollableContainer();
  const expectedCount = getExpectedTrackCount();
  let stableRounds = 0;
  let noGrowthRounds = 0;
  let lastCount = 0;
  let lastHeight = -1;

  broadcastStatus(
    expectedCount
      ? `Loading all songs (auto-scrolling). Target from header: ${expectedCount}...`
      : 'Loading all songs (auto-scrolling)...'
  );

  for (let round = 1; round <= MAX_SCROLL_ROUNDS; round += 1) {
    if (runToken !== activeRunToken) {
      throw new Error('Stopped');
    }

    const count = getSongRows().length;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });

    const waitMs = getAdaptiveScrollDelay(noGrowthRounds);
    await sleep(waitMs);

    const newCount = getSongRows().length;
    const newHeight = scroller.scrollHeight;
    const hasGrowth = newCount > count || newHeight > lastHeight;

    noGrowthRounds = hasGrowth ? 0 : noGrowthRounds + 1;

    const unchanged = newCount === count && newCount === lastCount && newHeight === lastHeight;
    stableRounds = unchanged ? stableRounds + 1 : 0;

    lastCount = newCount;
    lastHeight = newHeight;

    if (round % 10 === 0) {
      broadcastStatus(
        expectedCount
          ? `Loading songs... ${newCount}/${expectedCount} loaded (wait ${waitMs}ms).`
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
      scroller.scrollBy({ top: -Math.max(200, Math.floor(scroller.clientHeight * 0.5)), behavior: 'auto' });
      await sleep(220);
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
    }
  }

  const total = getSongRows().length;

  if (expectedCount && total < expectedCount) {
    broadcastStatus(`Loading stopped at ${total}/${expectedCount}. YouTube may still be throttling lazy-load; run can continue.`);
  } else {
    broadcastStatus(`Loading complete. Found ${total} playlist/album rows.`);
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

  broadcastStatus(
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
      broadcastStatus(
        `${mode === 'like' ? 'Like' : 'Unlike'} progress: ${i + 1}/${total}` +
        `\nChanged: ${changed}, Skipped: ${skipped}` +
        (expectedCount ? `\nLoaded from page: ${loadedCount}/${expectedCount}` : '')
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

  if (msg.type === 'STOP') {
    activeRunToken += 1;
    const message = 'Stop requested. Current run will halt.';
    broadcastStatus(message);
    return Promise.resolve({ message });
  }

  if (msg.type === 'START_LIKE_ALL' || msg.type === 'START_UNLIKE_ALL') {
    activeRunToken += 1;
    const runToken = activeRunToken;
    const mode = msg.type === 'START_LIKE_ALL' ? 'like' : 'unlike';

    return applyToAllSongs(mode, runToken)
      .then((result) => {
        broadcastStatus(result.message);
        return result;
      })
      .catch((err) => {
        const message = err?.message === 'Stopped'
          ? 'Run stopped.'
          : `Failed: ${err?.message || String(err)}`;
        broadcastStatus(message);
        return { message };
      });
  }

  return undefined;
});
