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

@app.route('/reset', methods=['POST'])
def reset_model():
    try:
        success = classifier.reset_model()
        
        if success:
            return jsonify({
                'status': 'success', 
                'message': 'Model has been reset successfully'
            })
        else:
            return jsonify({
                'status': 'error', 
                'message': 'Failed to reset model'
            }), 500
            
    except Exception as e:
        app.logger.error(f"Error in reset: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/evaluate', methods=['POST'])
def evaluate_model():
    try:
        data = request.json
        test_size = data.get('test_size', 0.2)
        cv = data.get('cv', 5)
        
        # Validate parameters
        if not 0 < test_size < 1:
            return jsonify({'error': 'test_size must be between 0 and 1'}), 400
            
        if not isinstance(cv, int) or cv < 2:
            return jsonify({'error': 'cv must be an integer greater than 1'}), 400
        
        # Evaluate model accuracy
        results = classifier.evaluate_accuracy(test_size=test_size, cv=cv)
        
        if 'error' in results:
            return jsonify(results), 400
            
        return jsonify({
            'status': 'success',
            'results': results
        })
        
    except Exception as e:
        app.logger.error(f"Error in evaluate: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Evaluate model accuracy before starting the server
    try:
        print("\nEvaluating model accuracy...")
        results = classifier.evaluate_accuracy()
        if 'error' in results:
            print(f"Evaluation error: {results['error']}")
        else:
            print(f"Model accuracy: {results['test_accuracy']:.2f}")
            print(f"Cross-validation accuracy: {results['cross_val_mean']:.2f} ± {results['cross_val_std']:.2f}")
            print(f"Label distribution: {results['label_counts']}")
            print("\nDetailed metrics per label:")
            for label, metrics in results['classification_report'].items():
                if label not in ['accuracy', 'macro avg', 'weighted avg']:
                    try:
                        print(f"  {label}: precision={metrics['precision']:.2f}, recall={metrics['recall']:.2f}, f1-score={metrics['f1-score']:.2f}")
                    except:
                        pass
    except Exception as e:
        print(f"Error evaluating model: {str(e)}")
    
    # Start the server
    print("\nStarting server...")
    app.run(debug=True, host='0.0.0.0', port=5050)  # Changed to port 5050 to avoid conflicts