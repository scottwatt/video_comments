chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const url = tab.url;
  
  let platform = 'Not a supported site';
  if (url.includes('netflix.com')) platform = 'Netflix';
  else if (url.includes('disneyplus.com')) platform = 'Disney+';
  else if (url.includes('hulu.com')) platform = 'Hulu';
  
  document.getElementById('current-page').textContent = platform;
});

// Toggle extension enabled/disabled
const toggleBtn = document.getElementById('toggle-extension');

chrome.storage.local.get(['enabled'], (result) => {
  const enabled = result.enabled !== false;
  updateToggleButton(enabled);
});

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['enabled'], (result) => {
    const enabled = result.enabled !== false;
    const newState = !enabled;
    
    chrome.storage.local.set({ enabled: newState });
    updateToggleButton(newState);
    
    // Reload active tab to apply changes
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.reload(tabs[0].id);
    });
  });
});

function updateToggleButton(enabled) {
  if (enabled) {
    toggleBtn.textContent = 'Extension Enabled';
    toggleBtn.classList.remove('disabled');
    document.getElementById('status').textContent = 'Active ✓';
  } else {
    toggleBtn.textContent = 'Extension Disabled';
    toggleBtn.classList.add('disabled');
    document.getElementById('status').textContent = 'Disabled ✕';
  }
}