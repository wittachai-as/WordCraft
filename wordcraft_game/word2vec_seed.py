#!/usr/bin/env python3
"""
Generate WordCraft recipes offline using a Word2Vec model.

Usage examples:
  python word2vec_seed.py --goal Electricity --starts Water Earth --out seed.json
  python word2vec_seed.py --goal Electricity --starts Water Earth Air --model GoogleNews-vectors-negative300.bin.gz

Output seed.json structure:
{
  "goalWord": "Electricity",
  "startWords": ["Water", "Earth"],
  "recipes": { "air+water": { "name": "Rain", "type": "result" }, ... }
}
"""

import argparse
import json
import os
from typing import Dict, List, Tuple

try:
    from gensim.models import KeyedVectors
except Exception:
    KeyedVectors = None  # type: ignore

"""AI-only mode: remove hardcoded/simple fallbacks."""


def slug_key(a: str, b: str) -> str:
    x, y = sorted([a.lower(), b.lower()])
    return f"{x}+{y}"


def _is_trivial_variant(candidate: str, inputs: List[str]) -> bool:
    """Avoid trivial variants such as plural-only forms of inputs."""
    cand = candidate.lower()
    normalized_inputs = {x.lower() for x in inputs}
    if cand in normalized_inputs:
        return True
    # simple plural/singular strip 's'
    if cand.endswith('s') and cand[:-1] in normalized_inputs:
        return True
    if any(x.endswith('s') and x[:-1] == cand for x in normalized_inputs):
        return True
    return False


def pick_candidate(a: str, b: str, model: "KeyedVectors") -> str:
    # Word2Vec-based combination: find words that are semantically related to both inputs
    try:
        if model and a.lower() in model and b.lower() in model:
            # Get similar words for each input
            similar_a = model.most_similar(a.lower(), topn=50)
            similar_b = model.most_similar(b.lower(), topn=50)
            
            # Find intersection of similar words
            words_a = {word for word, _ in similar_a}
            words_b = {word for word, _ in similar_b}
            intersection = words_a.intersection(words_b)
            
            # Filter out the input words and pick the best candidate
            candidates = []
            for word in intersection:
                if (word.isalpha() and 
                    word.lower() not in {a.lower(), b.lower()} and
                    len(word) > 2 and
                    not word.lower().endswith('ing') and
                    not word.lower().endswith('ed')):
                    # Get combined similarity score
                    sim_a = next((sim for w, sim in similar_a if w == word), 0)
                    sim_b = next((sim for w, sim in similar_b if w == word), 0)
                    combined_score = (sim_a + sim_b) / 2
                    candidates.append((word, combined_score))
            
            if candidates:
                # Sort by combined similarity and pick the best
                candidates.sort(key=lambda x: x[1], reverse=True)
                for word, _score in candidates:
                    if not _is_trivial_variant(word, [a, b]):
                        return word.capitalize()
            
            # Fallback: vector arithmetic
            vec = model[a.lower()] + model[b.lower()]
            similar = model.similar_by_vector(vec, topn=30)
            for token, _ in similar:
                if (token.isalpha() and 
                    token.lower() not in {a.lower(), b.lower()} and
                    len(token) > 2 and
                    not _is_trivial_variant(token, [a, b])):
                    return token.capitalize()
    except (KeyError, ValueError) as e:
        print(f"Warning: Error in pick_candidate for '{a}' + '{b}': {e}")
        pass
    
    # ห้ามต่อคำ - ถ้าไม่มี Word2Vec ก็ return None
    return None


def generate_recipes(goal: str, starts: List[str], model: "KeyedVectors" = None, max_recipes: int = 100) -> Dict[str, Dict[str, str]]:
    """Generate recipes using Word2Vec semantic similarity"""
    recipes = {}
    inventory = list(starts)
    goal_cap = goal.capitalize()
    
    # Add goal to inventory if not present
    if goal_cap not in inventory:
        inventory.append(goal_cap)
    
    # Generate recipes by combining existing items
    for i in range(len(inventory)):
        for j in range(i, len(inventory)):  # Allow self-combination
            a, b = inventory[i], inventory[j]
            if a == b and len(inventory) > 2:  # Skip self-combination if we have other options
                continue
                
            name = pick_candidate(a, b, model)
            if name is not None:  # Only add valid combinations
                key = slug_key(a, b)
                recipes[key] = {
                    "name": name,
                    "type": "result"
                }
                
                # Add new item to inventory if not already present and we have space
                if name not in inventory and len(inventory) < max_recipes:
                    inventory.append(name)
                
                # Check if we've reached the goal
                if name == goal_cap:
                    return recipes
    
    return recipes


def main():
    parser = argparse.ArgumentParser(description='Generate WordCraft recipes using Word2Vec')
    parser.add_argument('--goal', required=True, help='Goal word to reach')
    parser.add_argument('--starts', nargs='+', required=True, help='Starting words')
    parser.add_argument('--out', default='seed.json', help='Output file')
    parser.add_argument('--model', help='Path to Word2Vec model file')
    parser.add_argument('--max-recipes', type=int, default=100, help='Maximum number of recipes to generate')
    
    args = parser.parse_args()
    
    # Load Word2Vec model if available
    model = None
    if args.model and os.path.exists(args.model):
        try:
            # auto-detect binary by extension
            is_binary = args.model.endswith('.bin') or args.model.endswith('.gz')
            model = KeyedVectors.load_word2vec_format(args.model, binary=is_binary)
            print(f"Loaded Word2Vec model from {args.model}")
        except (IOError, ValueError, KeyError) as e:
            print(f"Failed to load Word2Vec model: {e}")
            print("Continuing without model...")
    else:
        print("No Word2Vec model provided. AI-only mode requires --model.")
    
    # Generate recipes
    recipes = generate_recipes(args.goal, args.starts, model, args.max_recipes)
    
    # Save to file
    out = {
        "goalWord": args.goal,
        "startWords": args.starts,
        "recipes": recipes,
    }
    with open(args.out, 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {args.out} with {len(recipes)} recipes")


if __name__ == '__main__':
    main()