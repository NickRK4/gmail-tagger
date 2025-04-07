// Log when content script is loaded
console.log('Gmail Label Classifier content script loaded');

function getEmailContent() {
    try {
        // Gmail specific selectors to get email content
        const emailBody = document.querySelector('.a3s.aiL');
        const subject = document.querySelector('h2.hP');
        
        if (!emailBody && !subject) {
            return null;
        }
        
        return {
            body: emailBody ? emailBody.innerText : '',
            subject: subject ? subject.innerText : ''
        };
    } catch (error) {
        console.error('Error getting email content:', error);
        return null;
    }
}

async function getGmailToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, function(token) {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            resolve(token);
        });
    });
}

async function createLabel(token, labelName) {
    try {
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: labelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Error creating label:', error);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('Error creating label:', error);
        return null;
    }
}

async function getMessageId() {
    // Get the current URL
    const url = window.location.href;
    const match = url.match(/\#inbox\/([^\/]+)/);
    if (match && match[1]) {
        return match[1];
    }
    return null;
}

async function applyLabel(label) {
    try {
        console.log('Starting label application for:', label);
        
        // Get auth token
        const token = await getGmailToken();
        if (!token) {
            throw new Error('Could not get authentication token');
        }

        // Get message ID
        const messageId = await getMessageId();
        if (!messageId) {
            throw new Error('Could not get message ID');
        }

        // First try to create the label (if it doesn't exist, this will create it)
        const labelData = await createLabel(token, label);
        const labelId = labelData ? labelData.id : null;

        if (!labelId) {
            // If creation failed, try to find existing label
            const labelsResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const labels = await labelsResponse.json();
            const existingLabel = labels.labels.find(l => l.name === label);
            if (!existingLabel) {
                throw new Error('Could not create or find label');
            }
            labelId = existingLabel.id;
        }

        // Apply the label to the message
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                addLabelIds: [labelId]
            })
        });

        if (!response.ok) {
            throw new Error('Failed to apply label');
        }

        console.log('Successfully applied label:', label);
        return true;
    } catch (error) {
        console.error('Error in applyLabel:', error);
        return false;
    }
}

// Keep track of processed emails to avoid duplicates
const processedEmails = new Set();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received in content script:', request);
    
    // Respond to ping to check if content script is loaded
    if (request.action === 'ping') {
        sendResponse({ pong: true });
        return true;
    }
    
    if (request.action === 'getEmailContent') {
        const content = getEmailContent();
        console.log('Email content retrieved:', content);
        sendResponse(content);
        return true;
    }
    
    if (request.action === 'applyLabel') {
        console.log('Applying label from popup:', request.label);
        applyLabel(request.label)
            .then(() => {
                console.log('Label applied successfully');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('Error applying label:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Important: return true to indicate async response
    }
    
    return true; // Required for async response
});

// Listen for new emails and classify them
const observer = new MutationObserver(() => {
    try {
        const emailData = getEmailContent();
        if (!emailData) return;
        
        // Create a unique identifier for the email
        const emailId = `${emailData.subject}-${emailData.body.substring(0, 50)}`;
        
        // Skip if we've already processed this email
        if (processedEmails.has(emailId)) return;
        processedEmails.add(emailId);
        
        // Combine subject and body for better classification
        const fullText = `${emailData.subject}\n${emailData.body}`;
        
        console.log('Sending email for classification:', {
            subject: emailData.subject,
            bodyPreview: emailData.body.substring(0, 100) + '...'
        });
        
        fetch('http://localhost:5050/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: fullText })
        })
        .then(response => {
            console.log('Classification response status:', response.status);
            if (!response.ok) {
                return response.json().then(errorData => {
                    throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Classification result:', data);
            if (data.label) {
                console.log('Applying label:', data.label);
                return applyLabel(data.label);
            } else {
                console.log('No label to apply:', data.message || 'No confident prediction');
            }
        })
        .catch(error => {
            console.error('Error in email classification:', error.message);
        });
    } catch (error) {
        console.error('Error in observer:', error);
    }
});

// Start observing changes in Gmail
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Clean up old processed emails periodically
setInterval(() => {
    if (processedEmails.size > 1000) {
        processedEmails.clear();
    }
}, 3600000); // Clean up every hour

// Send a message to the background script to confirm content script is loaded
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' }, (response) => {
    console.log('Content script loaded confirmation sent');
});