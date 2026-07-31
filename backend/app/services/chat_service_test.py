import copy
import unittest

from app.models.schemas_test import plan_payload
from app.services.chat_service import EDIT_SYSTEM_PROMPT, _extract_output_text, _validate_updated_plan


class ExtractOutputTextTest(unittest.TestCase):
    def test_extracts_first_output_text(self):
        data = {"output": [
            {"type": "reasoning"},
            {"type": "message", "content": [
                {"type": "output_text", "text": "你好"},
            ]},
        ]}
        self.assertEqual(_extract_output_text(data), "你好")

    def test_empty_output_returns_empty_string(self):
        self.assertEqual(_extract_output_text({"output": []}), "")
        self.assertEqual(_extract_output_text({}), "")


class ChatServiceBlueprintTest(unittest.TestCase):
    def test_edit_prompt_allows_blueprint_and_reference_times(self):
        self.assertIn("blueprint", EDIT_SYSTEM_PROMPT)
        self.assertIn("参考时间", EDIT_SYSTEM_PROMPT)

    def test_validated_edit_keeps_updated_blueprint(self):
        original = plan_payload()
        updated = copy.deepcopy(original)
        updated["days"][0]["attractions"][0]["start_time"] = "10:00"
        updated["blueprint"]["logic"] = "上午错峰，下午转场。"

        result = _validate_updated_plan(updated, original)

        self.assertEqual(result["days"][0]["attractions"][0]["start_time"], "10:00")
        self.assertEqual(result["blueprint"]["logic"], "上午错峰，下午转场。")

    def test_invalid_edited_blueprint_degrades_without_rejecting_days(self):
        original = plan_payload()
        updated = copy.deepcopy(original)
        updated["days"][0]["description"] = "调整后的城市文化"
        updated["blueprint"]["stages"][1]["day_indices"] = [0]

        result = _validate_updated_plan(updated, original)

        self.assertEqual(result["days"][0]["description"], "调整后的城市文化")
        self.assertIsNone(result["blueprint"])


if __name__ == "__main__":
    unittest.main()
