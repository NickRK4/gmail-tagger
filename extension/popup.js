document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('status');
    const trainBtn = document.getElementById('train-btn');
    const trainToggleBtn = document.getElementById('train-toggle-btn');
    const applyBtn = document.getElementById('apply-btn');
    const labelInput = document.getElementById('label-input');
    const checkServerBtn = document.getElementById('check-server');
    const trainingSection = document.getElementById('training-section');
    const processingIndicator = document.getElementById('processing-indicator');
    const progressCount = document.getElementById('progress-count');
    const totalCount = document.getElementById('total-count');
    const openGmailBtn = document.createElement('button');
    
    openGmailBtn.textContent = 'Open Gmail';
    openGmailBtn.className = 'btn';
    openGmailBtn.style.marginTop = '10px';
    openGmailBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://mail.google.com' });
    });

    function showStatus(message, isError = false) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + (isError ? 'error' : 'success');
        
        // Show Gmail button if we're not on Gmail
        if (isError && message.includes('navigate to Gmail')) {
            statusDiv.appendChild(document.createElement('br'));
            statusDiv.appendChild(openGmailBtn);
        }
    }

    async function getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }

    async function checkIfContentScriptLoaded(tabId) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            return response && response.pong;
        } catch (error) {
            return false;
        }
    }

    async function getEmailContent() {
        try {
            const tab = await getCurrentTab();
            
            // Check if we're on Gmail
            if (!tab.url || !tab.url.includes('mail.google.com')) {
                throw new Error('Please navigate to Gmail to use this extension');
            }

            // Try to get email content first
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getEmailContent' });
                if (response) {
                    return response;
                }
            } catch (error) {
                // Content script not loaded, continue to injection
            }

            // Inject content script
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                
                // Wait a bit for the script to initialize
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Try getting email content again
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getEmailContent' });
                if (response) {
                    return response;
                }
                throw new Error('No email content found');
            } catch (error) {
                if (error.message.includes('Cannot access contents of url')) {
                    throw new Error('Please refresh the Gmail page to use the extension');
                }
                throw error;
            }
        } catch (error) {
            throw error;
        }
    }

    // Function to get all visible emails in inbox
    async function getAllVisibleEmails(tabId) {
        return new Promise(async (resolve, reject) => {
            try {
                const isLoaded = await checkIfContentScriptLoaded(tabId);
                
                if (!isLoaded) {
                    // Inject content script if not loaded
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        files: ['content.js']
                    });
                    
                    // Wait for script to initialize
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                chrome.tabs.sendMessage(tabId, { action: 'getAllVisibleEmails' }, response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response && response.emails) {
                        resolve(response.emails);
                    } else {
                        reject(new Error('Failed to get emails'));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // Function to process emails in batches
    async function processEmails(tabId, emails) {
        const batchSize = 5;
        let processedCount = 0;
        const results = {
            labeled: 0,
            skipped: 0,
            failed: 0
        };

        progressCount.textContent = processedCount;
        totalCount.textContent = emails.length;
        processingIndicator.style.display = 'block';

        for (let i = 0; i < emails.length; i += batchSize) {
            const batch = emails.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (email) => {
                try {
                    // Skip if no content
                    if (!email.content || !email.content.trim()) {
                        results.skipped++;
                        return;
                    }
                    
                    // Call prediction API
                    const response = await fetch('http://localhost:5050/predict', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ 
                            text: email.content 
                        })
                    });
                    
                    if (response.ok) {
                        const prediction = await response.json();
                        
                        // Only apply label if confidence is above 80%
                        if (prediction.confidence && prediction.confidence >= 0.8) {
                            // Apply the label
                            await chrome.tabs.sendMessage(tabId, { 
                                action: 'applyLabelToEmail', 
                                threadId: email.threadId,
                                label: prediction.label 
                            });
                            results.labeled++;
                        } else {
                            results.skipped++;
                        }
                    } else {
                        results.failed++;
                    }
                } catch (error) {
                    console.error('Error processing email:', error);
                    results.failed++;
                }
                
                // Update progress
                processedCount++;
                progressCount.textContent = processedCount;
            }));
            
            // Short delay between batches to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        return results;
    }

    // Check server status
    checkServerBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('http://localhost:5050/predict', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: 'test' })
            });
            
            if (response.ok) {
                showStatus('Server is running');
            } else {
                showStatus('Server error: ' + response.statusText, true);
            }
        } catch (error) {
            showStatus('Cannot connect to server. Is it running?', true);
        }
    });

    // Toggle training section when Train button is clicked
    trainToggleBtn.addEventListener('click', () => {
        trainToggleBtn.classList.toggle('active');
        
        if (trainingSection.style.display === 'none' || !trainingSection.style.display) {
            trainingSection.style.display = 'block';
            trainingSection.style.animation = 'slideDown 0.3s ease';
        } else {
            // First add a slide up animation, then hide the element
            trainingSection.style.animation = 'slideDown 0.3s ease reverse';
            setTimeout(() => {
                trainingSection.style.display = 'none';
            }, 280); // Slightly less than animation duration
        }
    });

    // Apply button - process all visible emails
    applyBtn.addEventListener('click', async () => {
        try {
            const tab = await getCurrentTab();
            
            // Check if we're on Gmail
            if (!tab.url || !tab.url.includes('mail.google.com')) {
                throw new Error('Please navigate to Gmail to use this extension');
            }
            
            showStatus('Fetching emails...');
            processingIndicator.style.display = 'block';
            
            try {
                const emails = await getAllVisibleEmails(tab.id);
                
                if (!emails || emails.length === 0) {
                    throw new Error('No emails found in the current view');
                }
                
                showStatus(`Processing ${emails.length} emails...`);
                const results = await processEmails(tab.id, emails);
                
                // Hide processing indicator
                processingIndicator.style.display = 'none';
                
                // Show summary of results
                showStatus(`Done! ${results.labeled} labeled, ${results.skipped} skipped (low confidence), ${results.failed} failed`);
            } catch (error) {
                processingIndicator.style.display = 'none';
                throw error;
            }
        } catch (error) {
            showStatus('Error: ' + error.message, true);
            processingIndicator.style.display = 'none';
        }
    });

    // Train model with current email
    trainBtn.addEventListener('click', async () => {
        const label = labelInput.value.trim();
        if (!label) {
            showStatus('Please enter a label', true);
            return;
        }

        try {
            const emailContent = await getEmailContent();
            if (!emailContent) {
                showStatus('No email content found', true);
                return;
            }

            const response = await fetch('http://localhost:5050/train', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: `${emailContent.subject}\n${emailContent.body}`,
                    label: label
                })
            });

            if (response.ok) {
                // After successful training, also apply the label
                try {
                    const tab = await getCurrentTab();
                    // Send message to apply the label
                    await chrome.tabs.sendMessage(tab.id, { 
                        action: 'applyLabel', 
                        label: label 
                    });
                    showStatus(`Successfully trained model and applied label: ${label}`);
                } catch (labelError) {
                    console.error('Error applying label:', labelError);
                    showStatus(`Model trained but couldn't apply label: ${labelError.message}`, true);
                }
                
                labelInput.value = '';
            } else {
                const error = await response.json();
                showStatus('Training failed: ' + (error.error || response.statusText), true);
            }
        } catch (error) {
            showStatus('Error: ' + error.message, true);
        }
    });

    // Check server status on popup open
    checkServerBtn.click();
});