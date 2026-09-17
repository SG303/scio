"""
Unit tests for P4.2 (streaks) and P4.3 (deck-wide daily new-card limit).

The functions under test are pure (no DB access) — the streak helpers take
simple data structures, the quota helper takes plain integers and dates.
"""
from datetime import date, timedelta

from app.services.spaced_repetition import (
    compute_streak,
    remaining_new_quota,
    DAILY_GOAL_REVIEWS,
)

TODAY = date(2026, 9, 17)
YESTERDAY = TODAY - timedelta(days=1)


class TestComputeStreak:
    def test_empty_history(self):
        current, longest = compute_streak({}, TODAY)
        assert (current, longest) == (0, 0)

    def test_studied_today(self):
        days = {TODAY: 12}
        current, longest = compute_streak(days, TODAY)
        assert current == 1

    def test_streak_alive_before_first_review_today(self):
        # Yesterday's streak stays alive until the day actually ends
        days = {YESTERDAY - timedelta(days=i): 5 for i in range(3)}
        current, _ = compute_streak(days, TODAY)
        assert current == 3

    def test_gap_breaks_streak(self):
        days = {TODAY: 5, TODAY - timedelta(days=2): 5}
        current, longest = compute_streak(days, TODAY)
        assert current == 1
        assert longest == 1

    def test_longest_longer_than_current(self):
        days = {TODAY: 5}
        for i in range(4):
            days[TODAY - timedelta(days=10 + i)] = 3
        current, longest = compute_streak(days, TODAY)
        assert current == 1
        assert longest == 4

    def test_zero_review_days_do_not_count(self):
        days = {TODAY: 0, YESTERDAY: 5}
        current, longest = compute_streak(days, TODAY)
        # Today with 0 reviews is not a streak day itself, but the streak
        # from yesterday stays alive until the day ends
        assert current == 1
        assert longest == 1

    def test_current_equals_longest_when_continuous(self):
        days = {TODAY - timedelta(days=i): 4 for i in range(5)}
        current, longest = compute_streak(days, TODAY)
        assert current == longest == 5


class TestRemainingNewQuota:
    def test_fresh_day_gets_full_limit(self):
        assert remaining_new_quota(20, 0, None, TODAY) == 20

    def test_old_study_date_resets_limit(self):
        assert remaining_new_quota(20, 15, TODAY - timedelta(days=1), TODAY) == 20

    def test_same_day_subtracts(self):
        assert remaining_new_quota(20, 15, TODAY, TODAY) == 5

    def test_never_negative(self):
        assert remaining_new_quota(10, 25, TODAY, TODAY) == 0


class TestDailyGoalConstant:
    def test_goal_is_sane(self):
        assert 1 <= DAILY_GOAL_REVIEWS <= 200
