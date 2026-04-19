import os
import re
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Tuple, Dict
import numpy as np

# gensim 3.8.x compatible
from gensim.models import KeyedVectors

# Firebase
import firebase_admin
from firebase_admin import credentials, firestore

# NLTK for lemmatization
import nltk
from nltk.stem import WordNetLemmatizer
from nltk.corpus import words as nltk_words
import threading

# Download NLTK data if not already present
try:
  nltk.data.find('corpora/wordnet')
except LookupError:
  print("[AI] Downloading WordNet data...")
  nltk.download('wordnet', quiet=False)
  nltk.download('omw-1.4', quiet=False)
  print("[AI] WordNet data downloaded successfully")

try:
  nltk.data.find('corpora/words')
except LookupError:
  print("[AI] Downloading words corpus for spell checking...")
  nltk.download('words', quiet=False)
  print("[AI] Words corpus downloaded successfully")


def is_logical_combination(a: str, b: str, result: str) -> bool:
  """ตรวจสอบว่าผลลัพธ์มีความเชื่อมโยงทางตรรกะกับ input หรือไม่"""
  a_l, b_l, result_l = a.lower(), b.lower(), result.lower()
  
  # ตรวจสอบว่าไม่ใช่คำเดิมเท่านั้น
  if result_l in [a_l, b_l]:
    return False

  return True



def choose_best_with_knowledge(a: str, b: str, cands: List[str], model: KeyedVectors) -> Optional[str]:
  """
  Find word closest to the midpoint between vectors a and b
  Pure vector arithmetic approach: result = (vec_a + vec_b) / 2
  """
  a_l, b_l = a.lower(), b.lower()
  
  # Check if words exist in model
  if a_l not in model or b_l not in model:
    return None
  
  # Calculate midpoint vector: (vec_a + vec_b) / 2
  import numpy as np
  vec_a = model[a_l]
  vec_b = model[b_l]
  midpoint = (vec_a + vec_b) / 2.0
  
  # Normalize midpoint vector
  midpoint = midpoint / np.linalg.norm(midpoint)
  
  # Find closest words to midpoint (excluding input words)
  try:
    # Get top candidates similar to midpoint
    similar_words = model.similar_by_vector(midpoint, topn=100)
    
    # Filter out original words and find best match
    for word, similarity in similar_words:
      wl = word.lower()
      if wl not in [a_l, b_l]:
        # Return first valid word (most similar to midpoint)
        return normalize_uk_to_us(word).capitalize()
    
    return None
    
  except Exception as e:
    print(f"[AI] Error finding midpoint for '{a}' + '{b}': {e}")
    return None

app = FastAPI()

# CORS for web clients
# Configure allowed origins via environment variable for production
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)

# Use relative path for default model location (root words only - no variants)
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "word2vec_model_root_only.vec.gz")
MODEL_PATH = os.getenv("MODEL_PATH", DEFAULT_MODEL_PATH)
# .vec and .vec.gz เป็นไฟล์ข้อความ; .bin และ .bin.gz เป็นไบนารี
MODEL_BINARY = MODEL_PATH.endswith('.bin') or MODEL_PATH.endswith('.bin.gz')
try:
  # No limit for root-only model (already filtered to 202k root words)
  MODEL_LIMIT = int(os.getenv("MODEL_LIMIT", "0") or "0")  # 0 = no limit
except Exception:
  MODEL_LIMIT = 0

_model: Optional[KeyedVectors] = None
_model_lock = threading.Lock()  # Lock for model loading


def load_model() -> KeyedVectors:
  global _model
  
  # Return cached model if already loaded
  if _model is not None:
    return _model
  
  # Use lock to prevent multiple threads from loading model simultaneously
  with _model_lock:
    # Double-check after acquiring lock
    if _model is not None:
      return _model
    if not os.path.exists(MODEL_PATH):
      raise FileNotFoundError(f"MODEL_PATH not found: {MODEL_PATH}")
    print(f"[AI] Loading model from {MODEL_PATH} binary={MODEL_BINARY} limit={MODEL_LIMIT or 'FULL'}")
    # limit helps reduce startup time and RAM usage
    limit = MODEL_LIMIT if MODEL_LIMIT and MODEL_LIMIT > 0 else None
    _model = KeyedVectors.load_word2vec_format(MODEL_PATH, binary=MODEL_BINARY, limit=limit)
    # precompute norms for fast similarity
    try:
      # gensim 3.x
      _model.init_sims(replace=True)
    except Exception:
      try:
        # gensim 4.x (not used here, just in case)
        _model.fill_norms()
      except Exception:
        pass
    print(f"[AI] Model loaded. Vocab size: {len(getattr(_model, 'index2word', [])) or getattr(_model, 'key_to_index', None) and len(_model.key_to_index)}")
    return _model


