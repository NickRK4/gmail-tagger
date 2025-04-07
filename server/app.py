from flask import Flask, request, jsonify
from flask_cors import CORS
from classifier import EmailClassifier
import json

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes
classifier = EmailClassifier()

@app.route('/predict', methods=['POST'])
def predict_label():
    try:
        data = request.json
        if not data or 'text' not in data:
            return jsonify({'error': 'No email text provided'}), 400
        
        email_text = data['text']
        
        # Special case for the test request from the popup
        if email_text == 'test':
            return jsonify({'status': 'Server is running'})
            
        prediction = classifier.predict(email_text)
        
        if prediction is None:
            return jsonify({'error': 'Model not trained yet'}), 400
            
        return jsonify({'label': prediction})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_model():
    try:
        data = request.json
        if not data or 'text' not in data or 'label' not in data:
            return jsonify({'error': 'Missing text or label'}), 400
            
        text = data['text']
        label = data['label']
        
        if not text or not label:
            return jsonify({'error': 'Text and label cannot be empty'}), 400
            
        classifier.train(text, label)
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def index():
    return jsonify({'status': 'Server is running', 'message': 'Gmail Label Classifier API is active'})

if __name__ == '__main__':
    app.run(port=5050)  # Changed to port 5050 to avoid conflicts