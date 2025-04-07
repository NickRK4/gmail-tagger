from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
import numpy as np
import pickle
import os

class EmailClassifier:
    def __init__(self, model_path='model.pkl'):
        # Use a simpler Multinomial Naive Bayes classifier instead of XGBoost
        self.classifier = MultinomialNB()
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.texts = []
        self.labels = []
        self.model_path = model_path
        self.is_trained = False
        self.load_model()

    def train(self, text, label):
        """Train the classifier with new data."""
        try:
            if not text or not label:
                raise ValueError("Text and label cannot be empty")
                
            # Add new example to our dataset
            self.texts.append(text)
            self.labels.append(label)
            
            # Need at least 2 examples of different classes for training
            unique_labels = set(self.labels)
            if len(unique_labels) < 2:
                print("Warning: Need at least 2 different labels to train a classifier")
                self.save_model()  # Still save the data
                return False
                
            # Count examples per label
            label_counts = {}
            for l in self.labels:
                label_counts[l] = label_counts.get(l, 0) + 1
                
            # Check if we have enough examples per class
            for l, count in label_counts.items():
                if count < 1:
                    print(f"Warning: Need at least 1 example for label '{l}'")
                    self.save_model()  # Still save the data
                    return False
            
            # Fit vectorizer and transform text
            X = self.vectorizer.fit_transform(self.texts)
            
            # Train classifier
            self.classifier.fit(X, self.labels)
            
            self.is_trained = True
            print(f"Model successfully trained with {len(self.texts)} examples and {len(unique_labels)} unique labels")
            
            # Save the updated model
            self.save_model()
            return True
        except Exception as e:
            print(f"Error during training: {str(e)}")
            import traceback
            traceback.print_exc()
            raise

    def predict(self, text):
        """Predict label for new text."""
        try:
            # If model not trained yet
            if not self.is_trained:
                print("Model not trained yet or insufficient training data")
                return None
                
            if not text:
                raise ValueError("Text cannot be empty")
                
            # Transform new text using vectorizer
            X = self.vectorizer.transform([text])
            
            # Make prediction
            prediction = self.classifier.predict(X)[0]
            
            # Get prediction probability
            probas = self.classifier.predict_proba(X)[0]
            max_proba = np.max(probas)
            
            print(f"Prediction: {prediction}, Confidence: {max_proba}")
            
            # Only return prediction if confidence is high enough
            if max_proba >= 0.6:  # 60% confidence threshold
                return prediction
            return None
            
        except Exception as e:
            print(f"Error during prediction: {str(e)}")
            import traceback
            traceback.print_exc()
            return None

    def save_model(self):
        """Save model and data to disk."""
        try:
            with open(self.model_path, 'wb') as f:
                pickle.dump({
                    'classifier': self.classifier,
                    'vectorizer': self.vectorizer,
                    'texts': self.texts,
                    'labels': self.labels,
                    'is_trained': self.is_trained
                }, f)
            print(f"Model saved to {self.model_path}")
        except Exception as e:
            print(f"Error saving model: {str(e)}")
            import traceback
            traceback.print_exc()
            raise

    def load_model(self):
        """Load model and data from disk if available."""
        try:
            if os.path.exists(self.model_path):
                with open(self.model_path, 'rb') as f:
                    data = pickle.load(f)
                    self.classifier = data['classifier']
                    self.vectorizer = data['vectorizer']
                    self.texts = data['texts']
                    self.labels = data['labels']
                    self.is_trained = data.get('is_trained', False)
                print(f"Model loaded from {self.model_path} with {len(self.texts)} examples")
                return True
            return False
        except Exception as e:
            print(f"Error loading model: {str(e)}")
            import traceback
            traceback.print_exc()
            # Initialize empty model if loading fails
            self.texts = []
            self.labels = []
            self.is_trained = False
            return False