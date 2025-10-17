#!/usr/bin/env python3
"""
Generate global recipes that work across all days.
These recipes are consistent - same inputs always produce same outputs.

Usage:
  python generate_global_recipes.py --out global_recipes.json
"""

import argparse
import json
from typing import Dict, List, Set, Optional, Tuple

from word2vec_seed import pick_candidate
try:
    from gensim.models import KeyedVectors
except Exception:
    KeyedVectors = None  # type: ignore


def _slug_key(a: str, b: str) -> str:
    x, y = sorted([a.lower(), b.lower()])
    return f"{x}+{y}"


def _capitalize(w: str) -> str:
    return w[:1].upper() + w[1:] if w else w


def generate_global_recipes(
    model: Optional["KeyedVectors"] = None,
    vocab_size: int = 800,
    topk: int = 6,
    max_recipes: int = 5000,
) -> Dict[str, Dict[str, str]]:
    """Generate global recipes.

    If a Word2Vec model is provided, sample vocabulary from the model and pair
    each base word with its top-K most similar words to produce diverse combos.
    Falls back to a small curated list when no model is available.
    """

    recipes: Dict[str, Dict[str, str]] = {}
    seen_pairs: Set[str] = set()

    if model is not None:
        # gensim 3.8 uses `index2word` for vocabulary ordering
        try:
            vocab: List[str] = [w for w in getattr(model, 'index2word')[:vocab_size] if w.isalpha() and len(w) > 2]
        except Exception:
            vocab = []

        for base in vocab:
            # choose nearest neighbors for diversity without O(N^2)
            try:
                neighbors = [w for w, _ in model.most_similar(base, topn=topk) if w.isalpha() and len(w) > 2]
            except Exception:
                neighbors = []

            # include self-combination: (base, base)
            try:
                a = _capitalize(base)
                b = _capitalize(base)
                key = _slug_key(a, b)
                if key not in seen_pairs:
                    result = pick_candidate(a, b, model=model)
                    if result:
                        recipes[key] = {"name": result, "type": "result"}
                        seen_pairs.add(key)
                        if len(recipes) >= max_recipes:
                            return recipes
            except Exception:
                pass

            for nb in neighbors:
                a = _capitalize(base)
                b = _capitalize(nb)
                key = _slug_key(a, b)
                if key in seen_pairs:
                    continue
                result = pick_candidate(a, b, model=model)
                if result:
                    recipes[key] = {"name": result, "type": "result"}
                    seen_pairs.add(key)
                    if len(recipes) >= max_recipes:
                        return recipes

        return recipes

    # If no model provided, return empty set (AI-only, no hardcoded fallbacks)
    return recipes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='global_recipes.json', help='Output file')
    parser.add_argument('--model', help='Path to Word2Vec model (.bin/.gz for binary or .vec for text)')
    parser.add_argument('--vocab-size', type=int, default=800, help='Number of vocab words to sample from model')
    parser.add_argument('--topk', type=int, default=6, help='Neighbors per base word to form pairs')
    parser.add_argument('--max-recipes', type=int, default=5000, help='Maximum number of generated recipes')
    args = parser.parse_args()
    
    # Optional: load external model if provided
    model = None
    if args.model and KeyedVectors:
        try:
            is_binary = args.model.endswith('.bin') or args.model.endswith('.gz')
            model = KeyedVectors.load_word2vec_format(args.model, binary=is_binary)
            print(f"Loaded Word2Vec model from {args.model}")
        except Exception as e:
            print(f"Failed to load model: {e}")
            model = None

    if not model:
        print("Error: --model is required in AI-only mode")
        return

    print("Generating global recipes...")
    recipes = generate_global_recipes(model=model, vocab_size=args.vocab_size, topk=args.topk, max_recipes=args.max_recipes)
    
    with open(args.out, 'w') as f:
        json.dump(recipes, f, ensure_ascii=False, indent=2)
    
    print(f"Generated {len(recipes)} global recipes")
    print(f"Saved to {args.out}")


if __name__ == '__main__':
    main()
