import unittest

from app.models.schemas import BudgetLedgerItem, DayPlan, TripRequest
from app.services.budget_guard import (
    adjust_generated_days_to_budget,
    calculate_budget_status,
    group_budget_limit,
)


def _request(budget=1000):
    return TripRequest(
        city="西安",
        start_date="2026-10-01",
        end_date="2026-10-02",
        travel_days=2,
        transportation="公共交通",
        accommodation="舒适商务",
        traveler_count=2,
        room_count=1,
        budget_amount=budget,
        budget_basis="group_total",
    )


def _day(index, meal_cost=100):
    return DayPlan.model_validate({
        "date": f"2026-10-0{index + 1}",
        "day_index": index,
        "city": "西安",
        "description": "测试",
        "transportation": "地铁",
        "accommodation": "舒适商务",
        "hotel": None,
        "attractions": [],
        "meals": [
            {"type": "lunch", "name": "午餐", "estimated_cost": meal_cost},
            {"type": "dinner", "name": "晚餐", "estimated_cost": meal_cost},
        ],
    })


class BudgetGuardTest(unittest.TestCase):
    def test_group_budget_limit_supports_per_person_basis(self):
        self.assertEqual(group_budget_limit(1200, "group_total", 3), 1200)
        self.assertEqual(group_budget_limit(1200, "per_person", 3), 3600)
        self.assertIsNone(group_budget_limit(None, "group_total", 3))

    def test_status_separates_current_overage_from_pending_buffer(self):
        items = [BudgetLedgerItem(
            id="transport-1",
            type="transport",
            day_index=0,
            name="地铁",
            amount=None,
            traveler_count=3,
        )]
        status = calculate_budget_status(
            {"total": 10_690}, items, 3, 10_000, "group_total"
        )

        self.assertEqual(status["over_budget_amount"], 690)
        self.assertEqual(status["pending_buffer"], 150)
        self.assertEqual(status["projected_total"], 10_840)
        self.assertEqual(status["projected_over_budget_amount"], 840)

    def test_generated_plan_reduces_only_meal_estimates_once(self):
        days = [_day(0), _day(1)]
        adjusted, report = adjust_generated_days_to_budget(_request(700), days)

        self.assertTrue(report["budget_adjustment_applied"])
        self.assertIn("待报价项目预留", report["budget_adjustment_note"])
        self.assertLess(
            sum(meal.estimated_cost for day in adjusted for meal in day.meals),
            sum(meal.estimated_cost for day in days for meal in day.meals),
        )
        self.assertEqual(
            sum(meal.estimated_cost for day in days for meal in day.meals),
            400,
        )


if __name__ == "__main__":
    unittest.main()
