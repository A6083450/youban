"""Deterministic budget guardrails for generated plans and editable ledgers."""

from __future__ import annotations

import copy
import math
from typing import Any, Iterable

from ..models.schemas import BudgetLedgerItem, DayPlan, TripRequest


TRANSPORT_BUFFER_PER_PERSON = 50.0
HOTEL_BUFFER_PER_ROOM_NIGHT = 300.0
PENDING_BUFFER_PER_PERSON = {
    "attraction": 100.0,
    "meal": 80.0,
    "transport": TRANSPORT_BUFFER_PER_PERSON,
    "other": 100.0,
}
MEAL_FLOOR_PER_PERSON = {
    "breakfast": 15,
    "lunch": 30,
    "dinner": 40,
    "snack": 15,
}


def group_budget_limit(
    budget_amount: Any,
    budget_basis: str,
    traveler_count: int,
) -> float | None:
    """Normalize a user budget to the canonical group-total basis."""
    try:
        amount = float(budget_amount)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(amount) or amount <= 0:
        return None
    travelers = max(1, int(traveler_count or 1))
    if budget_basis == "per_person":
        amount *= travelers
    return round(amount, 2)


def pending_budget_buffer(
    items: Iterable[BudgetLedgerItem],
    traveler_count: int,
) -> float:
    """Reserve money for unquoted rows without pretending it is a real price."""
    travelers = max(1, int(traveler_count or 1))
    total = 0.0
    for item in items:
        if item.deleted or item.amount is not None:
            continue
        if item.type == "hotel":
            total += (
                HOTEL_BUFFER_PER_ROOM_NIGHT
                * max(1, int(item.room_count or 1))
                * max(1, int(item.nights or 1))
            )
            continue
        total += PENDING_BUFFER_PER_PERSON.get(item.type, 100.0) * travelers
    return round(total, 2)


def calculate_budget_status(
    totals: dict[str, float],
    items: Iterable[BudgetLedgerItem],
    traveler_count: int,
    budget_amount: Any,
    budget_basis: str,
    *,
    adjustment_applied: bool = False,
    adjustment_note: str = "",
) -> dict[str, Any]:
    """Return auditable quoted and projected budget status values."""
    materialized = list(items)
    limit = group_budget_limit(budget_amount, budget_basis, traveler_count)
    quoted_total = round(float(totals.get("total", 0) or 0), 2)
    buffer_amount = pending_budget_buffer(materialized, traveler_count)
    projected_total = round(quoted_total + buffer_amount, 2)
    return {
        "budget_limit": limit,
        "quoted_total": quoted_total,
        "over_budget_amount": (
            round(max(0.0, quoted_total - limit), 2) if limit is not None else 0.0
        ),
        "pending_buffer": buffer_amount,
        "projected_total": projected_total,
        "projected_over_budget_amount": (
            round(max(0.0, projected_total - limit), 2)
            if limit is not None
            else 0.0
        ),
        "adjustment_applied": bool(adjustment_applied),
        "adjustment_note": str(adjustment_note or ""),
    }


def _plan_known_total(days: list[DayPlan], traveler_count: int, room_count: int) -> float:
    attractions = sum(
        max(0, attraction.ticket_price) * traveler_count
        for day in days
        for attraction in day.attractions
    )
    meals = sum(
        max(0, meal.estimated_cost) * traveler_count
        for day in days
        for meal in day.meals
    )
    hotels = sum(
        max(0, day.hotel.estimated_cost) * room_count
        for day in days
        if day.hotel and day.hotel.price_status != "unavailable"
    )
    return round(attractions + meals + hotels, 2)


def _plan_pending_buffer(days: list[DayPlan], traveler_count: int, room_count: int) -> float:
    transport_rows = sum(1 for day in days if day.transportation.strip())
    hotel_nights = sum(
        1
        for day in days
        if day.hotel and day.hotel.price_status == "unavailable"
    )
    return round(
        transport_rows * TRANSPORT_BUFFER_PER_PERSON * traveler_count
        + hotel_nights * HOTEL_BUFFER_PER_ROOM_NIGHT * room_count,
        2,
    )


def _adjustment_note(language: str, reduction: float, buffer_amount: float) -> str:
    code = (language or "zh").strip().lower().split("-")[0]
    if code == "en":
        return (
            f"Meal estimates were reduced by ¥{reduction:g} to respect the budget, "
            f"with ¥{buffer_amount:g} reserved for unquoted items."
        )
    if code == "ja":
        return (
            f"予算に合わせて食事の見積もりを ¥{reduction:g} 引き下げ、"
            f"未見積もり項目に ¥{buffer_amount:g} を確保しました。"
        )
    return (
        f"已根据总预算将餐饮预估下调 ¥{reduction:g}，"
        f"并为待报价项目预留 ¥{buffer_amount:g}。"
    )


def adjust_generated_days_to_budget(
    request: TripRequest,
    days: list[DayPlan],
) -> tuple[list[DayPlan], dict[str, Any]]:
    """Make one conservative adjustment pass over unverified meal estimates.

    Provider hotel prices and itinerary attractions are left untouched. If meal
    estimates cannot absorb the excess, the remaining overage is reported by
    the ledger status instead of fabricating cheaper prices.
    """
    adjusted = [copy.deepcopy(day) for day in days]
    travelers = max(1, request.traveler_count)
    rooms = max(1, request.room_count or (travelers + 1) // 2)
    limit = group_budget_limit(request.budget_amount, request.budget_basis, travelers)
    buffer_amount = _plan_pending_buffer(adjusted, travelers, rooms)
    known_total = _plan_known_total(adjusted, travelers, rooms)
    if limit is None or known_total + buffer_amount <= limit:
        return adjusted, {
            "budget_adjustment_applied": False,
            "budget_adjustment_note": "",
        }

    remaining_reduction = known_total + buffer_amount - limit
    original_total = known_total
    meals = [meal for day in adjusted for meal in day.meals]
    meals.sort(
        key=lambda meal: (
            meal.estimated_cost - MEAL_FLOOR_PER_PERSON.get(meal.type.lower(), 20),
            meal.estimated_cost,
        ),
        reverse=True,
    )
    for meal in meals:
        floor = MEAL_FLOOR_PER_PERSON.get(meal.type.lower(), 20)
        reducible = max(0, meal.estimated_cost - floor)
        if reducible <= 0 or remaining_reduction <= 0:
            continue
        reduction_per_person = min(
            reducible,
            int(math.ceil(remaining_reduction / travelers)),
        )
        meal.estimated_cost -= reduction_per_person
        remaining_reduction = max(
            0.0,
            remaining_reduction - reduction_per_person * travelers,
        )

    adjusted_total = _plan_known_total(adjusted, travelers, rooms)
    reduction = round(max(0.0, original_total - adjusted_total), 2)
    applied = reduction > 0
    return adjusted, {
        "budget_adjustment_applied": applied,
        "budget_adjustment_note": (
            _adjustment_note(request.language or "zh", reduction, buffer_amount)
            if applied
            else ""
        ),
    }
