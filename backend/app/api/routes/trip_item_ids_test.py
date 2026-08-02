import unittest

from app.api.routes.trip import _ensure_item_ids, _find_plan_item, _new_item_id
from app.models.schemas import TripPlanResponse


def _dict_result():
    return {
        "success": True,
        "data": {
            "city": "北京",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "overall_suggestions": "s",
            "days": [
                {
                    "date": "2026-08-01",
                    "day_index": 0,
                    "description": "d",
                    "transportation": "公共交通",
                    "accommodation": "酒店",
                    "attractions": [
                        {
                            "name": "故宫",
                            "address": "a",
                            "location": {"longitude": 116.39, "latitude": 39.91},
                            "visit_duration": 120,
                            "description": "x",
                        }
                    ],
                    "meals": [{"type": "lunch", "name": "烤鸭"}],
                }
            ],
        },
    }


class EnsureItemIdsTest(unittest.TestCase):
    def test_new_item_id_format(self):
        item_id = _new_item_id()
        self.assertTrue(item_id.startswith("itm_"))
        self.assertEqual(len(item_id), 12)

    def test_inject_ids_into_dict_result(self):
        result = _dict_result()
        changed = _ensure_item_ids(result)
        self.assertTrue(changed)
        day = result["data"]["days"][0]
        self.assertTrue(day["attractions"][0]["id"].startswith("itm_"))
        self.assertTrue(day["meals"][0]["id"].startswith("itm_"))

    def test_idempotent(self):
        result = _dict_result()
        _ensure_item_ids(result)
        first = result["data"]["days"][0]["attractions"][0]["id"]
        self.assertFalse(_ensure_item_ids(result))
        self.assertEqual(result["data"]["days"][0]["attractions"][0]["id"], first)

    def test_inject_ids_into_model_result(self):
        model = TripPlanResponse(**_dict_result())
        self.assertTrue(_ensure_item_ids(model))
        self.assertTrue(model.data.days[0].attractions[0].id.startswith("itm_"))

    def test_none_and_empty(self):
        self.assertFalse(_ensure_item_ids(None))
        self.assertFalse(_ensure_item_ids({"success": True, "data": None}))

    def test_find_plan_item(self):
        result = _dict_result()
        _ensure_item_ids(result)
        meal_id = result["data"]["days"][0]["meals"][0]["id"]
        self.assertIsNotNone(_find_plan_item(result, meal_id))
        self.assertIsNone(_find_plan_item(result, "itm_00000000"))


if __name__ == "__main__":
    unittest.main()
