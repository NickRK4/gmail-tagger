// Background script for Gmail Label Classifier

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'contentScriptLoaded') {
    console.log('Content script loaded in tab:', sender.tab.id);
    sendResponse({ status: 'acknowledged' });
  }
  return true;
});

// Log when the background script is loaded
console.log('Gmail Label Classifier background script loaded');
