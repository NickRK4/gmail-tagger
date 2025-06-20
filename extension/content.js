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
        // Get thread ID using the helper function
        const threadId = getThreadIdFromOpenEmail();
        if (!threadId) {
            console.error('Could not find thread ID');
            return null;
        }
        
        // Get email body and subject
        const emailBody = document.querySelector('.a3s.aiL');
        const subject = document.querySelector('h2.hP') || document.querySelector('h2[data-thread-perm-id]');
        
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

// Apply a label to the currently open email
async function applyLabel(labelName) {
    try {
        console.log('Starting label application for:', labelName);
        
        // Get email content which includes thread ID
        const emailContent = getEmailContent();
        if (!emailContent || !emailContent.threadId) {
            throw new Error('Could not get thread ID from email');
        }
        
        // Use the common function to apply the label
        const result = await applyLabelToEmail(emailContent.threadId, labelName);
        
        // Refresh the UI to show the new label
        setTimeout(() => {
            refreshGmailUI();
        }, 500); // Small delay to ensure the label is applied before refreshing
        
        return result;
    } catch (error) {
        console.error('Error in applyLabel:', error);
        throw error;
    }
}

// Function to predict and apply label to an email
async function predictAndApplyLabel(emailContent) {
    try {
        if (!emailContent || !emailContent.body) {
            console.error('No valid email content to predict');
            return { status: 'error', message: 'No valid email content' };
        }
        
        // Call prediction API
        const response = await fetch('http://localhost:5050/predict', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                text: emailContent.body 
            })
        });
        
        if (!response.ok) {
            console.error('Error from prediction API:', response.status);
            return { status: 'error', message: `API error: ${response.status}` };
        }
        
        const prediction = await response.json();
        
        // Only apply label if confidence is above threshold
        if (prediction.confidence && prediction.confidence >= 0.7) {
            console.log(`Applying label ${prediction.label} with confidence ${prediction.confidence}`);
            
            // Apply the label
            const result = await applyLabelToEmail(emailContent.threadId, prediction.label);
            return { status: 'labeled', label: prediction.label, confidence: prediction.confidence, ...result };
        } else {
            console.log(`Skipping label application due to low confidence: ${prediction.confidence}`);
            return { status: 'skipped', reason: 'low_confidence', confidence: prediction.confidence };
        }
        
    } catch (error) {
        console.error('Error predicting or applying label:', error);
        return { status: 'error', message: error.message };
    }
}

