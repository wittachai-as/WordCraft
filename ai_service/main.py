import os
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from collections import Counter

# gensim 3.8.x compatible
from gensim.models import KeyedVectors

app = FastAPI()

# CORS for web clients
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],   # ใส่โดเมนของคุณแทน "*" หากต้องการจำกัด
  allow_credentials=False,
  allow_methods=["*"],
  allow_headers=["*"],
)

MODEL_PATH = os.getenv("MODEL_PATH", "/app/word2vec_model.vec")
MODEL_BINARY = MODEL_PATH.endswith('.bin') or MODEL_PATH.endswith('.gz')
try:
  MODEL_LIMIT = int(os.getenv("MODEL_LIMIT", "0") or "0")  # 0 = no limit
except Exception:
  MODEL_LIMIT = 0

_model: Optional[KeyedVectors] = None


def load_model() -> KeyedVectors:
  global _model
  if _model is None:
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


def is_english_word(word: str) -> bool:
  """เช็คว่าเป็นคำภาษาอังกฤษหรือไม่"""
  # กรองคำที่ไม่ใช่ภาษาอังกฤษ (เช่น เยอรมัน, ฝรั่งเศส, ฯลฯ)
  non_english_patterns = [
    'ä', 'ö', 'ü', 'ß',  # เยอรมัน
    'é', 'è', 'ê', 'ë', 'à', 'â', 'ç',  # ฝรั่งเศส
    'ñ', 'í', 'ó', 'ú',  # สเปน
    'å', 'ø', 'æ',  # นอร์เวย์/เดนมาร์ก
    'č', 'š', 'ž',  # เช็ก/สโลวัก
    'ł', 'ą', 'ę',  # โปแลนด์
  ]
  
  word_lower = word.lower()
  return not any(pattern in word_lower for pattern in non_english_patterns)

# 1. คำสะกดแบบอังกฤษ -> แปลงเป็น US (ใช้ regex pattern)
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
  ]
  
  for pattern, replacement in patterns:
    if re.search(pattern, word_lower) and len(word_lower) > 4:
      return re.sub(pattern, replacement, word_lower)
  
  return word_lower

# 2. ชื่อเฉพาะ - ใช้ Pattern Recognition
def is_proper_noun(word: str) -> bool:
  # กรองคำที่ขึ้นต้นด้วยตัวใหญ่ (Capitalized)
  if word[0].isupper() and len(word) > 1:
    return True
  
  # กรองคำที่มี underscore (มักเป็นชื่อเฉพาะ)
  if '_' in word:
    return True
  
  # กรองคำที่มีตัวเลข
  if any(char.isdigit() for char in word):
    return True
  
  # กรองคำที่ยาวมาก (มักเป็นชื่อเฉพาะ)
  if len(word) > 15:
    return True
  
  return False

# 3. คำผันรูป - ใช้ Pattern Recognition
def is_inflected_word(word: str) -> bool:
  word_lower = word.lower()
  
  # ใช้ regex pattern แทน hard-coded list
  inflection_patterns = [
    r's$', r'es$', r'ies$',  # พหูพจน์
    r'ed$', r'ing$', r'er$', r'est$',  # กริยา/คุณศัพท์ผัน
    r'ly$', r'ness$', r'ment$', r'tion$', r'sion$',  # คำนาม/คำวิเศษณ์
    r'ful$', r'less$', r'ous$', r'ive$', r'able$', r'ible$'  # คำคุณศัพท์
  ]
  
  for pattern in inflection_patterns:
    if re.search(pattern, word_lower) and len(word_lower) > len(pattern) + 2:
      return True
  
  return False

# 4. คำหยาบคาย - ใช้ Pattern Recognition
def is_profane_word(word: str) -> bool:
  word_lower = word.lower()
  
  # ใช้ pattern แทน hard-coded list
  profane_patterns = [
    r'f[ck]', r'sh[it]', r'd[amn]', r'h[ell]', r'b[itch]',
    r'a[ss]', r'c[rap]', r'p[iss]', r'b[astard]'
  ]
  
  for pattern in profane_patterns:
    if re.search(pattern, word_lower):
      return True
  
  return False

# 5. คำหยาบ - ใช้ Pattern Recognition
def is_stop_word(word: str) -> bool:
  word_lower = word.lower()
  
  # ใช้ pattern แทน hard-coded list
  stop_patterns = [
    r'^[aeiou]$',  # คำ 1 ตัวอักษรที่เป็นสระ
    r'^[a-z]{1,2}$',  # คำ 1-2 ตัวอักษร
    r'^(the|and|or|but|in|on|at|to|for|of|with|by)$'  # คำเชื่อมพื้นฐาน
  ]
  
  for pattern in stop_patterns:
    if re.search(pattern, word_lower):
      return True
  
  return False

