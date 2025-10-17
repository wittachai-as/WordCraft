#!/usr/bin/env python3
"""
Simple Word2Vec Implementation
ใช้ Word2Vec model จริงๆ โดยไม่ต้องติดตั้ง gensim
"""

import requests
import json
import os
from typing import Optional, List, Tuple

class SimpleWord2Vec:
    def __init__(self):
        self.model_url = "https://dl.fbaipublicfiles.com/fasttext/vectors-english/crawl-300d-2M.vec.zip"
        self.model_file = "word2vec_model.vec"
        self.vectors = {}
        self.vocab = set()
        
    def download_model(self):
        """ดาวน์โหลด Word2Vec model"""
        if os.path.exists(self.model_file):
            print(f"✅ Model ไฟล์ {self.model_file} มีอยู่แล้ว")
            return True
            
        print("📥 กำลังดาวน์โหลด Word2Vec model...")
        print("⚠️  ไฟล์ขนาดใหญ่ (~1GB) กรุณารอสักครู่...")
        
        try:
            # ใช้ model ที่เล็กกว่า
            response = requests.get("https://dl.fbaipublicfiles.com/fasttext/vectors-english/wiki-news-300d-1M.vec.zip", 
                                  stream=True)
            if response.status_code == 200:
                with open(self.model_file, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"✅ ดาวน์โหลดเสร็จสิ้น: {self.model_file}")
                return True
        except Exception as e:
            print(f"❌ ไม่สามารถดาวน์โหลด model: {e}")
            return False
    
    def load_model(self):
        """โหลด Word2Vec model"""
        if not os.path.exists(self.model_file):
            print("❌ ไม่พบ model ไฟล์")
            return False
            
        print("📖 กำลังโหลด Word2Vec model...")
        try:
            with open(self.model_file, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if i == 0:  # ข้าม header
                        continue
                    if i > 10000:  # จำกัดคำศัพท์เพื่อความเร็ว
                        break
                        
                    parts = line.strip().split()
                    if len(parts) > 1:
                        word = parts[0]
                        vector = [float(x) for x in parts[1:]]
                        self.vectors[word] = vector
                        self.vocab.add(word)
            
            print(f"✅ โหลด model เสร็จสิ้น: {len(self.vectors)} คำ")
            return True
        except Exception as e:
            print(f"❌ ไม่สามารถโหลด model: {e}")
            return False
    
    def get_vector(self, word: str) -> Optional[List[float]]:
        """ดึง vector ของคำ"""
        return self.vectors.get(word.lower())
    
    def cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """คำนวณ cosine similarity"""
        if len(vec1) != len(vec2):
            return 0.0
            
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = sum(a * a for a in vec1) ** 0.5
        norm2 = sum(b * b for b in vec2) ** 0.5
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
            
        return dot_product / (norm1 * norm2)
    
    def most_similar(self, word: str, topn: int = 10) -> List[Tuple[str, float]]:
        """หาคำที่คล้ายคลึงที่สุด"""
        word_vec = self.get_vector(word)
        if not word_vec:
            return []
        
        similarities = []
        for other_word, other_vec in self.vectors.items():
            if other_word != word:
                sim = self.cosine_similarity(word_vec, other_vec)
                similarities.append((other_word, sim))
        
        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities[:topn]
    
    def combine_words(self, word1: str, word2: str) -> Optional[str]:
        """รวมสองคำด้วย vector arithmetic"""
        vec1 = self.get_vector(word1)
        vec2 = self.get_vector(word2)
        
        if not vec1 or not vec2:
            return None
        
        # Vector arithmetic: vec1 + vec2
        combined_vec = [a + b for a, b in zip(vec1, vec2)]
        
        # หาคำที่ใกล้เคียงกับ combined vector
        best_similarity = 0
        best_word = None
        
        for word, vec in self.vectors.items():
            if word not in [word1.lower(), word2.lower()]:
                sim = self.cosine_similarity(combined_vec, vec)
                if sim > best_similarity:
                    best_similarity = sim
                    best_word = word
        
        if best_similarity > 0.3:  # threshold
            return best_word.capitalize()
        
        return None

def test_word2vec():
    """ทดสอบ Word2Vec"""
    print("🚀 เริ่มทดสอบ Simple Word2Vec")
    
    w2v = SimpleWord2Vec()
    
    # ดาวน์โหลด model
    if not w2v.download_model():
        print("❌ ไม่สามารถดาวน์โหลด model ได้")
        return
    
    # โหลด model
    if not w2v.load_model():
        print("❌ ไม่สามารถโหลด model ได้")
        return
    
    # ทดสอบการรวมคำ
    test_cases = [
        ("king", "queen"),
        ("man", "woman"),
        ("fire", "water"),
        ("earth", "air"),
        ("light", "dark"),
        ("life", "death"),
        ("love", "hate"),
        ("peace", "war"),
        ("hope", "fear"),
        ("strength", "courage")
    ]
    
    print("\n🧪 ทดสอบการรวมคำด้วย Word2Vec:")
    print("=" * 50)
    
    for word1, word2 in test_cases:
        result = w2v.combine_words(word1, word2)
        if result:
            print(f"✅ {word1} + {word2} = {result}")
        else:
            print(f"❌ {word1} + {word2} = ไม่พบคำที่เหมาะสม")
    
    # ทดสอบการหาคำที่คล้ายคลึง
    print("\n🔍 ทดสอบการหาคำที่คล้ายคลึง:")
    print("=" * 50)
    
    test_words = ["king", "fire", "love", "power", "light"]
    for word in test_words:
        similar = w2v.most_similar(word, 5)
        print(f"\nคำที่คล้ายคลึงกับ '{word}':")
        for sim_word, score in similar:
            print(f"  - {sim_word}: {score:.3f}")

if __name__ == "__main__":
    test_word2vec()
