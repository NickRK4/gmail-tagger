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

// Function to get all visible emails in the inbox
function getAllVisibleEmails() {
    const emails = [];
    try {
        // Try different selectors for different Gmail views
        const emailRows = document.querySelectorAll([
            // Inbox view
            'div[role="main"] div[role="list"] div[role="listitem"]',
            // Other views
            'table.F tr.zA',
            // Conversation view
            'div.adn.ads'
        ].join(', '));
        
        console.log(`Found ${emailRows.length} email rows`);
        
        // Process only up to 50 emails
        const maxEmails = Math.min(emailRows.length, 50);
        
        for (let i = 0; i < maxEmails; i++) {
            const row = emailRows[i];
            
            // Try to get thread ID first - check for data attribute
            let threadId = row.getAttribute('data-thread-perm-id');
            
            // If no thread ID found, try to find it in links or other attributes
            if (!threadId) {
                // Look for links with thread IDs in the URL
                const links = row.querySelectorAll('a[href*="#inbox/"]');
                for (const link of links) {
                    const match = link.href.match(/[/#](?:inbox|all|sent|trash|spam)\/([a-zA-Z0-9]+)/);
                    if (match && match[1]) {
                        threadId = match[1];
                        break;
                    }
                }
                
                // If still no thread ID, try to get from other links
                if (!threadId) {
                    const allLinks = row.querySelectorAll('a');
                    for (const link of allLinks) {
                        const match = link.href.match(/\/([a-zA-Z0-9]+)$/);
                        if (match && match[1] && match[1].length > 10) {
                            threadId = match[1];
                            break;
                        }
                    }
                }
            }
            
            // Use a fallback ID if none found
            if (!threadId) {
                threadId = 'email_' + i;
                console.log('Using fallback ID for email', i);
            }
            
            // Get the email subject and any visible content
            const subject = row.querySelector('.y6, .bog') ? 
                       row.querySelector('.y6, .bog').textContent.trim() : '';
                       
            const snippet = row.querySelector('.y2, .yX') ? 
                       row.querySelector('.y2, .yX').textContent.trim() : '';
            
            // If no specific content found, use the entire row content
            const content = (subject || snippet) ? 
                `${subject}\n${snippet}` : row.textContent.trim();
            
            emails.push({
                threadId,
                content
            });
        }
        
        console.log(`Processed ${emails.length} emails for classification`);
    } catch (error) {
        console.error('Error getting visible emails:', error);
    }
    
    return emails;
}

// Function to apply a label to a specific thread ID
async function applyLabelToEmail(threadId, labelName) {
    try {
        // Get authentication token
        const token = await getGmailToken();
        
        // Find or create the label
        const labelId = await findOrCreateLabel(token, labelName);
        
        // Apply label to specific thread
        const applyResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                addLabelIds: [labelId]
            })
        });
        
        if (!applyResponse.ok) {
            const error = await applyResponse.json();
            console.error('Error applying label to thread:', error);
            throw new Error(`Failed to apply label: ${error.error?.message || 'Unknown error'}`);
        }
        
        return true;
    } catch (error) {
        console.error('Error in applyLabelToEmail:', error);
        throw error;
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
    } else if (request.action === 'getAllVisibleEmails') {
        const emails = getAllVisibleEmails();
        sendResponse({ emails });
    } else if (request.action === 'applyLabelToEmail') {
        applyLabelToEmail(request.threadId, request.label)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    } else if (request.action === 'batchTrain') {
        const emails = getAllVisibleEmails();
        if (emails && emails.length > 0) {
            batchTrainEmails(emails, request.label, request.batchSize || 5);
            sendResponse({ 
                status: 'started', 
                totalEmails: emails.length 
            });
        } else {
            sendResponse({ 
                status: 'error', 
                error: 'No emails selected for batch training' 
            });
        }
    } else if (request.action === 'ping') {
        sendResponse({ pong: true });
    }
});

// Send a message to the background script to confirm content script is loaded
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' }, (response) => {
    console.log('Content script loaded confirmation sent');
});

