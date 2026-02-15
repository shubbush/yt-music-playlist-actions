function setStatus(text) {
  const status = document.getElementById('status');
  status.textContent = text;
}

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id;
}

async function sendAction(action) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    setStatus('No active tab found.');
    return;
  }

  try {
    const response = await browser.tabs.sendMessage(tabId, { type: action });
    setStatus(response?.message || 'Command sent.');
  } catch (err) {
    setStatus('Unable to reach page script. Open YouTube Music first.');
  }
}

document.getElementById('like-all').addEventListener('click', () => sendAction('START_LIKE_ALL'));
document.getElementById('unlike-all').addEventListener('click', () => sendAction('START_UNLIKE_ALL'));
document.getElementById('stop').addEventListener('click', () => sendAction('STOP'));

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'STATUS') {
    setStatus(msg.text);
  }
});
