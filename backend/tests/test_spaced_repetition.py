"""
Unit tests for the SM-2 spaced repetition algorithm.

These tests document the scheduling behaviour that the frontend and the
study queue depend on. The function under test is pure (no DB access),
so all cases run synchronously.

Rating scale: 1=Again, 2=Hard, 3=Good, 4=Easy.
Learning steps: [1, 10] minutes. EF bounds: [1.3, 3.0].
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.spaced_repetition import (
    calculate_next_review,
    LEARNING_STEPS,
    MIN_EF,
)


def utc_now():
    return datetime.now(timezone.utc)


def run(state, rating, *, ef=2.5, interval=0, reps=0, step=0):
    """Call calculate_next_review and return the full result tuple."""
    return calculate_next_review(
        state=state,
        easiness_factor=ef,
        interval_days=interval,
        repetitions=reps,
        learning_step=step,
        rating=rating,
    )


def assert_next_review_within(result, start, **delta_kwargs):
    """next_review_at must be [start + delta, now + delta].

    `start` must be captured BEFORE calling calculate_next_review, since
    the function snapshots its own `now` at call time.
    """
    new_state, new_ef, new_interval, new_reps, new_step, next_review = result
    expected = timedelta(**delta_kwargs)
    lower = start + expected
    upper = utc_now() + expected
    assert next_review.tzinfo is not None, "next_review_at must be timezone-aware"
    assert lower <= next_review <= upper, (
        f"next_review_at {next_review} outside expected window "
        f"[{lower} .. {upper}] (delta {expected})"
    )


# ============== Rating 1 (Again) ==============


class TestAgain:
    def test_again_from_new_enters_learning(self):
        t0 = utc_now()
        result = run("new", 1)
        new_state, new_ef, new_interval, new_reps, new_step, _ = result
        assert new_state == "learning"
        assert new_ef == pytest.approx(2.3)  # 2.5 - 0.2
        assert new_interval == 0
        assert new_reps == 0
        assert new_step == 0
        assert_next_review_within(result, t0, minutes=LEARNING_STEPS[0])

    def test_again_from_review_enters_relearning(self):
        new_state, new_ef, new_interval, new_reps, new_step, _ = run(
            "review", 1, ef=2.5, interval=15, reps=4
        )
        assert new_state == "relearning"
        assert new_ef == pytest.approx(2.3)
        assert new_interval == 0
        assert new_reps == 0
        assert new_step == 0

    def test_again_resets_repetitions(self):
        _, _, new_interval, new_reps, _, _ = run("review", 1, interval=100, reps=9)
        assert new_reps == 0
        assert new_interval == 0

    def test_again_ef_never_below_minimum(self):
        _, new_ef, _, _, _, _ = run("review", 1, ef=1.35)
        assert new_ef == pytest.approx(MIN_EF)

    def test_again_from_learning_stays_learning(self):
        new_state, _, _, new_reps, new_step, _ = run("learning", 1, step=1, reps=0)
        assert new_state == "learning"
        assert new_reps == 0
        assert new_step == 0


# ============== Learning / relearning states ==============


class TestLearning:
    def test_good_advances_first_learning_step(self):
        # New card rated Good: step 0 -> 1, next in 10 minutes (LEARNING_STEPS[1])
        t0 = utc_now()
        result = run("new", 3)
        new_state, new_ef, new_interval, new_reps, new_step, _ = result
        assert new_state == "learning"
        assert new_step == 1
        assert new_ef == pytest.approx(2.5)
        assert new_interval == 0
        assert new_reps == 0
        assert_next_review_within(result, t0, minutes=LEARNING_STEPS[1])

    def test_good_on_second_step_graduates_to_review(self):
        # Learning card at step 1 rated Good: graduates
        t0 = utc_now()
        result = run("learning", 3, step=1)
        new_state, new_ef, new_interval, new_reps, new_step, _ = result
        assert new_state == "review"
        assert new_step == 0
        assert new_reps == 1
        assert new_interval == 1  # Good graduation interval: 1 day
        assert new_ef == pytest.approx(2.5)  # EF unchanged during learning
        assert_next_review_within(result, t0, days=1)

    def test_easy_on_second_step_graduates_with_longer_interval(self):
        new_state, new_ef, new_interval, new_reps, _, _ = run("learning", 4, step=1)
        assert new_state == "review"
        assert new_reps == 1
        assert new_interval == 4  # Easy graduation interval: 4 days

    def test_easy_on_first_step_advances_step_without_graduating(self):
        # New card rated Easy: step 0 -> 1, still learning (no graduation)
        t0 = utc_now()
        result = run("new", 4)
        new_state, _, _, _, new_step, _ = result
        assert new_state == "learning"
        assert new_step == 1
        assert_next_review_within(result, t0, minutes=LEARNING_STEPS[1])

    def test_hard_repeats_current_learning_step(self):
        # Hard on step 1: same step again, same 10-minute delay
        t0 = utc_now()
        result = run("learning", 2, step=1)
        new_state, new_ef, _, new_reps, new_step, _ = result
        assert new_state == "learning"
        assert new_step == 1
        assert new_reps == 0
        assert new_ef == pytest.approx(2.5)
        assert_next_review_within(result, t0, minutes=LEARNING_STEPS[1])

    def test_hard_on_new_converts_state_to_learning(self):
        t0 = utc_now()
        result = run("new", 2, step=0)
        new_state, _, _, _, new_step, _ = result
        assert new_state == "learning"
        assert new_step == 0
        assert_next_review_within(result, t0, minutes=LEARNING_STEPS[0])

    def test_relearning_graduates_back_to_review(self):
        new_state, _, new_interval, new_reps, new_step, _ = run("relearning", 3, step=1)
        assert new_state == "review"
        assert new_interval == 1
        assert new_reps == 1
        assert new_step == 0


# ============== Review state (graduated cards) ==============


class TestReview:
    def test_good_after_graduation_six_day_interval(self):
        # reps 1 -> 2: fixed SM-2 interval of 6 days, EF unchanged (q=4)
        new_state, new_ef, new_interval, new_reps, new_step, _ = run(
            "review", 3, ef=2.5, interval=1, reps=1
        )
        assert new_state == "review"
        assert new_reps == 2
        assert new_interval == 6
        assert new_ef == pytest.approx(2.5)
        assert new_step == 0

    def test_good_multiplies_interval_by_ef(self):
        # reps 2 -> 3: interval = round(prev_interval * EF)
        _, new_ef, new_interval, new_reps, _, _ = run(
            "review", 3, ef=2.5, interval=6, reps=2
        )
        assert new_reps == 3
        assert new_interval == 15  # round(6 * 2.5)
        assert new_ef == pytest.approx(2.5)

    def test_easy_grows_interval_and_ef(self):
        # EF +0.1 (formula, q=5) +0.15 (Easy bonus); interval uses updated EF then *1.3
        new_state, new_ef, new_interval, new_reps, _, _ = run(
            "review", 4, ef=2.5, interval=15, reps=3
        )
        assert new_reps == 4
        assert new_ef == pytest.approx(2.75)  # 2.5 + 0.1 + 0.15
        assert new_interval == 51  # round(15 * 2.6) = 39, then round(39 * 1.3) = 51
        assert new_state == "review"

    def test_easy_ef_capped_at_three(self):
        _, new_ef, _, _, _, _ = run("review", 4, ef=2.9, interval=20, reps=4)
        assert new_ef == pytest.approx(3.0)

    def test_hard_shrinks_interval_and_drops_ef_twice(self):
        # Hard: EF -0.32 (formula, q=2) then -0.15 (Hard penalty);
        # interval uses the formula-updated EF, then *0.8
        new_state, new_ef, new_interval, new_reps, _, _ = run(
            "review", 2, ef=2.5, interval=30, reps=5
        )
        assert new_reps == 6
        assert new_ef == pytest.approx(2.03)  # 2.5 - 0.32 - 0.15
        assert new_interval == 52  # round(30 * 2.18) = 65, then round(65 * 0.8) = 52
        assert new_state == "review"

    def test_hard_ef_never_below_minimum(self):
        _, new_ef, _, _, _, _ = run("review", 2, ef=1.4, interval=20, reps=4)
        assert new_ef == pytest.approx(MIN_EF)

    def test_hard_interval_never_below_one_day(self):
        _, _, new_interval, _, _, _ = run("review", 2, ef=1.3, interval=1, reps=2)
        assert new_interval >= 1


# ============== Invariants ==============


class TestInvariants:
    def test_state_never_invalid(self):
        for state in ("new", "learning", "relearning", "review"):
            for rating in (1, 2, 3, 4):
                new_state = run(state, rating)[0]
                assert new_state in ("learning", "relearning", "review"), (
                    f"state {state!r} + rating {rating} produced invalid state {new_state!r}"
                )

    def test_every_rating_produces_future_next_review(self):
        for state in ("new", "learning", "relearning", "review"):
            for rating in (1, 2, 3, 4):
                next_review = run(state, rating)[5]
                assert next_review > utc_now()


# ============== Ghost-Session Detection (P2.1) ==============


class TestHasRatedCards:
    """P2.1: get_incomplete_session must ignore sessions with 0 rated cards —
    they are leftovers from accidental starts, not sessions worth resuming."""

    def _session(self, cards_studied_json):
        from app.models import StudySession

        s = StudySession(deck_id=1)
        s.cards_studied_json = cards_studied_json
        return s

    def test_none_is_not_rated(self):
        from app.services.spaced_repetition import _has_rated_cards

        assert _has_rated_cards(self._session(None)) is False

    def test_empty_string_is_not_rated(self):
        from app.services.spaced_repetition import _has_rated_cards

        assert _has_rated_cards(self._session("")) is False

    def test_empty_array_is_not_rated(self):
        from app.services.spaced_repetition import _has_rated_cards

        assert _has_rated_cards(self._session("[]")) is False

    def test_invalid_json_is_not_rated(self):
        from app.services.spaced_repetition import _has_rated_cards

        assert _has_rated_cards(self._session("not json {{{")) is False

    def test_cards_present_is_rated(self):
        from app.services.spaced_repetition import _has_rated_cards

        assert _has_rated_cards(self._session("[1, 2, 3]")) is True