# 6. ความยาว - ใช้ Dynamic Range
def is_valid_length(word: str) -> bool:
  length = len(word)
  return 3 <= length <= 12  # 3-12 ตัวอักษร

# 7. คำโบราณ/คลุมเครือ - ใช้ Word Frequency จาก Model
def is_common_word(word: str, model) -> bool:
  """ใช้ word frequency จาก model แทน hard-coded list"""
  
  if word.lower() not in model:
    return False
  
  # เช็คว่าคำนี้มี similarity สูงกับคำอื่นๆ ใน model หรือไม่
  try:
    # หาคำที่คล้ายกัน 10 อันดับแรก
    similar_words = model.most_similar(word.lower(), topn=10)
    # ถ้ามีคำที่คล้ายกันมาก = เป็นคำที่ใช้บ่อย
    if len(similar_words) > 5:
      return True
  except:
    pass
  
  return False

# ฟังก์ชันหลักสำหรับกรองคำ
def filter_word(word: str, model) -> bool:
  """กรองคำตาม 7 เกณฑ์แบบ Dynamic"""
  
  # ตรวจสอบความยาว
  if not is_valid_length(word):
    return False
  
  # ตรวจสอบคำหยาบคาย
  if is_profane_word(word):
    return False
  
  # ตรวจสอบคำหยาบ
  if is_stop_word(word):
    return False
  
  # ตรวจสอบชื่อเฉพาะ
  if is_proper_noun(word):
    return False
  
  # ตรวจสอบคำผันรูป
  if is_inflected_word(word):
    return False
  
  # ตรวจสอบคำโบราณ/คลุมเครือ (ใช้ model)
  if not is_common_word(word, model):
    return False
  
  return True

def is_trivial(candidate: str, a: str, b: str) -> bool:
  c = candidate.lower()
  s = {a.lower(), b.lower()}
  if c in s:
    return True
  if c.endswith('s') and c[:-1] in s:
    return True
  if any(x.endswith('s') and x[:-1] == c for x in s):
    return True
  return False


def pick_candidate(a: str, b: str, model: KeyedVectors) -> Optional[str]:
  a_l, b_l = a.lower(), b.lower()
  try:
    # intersection of top similar
    if a_l in model and b_l in model:
      sim_a = model.most_similar(a_l, topn=50)
      sim_b = model.most_similar(b_l, topn=50)
      set_a = {w for w, _ in sim_a}
      set_b = {w for w, _ in sim_b}
      inter = [w for w in set_a.intersection(set_b)]
      scored = []
      for w in inter:
        if w.isalpha() and len(w) > 2 and not is_trivial(w, a, b) and is_english_word(w) and filter_word(w, model):
          sa = next((s for ww, s in sim_a if ww == w), 0)
          sb = next((s for ww, s in sim_b if ww == w), 0)
          scored.append((w, (sa + sb) / 2.0))
      if scored:
        scored.sort(key=lambda x: x[1], reverse=True)
        best_word = scored[0][0]
        # normalize to American spelling
        normalized = normalize_uk_to_us(best_word)
        return normalized.capitalize()

    # vector arithmetic fallback
    if a_l in model and b_l in model:
      vec = model[a_l] + model[b_l]
      for w, _ in model.similar_by_vector(vec, topn=30):
        if w.isalpha() and len(w) > 2 and not is_trivial(w, a, b) and is_english_word(w) and filter_word(w, model):
          normalized = normalize_uk_to_us(w)
          return normalized.capitalize()
  except Exception:
    pass
  return None


class CombineRequest(BaseModel):
  a: str
  b: str


@app.post("/combine")
def combine(req: CombineRequest):
  try:
    model = load_model()
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Model load error: {e}")
  name = pick_candidate(req.a, req.b, model)
  if not name:
    raise HTTPException(status_code=404, detail="No combination")
  return {"id": name.lower().replace(' ', '-'), "name": name, "type": "result"}


@app.get("/health")
def health():
  try:
    m = load_model()
    vocab = len(getattr(m, 'index2word', [])) or (getattr(m, 'key_to_index', None) and len(m.key_to_index)) or 0
    return {"status": "ok", "vocab": vocab, "limit": MODEL_LIMIT}
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