def normalize_uk_to_us(word: str) -> str:
  """รวมคำที่คล้ายกันให้เป็นคำเดียว (เช่น vapor/vapour)"""
  word_lower = word.lower()
  
  # ใช้ regex pattern แทน hard-coded list
  patterns = [
    (r'our$', 'or'),      # colour -> color
    (r're$', 'er'),       # centre -> center  
    (r'ise$', 'ize'),     # realise -> realize
    (r'yse$', 'yze'),     # analyse -> analyze
    (r'ogue$', 'og'),     # dialogue -> dialog
    (r'ae', 'e'),         # aesthetic -> esthetic, anaemia -> anemia
  ]
  
  for pattern, replacement in patterns:
    if re.search(pattern, word_lower) and len(word_lower) > 4:
      return re.sub(pattern, replacement, word_lower)
  
  # Special case: grey -> gray (vowel change pattern)
  if word_lower == 'grey':
    return 'gray'
  
  return word_lower

# Firebase cache system
_firebase_app = None
_firestore_db = None
_global_recipes_cache: Dict[str, str] = None  # Start as None, will be initialized on first load

def init_firebase():
  """เริ่มต้น Firebase"""
  global _firebase_app, _firestore_db
  if _firebase_app is None:
    try:
      # พยายามใช้ Service Account Key ก่อน
      import os
      key_path = os.path.join(os.path.dirname(__file__), 'firebase-adminsdk.json')
      
      if os.path.exists(key_path):
        cred = credentials.Certificate(key_path)
        _firebase_app = firebase_admin.initialize_app(cred)
        _firestore_db = firestore.client()
        print("[FIREBASE] ✅ Initialized with Service Account Key")
      else:
        # Fallback: ใช้ default credentials (Google Cloud)
        _firebase_app = firebase_admin.initialize_app()
        _firestore_db = firestore.client()
        print("[FIREBASE] ✅ Initialized with default credentials")
        
    except Exception as e:
      print(f"[FIREBASE] ❌ Error initializing: {e}")
      print(f"[FIREBASE] ℹ️  See ai_service/FIREBASE_SETUP.md for setup instructions")
      _firebase_app = None
      _firestore_db = None
  return _firestore_db

def load_global_recipes() -> Dict[str, str]:
  """โหลด global recipes จาก Firebase หรือ local JSON file (lazy loading, non-blocking)"""
  global _global_recipes_cache
  
  if _global_recipes_cache is None:
    # เริ่มต้นด้วย empty dict (ไม่ block)
    _global_recipes_cache = {}
    
    # Load จาก Firebase ใน background thread
    import threading
    
    def load_in_background():
      global _global_recipes_cache
      
      # Load from Firebase only (no local JSON fallback)
      try:
        db = init_firebase()
        if db:
          print("[FIREBASE] Loading recipes in background...")
          doc_ref = db.collection('global_recipes').document('all')
          doc = doc_ref.get(timeout=5.0)  # 5 second timeout
          
          if doc.exists:
            data = doc.to_dict()
            recipes = data.get('recipes', {})
            _global_recipes_cache.update(recipes)  # Update existing cache
            print(f"[FIREBASE] ✅ Loaded {len(recipes)} recipes from Firestore (total: {len(_global_recipes_cache)})")
          else:
            print("[FIREBASE] No recipes found in Firestore")
        else:
          print("[FIREBASE] Not configured, using local cache only")
      except Exception as e:
        print(f"[FIREBASE] ⚠️ Could not load recipes from Firebase: {e}")
    
    # Start background loading (non-blocking)
    thread = threading.Thread(target=load_in_background, daemon=True)
    thread.start()
    print("[CACHE] Started with empty cache, loading in background...")
  
  return _global_recipes_cache

