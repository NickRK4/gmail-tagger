from flask import Flask, request, jsonify
from flask_cors import CORS
from classifier import EmailClassifier
import traceback

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize classifier
classifier = EmailClassifier()

@app.route('/', methods=['GET'])
def index():
    return jsonify({'status': 'Server is running', 'message': 'Gmail Label Classifier API is active'})

@app.route('/predict', methods=['POST'])
def predict_label():
    try:
        data = request.json
        
        # Check if this is a simple server check request
        if data.get('text') == 'test' and not data.get('isModelTest'):
            return jsonify({'status': 'Server is running'})
            
        email_text = data.get('text', '')
        
        if not email_text:
            return jsonify({'error': 'No email text provided'}), 400
            
        # Check if model has enough training data
        unique_labels = set(classifier.labels)
        if len(unique_labels) < 2:
            return jsonify({
                'error': 'Need at least 2 different labels to train a classifier',
                'trained_labels': list(unique_labels)
            })
            
        # Get prediction with confidence
        prediction, confidence = classifier.predict_with_confidence(email_text)
        
        if prediction:
            return jsonify({
                'label': prediction,
                'confidence': confidence
            })
        else:
            return jsonify({
                'label': None, 
                'message': 'No confident prediction available',
                'confidence': confidence
            })
            
    except Exception as e:
        app.logger.error(f"Error in predict: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_model():
    try:
        data = request.json
        text = data.get('text', '')
        label = data.get('label', '')
        
        if not text:
            return jsonify({'error': 'No email text provided'}), 400
            
        if not label:
            return jsonify({'error': 'No label provided'}), 400
            
        success = classifier.train(text, label)
        
        if success:
            return jsonify({
                'status': 'success', 
                'message': f'Model trained with label: {label}',
                'is_trained': classifier.is_trained
            })
        else:
            return jsonify({
                'status': 'partial', 
                'message': 'Data saved, but need more examples to train the model',
                'is_trained': classifier.is_trained
            })
        
    except Exception as e:
        app.logger.error(f"Error in train: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5050)  # Changed to port 5050 to avoid conflicts