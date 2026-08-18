"""Persistent, user-editable budget ledger derived from a trip plan."""

from __future__ import annotations

from typing import Any, Iterable

from ..models.schemas import BudgetLedgerItem


_TYPE_ORDER = {
    "attraction": 0,
    "hotel": 1,
    "meal": 2,
    "transport": 3,
    "other": 4,
}


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _plan(result: Any) -> Any:
    return _get(result, "data")


def _amount(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return 0
    return round(max(0, number), 2)


def _default_item(**values: Any) -> BudgetLedgerItem:
    return BudgetLedgerItem(
        origin="itinerary",
        user_locked=False,
        deleted=False,
        note="",
        **values,
    )


def derive_budget_items(result: Any) -> list[BudgetLedgerItem]:
    """Build a stable ledger snapshot from the current itinerary."""
    plan = _plan(result)
    if plan is None:
        return []

    days = list(_get(plan, "days", []) or [])
    budget = _get(plan, "budget")
    transport_total = _amount(_get(budget, "total_transportation", 0))
    transport_days = [
        day for day in days if str(_get(day, "transportation", "") or "").strip()
    ]
    transport_share = (
        round(transport_total / len(transport_days), 2) if transport_days else 0
    )
    transport_remaining = transport_total
    items: list[BudgetLedgerItem] = []

    for day_position, day in enumerate(days):
        day_index = int(_get(day, "day_index", day_position))
        for item_position, attraction in enumerate(_get(day, "attractions", []) or []):
            linked_id = str(_get(attraction, "id", "") or f"{day_index}-{item_position}")
            items.append(_default_item(
                id=f"itinerary:attraction:{linked_id}",
                type="attraction",
                day_index=day_index,
                name=str(_get(attraction, "name", "") or "未命名景点"),
                amount=_amount(_get(attraction, "ticket_price", 0)),
                price_source="estimated",
                linked_item_id=linked_id,
            ))

        hotel = _get(day, "hotel")
        if hotel is not None:
            price_status = str(_get(hotel, "price_status", "estimated") or "estimated")
            hotel_amount = None if price_status == "unavailable" else _amount(
                _get(hotel, "estimated_cost", 0)
            )
            items.append(_default_item(
                id=f"itinerary:hotel:{day_index}",
                type="hotel",
                day_index=day_index,
                name=str(_get(hotel, "name", "") or "未命名酒店"),
                amount=hotel_amount,
                price_source=price_status if price_status in {"live", "estimated"} else "unavailable",
                linked_item_id=str(_get(hotel, "source_hotel_id", "") or ""),
                entity_source=str(_get(hotel, "source", "") or ""),
            ))

        for item_position, meal in enumerate(_get(day, "meals", []) or []):
            linked_id = str(_get(meal, "id", "") or f"{day_index}-{item_position}")
            items.append(_default_item(
                id=f"itinerary:meal:{linked_id}",
                type="meal",
                day_index=day_index,
                name=str(_get(meal, "name", "") or "未命名餐饮"),
                amount=_amount(_get(meal, "estimated_cost", 0)),
                price_source="estimated",
                linked_item_id=linked_id,
            ))

        transportation = str(_get(day, "transportation", "") or "").strip()
        if transportation:
            is_last = day is transport_days[-1] if transport_days else False
            share = transport_remaining if is_last else min(transport_share, transport_remaining)
            transport_remaining = round(max(0, transport_remaining - share), 2)
            items.append(_default_item(
                id=f"itinerary:transport:{day_index}",
                type="transport",
                day_index=day_index,
                name=transportation,
                amount=round(share, 2) if transport_total > 0 else None,
                price_source="estimated" if transport_total > 0 else "unavailable",
                linked_item_id=f"day:{day_index}:transport",
            ))

    return items


def sync_budget_items(
    result: Any,
    saved_items: Iterable[dict[str, Any] | BudgetLedgerItem] | None,
) -> list[BudgetLedgerItem]:
    """Refresh generated rows while preserving every user-owned override."""
    saved: list[BudgetLedgerItem] = []
    for raw in saved_items or []:
        try:
            saved.append(BudgetLedgerItem.model_validate(raw))
        except (TypeError, ValueError):
            continue

    saved_by_id = {item.id: item for item in saved}
    derived = derive_budget_items(result)
    merged: list[BudgetLedgerItem] = []
    derived_ids: set[str] = set()
    for item in derived:
        derived_ids.add(item.id)
        previous = saved_by_id.get(item.id)
        merged.append(previous if previous and previous.user_locked else item)

    for item in saved:
        if item.id not in derived_ids and (item.origin == "user" or item.user_locked):
            merged.append(item)

    return sorted(
        merged,
        key=lambda item: (
            item.deleted,
            item.day_index if item.day_index is not None else 10_000,
            _TYPE_ORDER.get(item.type, 99),
            item.id,
        ),
    )


def calculate_budget_totals(items: Iterable[BudgetLedgerItem]) -> dict[str, float]:
    totals = {
        "total_attractions": 0.0,
        "total_hotels": 0.0,
        "total_meals": 0.0,
        "total_transportation": 0.0,
        "total_inter_city_transport": 0.0,
        "total_other": 0.0,
        "total": 0.0,
    }
    targets = {
        "attraction": "total_attractions",
        "hotel": "total_hotels",
        "meal": "total_meals",
        "transport": "total_transportation",
        "other": "total_other",
    }
    for item in items:
        if item.deleted or item.amount is None:
            continue
        amount = _amount(item.amount)
        totals[targets[item.type]] += amount
        totals["total"] += amount
    return {key: round(value, 2) for key, value in totals.items()}


def apply_budget_totals(result: Any, totals: dict[str, float]) -> None:
    plan = _plan(result)
    if plan is None:
        return
    budget = _get(plan, "budget")
    if isinstance(plan, dict):
        if not isinstance(budget, dict):
            budget = {}
            plan["budget"] = budget
        budget.update(totals)
        return
    if budget is None:
        from ..models.schemas import Budget

        budget = Budget(**totals)
        plan.budget = budget
        return
    for key, value in totals.items():
        setattr(budget, key, value)
