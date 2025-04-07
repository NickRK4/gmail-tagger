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

function applyLabel(label) {
    return new Promise((resolve, reject) => {
        try {
            // Use Gmail's keyboard shortcuts to apply label
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'l',
                ctrlKey: true
            }));
            
            setTimeout(() => {
                const labelInput = document.querySelector('input[role="combobox"]');
                if (labelInput) {
                    labelInput.value = label;
                    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    setTimeout(() => {
                        // Press Enter to apply the label
                        labelInput.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            bubbles: true
                        }));
                        resolve();
                    }, 500);
                } else {
                    reject(new Error('Label input not found'));
                }
            }, 500);
        } catch (error) {
            reject(error);
        }
    });
}

// Keep track of processed emails to avoid duplicates
const processedEmails = new Set();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received in content script:', request);
    if (request.action === 'getEmailContent') {
        const content = getEmailContent();
        console.log('Email content retrieved:', content);
        sendResponse(content);
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
        
        fetch('http://localhost:5050/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: fullText })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.label) {
                return applyLabel(data.label);
            }
        })
        .catch(error => {
            console.error('Error in email classification:', error);
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