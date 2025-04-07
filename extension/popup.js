document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('status');
    const trainBtn = document.getElementById('train-btn');
    const applyBtn = document.getElementById('apply-btn');
    const labelInput = document.getElementById('label-input');
    const checkServerBtn = document.getElementById('check-server');
    const trainingSection = document.getElementById('training-section');
    const processingIndicator = document.getElementById('processing-indicator');
    const progressCount = document.getElementById('progress-count');
    const totalCount = document.getElementById('total-count');
    const testBtn = document.getElementById('test-btn');
    const testInput = document.getElementById('test-input');
    const testResult = document.getElementById('test-result');
    const predictionLabel = document.getElementById('prediction-label');
    const predictionConfidence = document.getElementById('prediction-confidence');
    const resetModelBtn = document.getElementById('reset-model-btn');
    // New elements for batch training
    const batchTrainBtn = document.getElementById('batch-train-btn');
    const batchLabelInput = document.getElementById('batch-label-input');
    const batchTrainingSection = document.getElementById('batch-training-section');
    const batchProcessingIndicator = document.getElementById('batch-processing-indicator');
    const batchProgressCount = document.getElementById('batch-progress-count');
    const batchTotalCount = document.getElementById('batch-total-count');
    const batchResults = document.getElementById('batch-results');
    const batchSuccessCount = document.getElementById('batch-success-count');
    const applySection = document.getElementById('apply-section');
    const testSection = document.getElementById('test-section');
    
    // Menu buttons
    const applyMenuBtn = document.getElementById('apply-menu-btn');
    const trainMenuBtn = document.getElementById('train-menu-btn');
    const batchMenuBtn = document.getElementById('batch-menu-btn');
    const testMenuBtn = document.getElementById('test-menu-btn');
    
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

    // Hide all sections function
    function hideAllSections() {
        trainingSection.style.display = 'none';
        batchTrainingSection.style.display = 'none';
        testSection.style.display = 'none';
        applySection.style.display = 'none';
        testResult.style.display = 'none';
        
        // Reset active state on all menu buttons
        applyMenuBtn.classList.remove('active');
        trainMenuBtn.classList.remove('active');
        batchMenuBtn.classList.remove('active');
        testMenuBtn.classList.remove('active');
    }
    
    // Apply menu button
    applyMenuBtn.addEventListener('click', function() {
        // If this section is already visible, hide it
        if (applySection.style.display === 'block') {
            applySection.style.display = 'none';
            applyMenuBtn.classList.remove('active');
            return;
        }
        
        // Otherwise, hide all sections and show this one
        hideAllSections();
        applySection.style.display = 'block';
        applyMenuBtn.classList.add('active');
        showStatus('Select emails to apply labels to');
    });
    
    // Train menu button
    trainMenuBtn.addEventListener('click', function() {
        // If this section is already visible, hide it
        if (trainingSection.style.display === 'block') {
            trainingSection.style.display = 'none';
            trainMenuBtn.classList.remove('active');
            return;
        }
        
        // Otherwise, hide all sections and show this one
        hideAllSections();
        trainingSection.style.display = 'block';
        trainMenuBtn.classList.add('active');
        showStatus('Enter a label for the currently open email');
    });
    
    // Batch menu button
    batchMenuBtn.addEventListener('click', function() {
        // If this section is already visible, hide it
        if (batchTrainingSection.style.display === 'block') {
            batchTrainingSection.style.display = 'none';
            batchMenuBtn.classList.remove('active');
            return;
        }
        
        // Otherwise, hide all sections and show this one
        hideAllSections();
        batchTrainingSection.style.display = 'block';
        batchMenuBtn.classList.add('active');
        showStatus('Select multiple emails in Gmail and enter a label');
    });
    
    // Test menu button
    testMenuBtn.addEventListener('click', function() {
        // If this section is already visible, hide it
        if (testSection.style.display === 'block') {
            testSection.style.display = 'none';
            testMenuBtn.classList.remove('active');
            return;
        }
        
        // Otherwise, hide all sections and show this one
        hideAllSections();
        testSection.style.display = 'block';
        testMenuBtn.classList.add('active');
        testInput.focus();
        showStatus('Enter text to test the model');
    });

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

    // Batch train button functionality
    batchTrainBtn.addEventListener('click', async function() {
        const label = batchLabelInput.value.trim();
        if (!label) {
            showStatus('Please enter a label for batch training', true);
            return;
        }

        try {
            // Reset UI
            batchResults.style.display = 'none';
            
            // Get the active tab
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            
            if (!tab.url.includes('mail.google.com')) {
                showStatus('Please navigate to Gmail first', true);
                return;
            }
            
            // Start batch training
            showStatus('Starting batch training...');
            
            // Show processing indicator
            batchProcessingIndicator.style.display = 'block';
            
            // Send message to content script
            chrome.tabs.sendMessage(tab.id, { 
                action: 'batchTrain', 
                label: label 
            }, function(response) {
                if (chrome.runtime.lastError) {
                    // Content script not loaded or other error
                    injectContentScriptAndRetry(tab.id, { action: 'batchTrain', label: label });
                    return;
                }
                
                if (response && response.status === 'started') {
                    showStatus('Batch training in progress...');
                    batchTotalCount.textContent = response.totalEmails || '0';
                    
                    // Update UI when batch processing is complete
                    chrome.runtime.onMessage.addListener(function batchTrainingListener(message) {
                        if (message.action === 'batchTrainingUpdate') {
                            batchProgressCount.textContent = message.processed;
                        } else if (message.action === 'batchTrainingComplete') {
                            chrome.runtime.onMessage.removeListener(batchTrainingListener);
                            batchProcessingIndicator.style.display = 'none';
                            batchResults.style.display = 'block';
                            batchSuccessCount.textContent = message.successCount;
                            showStatus('Batch training complete!');
                        }
                    });
                } else {
                    showStatus('Failed to start batch training: ' + (response ? response.error : 'Unknown error'), true);
                    batchProcessingIndicator.style.display = 'none';
                }
            });
        } catch (error) {
            showStatus('Error: ' + error.message, true);
            batchProcessingIndicator.style.display = 'none';
        }
    });

    // Reset model button functionality
    resetModelBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reset the model? This will delete all training data.')) {
            return;
        }
        
        try {
            // Call reset API
            const response = await fetch('http://localhost:5050/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                showStatus(result.message);
                
                // Clear test results if showing
                testResult.style.display = 'none';
                testInput.value = '';
            } else {
                // Handle API error
                const error = await response.json();
                showStatus('Reset failed: ' + (error.error || response.statusText), true);
            }
        } catch (error) {
            showStatus('Error: ' + error.message, true);
        }
    });

    // Test button functionality
    testBtn.addEventListener('click', async () => {
        const text = testInput.value.trim();
        if (!text) {
            showStatus('Please enter text to classify', true);
            return;
        }

        try {
            // Call prediction API
            const response = await fetch('http://localhost:5050/predict', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    text: text,
                    isModelTest: true
                })
            });
            
            if (response.ok) {
                const prediction = await response.json();
                
                // Show result
                testResult.style.display = 'block';
                
                if (prediction.error && prediction.error.includes('at least 2 different labels')) {
                    // Model not trained with enough labels
                    predictionLabel.textContent = 'Insufficient training data';
                    predictionConfidence.textContent = 'The model needs at least 2 different labels to make predictions';
                    predictionLabel.style.color = '#a94442';
                } else if (prediction.label) {
                    // Show prediction and confidence
                    predictionLabel.textContent = prediction.label;
                    predictionLabel.style.color = '#4285f4';
                    
                    // Format confidence as percentage
                    const confidence = prediction.confidence ? 
                        (prediction.confidence * 100).toFixed(1) + '%' : 
                        'Not available';
                    
                    predictionConfidence.textContent = confidence;
                } else {
                    // No confident prediction available
                    predictionLabel.textContent = 'Model cannot determine label';
                    
                    // Format confidence as percentage if available
                    const confidence = prediction.confidence ? 
                        'Low confidence: ' + (prediction.confidence * 100).toFixed(1) + '%' : 
                        'Unable to calculate confidence';
                    
                    predictionConfidence.textContent = confidence;
                    predictionLabel.style.color = '#5f6368';
                }
            } else {
                // Handle API error
                const error = await response.json();
                showStatus('Prediction failed: ' + (error.error || response.statusText), true);
                testResult.style.display = 'none';
            }
        } catch (error) {
            showStatus('Error: ' + error.message, true);
            testResult.style.display = 'none';
        }
    });

    // Check server status on popup open
    checkServerBtn.click();
});