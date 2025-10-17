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


def slug_key(a: str, b: str) -> str:
    x, y = sorted([a.lower(), b.lower()])
    return f"{x}+{y}"


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
                return candidates[0][0].capitalize()
            
            # Fallback: vector arithmetic
            vec = model[a.lower()] + model[b.lower()]
            similar = model.similar_by_vector(vec, topn=30)
            for token, _ in similar:
                if (token.isalpha() and 
                    token.lower() not in {a.lower(), b.lower()} and
                    len(token) > 2):
                    return token.capitalize()
    except Exception:
        pass
    
    # Final fallback: comprehensive combination rules
    combination_rules = {
        # Basic elements
        ('fire', 'water'): 'Steam',
        ('water', 'earth'): 'Mud', 
        ('air', 'water'): 'Rain',
        ('fire', 'earth'): 'Lava',
        ('air', 'fire'): 'Energy',
        ('air', 'earth'): 'Dust',
        ('ice', 'fire'): 'Water',
        
        # Materials + Fire
        ('heat', 'wood'): 'Ash',
        ('wood', 'fire'): 'Ash',
        ('stone', 'fire'): 'Lava',
        ('metal', 'fire'): 'Steel',
        ('sand', 'fire'): 'Glass',
        ('clay', 'fire'): 'Pottery',
        
        # Materials + Water
        ('sand', 'water'): 'Mud',
        ('clay', 'water'): 'Mud',
        ('salt', 'water'): 'Saltwater',
        
        # Materials + Air
        ('dust', 'air'): 'Wind',
        ('smoke', 'air'): 'Cloud',
        
        # Life and Nature
        ('heart', 'wood'): 'Life',
        ('wood', 'heart'): 'Life',
        
        # Advanced combinations
        ('steam', 'metal'): 'Rust',
        ('mud', 'fire'): 'Brick',
        ('sand', 'heat'): 'Glass',
        ('wood', 'water'): 'Swamp',
        ('ash', 'water'): 'Lye',
        ('ash', 'fire'): 'Ember',
        ('ash', 'wood'): 'Charcoal',
        ('ash', 'heat'): 'Ember',
        ('ember', 'wood'): 'Fire',
        ('rust', 'fire'): 'Iron',
        ('charcoal', 'fire'): 'Coal',
        ('charcoal', 'heat'): 'Coal',
        
        # Self-combinations
        ('fire', 'fire'): 'Inferno',
        ('water', 'water'): 'Ocean',
        ('earth', 'earth'): 'Mountain',
        ('air', 'air'): 'Storm',
        ('heat', 'heat'): 'Furnace',
        ('wood', 'wood'): 'Forest',
        ('stone', 'stone'): 'Mountain',
        ('metal', 'metal'): 'Alloy',
        ('sand', 'sand'): 'Desert',
        ('ice', 'ice'): 'Glacier',
        ('steam', 'steam'): 'Cloud',
        ('mud', 'mud'): 'Swamp',
        ('ash', 'ash'): 'Dust',
        ('dust', 'dust'): 'Sand',
        ('rain', 'rain'): 'Storm',
        ('lava', 'lava'): 'Volcano',
        ('energy', 'energy'): 'Power',
        
        # Furnace combinations
        ('furnace', 'wood'): 'Charcoal',
        ('furnace', 'metal'): 'Steel',
        ('furnace', 'sand'): 'Glass',
        ('furnace', 'clay'): 'Pottery',
        ('furnace', 'stone'): 'Lava',
        
        # Light combinations
        ('light', 'light'): 'Sun',
        ('fire', 'light'): 'Flame',
        ('light', 'water'): 'Rainbow',
        ('air', 'light'): 'Sky',
        ('earth', 'light'): 'Crystal',
        ('light', 'dark'): 'Twilight',
        
        # Dark combinations
        ('dark', 'dark'): 'Void',
        ('dark', 'water'): 'Abyss',
        ('dark', 'fire'): 'Shadow',
        ('dark', 'earth'): 'Cave',
        
        # Cold combinations
        ('cold', 'cold'): 'Freeze',
        ('cold', 'water'): 'Ice',
        ('cold', 'air'): 'Wind',
        ('cold', 'fire'): 'Smoke',
        
        # Dust combinations
        ('dust', 'dust'): 'Sandstorm',
        ('dust', 'water'): 'Mud',
        ('dust', 'fire'): 'Ash',
        
        # Missing basic combinations
        ('water', 'earth'): 'Mud',
        ('earth', 'water'): 'Mud',
        ('fire', 'earth'): 'Lava',
        ('earth', 'fire'): 'Lava',
        ('air', 'earth'): 'Dust',
        ('earth', 'air'): 'Dust',
        ('water', 'fire'): 'Steam',
        ('fire', 'water'): 'Steam',
        ('air', 'water'): 'Rain',
        ('water', 'air'): 'Rain',
        ('air', 'fire'): 'Energy',
        ('fire', 'air'): 'Energy',
    }
    
    key = tuple(sorted([a.lower(), b.lower()]))
    if key in combination_rules:
        return combination_rules[key]
    
    # Don't create concatenated words - return None if no valid combination exists
    return None


def generate_recipes(goal: str, starts: List[str], model: "KeyedVectors" = None) -> Dict[str, Dict[str, str]]:
    # Simple recipe generation with limited steps
    inventory: List[str] = list(dict.fromkeys([s.capitalize() for s in starts]))
    recipes: Dict[str, Dict[str, str]] = {}
    seen_pairs = set()

    goal_cap = goal.capitalize()
    max_steps = 50  # Reduced from 200
    max_inventory = 20  # Limit inventory size

    def add_recipe(a: str, b: str, name: str):
        key = slug_key(a, b)
        if key not in recipes:
            recipes[key] = {"name": name, "type": "result"}

    steps = 0
    while steps < max_steps and goal_cap not in inventory and len(inventory) < max_inventory:
        steps += 1
        # Try pairs from current inventory (including self-combinations)
        for i in range(min(len(inventory), 10)):  # Limit iterations
            for j in range(i, min(len(inventory), 10)):  # Start from i to allow self-combination
                a, b = inventory[i], inventory[j]
                pair_key = (a.lower(), b.lower())
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                # Compute candidate - only add if valid combination exists
                name = pick_candidate(a, b, model)
                if name is not None:  # Only add valid combinations
                    add_recipe(a, b, name)
                    if name not in inventory and len(inventory) < max_inventory:
                        inventory.append(name)
                    if name == goal_cap:
                        return recipes
    return recipes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--goal', required=True)
    parser.add_argument('--starts', nargs='+', required=True)
    parser.add_argument('--model', default='')
    parser.add_argument('--out', default='seed.json')
    args = parser.parse_args()

    model = None
    if args.model:
        if KeyedVectors is None:
            raise RuntimeError('gensim is required to load models. Install with: pip install gensim')
        print(f"Loading model: {args.model}")
        model = KeyedVectors.load_word2vec_format(args.model, binary=True)

    recipes = generate_recipes(args.goal, args.starts, model)
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