// Function to get all visible emails in the inbox
function getAllVisibleEmails(selectedOnly = false) {
    const emails = [];
    try {
        // Try different selectors for different Gmail views
        let emailRows = document.querySelectorAll([
            // Inbox view
            'div[role="main"] div[role="list"] div[role="listitem"]',
            // Other views
            'table.F tr.zA',
            // Conversation view
            'div.adn.ads'
        ].join(', '));
        
        // If we only want selected emails, filter for those with the selected attribute or class
        if (selectedOnly) {
            console.log('Looking for selected emails...');
            
            // First try Gmail's checkbox selection system
            const checkboxes = document.querySelectorAll('div[role="checkbox"][aria-checked="true"]');
            if (checkboxes.length > 0) {
                console.log(`Found ${checkboxes.length} selected checkboxes`);
                
                // For each selected checkbox, find the parent email row
                const selectedRows = [];
                checkboxes.forEach(checkbox => {
                    // Navigate up to find the listitem (modern Gmail) or row (older Gmail)
                    let parent = checkbox.parentElement;
                    while (parent && 
                          !parent.matches('div[role="listitem"]') && 
                          !parent.matches('tr.zA') &&
                          parent !== document.body) {
                        parent = parent.parentElement;
                    }
                    
                    if (parent && (parent.matches('div[role="listitem"]') || parent.matches('tr.zA'))) {
                        selectedRows.push(parent);
                        console.log('Found selected row:', parent);
                    }
                });
                
                if (selectedRows.length > 0) {
                    emailRows = selectedRows;
                }
            } else {
                // Fallback to other selection indicators
                emailRows = Array.from(emailRows).filter(row => {
                    // Check for various indicators of selection in Gmail
                    const isSelected = (
                        row.getAttribute('aria-selected') === 'true' || // Modern Gmail
                        row.classList.contains('x7') || // Some Gmail views
                        row.querySelector('input[type="checkbox"]:checked') !== null || // Checkbox selected
                        row.hasAttribute('selected') || // Legacy attribute
                        row.classList.contains('aps') || // Another selection class
                        row.getAttribute('data-selected') === 'true' // Data attribute
                    );
                    
                    if (isSelected) {
                        console.log('Found selected row with class:', row.className);
                    }
                    
                    return isSelected;
                });
            }
        }
        
        console.log(`Found ${emailRows.length} email rows${selectedOnly ? ' (selected)' : ''}`);
        
        // Process only up to 50 emails
        const maxEmails = Math.min(emailRows.length, 50);
        
        for (let i = 0; i < maxEmails; i++) {
            const row = emailRows[i];
            
            // Try to get thread ID first - check for data attribute
            let threadId = row.getAttribute('data-thread-perm-id') || row.getAttribute('data-thread-id');
            
            // If no thread ID found, try to find it in links or other attributes
            if (!threadId) {
                // Look for links with thread IDs in the URL
                const links = row.querySelectorAll('a[href*="#inbox/"], a[href*="#all/"], a[href*="#sent/"], a[href*="#trash/"], a[href*="#spam/"]');
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
                
                // Try to find thread ID in data attributes of child elements
                if (!threadId) {
                    const elements = row.querySelectorAll('[data-legacy-thread-id], [data-thread-id]');
                    for (const el of elements) {
                        threadId = el.getAttribute('data-legacy-thread-id') || el.getAttribute('data-thread-id');
                        if (threadId) break;
                    }
                }
            }
            
            // Use a fallback ID if none found
            if (!threadId) {
                threadId = 'email_' + i;
                console.log('Using fallback ID for email', i);
            }
            
            // Get the email subject and any visible content
            let subject = '';
            let snippet = '';
            
            // Try multiple selectors for subject
            const subjectSelectors = ['.y6', '.bog', '.bqe', '.y2', 'span[data-thread-id]', 'span.bA4', 'span.bqf'];
            for (const selector of subjectSelectors) {
                const el = row.querySelector(selector);
                if (el) {
                    subject = el.textContent.trim();
                    break;
                }
            }
            
            // Try multiple selectors for snippet
            const snippetSelectors = ['.y2', '.yX', '.xY', '.xW', '.a4W', 'span.bx4'];
            for (const selector of snippetSelectors) {
                const el = row.querySelector(selector);
                if (el) {
                    snippet = el.textContent.trim();
                    break;
                }
            }
            
            // If no specific content found, use the entire row content
            const content = (subject || snippet) ? 
                `${subject}\n${snippet}` : row.textContent.trim();
            
            emails.push({
                threadId,
                content
            });
        }
        
        console.log(`Processed ${emails.length} emails for classification${selectedOnly ? ' (selected)' : ''}`);
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
    // Check if this is a tr element with data-thread-id
    if (element.tagName === 'TR' && element.hasAttribute('data-thread-id')) {
        return true;
    }
    
    // Check if this is a div with role='main' (new Gmail UI)
    if (element.tagName === 'DIV' && element.getAttribute('role') === 'main') {
        return true;
    }
    
    // Check for any elements with thread ID inside
    return element.querySelector('[data-thread-perm-id]') !== null;
}

// Listen for new emails and classify them
const observer = new MutationObserver((mutations) => {
    // We'll only process new emails when explicitly requested by the user
    // through the extension popup, as per user preferences
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && isNewEmail(node)) {
                const threadId = node.getAttribute('data-thread-id');
                if (threadId && !processedEmails.has(threadId)) {
                    processedEmails.add(threadId);
                    console.log('New email detected, thread ID:', threadId);
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
        // Get only selected emails for batch training
        const emails = getAllVisibleEmails(true);
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
    let labelAppliedCount = 0;
    
    try {
        // Get authentication token once for all emails
        const token = await getGmailToken();
        if (!token) {
            throw new Error('Could not get authentication token');
        }
        
        // Find or create the label once for all emails
        const labelId = await findOrCreateLabel(token, label);
        console.log('Got label ID for batch training:', labelId);
        
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
                    
                    // Use the content we already have from the list view
                    // This avoids the need to navigate to each email
                    if (!email.content) {
                        console.error('No content found for email');
                        continue;
                    }
                    
                    const emailContent = {
                        subject: email.content.split('\n')[0] || '',
                        body: email.content.split('\n').slice(1).join('\n') || '',
                        threadId: threadId
                    };
                    
                    // Train the model with this email
                    const trainResult = await trainModel(emailContent, label);
                    
                    if (trainResult.success) {
                        successCount++;
                        
                        // Apply the label to the thread
                        try {
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
                            
                            if (applyResponse.ok) {
                                labelAppliedCount++;
                                console.log(`Applied label to thread ${threadId}`);
                            } else {
                                const error = await applyResponse.json();
                                console.error('Error applying label to thread:', error);
                            }
                        } catch (labelError) {
                            console.error('Error applying label during batch training:', labelError);
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
        
        // Refresh the UI to show the new labels
        setTimeout(() => {
            refreshGmailUI();
        }, 500);
        
    } catch (error) {
        console.error('Error in batch training process:', error);
    }
    
    // Notify completion
    chrome.runtime.sendMessage({ 
        action: 'batchTrainingComplete', 
        processed: processed,
        successCount: successCount,
        labelAppliedCount: labelAppliedCount
    });
    
    console.log(`Batch training complete. ${successCount} of ${emails.length} emails trained successfully. ${labelAppliedCount} labels applied.`);
}

// Helper function to get email content from a thread ID
async function getEmailContentFromThreadId(threadId) {
    try {
        // Check if we're already on the thread
        const currentThreadId = getThreadIdFromOpenEmail();
        if (currentThreadId === threadId) {
            return getEmailContent();
        }
        
        // Extract what we can from the email list view
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
                        threadId: threadId,
                        snippetOnly: true
                    };
                }
            }
        }
        
        console.log('Cannot get content of unopened email in batch mode');
        return null;
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