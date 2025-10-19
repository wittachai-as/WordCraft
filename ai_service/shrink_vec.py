#!/usr/bin/env python3
import argparse
import gzip
import io
import os
import sys
from typing import Callable, Iterable, Optional, Set, Tuple


def read_keep_words(path: str, to_lower: bool) -> Set[str]:
  """อ่านไฟล์รายชื่อคำ (บรรทัดละคำ). ข้ามบรรทัดว่าง/ที่ขึ้นต้นด้วย #
  คืนค่าเป็น set ของคำสำหรับกรอง
  """
  keep: Set[str] = set()
  with open(path, "r", encoding="utf-8") as f:
    for line in f:
      text = line.strip()
      if not text or text.startswith("#"):
        continue
      keep.add(text.lower() if to_lower else text)
  return keep


def open_any(path: str, mode: str):
  """เปิดไฟล์ .vec หรือ .vec.gz ตามนามสกุล"""
  if path.endswith(".gz"):
    return gzip.open(path, mode)
  return open(path, mode)


def peek_header(path: str) -> Tuple[int, int]:
  """อ่านบรรทัดแรกเพื่อดึง (จำนวนคำ, มิติ) ของไฟล์ word2vec (.vec หรือ .vec.gz)
  ไม่ทำการตรวจสอบเชิงลึก เพียง parse ตัวเลขสองค่าแรก
  """
  with open_any(path, "rt") as f:  # type: ignore[arg-type]
    header = f.readline()
  parts = header.strip().split()
  if len(parts) < 2:
    raise ValueError("Invalid .vec header: expected '<vocab> <dim>'")
  try:
    vocab = int(parts[0])
    dim = int(parts[1])
  except Exception as e:
    raise ValueError(f"Invalid header numbers: {parts[:2]}") from e
  return vocab, dim


def iter_word_lines(path: str) -> Iterable[str]:
  """วนซ้ำบรรทัดเวคเตอร์ (ข้ามบรรทัดแรก) แบบสตริมมิ่ง"""
  with open_any(path, "rt") as f:  # type: ignore[arg-type]
    # ข้าม header
    _ = f.readline()
    for line in f:
      yield line


def get_token_from_line(line: str, lower: bool) -> str:
  """ดึงโทเคนคำจากบรรทัดเวคเตอร์ โดยถือว่าโทเคนเป็นส่วนแรกก่อนตัวเลข"""
  # ใช้ split หนึ่งครั้งเพื่อประสิทธิภาพ: แยก token และส่วนเวคเตอร์คร่าวๆ
  # หมายเหตุ: ถ้าโทเคนมีช่องว่างจริง (ผิดรูปแบบมาตรฐาน) โค้ดนี้จะไม่รองรับ
  token = line.strip().split(" ", 1)[0]
  return token.lower() if lower else token


def is_proper_noun(token: str) -> bool:
  if not token:
    return False
  if token[0].isupper() and len(token) > 1:
    return True
  if '_' in token:
    return True
  if any(ch.isdigit() for ch in token):
    return True
  if len(token) > 20:
    return True
  return False


def is_inflected_word(token: str) -> bool:
  t = token.lower()
  # รูปพหูพจน์พื้นฐานและคำลงท้ายทั่วไป (เฮอริสติกส์อย่างง่าย)
  suffixes = (
    "ies", "ves", "ses", "xes", "zes", "ches", "shes",
    "s", "ed", "ing", "er", "est", "ly", "ness", "ment", "tion", "sion",
  )
  # กัน false positive ขั้นพื้นฐาน
  exceptions = {"bus", "gas", "thesis", "analysis", "basis", "news", "series"}
  if t in exceptions:
    return False
  # ยอมรับเฉพาะ a-z ล้วนเพื่อเลี่ยงสัญลักษณ์/สคริปต์อื่น
  if not t.isalpha():
    return True
  for s in suffixes:
    if len(t) > len(s) + 2 and t.endswith(s):
      return True
  return False


def is_lemma_like(token: str) -> bool:
  # เล็งเฉพาะคำตัวเล็ก a-z ที่ไม่น่าจะเป็นชื่อเฉพาะและไม่ดูเหมือนผันรูป
  if not token:
    return False
  if token != token.lower():
    return False
  if not token.isalpha():
    return False
  if is_proper_noun(token):
    return False
  if is_inflected_word(token):
    return False
  # ความยาวขั้นต่ำป้องกัน noise
  return 2 <= len(token) <= 20


