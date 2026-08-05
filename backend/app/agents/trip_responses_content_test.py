import json
import unittest
from datetime import date, timedelta

from langchain_core.messages import AIMessage

from app.agents import trip_planner_agent
from app.agents.trip_plan_orchestrator import build_segments, empty_checkpoint
from app.models.schemas import TripRequest


class _ContentBlockModel:
    def __init__(self, message: AIMessage) -> None:
        self._message = message

    async def ainvoke(self, _messages: list[dict[str, str]]) -> AIMessage:
        return self._message


class TripResponsesContentTest(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_final_text_from_responses_api_content_blocks(self) -> None:
        # Given
        start = date(2026, 8, 5)
        request = TripRequest(
            city="乌鲁木齐",
            start_date=start.isoformat(),
            end_date=(start + timedelta(days=1)).isoformat(),
            travel_days=2,
            transportation="公共交通",
            accommodation="经济型酒店",
            preferences=["自然风光"],
            language="zh",
        )
        segment = build_segments(request)[0]
        days = [
            {
                "date": (start + timedelta(days=index)).isoformat(),
                "day_index": index,
                "city": "乌鲁木齐",
                "description": f"第{index + 1}天",
                "transportation": "公共交通",
                "accommodation": "经济型酒店",
                "hotel": {"name": "测试酒店", "estimated_cost": 300},
                "attractions": [
                    {
                        "name": f"景点{index + 1}",
                        "address": "测试地址",
                        "location": {"longitude": 87.62, "latitude": 43.82},
                        "visit_duration": 120,
                        "description": "景点描述",
                        "ticket_price": 20,
                    }
                ],
                "meals": [
                    {"type": "lunch", "name": "测试餐厅", "estimated_cost": 50}
                ],
            }
            for index in segment["day_indices"]
        ]
        payload = json.dumps(
            {"segment_id": segment["segment_id"], "days": days},
            ensure_ascii=False,
        )
        message = AIMessage(
            content=[
                {
                    "type": "reasoning",
                    "summary": [],
                    "content": [
                        {"type": "reasoning_text", "text": "Return the requested JSON."}
                    ],
                    "status": "completed",
                },
                {"type": "text", "text": payload, "annotations": []},
            ]
        )
        checkpoint = empty_checkpoint()
        checkpoint["segments"][segment["segment_id"]] = {
            "day_indices": segment["day_indices"],
            "status": "processing",
            "output": [],
            "attempts": 1,
            "error": "",
        }
        state = {
            "checkpoint": checkpoint,
            "attractions": {},
            "weather": {},
            "hotels": {},
            "memory_context": "",
        }

        # When
        result = await trip_planner_agent._generate_segment(
            _ContentBlockModel(message),
            request,
            segment,
            state,
        )

        # Then
        self.assertEqual([0, 1], [day["day_index"] for day in result])


if __name__ == "__main__":
    unittest.main()
