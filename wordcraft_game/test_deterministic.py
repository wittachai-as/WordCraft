#!/usr/bin/env python3
"""
Test that puzzle generation is truly deterministic based on date seed.
Run this multiple times to verify same date always produces same puzzle.
"""

from generate_daily import generate_daily_puzzle

def test_deterministic():
    """Test that same date produces same puzzle every time"""
    test_dates = [
        "2025-10-19",
        "2025-10-20", 
        "2025-10-21",
        "2025-12-25",
        "2026-01-01",
    ]
    
    print("Testing deterministic puzzle generation...")
    print("=" * 60)
    
    for date in test_dates:
        # Generate puzzle 3 times for same date
        puzzles = [generate_daily_puzzle(date, deterministic=True) for _ in range(3)]
        
        # Check all 3 are identical
        puzzle1 = puzzles[0]
        all_same = all(
            p["goalWord"] == puzzle1["goalWord"] and 
            p["startWords"] == puzzle1["startWords"] 
            for p in puzzles
        )
        
        status = "✅ PASS" if all_same else "❌ FAIL"
        print(f"{status} | {date} | Goal: {puzzle1['goalWord']:12} | Starts: {', '.join(puzzle1['startWords'])}")
        
        if not all_same:
            print("  ERROR: Puzzle not deterministic!")
            for i, p in enumerate(puzzles):
                print(f"    Run {i+1}: {p}")
    
    print("=" * 60)
    print("\nTesting cross-date uniqueness...")
    print("=" * 60)
    
    # Generate puzzles for many dates
    puzzles = {}
    date_range = [f"2025-{month:02d}-{day:02d}" 
                  for month in range(10, 13) 
                  for day in range(1, 29)]
    
    for date in date_range:
        p = generate_daily_puzzle(date, deterministic=True)
        puzzles[date] = p
    
    # Check for goal word collisions
    goals = [p["goalWord"] for p in puzzles.values()]
    unique_goals = set(goals)
    
    collision_rate = (len(goals) - len(unique_goals)) / len(goals) * 100
    print(f"Total dates tested: {len(goals)}")
    print(f"Unique goals: {len(unique_goals)}")
    print(f"Collision rate: {collision_rate:.1f}%")
    
    if collision_rate < 50:  # Less than 50% collision is acceptable
        print("✅ Collision rate is acceptable")
    else:
        print("⚠️  High collision rate - consider expanding goal word pool")
    
    print("\nSample puzzles:")
    for date in list(puzzles.keys())[:5]:
        p = puzzles[date]
        print(f"  {date}: {p['goalWord']:12} | {', '.join(p['startWords'])}")

if __name__ == '__main__':
    test_deterministic()

