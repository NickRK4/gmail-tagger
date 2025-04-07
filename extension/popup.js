document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('status');
    const trainBtn = document.getElementById('train-btn');
    const labelInput = document.getElementById('label-input');
    const checkServerBtn = document.getElementById('check-server');
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