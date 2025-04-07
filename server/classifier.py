from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
import numpy as np
import pickle
import os
import random

class EmailClassifier:
    def __init__(self, model_path='model.pkl'):
        # Use a simpler Multinomial Naive Bayes classifier instead of XGBoost
        self.classifier = MultinomialNB(alpha=2.0)  # Higher alpha for more smoothing
        self.vectorizer = TfidfVectorizer(
            max_features=1000, 
            stop_words='english', 
            ngram_range=(1, 2),  # Use both unigrams and bigrams
            min_df=2             # Only use terms that appear in at least 2 documents
        )
        self.texts = []
        self.labels = []
        self.model_path = model_path
        self.is_trained = False
        self.confidence_threshold = 0.85  # Higher threshold for more conservative predictions
        self.min_text_length = 5  # Minimum text length for valid classification
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
            print(f"Label distribution: {label_counts}")
            
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
            
            prediction, confidence = self.predict_with_confidence(text)
            
            # Only return prediction if confidence is high enough
            if confidence >= self.confidence_threshold:
                return prediction
            return None
            
        except Exception as e:
            print(f"Error during prediction: {str(e)}")
            import traceback
            traceback.print_exc()
            return None
            
    def predict_with_confidence(self, text):
        """Predict label for new text and return the confidence score."""
        try:
            # If model not trained yet
            if not self.is_trained:
                print("Model not trained yet or insufficient training data")
                return None, 0.0
                
            if not text:
                raise ValueError("Text cannot be empty")
            
            # Handle edge cases: very short texts
            if len(text.strip()) < self.min_text_length:
                print(f"Text too short for reliable classification: '{text}'")
                return None, 0.0
                
            # Transform new text using vectorizer
            X = self.vectorizer.transform([text])
            
            # Check if the transform produced any features
            if X.sum() == 0:
                print(f"No features extracted for text: '{text}'")
                return None, 0.0
            
            # Get prediction probabilities for all classes
            probas = self.classifier.predict_proba(X)[0]
            
            # Find the top 2 confidences
            sorted_probas = np.sort(probas)
            top_proba = sorted_probas[-1]
            
            # If we have at least 2 classes, get the second highest probability
            if len(sorted_probas) > 1:
                second_proba = sorted_probas[-2]
                # If the top two probabilities are close, reduce confidence
                if top_proba - second_proba < 0.3:
                    top_proba = top_proba * 0.7
            
            # Get the label class index with highest probability
            class_idx = np.argmax(probas)
            prediction = self.classifier.classes_[class_idx]
            
            # Adjust confidence based on label distribution
            label_counts = {}
            for l in self.labels:
                label_counts[l] = label_counts.get(l, 0) + 1
                
            total_examples = len(self.labels)
            if total_examples > 0:
                # Get frequency of predicted label in training data
                predicted_label_count = label_counts.get(prediction, 0)
                label_frequency = predicted_label_count / total_examples
                
                # Apply progressive penalty for dominant labels
                if label_frequency > 0.5:
                    # The more dominant, the stronger the penalty
                    penalty_factor = 0.5 / label_frequency
                    adjusted_confidence = top_proba * penalty_factor
                else:
                    adjusted_confidence = top_proba
                    
                # Extra penalty for very short text
                text_length = len(text.strip())
                if text_length < 20:
                    length_factor = text_length / 20
                    adjusted_confidence = adjusted_confidence * length_factor
            else:
                adjusted_confidence = top_proba
                
            # Convert to float to ensure JSON serialization works
            adjusted_confidence = float(adjusted_confidence)
            
            print(f"Text: '{text[:30]}{'...' if len(text) > 30 else ''}'")
            print(f"Prediction: {prediction}, Original Confidence: {top_proba:.4f}, Adjusted: {adjusted_confidence:.4f}")
            print(f"Label distribution: {label_counts}")
            
            return prediction, adjusted_confidence
            
        except Exception as e:
            print(f"Error during prediction with confidence: {str(e)}")
            import traceback
            traceback.print_exc()
            return None, 0.0

    def save_model(self):
        """Save model and data to disk."""
        try:
            with open(self.model_path, 'wb') as f:
                pickle.dump({
                    'classifier': self.classifier,
                    'vectorizer': self.vectorizer,
                    'texts': self.texts,
                    'labels': self.labels,
                    'is_trained': self.is_trained,
                    'confidence_threshold': self.confidence_threshold,
                    'min_text_length': self.min_text_length
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
                    self.confidence_threshold = data.get('confidence_threshold', 0.85)
                    self.min_text_length = data.get('min_text_length', 5)
                print(f"Model loaded from {self.model_path} with {len(self.texts)} examples")
                
                # Print label distribution
                if self.labels:
                    label_counts = {}
                    for l in self.labels:
                        label_counts[l] = label_counts.get(l, 0) + 1
                    print(f"Label distribution: {label_counts}")
                    
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

    def get_label_distribution(self):
        """Get the distribution of labels in the training data."""
        if not self.labels:
            return {}
            
        label_counts = {}
        for l in self.labels:
            label_counts[l] = label_counts.get(l, 0) + 1
            
        return label_counts
        
    def reset_model(self):
        """Reset the model completely."""
        self.texts = []
        self.labels = []
        self.is_trained = False
        self.classifier = MultinomialNB(alpha=2.0)
        self.save_model()
        print("Model has been reset")
        return True