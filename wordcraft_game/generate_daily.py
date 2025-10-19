#!/usr/bin/env python3
"""
Generate daily WordCraft puzzle with unique goal/startWords using date as seed.
Ensures no duplicate goals across days.

Usage:
  python generate_daily.py --date 2025-10-15 --out seed.json
  python generate_daily.py --today --out seed.json
"""

import argparse
import json
from datetime import datetime
from typing import List, Set

# Remove random import - we use pure deterministic seed-based generation
# from word2vec_seed import generate_recipes  # Not needed for puzzle generation


def _seed_from_date_str(seed_str: str) -> int:
    seed = 0
    for i in range(len(seed_str)):
        seed = (seed * 31 + ord(seed_str[i])) & 0xFFFFFFFF
    return seed & 0xFFFFFFFF


def _mulberry32(seed: int):
    # Deterministic PRNG to match client
    state = seed & 0xFFFFFFFF
    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * ((t | 61) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return rnd


def load_used_goals() -> Set[str]:
    """Load previously used goals from a simple text file"""
    try:
        with open('used_goals.txt', 'r') as f:
            return set(line.strip().lower() for line in f if line.strip())
    except FileNotFoundError:
        return set()


def save_used_goal(goal: str):
    """Save goal to used_goals.txt"""
    with open('used_goals.txt', 'a') as f:
        f.write(f"{goal.lower()}\n")


def generate_daily_puzzle(date_str: str, deterministic: bool = True) -> dict:
    # Word pools
    START_WORDS = [
        "Water", "Fire", "Earth", "Air", "Light", "Dark", "Heat", "Cold",
        "Stone", "Wood", "Metal", "Sand", "Ice", "Steam", "Smoke", "Dust"
    ]
    
    GOAL_WORDS = [
        "Electricity", "Life", "Time", "Space", "Energy", "Matter", "Light",
        "Sound", "Color", "Music", "Art", "Love", "Hope", "Dream", "Magic",
        "Power", "Wisdom", "Peace", "Freedom", "Justice", "Beauty", "Truth"
    ]
    
    # Use date as seed for reproducible randomness (mulberry32 like client)
    rnd = _mulberry32(_seed_from_date_str(date_str))

    if deterministic:
        # Purely date-based selection (independent of history)
        goal = GOAL_WORDS[int(rnd() * len(GOAL_WORDS)) % len(GOAL_WORDS)]
    else:
        # History-aware: avoid reusing goals across days
        used_goals = load_used_goals()
        available_goals = [g for g in GOAL_WORDS if g.lower() not in used_goals]
        if not available_goals:
            print("Warning: All goals have been used, resetting...")
            available_goals = GOAL_WORDS
            used_goals.clear()
            with open('used_goals.txt', 'w') as f:
                pass  # Clear file
        goal = available_goals[int(rnd() * len(available_goals)) % len(available_goals)]
        save_used_goal(goal)
    
    # Pick 2-3 unique start words
    num_starts = 2 if rnd() < 0.5 else 3
    # sample without replacement using rnd
    pool = START_WORDS[:]
    start_words: List[str] = []
    for _ in range(num_starts):
        idx = int(rnd() * len(pool)) % len(pool)
        start_words.append(pool.pop(idx))
    
    print(f"Generated for {date_str}:")
    print(f"  Goal: {goal}")
    print(f"  Start words: {start_words}")
    if not deterministic:
        # Only meaningful when tracking history
        try:
            used_goals = load_used_goals()
            print(f"  Used goals count: {len(used_goals) + 1}")
        except Exception:
            pass
    
    # Don't include recipes in daily puzzles - they're stored separately in global_recipes collection
    return {
        "goalWord": goal,
        "startWords": start_words
        # No recipes field - loaded separately from global_recipes collection
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', help='Date in YYYY-MM-DD format')
    parser.add_argument('--today', action='store_true', help='Use today\'s date')
    parser.add_argument('--local-time', action='store_true', help='When using --today, use device local date (default UTC)')
    parser.add_argument('--out', default='seed.json', help='Output file')
    parser.add_argument('--deterministic', action='store_true', help='Use date-only deterministic seed (ignore history)')
    args = parser.parse_args()
    
    if args.today:
        # If --local-time provided, use local date; otherwise use UTC date
        if args.local_time:
            date_str = datetime.now().strftime('%Y-%m-%d')
        else:
            date_str = datetime.utcnow().strftime('%Y-%m-%d')
    elif args.date:
        date_str = args.date
    else:
        date_str = datetime.now().strftime('%Y-%m-%d')
    
    puzzle = generate_daily_puzzle(date_str, deterministic=args.deterministic)
    
    with open(args.out, 'w') as f:
        json.dump(puzzle, f, ensure_ascii=False, indent=2)
    
    print(f"Saved to {args.out}")


if __name__ == '__main__':
    main()