def save_global_recipes():
  """บันทึก global recipes ลง Firebase (synchronous for reliability)"""
  try:
    db = init_firebase()
    if not db:
      print("[FIREBASE] ⚠️ Firebase not initialized, skipping save")
      return
    
    # Save to Firestore using Admin SDK (synchronous)
    doc_ref = db.collection('global_recipes').document('all')
    doc_ref.set({
      'recipes': dict(_global_recipes_cache),
      'count': len(_global_recipes_cache),
      'version': '1.0',
      'updated': firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    print(f"[FIREBASE] ✅ Saved {len(_global_recipes_cache)} recipes to Firestore")
      
  except Exception as e:
    print(f"[FIREBASE] ⚠️ Could not save recipes: {e}")

def get_cached_result(a: str, b: str) -> Optional[str]:
  """หาผลลัพธ์จาก cache (memory + Firebase)"""
  cache = load_global_recipes()  # Get current cache (may be loading in background)
  key1 = f"{a.lower()}+{b.lower()}"
  key2 = f"{b.lower()}+{a.lower()}"
  
  # ลองทั้งสองทิศทาง
  if key1 in cache:
    return cache[key1]
  elif key2 in cache:
    return cache[key2]
  return None

def cache_result(a: str, b: str, result: str):
  """บันทึกผลลัพธ์ลง cache (memory + Firebase)"""
  global _global_recipes_cache
  cache = load_global_recipes()
  key = f"{a.lower()}+{b.lower()}"
  
  # บันทึกใน memory cache
  cache[key] = result
  _global_recipes_cache = cache
  
  # บันทึกลง Firebase แบบ async (ไม่ block)
  save_global_recipes()
  print(f"[CACHE] Saved: {a} + {b} = {result} (syncing to Firebase...)")


def is_valid_result_word(w: str) -> bool:
  """
  ตรวจสอบว่าคำที่ได้จาก AI ผ่านเกณฑ์คุณภาพหรือไม่
  (เกณฑ์เดียวกับการกรอง vocabulary สำหรับโจทย์)
  """
  # Must be alphabetic (no hyphen, no underscore, no numbers)
  if not (w.isalpha() and w.islower() and '_' not in w):
    return False
  
  # Must be reasonable length (3-20 chars)
  if len(w) < 3 or len(w) > 20:
    return False
  
  # Must be ASCII only (no foreign characters)
  if not all(ord(c) < 128 for c in w):
    return False
  
  # No repetitive patterns (3+ same chars in a row)
  if any(c*3 in w for c in 'abcdefghijklmnopqrstuvwxyz'):
    return False
  
  # Not in excluded words or profanity lists
  if w in EXCLUDED_WORDS or w in PROFANITY_WORDS:
    return False
  
  return True


def pick_candidate(a: str, b: str, model: KeyedVectors, goal: Optional[str] = None) -> Optional[str]:
  """
  Pure vector arithmetic: Find word closest to midpoint of a and b
  
  Strategy:
  - If no goal provided: Return word closest to midpoint (original behavior)
  - If goal provided: Balance between midpoint proximity and goal proximity (70/30)
  """
  a_l, b_l = a.lower(), b.lower()
  
  # Check if both words exist in model
  if a_l not in model or b_l not in model:
    print(f"[AI] Words not in vocab: a='{a_l}' ({a_l in model}), b='{b_l}' ({b_l in model})")
    return None
  
  try:
    import numpy as np
    
    # Calculate midpoint vector: (vec_a + vec_b) / 2
    vec_a = model[a_l]
    vec_b = model[b_l]
    midpoint = (vec_a + vec_b) / 2.0
    
    # Normalize midpoint vector for better comparison
    midpoint = midpoint / np.linalg.norm(midpoint)
    
    # Find words closest to midpoint
    similar_words = model.similar_by_vector(midpoint, topn=200)
    print(f"[AI] Found {len(similar_words)} candidates near midpoint")
    
    # Filter valid words
    valid_candidates = []
    for word, similarity in similar_words:
      wl = word.lower()
      
      # Skip original words (exact match)
      if wl in [a_l, b_l]:
        continue
      
      # Skip plural/singular variants of original words
      if (wl == a_l + 's' or wl == b_l + 's' or 
          wl + 's' == a_l or wl + 's' == b_l or
          wl == a_l + 'es' or wl == b_l + 'es' or
          wl + 'es' == a_l or wl + 'es' == b_l):
        continue
      
      # Check if word is valid
      if is_valid_result_word(word):
        valid_candidates.append((word, similarity))
    
    if not valid_candidates:
      print(f"[AI] No valid candidates found")
      return None
    
    # Select best candidate
    if goal and goal.lower() in model:
      # With goal: Balance midpoint proximity (90%) and goal proximity (10%)
      # Low goal weight for harder puzzles - needs 4-7 steps to reach goal
      scored_candidates = []
      for word, midpoint_sim in valid_candidates[:50]:  # Only score top 50 to save time
        goal_sim = model.similarity(word.lower(), goal.lower())
        combined_score = (midpoint_sim * 0.98) + (goal_sim * 0.02)  # Minimal goal weight for EXTREME difficulty
        scored_candidates.append((word, combined_score, midpoint_sim, goal_sim))
      
      scored_candidates.sort(key=lambda x: x[1], reverse=True)
      best_word, combined_score, midpoint_sim, goal_sim = scored_candidates[0]
      result = normalize_uk_to_us(best_word).capitalize()
      print(f"[AI] Selected: {result} (midpoint: {midpoint_sim:.3f}, goal: {goal_sim:.3f}, combined: {combined_score:.3f})")
    else:
      # Without goal: Just return closest to midpoint (first valid word)
      best_word, midpoint_sim = valid_candidates[0]
      result = normalize_uk_to_us(best_word).capitalize()
      print(f"[AI] Selected: {result} (midpoint: {midpoint_sim:.3f})")
    
    return result
    
  except Exception as e:
    print(f"[AI] Error in pick_candidate for '{a}' + '{b}': {e}")
    import traceback
    traceback.print_exc()
    return None


class CombineRequest(BaseModel):
  a: str
  b: str
  goal: Optional[str] = None  # Optional: goal word for better path-finding


@app.post("/combine")
def combine(req: CombineRequest):
  if req.goal:
    print(f"[COMBINE] Received request: {req.a} + {req.b} (goal: {req.goal})")
  else:
    print(f"[COMBINE] Received request: {req.a} + {req.b}")
  try:
    model = load_model()
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Model load error: {e}")
  
  # block same-word combination after normalization (สมเหตุสมผลกว่าไม่เดา)
  a_normalized = normalize_uk_to_us(req.a.strip().lower())
  b_normalized = normalize_uk_to_us(req.b.strip().lower())
  print(f"[COMBINE] Normalized: {a_normalized} + {b_normalized}")
  if a_normalized == b_normalized:
    print(f"[COMBINE] Same word, no combination")
    raise HTTPException(status_code=404, detail="No combination")
  
  # 1. ถ้าไม่มี goal: ลองหาจาก cache ก่อน
  # ถ้ามี goal: ข้าม cache เพื่อให้ได้ผลลัพธ์ที่เหมาะสมกับ goal
  if not req.goal:
    cached_result = get_cached_result(a_normalized, b_normalized)
    if cached_result:
      print(f"[CACHE] Found cached result: {a_normalized} + {b_normalized} = {cached_result}")
      return {"id": cached_result.lower().replace(' ', '-'), "name": cached_result, "type": "result", "source": "cache"}
  
  # 2. ถ้าไม่มีใน cache หรือมี goal ให้ใช้ AI สร้างใหม่
  if req.goal:
    print(f"[AI] Generating new result for: {a_normalized} + {b_normalized} (with goal: {req.goal})")
  else:
    print(f"[AI] Generating new result for: {a_normalized} + {b_normalized}")
  
  name = pick_candidate(req.a, req.b, model, goal=req.goal)
  print(f"[AI] pick_candidate returned: {name}")
  if not name:
    print(f"[AI] No valid combination found")
    raise HTTPException(status_code=404, detail="No combination")
  
  # 3. บันทึกผลลัพธ์ใหม่ลง cache (เฉพาะกรณีไม่มี goal)
  if not req.goal:
    cache_result(a_normalized, b_normalized, name)
    print(f"[CACHE] Cached new result: {a_normalized} + {b_normalized} = {name}")
  else:
    print(f"[CACHE] Skipped caching (goal-aware result)")
  
  return {"id": name.lower().replace(' ', '-'), "name": name, "type": "result", "source": "ai"}


@app.get("/health")
def health():
  try:
    m = load_model()
    vocab = len(getattr(m, 'index2word', [])) or (getattr(m, 'key_to_index', None) and len(m.key_to_index)) or 0
    cache = load_global_recipes()
    
    # Check vocabulary cache status
    global _cached_vocab
    vocab_cache_ready = _cached_vocab is not None
    vocab_cache_size = len(_cached_vocab) if _cached_vocab else 0
    
    return {
      "status": "ok", 
      "vocab": vocab, 
      "limit": MODEL_LIMIT, 
      "recipe_cache_size": len(cache),
      "vocab_cache_ready": vocab_cache_ready,
      "vocab_cache_size": vocab_cache_size
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@app.get("/cache/status")
def cache_status():
  """ดูสถานะของ cache"""
  try:
    cache = load_global_recipes()
    db = init_firebase()
    return {
      "cache_size": len(cache),
      "firebase_connected": db is not None,
      "firebase_app": _firebase_app is not None
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@app.get("/cache/clear")
def clear_cache():
  """ล้าง cache ทั้งหมด"""
  try:
    global _global_recipes_cache
    _global_recipes_cache = {}
    
    # ล้างจาก Firebase
    db = init_firebase()
    if db:
      doc_ref = db.collection('global_recipes').document('all')
      doc_ref.set({
        'recipes': {},
        'updated_at': firestore.SERVER_TIMESTAMP
      })
      print("[FIREBASE] Cleared cache in Firestore")
    
    return {"status": "cache cleared", "cache_size": 0}
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@app.post("/cache/rebuild_vocab")
def rebuild_vocab():
  """Force rebuild vocabulary cache (clear and rebuild with latest filters)"""
  try:
    global _cached_vocab
    old_size = len(_cached_vocab) if _cached_vocab else 0
    
    # Clear vocab cache
    _cached_vocab = None
    print("[API] Vocab cache cleared, will rebuild on next use")
    
    # Trigger rebuild by calling get_filtered_vocab
    model = load_model()
    new_vocab = get_filtered_vocab(model)
    new_size = len(new_vocab)
    
    return {
      "status": "vocab rebuilt",
      "old_size": old_size,
      "new_size": new_size,
      "removed": old_size - new_size,
      "message": f"Rebuilt vocabulary: {old_size:,} → {new_size:,} words"
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@app.post("/cache/force_save")
def force_save():
  """Force save global recipes to Firebase immediately"""
  try:
    print(f"[API] Force saving {len(_global_recipes_cache)} recipes...")
    save_global_recipes()
    return {
      "status": "saved",
      "recipes_count": len(_global_recipes_cache),
      "message": f"Saved {len(_global_recipes_cache)} recipes to Firebase"
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))


@app.post("/warm")
def warm():
  m = load_model()
  # perform a trivial query to ensure norms/caches are hot
  try:
    _ = pick_candidate("Steam", "Steam", m)
  except Exception:
    pass
  return {"status": "warmed"}


class DailyPuzzleRequest(BaseModel):
  date: str  # YYYY-MM-DD format
  seed: Optional[int] = None


# Cache filtered vocab to avoid recomputing every time
_cached_vocab: Optional[List[str]] = None
_lemmatizer: Optional[WordNetLemmatizer] = None
_vocab_lock = threading.Lock()  # Lock for vocabulary cache building
_english_words: Optional[set] = None  # Cache for English words dictionary

# Define words to exclude (articles, pronouns, common function words)
EXCLUDED_WORDS = {
  # Articles
  'a', 'an', 'the',
  # Personal pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  # Possessive pronouns
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'mine', 'yours', 'hers', 'ours', 'theirs',
  # Demonstrative pronouns
  'this', 'that', 'these', 'those',
  # Relative pronouns
  'who', 'whom', 'whose', 'which', 'what',
  # Reflexive pronouns
  'myself', 'yourself', 'himself', 'herself', 'itself',
  'ourselves', 'yourselves', 'themselves',
  # Common conjunctions and prepositions (1-2 letters)
  'of', 'to', 'in', 'on', 'at', 'by', 'or', 'if', 'as', 'so',
  'up', 'no', 'do', 'go', 'am', 'is',
  # Single letters
  'a', 'i', 's', 't', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j',
  'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 'u', 'v', 'w', 'x', 'y', 'z'
}

# Profanity and offensive words to exclude
PROFANITY_WORDS = {
  'ass', 'arse', 'asshole', 'bastard', 'bitch', 'bollocks', 'bugger',
  'cock', 'crap', 'cunt', 'damn', 'dick', 'dickhead', 'fag', 'faggot',
  'fuck', 'fucker', 'fucking', 'hell', 'motherfucker', 'nigga', 'nigger',
  'piss', 'prick', 'pussy', 'shit', 'shite', 'slut', 'tit', 'tits',
  'twat', 'wank', 'wanker', 'whore', 'goddamn', 'bloody', 'bollox',
  'arsehole', 'bellend', 'bullshit', 'shitty', 'retard', 'retarded',
  'coon', 'spic', 'chink', 'gook', 'kike', 'dyke', 'homo', 'tranny'
}

def get_lemmatizer() -> WordNetLemmatizer:
  """Get or create WordNet lemmatizer (singleton)"""
  global _lemmatizer
  if _lemmatizer is None:
    _lemmatizer = WordNetLemmatizer()
  return _lemmatizer

def get_english_words() -> set:
  """Get English words dictionary (cached)"""
  global _english_words
  if _english_words is None:
    print("[AI] Loading English words dictionary for spell checking...")
    try:
      # Try loading from NLTK words corpus first
      _english_words = set(w.lower() for w in nltk_words.words())
      print(f"[AI] ✅ Loaded {len(_english_words):,} English words from NLTK")
    except Exception as e:
      print(f"[AI] ⚠️ Could not load NLTK words: {e}")
      # Fallback: use WordNet vocabulary as dictionary
      from nltk.corpus import wordnet
      _english_words = set()
      for synset in wordnet.all_synsets():
        for lemma in synset.lemmas():
          _english_words.add(lemma.name().lower().replace('_', ''))
      print(f"[AI] ✅ Loaded {len(_english_words):,} English words from WordNet")
  return _english_words

def is_lemma_form(word: str) -> bool:
  """Check if word is in its lemma (base) form"""
  lemmatizer = get_lemmatizer()
  
  # Quick check: reject obvious plural forms ending in 's'
  # (but not words that naturally end in 's' like 'glass', 'pass')
  if word.endswith('s') and len(word) > 3:
    # Reject common plural patterns
    if word.endswith('ies'):  # e.g., "berries" -> "berry"
      return False
    elif word.endswith('ses'):  # e.g., "glasses" -> "glass"
      return False
    elif word.endswith('xes'):  # e.g., "boxes" -> "box"
      return False
    elif word.endswith('ches'):  # e.g., "watches" -> "watch"
      return False
    elif word.endswith('shes'):  # e.g., "wishes" -> "wish"
      return False
    elif word.endswith('zes'):  # e.g., "prizes" -> "prize"
      return False
    elif word.endswith('ces') and len(word) > 4:  # e.g., "distances", "irradiances"
      # But not words like "ace", "ice" 
      if word.endswith('ances') or word.endswith('ences') or word.endswith('ices'):
        return False
    elif word.endswith('ges') and len(word) > 4:  # e.g., "images", "advantages"
      # But not words like "age"
      if word.endswith('ages'):
        return False
  
  # Check against noun, verb, adjective, and adverb lemmas
  try:
    for pos in ['n', 'v', 'a', 'r']:  # noun, verb, adj, adv
      lemma = lemmatizer.lemmatize(word, pos=pos)
      if lemma != word:
        return False  # Word can be lemmatized further, so it's not a base form
    return True  # Word is already in base form
  except Exception as e:
    # If lemmatization fails (e.g., threading issues), assume it's a lemma
    print(f"[AI] Warning: lemmatization failed for '{word}': {e}")
    return True

def get_filtered_vocab(model: KeyedVectors) -> List[str]:
  """Get and cache filtered vocabulary (lemma forms only, clean words)"""
  global _cached_vocab
  
  # Return cached vocab if already built
  if _cached_vocab is not None:
    return _cached_vocab
  
  # Use lock to prevent multiple threads from building vocab simultaneously
  with _vocab_lock:
    # Double-check after acquiring lock
    if _cached_vocab is not None:
      return _cached_vocab
    print("[AI] Building filtered vocabulary cache (lemma forms only - ALL words)...")
    
    # gensim 3.8.x uses index2word, 4.x uses index_to_key
    try:
      vocab = model.index2word  # ALL words (gensim 3.8)
    except AttributeError:
      try:
        vocab = list(model.index_to_key)  # gensim 4.x
      except AttributeError:
        vocab = list(model.key_to_index.keys())  # fallback
    
    # Filter 1: Basic quality filters
    print(f"[AI] Step 1: Filtering {len(vocab):,} words (basic quality)...")
    candidate_words = []
    
    # Load English dictionary for spell checking
    english_words = get_english_words()
    
    for w in vocab:
      # Must be alphabetic (no hyphen, no underscore, no numbers)
      if not (w.isalpha() and w.islower() and '_' not in w):
        continue
      
      # Must be reasonable length (3-20 chars)
      if len(w) < 3 or len(w) > 20:
        continue
      
      # Must be ASCII only (no foreign characters)
      if not all(ord(c) < 128 for c in w):
        continue
      
      # No repetitive patterns (3+ same chars in a row)
      if any(c*3 in w for c in 'abcdefghijklmnopqrstuvwxyz'):
        continue
      
      # Not in excluded words or profanity lists
      if w in EXCLUDED_WORDS or w in PROFANITY_WORDS:
        continue
      
      # Must be valid English word (spell check)
      if w not in english_words:
        continue
      
      candidate_words.append(w)
    
    print(f"[AI] Step 2: Found {len(candidate_words):,} candidate words, filtering for lemma forms...")
    # Keep only words in their lemma (base) form
    _cached_vocab = [
      w for w in candidate_words
      if is_lemma_form(w)
    ]
    
    print(f"[AI] ✨ Vocab cache ready: {len(_cached_vocab):,} clean lemma words")
    print(f"[AI]    (from {len(vocab):,} total → {len(candidate_words):,} candidates → {len(_cached_vocab):,} final)")
    return _cached_vocab


def mulberry32_generator(seed: int):
  """Mulberry32 PRNG - deterministic, matches client-side"""
  state = seed & 0xFFFFFFFF
  def next_float():
    nonlocal state
    state = (state + 0x6D2B79F5) & 0xFFFFFFFF
    t = state
    t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
    t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61)))) & 0xFFFFFFFF
    return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
  return next_float


