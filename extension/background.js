// Background script for Gmail Label Classifier

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'contentScriptLoaded') {
    console.log('Content script loaded in tab:', sender.tab.id);
    sendResponse({ status: 'acknowledged' });
  }
  return true;
});

// Handle auth token requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAuthToken') {
        chrome.identity.getAuthToken({ 'interactive': true }, function(token) {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError });
                return;
            }
            sendResponse({ token });
        });
        return true; // Will respond asynchronously
    }
});

// Log when the background script is loaded
console.log('Gmail Label Classifier background script loaded');
