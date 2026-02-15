let activeRunToken = 0;

const WAIT_SHORT_MS = 300;
const WAIT_SCROLL_MS = 700;
const MAX_SCROLL_ROUNDS = 1200;
const STABLE_ROUNDS_TO_STOP = 5;
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

function getSongRows() {
  return Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer'))
    .filter((row) => row.querySelector('a[href*="watch?"]') || row.querySelector('yt-formatted-string.title'));
}

function getScrollableContainer() {
  const candidates = [
    document.querySelector('ytmusic-app-layout #content'),
    document.querySelector('ytmusic-app-layout'),
    document.querySelector('#contents'),
    document.scrollingElement,
    document.documentElement,
    document.body
  ].filter(Boolean);

  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 50) {
      return el;
    }
  }

  return document.scrollingElement || document.documentElement || document.body;
}

function getLikeButton(row) {
  return row.querySelector(
    'ytmusic-like-button-renderer button[aria-label*="like" i], ytmusic-like-button-renderer #button-shape-like button, button[title*="Like" i]'
  );
}

function getDislikeButton(row) {
  return row.querySelector(
    'ytmusic-like-button-renderer button[aria-label*="dislike" i], ytmusic-like-button-renderer #button-shape-dislike button, button[title*="Dislike" i]'
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

async function loadAllSongs(runToken) {
  const scroller = getScrollableContainer();
  let stableRounds = 0;
  let lastCount = 0;
  let lastHeight = -1;

  broadcastStatus('Loading all songs (auto-scrolling)...');

  for (let round = 1; round <= MAX_SCROLL_ROUNDS; round += 1) {
    if (runToken !== activeRunToken) {
      throw new Error('Stopped');
    }

    const count = getSongRows().length;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
    await sleep(WAIT_SCROLL_MS);

    const newCount = getSongRows().length;
    const newHeight = scroller.scrollHeight;

    const unchanged = newCount === count && newCount === lastCount && newHeight === lastHeight;
    stableRounds = unchanged ? stableRounds + 1 : 0;

    lastCount = newCount;
    lastHeight = newHeight;

    if (round % 15 === 0) {
      broadcastStatus(`Loading songs... found ${newCount} rows so far.`);
    }

    if (stableRounds >= STABLE_ROUNDS_TO_STOP) {
      break;
    }
  }

  const total = getSongRows().length;
  broadcastStatus(`Loading complete. Found ${total} rows.`);
  return total;
}

async function applyToAllSongs(mode, runToken) {
  if (!isTargetPage()) {
    return { message: 'Open a YouTube Music playlist or album page first.' };
  }

  await loadAllSongs(runToken);

  const rows = getSongRows();
  const total = rows.length;

  if (!total) {
    return { message: 'No songs found on this page.' };
  }

  let changed = 0;
  let skipped = 0;

  broadcastStatus(`Starting ${mode} for ${total} songs...`);

  for (let i = 0; i < total; i += 1) {
    if (runToken !== activeRunToken) {
      throw new Error('Stopped');
    }

    const row = rows[i];
    const likeBtn = getLikeButton(row);
    const dislikeBtn = getDislikeButton(row);

    const targetBtn = mode === 'like' ? likeBtn : dislikeBtn;
    const alreadyApplied = isButtonActive(targetBtn);

    if (targetBtn && !alreadyApplied) {
      targetBtn.click();
      changed += 1;
      await sleep(WAIT_SHORT_MS);
    } else {
      skipped += 1;
    }

    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === total) {
      broadcastStatus(
        `${mode === 'like' ? 'Like' : 'Dislike'} progress: ${i + 1}/${total}\nChanged: ${changed}, Skipped: ${skipped}`
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

  if (msg.type === 'START_LIKE_ALL' || msg.type === 'START_DISLIKE_ALL') {
    activeRunToken += 1;
    const runToken = activeRunToken;
    const mode = msg.type === 'START_LIKE_ALL' ? 'like' : 'dislike';

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
