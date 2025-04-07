document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('status');
    const trainBtn = document.getElementById('train-btn');
    const labelInput = document.getElementById('label-input');
    const checkServerBtn = document.getElementById('check-server');

    function showStatus(message, isError = false) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + (isError ? 'error' : 'success');
    }

    async function getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    }

    async function getEmailContent() {
        try {
            const tab = await getCurrentTab();
            
            // Check if we're on Gmail
            if (!tab.url.includes('mail.google.com')) {
                throw new Error('Please navigate to Gmail to use this extension');
            }
            
            // Send message with error handling
            return new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, { action: 'getEmailContent' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
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
                showStatus(`Successfully trained model with label: ${label}`);
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