#!/usr/bin/env python3
"""
Seed global recipes to Firestore once, separate from daily puzzles.
This avoids copying 2000+ recipes every day.

Usage:
  python seed_global_recipes.py
"""

import json
import sys
import os

# Add parent directory to path to import firebase functions
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from mobile.firebase import ensureFirebaseApp, fetchPuzzleForDate
except ImportError:
    print("Error: Cannot import firebase functions. Make sure you're in the right directory.")
    sys.exit(1)


def seed_global_recipes():
    """Seed global recipes to Firestore collection 'global_recipes'"""
    
    # Load global recipes
    try:
        with open('global_recipes.json', 'r') as f:
            recipes = json.load(f)
    except FileNotFoundError:
        print("Error: global_recipes.json not found. Run generate_global_recipes.py first.")
        return False
    
    # Load Firebase config
    try:
        config_path = os.path.join('..', 'mobile', 'firebase.config.json')
        with open(config_path, 'r') as f:
            fb_config = json.load(f)
    except FileNotFoundError:
        print("Error: firebase.config.json not found")
        return False
    
    # Initialize Firebase
    app = ensureFirebaseApp(fb_config)
    if not app:
        print("Error: Failed to initialize Firebase")
        return False
    
    try:
        from firebase_admin import firestore
        db = firestore.client()
        
        # Create global_recipes collection with a single document
        doc_ref = db.collection('global_recipes').document('all')
        doc_ref.set({
            'recipes': recipes,
            'version': '1.0',
            'count': len(recipes)
        })
        
        print(f"Successfully seeded {len(recipes)} global recipes to Firestore")
        return True
        
    except Exception as e:
        print(f"Error seeding to Firestore: {e}")
        return False


if __name__ == '__main__':
    seed_global_recipes()
