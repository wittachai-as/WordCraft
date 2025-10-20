import os
import re
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Tuple, Dict

# gensim 3.8.x compatible
from gensim.models import KeyedVectors

# Firebase
import firebase_admin
from firebase_admin import credentials, firestore

# NLTK for lemmatization
import nltk
from nltk.stem import WordNetLemmatizer
import threading

# Download WordNet data if not already present
try:
  nltk.data.find('corpora/wordnet')
except LookupError:
  print("[AI] Downloading WordNet data...")
  nltk.download('wordnet', quiet=True)
  nltk.download('omw-1.4', quiet=True)


def is_logical_combination(a: str, b: str, result: str) -> bool:
  """ตรวจสอบว่าผลลัพธ์มีความเชื่อมโยงทางตรรกะกับ input หรือไม่"""
  a_l, b_l, result_l = a.lower(), b.lower(), result.lower()
  
  # ตรวจสอบว่าไม่ใช่คำเดิมเท่านั้น
  if result_l in [a_l, b_l]:
    return False

  return True



def choose_best_with_knowledge(a: str, b: str, cands: List[str], model: KeyedVectors) -> Optional[str]:
  # 1) Filter out original words
  filtered: List[str] = []
  a_l, b_l = a.lower(), b.lower()
  
  for w in cands:
    wl = w.lower()
    # เอาแค่คำที่ไม่ใช่คำเดิม
    if wl not in [a_l, b_l]:
      filtered.append(w)

  if not filtered:
    return None

  # 2) Find the word that is most "in the middle" between a and b
  best_word = None
  best_middle_score = float('inf')  # ต้องการคะแนนที่ต่ำที่สุด (ใกล้เคียงกับทั้งสองคำเท่าๆ กัน)
  
  for w in filtered:
    wl = w.lower()
    
    # คำนวณระยะห่างจากคำ a และ b
    try:
      if a_l in model and b_l in model and wl in model:
        # ใช้ cosine distance (1 - similarity)
        dist_a = 1 - model.similarity(a_l, wl)
        dist_b = 1 - model.similarity(b_l, wl)
        
        # คะแนน "ตรงกลาง" = ความแตกต่างของระยะห่าง (ยิ่งน้อยยิ่งดี)
        middle_score = abs(dist_a - dist_b)
        
        if middle_score < best_middle_score:
          best_middle_score = middle_score
          best_word = w
    except (KeyError, ValueError) as e:
      print(f"[AI] Error computing similarity for word '{w}': {e}")
      continue

  if best_word:
    return normalize_uk_to_us(best_word).capitalize()
  else:
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

# Use relative path for default model location
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "word2vec_model.vec")
MODEL_PATH = os.getenv("MODEL_PATH", DEFAULT_MODEL_PATH)
# .vec and .vec.gz เป็นไฟล์ข้อความ; .bin และ .bin.gz เป็นไบนารี
MODEL_BINARY = MODEL_PATH.endswith('.bin') or MODEL_PATH.endswith('.bin.gz')
try:
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
_global_recipes_cache: Dict[str, str] = {}

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
  """โหลด global recipes จาก Firebase (lazy loading, non-blocking)"""
  global _global_recipes_cache
  
  if _global_recipes_cache is None:
    # เริ่มต้นด้วย empty dict (ไม่ block)
    _global_recipes_cache = {}
    
    # Load จาก Firebase ใน background thread
    import threading
    
    def load_in_background():
      global _global_recipes_cache
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
            print(f"[FIREBASE] ✅ Loaded {len(recipes)} recipes from Firestore")
          else:
            print("[FIREBASE] No recipes found, starting fresh")
        else:
          print("[FIREBASE] Not configured, using local cache only")
      except Exception as e:
        print(f"[FIREBASE] ⚠️ Could not load recipes (will use local cache): {e}")
    
    # Start background loading (non-blocking)
    thread = threading.Thread(target=load_in_background, daemon=True)
    thread.start()
    print("[CACHE] Started with empty cache, loading from Firebase in background...")
  
  return _global_recipes_cache

def save_global_recipes():
  """บันทึก global recipes ลง Firebase (async, non-blocking)"""
  import threading
  
  def save_async():
    try:
      db = init_firebase()
      if db:
        # บันทึกลง Firestore collection 'global_recipes' with timeout
        doc_ref = db.collection('global_recipes').document('all')
        doc_ref.set({
          'recipes': _global_recipes_cache,
          'updated_at': firestore.SERVER_TIMESTAMP
        }, timeout=10.0)  # 10 second timeout
        print(f"[FIREBASE] ✅ Saved {len(_global_recipes_cache)} recipes to Firestore")
      else:
        print("[FIREBASE] ⚠️ Not configured, skipping save")
    except Exception as e:
      print(f"[FIREBASE] ⚠️ Could not save recipes (cached locally): {e}")
  
  # Run in background thread (non-blocking)
  thread = threading.Thread(target=save_async, daemon=True)
  thread.start()

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


