#!/usr/bin/env python3
"""
Update global_recipes.json by computing missing pairs via AI model, then seed Firestore.

Usage:
  python update_cache_and_seed.py --model ../word2vec_model.vec --out global_recipes.json
"""

import argparse
import json
import os
import subprocess
from typing import Dict

from gensim.models import KeyedVectors
from word2vec_seed import pick_candidate


def load_json(path: str) -> Dict:
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {}


def save_json(path: str, data: Dict):
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, help='Path to Word2Vec model (.vec/.bin/.gz)')
    parser.add_argument('--out', default='global_recipes.json', help='Path to global_recipes.json')
    parser.add_argument('--max-new', type=int, default=1000, help='Max new pairs to compute this run')
    args = parser.parse_args()

    is_binary = args.model.endswith('.bin') or args.model.endswith('.gz')
    model = KeyedVectors.load_word2vec_format(args.model, binary=is_binary)

    cache = load_json(args.out)

    # Build a small set of new pairs by walking top vocab and neighbors
    try:
        vocab = [w for w in getattr(model, 'index2word')[:2000] if w.isalpha() and len(w) > 2]
    except Exception:
        vocab = []

    new_count = 0
    for base in vocab:
        try:
            neighbors = [w for w, _ in model.most_similar(base, topn=8) if w.isalpha() and len(w) > 2]
        except Exception:
            neighbors = []
        # include self-combination
        a = base.capitalize()
        b = base.capitalize()
        key = (a.lower() < b.lower()) and f"{a.lower()}+{b.lower()}" or f"{b.lower()}+{a.lower()}"
        if key not in cache:
            result = pick_candidate(a, b, model)
            if result:
                cache[key] = {"name": result, "type": "result"}
                new_count += 1
                if new_count >= args.max_new:
                    break
        for nb in neighbors:
            a = base.capitalize()
            b = nb.capitalize()
            key = (a.lower() < b.lower()) and f"{a.lower()}+{b.lower()}" or f"{b.lower()}+{a.lower()}"
            if key in cache:
                continue
            result = pick_candidate(a, b, model)
            if result:
                cache[key] = {"name": result, "type": "result"}
                new_count += 1
                if new_count >= args.max_new:
                    break
        if new_count >= args.max_new:
            break

    save_json(args.out, cache)
    print(f"Updated cache at {args.out} (+{new_count} new)")

    # Seed to Firestore
    scripts_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'mobile', 'scripts')
    subprocess.check_call(['node', os.path.join(scripts_dir, 'seed-global-recipes.mjs')], cwd=os.path.join(os.path.dirname(__file__), '..', 'mobile'))


if __name__ == '__main__':
    main()


