const MAX_LOG_LINES = 300;
const logLines = ['Idle'];

function getTimeLabel() {
  return new Date().toLocaleTimeString();
}

function renderLog() {
  const status = document.getElementById('status');
  status.textContent = logLines.join('\n');
  status.scrollTop = status.scrollHeight;
}

function appendStatus(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return;
  }

  logLines.push(`[${getTimeLabel()}] ${normalized}`);
  if (logLines.length > MAX_LOG_LINES) {
    logLines.splice(0, logLines.length - MAX_LOG_LINES);
  }

  renderLog();
}

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id;
}

async function sendAction(action) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    appendStatus('No active tab found.');
    return;
  }

  try {
    const response = await browser.tabs.sendMessage(tabId, { type: action });
    appendStatus(response?.message || 'Command sent.');
  } catch (err) {
    appendStatus('Unable to reach page script. Open YouTube Music first.');
  }
}

document.getElementById('like-all').addEventListener('click', () => sendAction('START_LIKE_ALL'));
document.getElementById('unlike-all').addEventListener('click', () => sendAction('START_UNLIKE_ALL'));
document.getElementById('stop').addEventListener('click', () => sendAction('STOP'));

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'STATUS') {
    appendStatus(msg.text);
  }
});

renderLog();
