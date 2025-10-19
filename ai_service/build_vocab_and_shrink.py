#!/usr/bin/env python3
import argparse
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set, Tuple


WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]+")
DEFAULT_EXTS = {".json", ".js", ".jsx", ".ts", ".tsx", ".py", ".md", ".txt"}
IGNORE_DIRS = {"node_modules", "__pycache__", ".git", ".cursor", ".agent-tools"}


def iter_files(roots: Sequence[Path], allow_exts: Set[str]) -> Iterable[Path]:
  for root in roots:
    if root.is_file():
      if root.suffix.lower() in allow_exts:
        yield root
      continue
    for p in root.rglob("*"):
      if p.is_dir():
        if p.name in IGNORE_DIRS:
          # skip walking into ignored dirs
          try:
            p.rmdir()
          except Exception:
            pass
        continue
      if p.suffix.lower() in allow_exts:
        yield p


def extract_words_from_text(text: str) -> List[str]:
  return WORD_RE.findall(text)


def read_text(path: Path) -> str:
  try:
    return path.read_text(encoding="utf-8", errors="ignore")
  except Exception:
    return ""


def simple_lemmatize_heuristic(token: str) -> str:
  t = token.lower()
  # Basic exceptions to avoid over-stemming
  exceptions = {"bus", "gas", "thesis", "analysis", "basis", "news", "series"}
  if t in exceptions:
    return t
  # Plural forms
  if t.endswith("ies") and len(t) > 4:
    return t[:-3] + "y"
  if t.endswith("ves") and len(t) > 4:
    return t[:-3] + "f"
  if t.endswith("ses") and len(t) > 4:
    return t[:-2]
  if t.endswith("s") and len(t) > 3 and not t.endswith("ss"):
    return t[:-1]
  # Verb/adjective endings
  if t.endswith("ing") and len(t) > 5:
    base = t[:-3]
    if base.endswith("pp") or base.endswith("tt") or base.endswith("gg"):
      base = base[:-1]
    return base
  if t.endswith("ed") and len(t) > 4:
    base = t[:-2]
    if base.endswith("pp") or base.endswith("tt") or base.endswith("gg"):
      base = base[:-1]
    return base
  if t.endswith("er") and len(t) > 4:
    return t[:-2]
  if t.endswith("est") and len(t) > 5:
    return t[:-3]
  # Nominalizations/adverbs (keep it conservative)
  for suf in ("ly", "ness", "ment"):
    if t.endswith(suf) and len(t) > len(suf) + 2:
      return t[: -len(suf)]
  return t


def try_nltk_lemmatize(tokens: Iterable[str]) -> Optional[List[str]]:
  try:
    import nltk  # type: ignore
    from nltk.stem import WordNetLemmatizer  # type: ignore
  except Exception:
    return None

  try:
    # ensure wordnet downloaded
    import nltk
    try:
      nltk.data.find('corpora/wordnet')
    except LookupError:
      nltk.download('wordnet', quiet=True)
  except Exception:
    pass

  lemmatizer = WordNetLemmatizer()
  results: List[str] = []
  for w in tokens:
    lw = w.lower()
    if not lw.isalpha():
      continue
    # try noun then verb as naive POS
    lemma = lemmatizer.lemmatize(lw, pos='n')
    lemma_v = lemmatizer.lemmatize(lw, pos='v')
    # choose shorter (often closer to base form in practice)
    lemma = lemma if len(lemma) <= len(lemma_v) else lemma_v
    results.append(lemma)
  return results


def build_vocab(roots: Sequence[Path], min_count: int) -> Tuple[Set[str], Counter]:
  vocab: Counter = Counter()
  for fp in iter_files(roots, DEFAULT_EXTS):
    text = read_text(fp)
    if not text:
      continue
    for w in extract_words_from_text(text):
      lw = w.lower()
      if lw.isalpha():
        vocab[lw] += 1
  # filter by min_count
  words = {w for w, c in vocab.items() if c >= min_count}
  return words, vocab


def write_list(path: Path, words: Iterable[str]) -> None:
  with path.open("w", encoding="utf-8") as f:
    for w in sorted(set(words)):
      f.write(w + "\n")


def main() -> int:
  p = argparse.ArgumentParser(description="Build vocab from project files, lemmatize, and shrink .vec using shrink_vec.py")
  p.add_argument("--input-vec", required=True, help="ไฟล์ .vec/.vec.gz ต้นฉบับ")
  p.add_argument("--output-vec", required=True, help="ไฟล์ .vec/.vec.gz ปลายทาง")
  p.add_argument("--roots", nargs="+", required=False, help="ไดเรกทอรี/ไฟล์ที่ใช้สแกน vocab (ดีฟอลต์: โปรเจกต์หลัก)")
  p.add_argument("--extra-keep", required=False, help="ไฟล์รายชื่อคำเพิ่มเติม")
  p.add_argument("--min-count", type=int, default=1, help="ตัดคำที่พบน้อยกว่าค่านี้ (ดีฟอลต์=1)")
  p.add_argument("--lowercase", action="store_true", help="ทำงานแบบตัวพิมพ์เล็กทั้งหมด")
  p.add_argument("--dry-run", action="store_true", help="แสดงสถิติ/ไฟล์ keep ที่สร้าง โดยไม่เรียกย่อ .vec")
  args = p.parse_args()

  project_root = Path(__file__).resolve().parents[1]
  default_roots = [
    project_root / "mobile",
    project_root / "wordcraft_game",
    project_root,  # seed*.json ที่รากโปรเจกต์
  ]
  roots: List[Path] = [Path(p).resolve() for p in (args.roots or [])]
  if not roots:
    roots = default_roots

  words, counts = build_vocab(roots, min_count=max(1, args.min_count))
  print(f"[build] scanned words >={args.min_count}: {len(words)} unique")

  # Try NLTK first; fallback to heuristic
  lemmatized: Optional[List[str]] = try_nltk_lemmatize(words)
  if lemmatized is None:
    lemmatized = [simple_lemmatize_heuristic(w) for w in words]

  lemma_set: Set[str] = {w.lower() for w in lemmatized if w}

  if args.extra_keep and os.path.exists(args.extra_keep):
    extra = Path(args.extra_keep).read_text(encoding="utf-8").splitlines()
    lemma_set.update(w.strip().lower() for w in extra if w.strip() and not w.lstrip().startswith('#'))

  gen_keep = project_root / "ai_service" / ".generated_keep_words.txt"
  write_list(gen_keep, lemma_set)
  print(f"[build] generated keep-list: {gen_keep} ({len(lemma_set)} words)")

  if args.dry_run:
    print("[build] dry-run: skip shrinking. Done.")
    return 0

  shrink_script = project_root / "ai_service" / "shrink_vec.py"
  if not shrink_script.exists():
    print(f"[build] shrink script not found: {shrink_script}", file=sys.stderr)
    return 2

  cmd = [
    sys.executable,
    str(shrink_script),
    "--input", str(Path(args.input_vec).resolve()),
    "--output", str(Path(args.output_vec).resolve()),
    "--keep-list", str(gen_keep),
    "--lemma-only",
    "--lowercase" if args.lowercase else "",
  ]
  cmd = [c for c in cmd if c]
  print("[build] run:", " ".join(cmd))
  try:
    subprocess.check_call(cmd)
  except subprocess.CalledProcessError as e:
    return e.returncode or 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


