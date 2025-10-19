#!/usr/bin/env python3
"""
ทดสอบการกรองคำใน pick_candidate
"""
import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

from main import load_model, pick_candidate, is_valid_result_word

def test_combination(a: str, b: str):
    print(f"\n{'='*70}")
    print(f"🧪 ทดสอบ: {a} + {b}")
    print(f"{'='*70}")
    
    # Load model
    print("Loading model...")
    model = load_model()
    print(f"✅ Model loaded: {len(model.index2word if hasattr(model, 'index2word') else model.key_to_index)} words")
    
    # Test pick_candidate
    result = pick_candidate(a, b, model)
    
    print(f"\n📊 ผลลัพธ์: {result}")
    
    if result:
        # Test if result passes validation
        result_lower = result.lower()
        is_valid = is_valid_result_word(result_lower)
        print(f"✅ ผ่านการตรวจสอบ: {is_valid}")
    else:
        print("❌ ไม่มีผลลัพธ์ (No combination)")
    
    return result

if __name__ == "__main__":
    # Test cases
    test_cases = [
        ("sun", "moon"),
        ("water", "earth"),
        ("fire", "ice"),
        ("dog", "cat"),
    ]
    
    for a, b in test_cases:
        try:
            test_combination(a, b)
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()