def pick_candidate(a: str, b: str, model: KeyedVectors) -> Optional[str]:
  a_l, b_l = a.lower(), b.lower()
  try:
    candidates: List[str] = []

    # intersection candidates
    if a_l in model and b_l in model:
      sim_a = model.most_similar(a_l, topn=100)
      sim_b = model.most_similar(b_l, topn=100)
      set_a = {w for w, _ in sim_a}
      set_b = {w for w, _ in sim_b}
      candidates += [w for w in set_a.intersection(set_b)]

    # semantic averaging candidates
    if a_l in model and b_l in model:
      vec = (model[a_l] + model[b_l]) / 2  # Semantic Averaging
      candidates += [w for w, _ in model.similar_by_vector(vec, topn=200)]

    # local neighborhoods
    for src in (a_l, b_l):
      if src in model:
        try:
          candidates += [w for w, _ in model.most_similar(src, topn=200)]
        except Exception as e:
          print(f"[AI] Error getting similar words for '{src}': {e}")
          pass

    # ✅ กรอง candidates ให้เหลือแต่คำที่ผ่านเกณฑ์คุณภาพ
    before_filter = len(candidates)
    candidates = [w for w in candidates if is_valid_result_word(w)]
    after_filter = len(candidates)
    print(f"[FILTER] {a} + {b}: {before_filter} candidates → {after_filter} after filtering")

    # unique preserve order
    seen = set()
    uniq: List[str] = []
    for w in candidates:
      if w not in seen:
        seen.add(w)
        uniq.append(w)
    
    print(f"[FILTER] {a} + {b}: {len(uniq)} unique candidates for selection")

    chosen = choose_best_with_knowledge(a_l, b_l, uniq, model)
    if chosen:
      return chosen
  except Exception as e:
    print(f"[AI] Error in pick_candidate for '{a}' + '{b}': {e}")
    pass
  return None


class CombineRequest(BaseModel):
  a: str
  b: str


@app.post("/combine")
def combine(req: CombineRequest):
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
  
  # 1. ลองหาจาก cache ก่อน
  cached_result = get_cached_result(a_normalized, b_normalized)
  if cached_result:
    print(f"[CACHE] Found cached result: {a_normalized} + {b_normalized} = {cached_result}")
    return {"id": cached_result.lower().replace(' ', '-'), "name": cached_result, "type": "result", "source": "cache"}
  
  # 2. ถ้าไม่มีใน cache ให้ใช้ AI สร้างใหม่
  print(f"[AI] Generating new result for: {a_normalized} + {b_normalized}")
  name = pick_candidate(req.a, req.b, model)
  print(f"[AI] pick_candidate returned: {name}")
  if not name:
    print(f"[AI] No valid combination found")
    raise HTTPException(status_code=404, detail="No combination")
  
  # 3. บันทึกผลลัพธ์ใหม่ลง cache
  cache_result(a_normalized, b_normalized, name)
  print(f"[CACHE] Cached new result: {a_normalized} + {b_normalized} = {name}")
  
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

def is_lemma_form(word: str) -> bool:
  """Check if word is in its lemma (base) form"""
  lemmatizer = get_lemmatizer()
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
  
  # Select goal word (prefer abstract/complex words from middle-high frequency)
  goal_candidates = good_words[1000:10000]  # Skip very common words
  goal_idx = int(rng() * len(goal_candidates))
  goal_word = goal_candidates[goal_idx].capitalize()
  
  # Determine number of start words (always 2 to match client)
  num_starts = 2
  
  # Select start words (prefer common concrete words)
  start_candidates = [w for w in good_words[100:5000] if w != goal_word.lower()]
  start_words: List[str] = []
  pool = start_candidates[:]
  
  for _ in range(num_starts):
    if not pool:
      break
    idx = int(rng() * len(pool))
    start_words.append(pool[idx].capitalize())
    pool.pop(idx)  # Remove to avoid duplicates
  
  return {
    "date": date_str,
    "goalWord": goal_word,
    "startWords": start_words,
    "vocab_size": len(good_words),
    "seed": seed
  }