@app.post("/daily_puzzle")
def generate_daily_puzzle(req: DailyPuzzleRequest):
  """
  Generate a deterministic daily puzzle from Word2Vec vocabulary based on date seed.
  Returns goal word and start words selected from the actual vocabulary.
  """
  try:
    model = load_model()
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Model load error: {e}")
  
  # Get filtered vocabulary (cached)
  good_words = get_filtered_vocab(model)
  if len(good_words) < 100:
    raise HTTPException(status_code=500, detail="Not enough valid words in vocabulary")
  
  # Convert date string to seed (same algorithm as client)
  date_str = req.date
  if req.seed:
    seed = req.seed
  else:
    seed = 0
    for i, c in enumerate(date_str):
      seed = (seed * 31 + ord(c)) & 0xFFFFFFFF
  
  # Use mulberry32 for deterministic selection (matches client)
  rng = mulberry32_generator(seed)
  
  # Determine number of start words (always 2 to match client)
  num_starts = 2
  
  # Try to generate valid puzzle with semantic coherence
  max_attempts = 300  # Increased for EXTREME difficulty with stricter criteria
  best_puzzle = None
  best_coherence = 0.0
  
  for attempt in range(max_attempts):
    # Select goal word (prefer abstract/complex words from middle-high frequency)
    goal_candidates = good_words[1000:10000]  # Skip very common words
    goal_idx = int(rng() * len(goal_candidates))
    goal_word = goal_candidates[goal_idx]
    
    # Skip if goal not in model (shouldn't happen but just in case)
    if goal_word not in model:
      continue
    
    # NEW APPROACH: Find 2 words whose midpoint is near the goal
    # This guarantees that combining the start words will lead toward the goal
    try:
      import numpy as np
      goal_vec = model[goal_word]
      
      # Find words similar to the goal (potential start words)
      similar_to_goal = model.similar_by_vector(goal_vec, topn=500)
      
      # Filter for valid start words (common, not too similar to goal)
      # Use very wide range for harder puzzles: 0.15-0.45 (very far from goal)
      start_candidates = []
      for word, sim in similar_to_goal:
        if word == goal_word:
          continue
        # Want words that are related but EXTREMELY FAR from goal (0.08 < sim < 0.35)
        # This makes puzzles EXTREME difficulty - need 12-20 steps to reach goal
        if 0.08 < sim < 0.35 and word in good_words[:5000]:
          start_candidates.append((word, sim))
      
      if len(start_candidates) < 10:
        continue
      
      # Try to find 2 words whose midpoint is close to goal
      best_pair = None
      best_midpoint_sim = 0.0
      
      # Sample pairs efficiently - increased sampling for EXTREME difficulty
      for i in range(min(40, len(start_candidates))):  # More attempts to find pairs in target range
        idx_a = int(rng() * len(start_candidates))
        word_a, sim_a = start_candidates[idx_a]
        
        for j in range(min(20, len(start_candidates))):  # More inner loop iterations
          idx_b = int(rng() * len(start_candidates))
          if idx_b == idx_a:
            continue
          
          word_b, sim_b = start_candidates[idx_b]
          
          # Calculate midpoint
          vec_a = model[word_a]
          vec_b = model[word_b]
          midpoint = (vec_a + vec_b) / 2.0
          midpoint = midpoint / np.linalg.norm(midpoint)
          
          # Check how close midpoint is to goal
          midpoint_sim = float(np.dot(midpoint, goal_vec) / (np.linalg.norm(goal_vec)))
          
          # For EXTREME difficulty, prefer midpoint in target range (0.35-0.48)
          # This ensures puzzles are neither too easy nor too hard
          if 0.35 <= midpoint_sim <= 0.48:
            if midpoint_sim > best_midpoint_sim:
              best_midpoint_sim = midpoint_sim
              best_pair = (word_a, word_b, sim_a, sim_b)
      
      if not best_pair:
        continue
      
      start_words_lower = [best_pair[0], best_pair[1]]
      avg_coherence = float((best_pair[2] + best_pair[3]) / 2.0)
      max_coherence = float(max(best_pair[2], best_pair[3]))
      
    except Exception as e:
      print(f"[PUZZLE] Error in reverse generation: {e}")
      continue
    
    # VALIDATION: Test if puzzle is actually solvable by simulating gameplay
    # This ensures start words can actually reach the goal
    # Adjusted range for EXTREME puzzles: 0.35-0.48 (extreme difficulty, 12-20 steps)
    if 0.35 <= best_midpoint_sim <= 0.48 and avg_coherence >= 0.18:
      # Simulate playing the puzzle
      discovered = start_words_lower.copy()
      tested_pairs_sim = set()
      solvable = False
      
      for sim_round in range(30):  # Try up to 30 combinations for extreme puzzles
        found_new = False
        for i in range(len(discovered)):
          for j in range(i+1, len(discovered)):
            pair_key = tuple(sorted([discovered[i], discovered[j]]))
            if pair_key in tested_pairs_sim:
              continue
            tested_pairs_sim.add(pair_key)
            
            # Try combining
            result = pick_candidate(discovered[i].capitalize(), discovered[j].capitalize(), model, goal=goal_word)
            if result and result.lower() not in discovered:
              discovered.append(result.lower())
              found_new = True
              
              if result.lower() == goal_word.lower():
                solvable = True
                print(f"[PUZZLE] ✅ Validated solvable in {sim_round + 1} steps: {goal_word}")
                break
              break
          if found_new:
            break
        
        if solvable or not found_new:
          break
      
      # Only accept puzzle if it's solvable AND takes enough steps (12-20 rounds for EXTREME puzzles)
      if solvable and 12 <= sim_round + 1 <= 20:
        if avg_coherence > best_coherence:
          best_coherence = float(avg_coherence)
          best_puzzle = {
            "goal": goal_word,
            "starts": start_words_lower,
            "coherence": float(avg_coherence),
            "max_coherence": float(max_coherence),
            "midpoint_similarity": float(best_midpoint_sim),
            "validated": True  # Mark as validated puzzle
          }
        print(f"[PUZZLE] ✅ Found GOOD puzzle (takes {sim_round + 1} steps) on attempt {attempt + 1}")
        break
      elif solvable and sim_round + 1 < 12:
        print(f"[PUZZLE] ⚠️  Puzzle too easy ({sim_round + 1} steps), trying another... (attempt {attempt + 1})")
      elif solvable:
        print(f"[PUZZLE] ⚠️  Puzzle too hard ({sim_round + 1} steps), trying another... (attempt {attempt + 1})")
      else:
        print(f"[PUZZLE] ⚠️  Puzzle not solvable, trying another... (attempt {attempt + 1})")
    else:
      # Keep track of best puzzle even if not in ideal range (but only if close enough)
      # For EXTREME mode, be VERY STRICT - only accept if slightly outside target range
      if avg_coherence > best_coherence and 0.32 <= best_midpoint_sim <= 0.50:
        best_coherence = float(avg_coherence)
        best_puzzle = {
          "goal": goal_word,
          "starts": start_words_lower,
          "coherence": float(avg_coherence),
          "max_coherence": float(max_coherence),
          "midpoint_similarity": float(best_midpoint_sim),
          "validated": False  # Not validated (outside ideal range)
        }
  
  # Use best VALIDATED puzzle found
  # Only use puzzles that passed validation (are within ideal range and solvable)
  if best_puzzle:
    goal_word = best_puzzle["goal"].capitalize()
    start_words = [w.capitalize() for w in best_puzzle["starts"]]
    coherence = float(best_puzzle["coherence"])
    max_coh = float(best_puzzle.get("max_coherence", 0.0))
    midpoint_sim = float(best_puzzle.get("midpoint_similarity", 0.0))
    
    # Validate puzzle is within acceptable range for EXTREME difficulty
    if midpoint_sim < 0.35:
      print(f"[PUZZLE] ⚠️  Best puzzle has low midpoint similarity ({midpoint_sim:.3f}), might be too hard - REJECTED")
      best_puzzle = None  # Reject puzzle that's too hard
    elif midpoint_sim > 0.48:
      print(f"[PUZZLE] ⚠️  Puzzle is too easy (midpoint_sim={midpoint_sim:.3f}) - REJECTED")
      best_puzzle = None  # Reject puzzle that's too easy
    else:
      print(f"[PUZZLE] ✅ Using validated puzzle with balanced difficulty (midpoint_sim={midpoint_sim:.3f}), coherence avg={coherence:.3f}")
    
    # If puzzle was rejected, raise error (no fallback for EXTREME mode)
    if not best_puzzle:
      print(f"[PUZZLE] ❌ Could not generate suitable EXTREME difficulty puzzle for {date_str} after {max_attempts} attempts")
      raise HTTPException(status_code=500, detail=f"Could not generate EXTREME difficulty puzzle (midpoint must be 0.35-0.48)")
    
    # Determine version based on whether puzzle was validated
    is_validated = best_puzzle.get("validated", False)
    version = "2.0" if is_validated else "1.5"  # 2.0 = validated (12-20 steps), 1.5 = best effort
    
    return {
      "date": date_str,
      "goalWord": goal_word,
      "startWords": start_words,
      "vocab_size": len(good_words),
      "seed": seed,
      "coherence": round(coherence, 3),
      "max_coherence": round(max_coh, 3),
      "midpoint_similarity": round(midpoint_sim, 3),
      "version": version,
      "validated": is_validated
    }
  else:
    raise HTTPException(status_code=500, detail="Could not generate valid puzzle")


# Preload model on startup (in background thread to not block server start)
def preload_model():
  """Preload model in background to speed up first request"""
  import time
  time.sleep(2)  # Wait for server to start
  try:
    print("[AI] Preloading model...")
    load_model()
    print("[AI] Model preloaded successfully!")
  except Exception as e:
    print(f"[AI] Failed to preload model: {e}")

# Start preloading in background
preload_thread = threading.Thread(target=preload_model, daemon=True)
preload_thread.start()

# Preload global recipes cache on startup
print("[CACHE] Triggering global recipes preload...")
load_global_recipes()


