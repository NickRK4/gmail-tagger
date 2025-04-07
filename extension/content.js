// Log when content script is loaded
console.log('Gmail Label Classifier content script loaded');

async function getGmailToken() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getAuthToken' }, response => {
            if (response.error) {
                reject(new Error(response.error.message));
                return;
            }
            resolve(response.token);
        });
    });
}

function getEmailContent() {
    try {
        // Try to get thread ID first
        const threadIdElement = document.querySelector('h2[data-thread-perm-id]');
        const threadId = threadIdElement ? threadIdElement.getAttribute('data-thread-perm-id') : null;
        
        if (!threadId) {
            // Try getting from URL
            const urlMatch = window.location.href.match(/[/#](?:inbox|all|sent|trash|spam)\/([a-zA-Z0-9]+)/);
            if (!urlMatch || !urlMatch[1]) {
                console.error('Could not find thread ID');
                return null;
            }
            threadId = urlMatch[1];
        }
        
        // Get email body and subject
        const emailBody = document.querySelector('.a3s.aiL');
        const subject = threadIdElement || document.querySelector('h2.hP');
        
        console.log('Found thread ID:', threadId);
        
        return {
            body: emailBody ? emailBody.innerText : '',
            subject: subject ? subject.innerText : '',
            threadId: threadId
        };
    } catch (error) {
        console.error('Error getting email content:', error);
        return null;
    }
}

async function findOrCreateLabel(token, labelName) {
    try {
        console.log('Finding or creating label:', labelName);
        
        // First try to find the label
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to fetch labels:', error);
            throw new Error(`Failed to fetch labels: ${error.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        const existingLabel = data.labels.find(l => l.name === labelName);
        
        if (existingLabel) {
            console.log('Found existing label:', existingLabel);
            return existingLabel.id;
        }
        
        // If label doesn't exist, create it
        const createResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: labelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
                type: 'user'
            })
        });
        
        if (!createResponse.ok) {
            const error = await createResponse.json();
            console.error('Error creating label:', error);
            throw new Error(`Failed to create label: ${error.error?.message || 'Unknown error'}`);
        }
        
        const newLabel = await createResponse.json();
        console.log('Created new label:', newLabel);
        return newLabel.id;
    } catch (error) {
        console.error('Error in findOrCreateLabel:', error);
        throw error;
    }
}

async function refreshGmailUI() {
    // Find the refresh button in Gmail's UI
    const refreshButton = document.querySelector('button[aria-label="Refresh"]');
    if (refreshButton) {
        refreshButton.click();
        return true;
    }
    
    // Fallback: Try to find the refresh button by its icon
    const buttons = Array.from(document.querySelectorAll('button'));
    const refreshIconButton = buttons.find(button => 
        button.innerHTML.includes('refresh') || 
        button.querySelector('div[aria-label="Refresh"]')
    );
    
    if (refreshIconButton) {
        refreshIconButton.click();
        return true;
    }
    
    return false;
}

async function applyLabel(labelName) {
    try {
        console.log('Starting label application for:', labelName);
        
        // Get email content which includes thread ID
        const emailContent = getEmailContent();
        if (!emailContent || !emailContent.threadId) {
            throw new Error('Could not get thread ID from email');
        }
        
        // Get auth token
        const token = await getGmailToken();
        if (!token) {
            throw new Error('Could not get authentication token');
        }
        
        console.log('Got thread ID:', emailContent.threadId);
        
        // Get or create label
        const labelId = await findOrCreateLabel(token, labelName);
        console.log('Got label ID:', labelId);
        
        // Apply label to thread using the correct endpoint
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${emailContent.threadId}/modify`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                addLabelIds: [labelId],
                removeLabelIds: []
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Error applying label. Status:', response.status);
            console.error('Error details:', error);
            throw new Error(`Failed to apply label: ${error.error?.message || 'Unknown error'}`);
        }
        
        const result = await response.json();
        console.log('Successfully applied label, response:', result);
        
        // Refresh the UI to show the new label
        setTimeout(() => {
            refreshGmailUI();
        }, 500); // Small delay to ensure the label is applied before refreshing
        
        return true;
    } catch (error) {
        console.error('Error in applyLabel:', error);
        throw error;
    }
}

// Function to predict and apply label for new emails
async function predictAndApplyLabel(emailContent) {
    try {
        if (!emailContent || !emailContent.body) {
            console.log('No email content to predict');
            return;
        }

        // Call the prediction endpoint
        const response = await fetch('http://localhost:5050/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: emailContent.body
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get prediction');
        }

        const prediction = await response.json();
        if (prediction && prediction.label) {
            console.log('Predicted label:', prediction.label);
            await applyLabel(prediction.label);
        }
    } catch (error) {
        console.error('Error in predictAndApplyLabel:', error);
    }
}

// Keep track of processed emails to avoid duplicates
const processedEmails = new Set();

// Function to check if an element is a new email
function isNewEmail(element) {
    return (
        element.matches('div[role="main"] div[role="list"] div[role="listitem"]') ||
        element.matches('.adn.ads')
    );
}

// Listen for new emails and classify them
const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if this is a new email
                if (isNewEmail(node)) {
                    // Get thread ID to avoid processing the same email twice
                    const threadId = node.querySelector('[data-thread-perm-id]')?.getAttribute('data-thread-perm-id');
                    if (threadId && !processedEmails.has(threadId)) {
                        processedEmails.add(threadId);
                        
                        // Get email content and predict label
                        const emailContent = {
                            body: node.textContent,
                            threadId: threadId
                        };
                        
                        console.log('New email detected, predicting label...');
                        predictAndApplyLabel(emailContent);
                    }
                }
            }
        });
    });
});

// Start observing changes in the Gmail interface
function startObserving() {
    const config = { childList: true, subtree: true };
    const targetNode = document.body;
    observer.observe(targetNode, config);
    console.log('Started observing for new emails');
}

// Initialize observation when the script loads
startObserving();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getEmailContent') {
        const content = getEmailContent();
        sendResponse(content);
    } else if (request.action === 'applyLabel') {
        applyLabel(request.label)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    } else if (request.action === 'ping') {
        sendResponse({ pong: true });
    }
});

// Send a message to the background script to confirm content script is loaded
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' }, (response) => {
    console.log('Content script loaded confirmation sent');
});