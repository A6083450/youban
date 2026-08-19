import unittest

from app.services.budget_ledger import (
    calculate_budget_totals,
    calculate_per_person_totals,
    derive_budget_items,
    sync_budget_items,
    to_group_total,
)


def _day(day_index, hotel=None):
    return {
        "date": f"2026-09-0{day_index + 1}",
        "day_index": day_index,
        "transportation": "",
        "attractions": [],
        "meals": [],
        "hotel": hotel,
    }


def _hotel(price=450, status="estimated"):
    return {
        "name": "广州真实酒店",
        "source": "flyai",
        "source_hotel_id": "flyai-hotel-1",
        "source_url": "https://example.com/hotel-1",
        "price_checked_at": "2026-08-19T10:00:00+00:00",
        "estimated_cost": price,
        "price_status": status,
    }


def _result(days, travelers=2, rooms=None):
    plan = {
        "traveler_count": travelers,
        "days": days,
        "budget": {},
    }
    if rooms is not None:
        plan["room_count"] = rooms
    return {"data": plan}


class BudgetLedgerTest(unittest.TestCase):
    def test_two_travelers_one_room_two_nights_is_900_total_and_450_per_person(self):
        hotel = _hotel(450)
        items = derive_budget_items(
            _result([_day(0, hotel), _day(1, hotel), _day(2)], travelers=2, rooms=1)
        )
        hotel_items = [item for item in items if item.type == "hotel"]
        self.assertEqual(len(hotel_items), 1)
        item = hotel_items[0]
        self.assertEqual(item.day_index, 0)
        self.assertEqual(item.day_end_index, 2)
        self.assertEqual(item.nights, 2)
        self.assertEqual(item.room_count, 1)
        self.assertEqual(item.unit_amount, 450)
        self.assertEqual(item.amount, 900)
        self.assertEqual(item.per_person_amount, 450)
        totals = calculate_budget_totals(items)
        self.assertEqual(totals["total_hotels"], 900)
        self.assertEqual(calculate_per_person_totals(totals, 2)["total_hotels"], 450)

    def test_three_travelers_default_to_two_rooms(self):
        items = derive_budget_items(
            _result([_day(0, _hotel(300)), _day(1)], travelers=3)
        )
        hotel = next(item for item in items if item.type == "hotel")
        self.assertEqual(hotel.room_count, 2)
        self.assertEqual(hotel.nights, 1)
        self.assertEqual(hotel.amount, 600)
        self.assertEqual(hotel.per_person_amount, 200)

    def test_unavailable_hotel_price_remains_pending(self):
        items = derive_budget_items(
            _result([_day(0, _hotel(0, "unavailable")), _day(1)])
        )
        hotel = next(item for item in items if item.type == "hotel")
        self.assertIsNone(hotel.unit_amount)
        self.assertIsNone(hotel.amount)
        self.assertIsNone(hotel.per_person_amount)
        self.assertEqual(hotel.price_source, "unavailable")

    def test_diy_per_person_input_is_converted_to_group_total(self):
        self.assertEqual(to_group_total(125.5, "per_person", 3), 376.5)
        self.assertEqual(to_group_total(125.5, "group_total", 3), 125.5)

    def test_user_price_override_does_not_restore_provider_formula(self):
        result = _result([_day(0, _hotel(450)), _day(1)], travelers=2, rooms=1)
        original = next(item for item in derive_budget_items(result) if item.type == "hotel")
        original.amount = 600
        original.amount_basis = "group_total"
        original.per_person_amount = 300
        original.price_source = "user"
        original.user_locked = True
        original.unit_amount = None
        original.calculation_summary = ""

        synced = sync_budget_items(result, [original.model_dump(mode="json")])
        hotel = next(item for item in synced if item.type == "hotel")
        self.assertEqual(hotel.amount, 600)
        self.assertEqual(hotel.per_person_amount, 300)
        self.assertIsNone(hotel.unit_amount)
        self.assertEqual(hotel.calculation_summary, "")


if __name__ == "__main__":
    unittest.main()