def count_kept(input_path: str, predicate: Callable[[str], bool], lower: bool) -> int:
  count = 0
  for line in iter_word_lines(input_path):
    if not line.strip():
      continue
    token = get_token_from_line(line, lower)
    if predicate(token):
      count += 1
  return count


def write_shrunk(input_path: str, output_path: str, predicate: Callable[[str], bool], dim: int, lower: bool) -> int:
  """เขียนไฟล์ .vec ใหม่เฉพาะคำที่อยู่ใน keep
  คืนค่าจำนวนคำที่ถูกเขียนจริง
  """
  written = 0
  with open_any(output_path, "wt") as out_f:  # type: ignore[arg-type]
    # header จะถูกเขียนภายหลังด้วยจำนวนคำจริง แต่เพื่อความเรียบง่าย
    # เราจะเขียน header ที่มีจำนวนคำเป็น placeholder แล้ว seek กลับมาแก้
    header_placeholder = f"0 {dim}\n"
    out_f.write(header_placeholder)

    for line in iter_word_lines(input_path):
      s = line.strip()
      if not s:
        continue
      token = get_token_from_line(s, lower)
      if predicate(token):
        out_f.write(s + "\n")
        written += 1

    # แก้ไข header ด้วยจำนวนคำจริง
    # gzip ไม่รองรับการ seek เขียนทับได้สะดวก เราจึงต้องเขียนลงบัฟเฟอร์ชั่วคราวเมื่อเป็น .gz
    if output_path.endswith(".gz"):
      # สร้างไฟล์ใหม่อีกครั้งด้วย header ที่ถูกต้อง แล้วคัดลอกเนื้อหาเดิมยกเว้น headerเดิม
      out_f.flush()
  
  if output_path.endswith(".gz"):
    # อ่านเนื้อหาเดิม
    with gzip.open(output_path, "rt") as f_in:  # type: ignore[arg-type]
      lines = f_in.readlines()
    # เขียนใหม่พร้อม header ที่ถูกต้อง
    with gzip.open(output_path, "wt") as f_out:  # type: ignore[arg-type]
      f_out.write(f"{written} {dim}\n")
      f_out.writelines(lines[1:])
  else:
    # แก้ไขไฟล์ข้อความธรรมดาแบบ in-place โดยอ่านทั้งหมดแล้วเขียนกลับ
    with open(output_path, "r+", encoding="utf-8") as f:
      content = f.read()
      f.seek(0)
      f.write(f"{written} {dim}\n")
      f.write(content.split("\n", 1)[1] if "\n" in content else "")
      f.truncate()

  return written


def main() -> int:
  p = argparse.ArgumentParser(description="Shrink a word2vec .vec/.vec.gz by keeping only specified words")
  p.add_argument("--input", required=True, help="เส้นทางไฟล์ต้นฉบับ .vec หรือ .vec.gz")
  p.add_argument("--output", required=True, help="เส้นทางไฟล์ผลลัพธ์ .vec หรือ .vec.gz")
  p.add_argument("--keep-list", required=False, help="ไฟล์รายชื่อคำที่ต้องการเก็บ (บรรทัดละคำ)")
  p.add_argument("--lowercase", action="store_true", help="แปลงคำใน keep-list และโทเคนให้เป็นตัวพิมพ์เล็กก่อนเทียบ")
  p.add_argument("--lemma-only", action="store_true", help="คัดเฉพาะคำที่ดูเป็น lemma (เฮอริสติกส์)")
  args = p.parse_args()

  if not os.path.exists(args.input):
    print(f"[shrink] input not found: {args.input}", file=sys.stderr)
    return 2
  keep: Optional[Set[str]] = None
  if args.keep_list:
    if not os.path.exists(args.keep_list):
      print(f"[shrink] keep-list not found: {args.keep_list}", file=sys.stderr)
      return 2
    keep = read_keep_words(args.keep_list, to_lower=args.lowercase)
    if not keep:
      print("[shrink] keep-list is empty after parsing", file=sys.stderr)
      return 3

  vocab, dim = peek_header(args.input)
  print(f"[shrink] source vocab={vocab} dim={dim}")

  def predicate(token: str) -> bool:
    if args.lemma_only and not is_lemma_like(token):
      return False
    if keep is not None and token not in keep:
      return False
    return True

  kept_count = count_kept(args.input, predicate, lower=args.lowercase)
  if kept_count == 0:
    print("[shrink] no words from keep-list found in source model", file=sys.stderr)
    return 4
  print(f"[shrink] will keep ~{kept_count} tokens")

  written = write_shrunk(args.input, args.output, predicate, dim, lower=args.lowercase)
  print(f"[shrink] written {written} tokens -> {args.output}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