// Batch train multiple emails with the same label
async function batchTrainEmails(emails, label, batchSize) {
    console.log(`Starting batch training of ${emails.length} emails with label: ${label}`);
    
    let processed = 0;
    let successCount = 0;
    
    // Process emails in batches to avoid overwhelming the server
    for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        
        // Process each email in the batch
        for (const email of batch) {
            try {
                // Get the thread ID
                const threadId = email.threadId;
                if (!threadId) {
                    console.error('No thread ID found for email');
                    continue;
                }
                
                // Get email content
                const emailContent = await getEmailContentFromThreadId(threadId);
                if (!emailContent || !emailContent.subject) {
                    console.error('Could not get email content');
                    continue;
                }
                
                // Train the model with this email
                const trainResult = await trainModel(emailContent, label);
                
                if (trainResult.success) {
                    successCount++;
                    
                    // Apply the label using Gmail API
                    try {
                        await applyLabel(threadId, label);
                    } catch (labelError) {
                        console.error('Error applying label:', labelError);
                    }
                }
            } catch (error) {
                console.error('Error processing email for batch training:', error);
            }
            
            // Update progress
            processed++;
            chrome.runtime.sendMessage({ 
                action: 'batchTrainingUpdate', 
                processed: processed 
            });
        }
        
        // Short delay between batches to prevent overloading
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Notify completion
    chrome.runtime.sendMessage({ 
        action: 'batchTrainingComplete', 
        processed: processed,
        successCount: successCount
    });
    
    console.log(`Batch training complete. ${successCount} of ${emails.length} emails trained successfully.`);
}

// Helper function to get email content from a thread ID
async function getEmailContentFromThreadId(threadId) {
    try {
        // Navigate to thread if not already open
        const currentThreadId = getThreadIdFromOpenEmail();
        
        if (currentThreadId !== threadId) {
            // This is a simplification - in a real implementation, 
            // you would need to either:
            // 1. Fetch content via Gmail API without navigation, or
            // 2. Use a more sophisticated approach to extract content from the DOM
            console.log('Cannot get content of unopened email in batch mode');
            
            // For now, we'll extract what we can from the email list view
            const emailRows = document.querySelectorAll('tr.zA');
            for (const row of emailRows) {
                const rowThreadId = row.getAttribute('data-thread-id');
                if (rowThreadId === threadId) {
                    // Extract subject from the row
                    const subjectEl = row.querySelector('.y6');
                    const bodyPreviewEl = row.querySelector('.y2');
                    
                    if (subjectEl && bodyPreviewEl) {
                        return {
                            subject: subjectEl.innerText || '',
                            body: bodyPreviewEl.innerText || '',
                            snippetOnly: true
                        };
                    }
                }
            }
            
            return null;
        }
        
        // If we're already on the thread, get the content normally
        return getEmailContent();
    } catch (error) {
        console.error('Error getting email content from thread ID:', error);
        return null;
    }
}

// Helper function to get the thread ID from the URL of an open email
function getThreadIdFromOpenEmail() {
    try {
        // Extract thread ID from URL
        const urlMatch = window.location.href.match(/[/#](?:inbox|all|sent|trash|spam)\/([a-zA-Z0-9]+)/);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1];
        }
        
        // Fallback: try to get from DOM
        const threadIdElement = document.querySelector('h2[data-thread-perm-id]');
        if (threadIdElement) {
            return threadIdElement.getAttribute('data-thread-perm-id');
        }
        
        console.error('Could not find thread ID in URL or DOM');
        return null;
    } catch (error) {
        console.error('Error getting thread ID from open email:', error);
        return null;
    }
}

// Function to train the model with email content and a label
async function trainModel(emailContent, label) {
    try {
        if (!emailContent || !emailContent.subject) {
            console.error('Invalid email content for training');
            return { success: false, error: 'Invalid email content' };
        }
        
        console.log(`Training model with label: ${label}`);
        
        // Combine subject and body for training
        const text = `${emailContent.subject}\n${emailContent.body}`;
        
        // Call the server to train the model
        const response = await fetch('http://localhost:5050/train', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                label: label
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Training error:', error);
            return { 
                success: false, 
                error: error.error || 'Failed to train model' 
            };
        }
        
        const result = await response.json();
        console.log('Training result:', result);
        
        return { 
            success: true, 
            result: result 
        };
    } catch (error) {
        console.error('Error in trainModel:', error);
        return { 
            success: false, 
            error: error.message 
        };
    }
}