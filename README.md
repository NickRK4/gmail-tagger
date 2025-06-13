# Gmail Label Classifier

A Chrome extension that uses machine learning to automatically classify and label emails in Gmail based on their content.

## Features

- **Automatic Email Classification**: Predicts appropriate labels for emails based on content
- **Custom Training**: Train the model with your own labeled examples
- **Batch Processing**: Apply labels to multiple emails at once
- **High Confidence Threshold**: Only applies labels when confidence is above 70%
- **Simple Interface**: Easy-to-use popup UI for all operations

## Components

### Chrome Extension
- **Popup UI**: User interface for training, testing, and applying labels
- **Content Script**: Interacts with Gmail interface to extract email content and apply labels
- **Background Script**: Handles authentication and messaging between components

### Flask Server
- **ML Model**: Uses scikit-learn's MultinomialNB and TfidfVectorizer for text classification
- **API Endpoints**: Provides prediction, training, evaluation, and reset functionality

## Setup Instructions

### Server Setup
1. Navigate to the server directory
2. Install dependencies: `pip install -r requirements.txt`
3. Run the server: `python app.py`

### Extension Setup
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension` directory
4. Configure OAuth client ID in manifest.json (replace the placeholder with your own)

## Usage

1. **Training the Model**:
   - Open an email in Gmail
   - Click the extension icon and select "Train"
   - Enter a label name and click "Train"

2. **Applying Labels**:
   - Navigate to your Gmail inbox
   - Click the extension icon and select "Apply"
   - Click the "Apply" button to process visible emails

3. **Batch Training**:
   - Select multiple emails in Gmail
   - Click the extension icon and select "Batch Train"
   - Enter a label name and click "Train Selected"

4. **Testing the Model**:
   - Click the extension icon and select "Test"
   - Enter sample text and click "Test"

## Important Notes

- The server must be running locally on port 5050 for the extension to work
- Before uploading to GitHub, replace the OAuth client ID in manifest.json with your own
- The model.pkl file contains trained data and should be cleared before sharing

## License

MIT
