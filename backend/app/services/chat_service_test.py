import copy
import unittest

from app.models.schemas_test import plan_payload
from app.models.schemas import Hotel
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

    def test_edit_agent_cannot_replace_verified_hotel(self):
        original = plan_payload()
        original["days"][0]["hotel"] = {
            "name": "高德测试酒店",
            "address": "北京市测试路1号",
            "location": {"longitude": 116.41, "latitude": 39.91},
            "price_range": "",
            "rating": "",
            "distance": "",
            "type": "住宿服务;宾馆酒店",
            "source": "amap",
            "source_hotel_id": "B000A1",
            "price_status": "unavailable",
            "estimated_cost": 0,
        }
        updated = copy.deepcopy(original)
        updated["days"][0]["hotel"] = {
            "name": "模型编造酒店",
            "address": "虚构地址",
            "estimated_cost": 999,
        }

        result = _validate_updated_plan(updated, original)

        expected = Hotel.model_validate(original["days"][0]["hotel"]).model_dump(mode="json")
        self.assertEqual(expected, result["days"][0]["hotel"])
        self.assertIn("绝对不能修改酒店", EDIT_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
