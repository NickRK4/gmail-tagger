import xgboost as xgb
from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np
import pickle
import os

class EmailClassifier:
    def __init__(self, model_path='model.pkl'):
        self.classifier = xgb.XGBClassifier(n_estimators=100, random_state=42)
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.texts = []
        self.labels = []
        self.model_path = model_path
        self.load_model()

    def train(self, text, label):
        """Train the classifier with new data."""
        try:
            if not text or not label:
                raise ValueError("Text and label cannot be empty")
                
            self.texts.append(text)
            self.labels.append(label)
            
            # Fit vectorizer and transform text
            X = self.vectorizer.fit_transform(self.texts)
            
            # Train classifier
            self.classifier.fit(X, self.labels)
            
            # Save the updated model
            self.save_model()
        except Exception as e:
            print(f"Error during training: {str(e)}")
            raise

    def predict(self, text):
        """Predict label for new text."""
        try:
            if not self.texts:  # If no training data yet
                return None
                
            if not text:
                raise ValueError("Text cannot be empty")
                
            # Transform new text using vectorizer
            X = self.vectorizer.transform([text])
            
            # Make prediction
            prediction = self.classifier.predict(X)[0]
            
            # Get prediction probability
            proba = np.max(self.classifier.predict_proba(X)[0])
            
            # Only return prediction if confidence is high enough
            if proba >= 0.6:  # 60% confidence threshold
                return prediction
            return None
            
        except Exception as e:
            print(f"Error during prediction: {str(e)}")
            return None

    def save_model(self):
        """Save model and data to disk."""
        try:
            with open(self.model_path, 'wb') as f:
                pickle.dump({
                    'classifier': self.classifier,
                    'vectorizer': self.vectorizer,
                    'texts': self.texts,
                    'labels': self.labels
                }, f)
        except Exception as e:
            print(f"Error saving model: {str(e)}")
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
        except Exception as e:
            print(f"Error loading model: {str(e)}")
            # Initialize empty model if loading fails
            self.texts = []
            self.labels = []