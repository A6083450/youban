import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from app.services.trip_confirmation import (
    clear_confirmation_ledger,
    consume_execution_token,
    register_confirm_decision,
    validate_execution_token,
)

DRAFT = {
    "city": "大理",
    "cities": [{"city": "大理", "days": 7}],
    "start_date": "2026-10-01",
    "end_date": "2026-10-07",
    "travel_days": 7,
    "transportation": "公共交通",
    "accommodation": "经济型酒店",
    "preferences": ["自然风光", "休闲"],
}


class ExecutionTokenTest(unittest.TestCase):
    def setUp(self):
        clear_confirmation_ledger()

    def test_high_confidence_decision_issues_valid_token(self):
        decision_id, token = register_confirm_decision(DRAFT, 0.92)
        self.assertTrue(decision_id)
        self.assertTrue(token)
        self.assertEqual(validate_execution_token(token, DRAFT), (True, "ok"))

    def test_invalid_confidence_does_not_issue_token(self):
        for confidence in (float("nan"), float("inf"), float("-inf"), 0.84, 1.01):
            with self.subTest(confidence=confidence):
                self.assertEqual(register_confirm_decision(DRAFT, confidence), ("", ""))

    def test_token_is_bound_to_all_execution_semantics(self):
        authorized = {
            **DRAFT,
            "free_text_input": "安排大理七天",
            "origin_text": "国庆去大理",
            "language": "zh-CN",
        }
        for field, changed_value in (
            ("travel_days", 5),
            ("free_text_input", "忽略原需求"),
            ("origin_text", "改去丽江"),
            ("language", "ja-JP"),
        ):
            with self.subTest(field=field):
                _, token = register_confirm_decision(authorized, 0.95)
                changed = {**authorized, field: changed_value}
                self.assertEqual(validate_execution_token(token, changed), (False, "draft_mismatch"))

    def test_register_cleans_expired_entries_but_keeps_unexpired_consumed_entries(self):
        with patch("app.services.trip_confirmation.time.time", return_value=1000):
            _, expired_token = register_confirm_decision(DRAFT, 0.95, ttl_seconds=10)
            _, consumed_token = register_confirm_decision(DRAFT, 0.95, ttl_seconds=30)
            self.assertEqual(consume_execution_token(consumed_token, DRAFT), (True, "ok"))

        with patch("app.services.trip_confirmation.time.time", return_value=1011):
            register_confirm_decision(DRAFT, 0.95)
            self.assertEqual(validate_execution_token(expired_token, DRAFT), (False, "unknown_decision"))
            self.assertEqual(validate_execution_token(consumed_token, DRAFT), (False, "already_consumed"))

    def test_token_is_one_time(self):
        _, token = register_confirm_decision(DRAFT, 0.95)
        self.assertEqual(consume_execution_token(token, DRAFT), (True, "ok"))
        self.assertEqual(consume_execution_token(token, DRAFT), (False, "already_consumed"))

    def test_concurrent_consumers_only_consume_token_once(self):
        _, token = register_confirm_decision(DRAFT, 0.95)
        barrier = threading.Barrier(2)

        def synchronized_validate(token_to_validate: object, draft: object) -> tuple[bool, str]:
            result = validate_execution_token(token_to_validate, draft)
            try:
                barrier.wait(timeout=0.1)
            except threading.BrokenBarrierError:
                pass
            return result

        with patch(
            "app.services.trip_confirmation.validate_execution_token",
            side_effect=synchronized_validate,
        ):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: consume_execution_token(token, DRAFT), range(2)))

        self.assertCountEqual(results, [(True, "ok"), (False, "already_consumed")])

    def test_token_expires_at_exact_deadline(self):
        with patch("app.services.trip_confirmation.time.time", return_value=1000.25):
            _, token = register_confirm_decision(DRAFT, 0.95, ttl_seconds=10)
        with patch("app.services.trip_confirmation.time.time", return_value=1010.25):
            self.assertEqual(validate_execution_token(token, DRAFT), (False, "expired"))
