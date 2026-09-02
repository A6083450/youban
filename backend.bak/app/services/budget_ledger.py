"""Persistent, user-editable budget ledger derived from a trip plan."""

from __future__ import annotations

from typing import Any, Iterable, Literal

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


def _count(value: Any, default: int = 1) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def to_group_total(
    amount: float | None,
    amount_basis: Literal["group_total", "per_person"],
    traveler_count: int,
) -> float | None:
    """将用户录入金额换算成台账唯一存储口径：全体人员合计金额。"""
    if amount is None:
        return None
    normalized = _amount(amount)
    if amount_basis == "per_person":
        normalized *= _count(traveler_count)
    return round(normalized, 2)


def _per_person(amount: float | None, traveler_count: int) -> float | None:
    if amount is None:
        return None
    return round(_amount(amount) / _count(traveler_count), 2)


def _default_item(**values: Any) -> BudgetLedgerItem:
    return BudgetLedgerItem(
        origin="itinerary",
        user_locked=False,
        deleted=False,
        note="",
        **values,
    )


def _hotel_items(
    days: list[Any], travelers: int, rooms: int
) -> list[BudgetLedgerItem]:
    items: list[BudgetLedgerItem] = []
    group: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal group
        if group is None:
            return
        hotel = group["hotel"]
        nights = group["nights"]
        price_status = str(
            _get(hotel, "price_status", "unavailable") or "unavailable"
        )
        unit_amount = (
            None
            if price_status == "unavailable"
            else _amount(_get(hotel, "estimated_cost", 0))
        )
        if unit_amount == 0:
            unit_amount = None
        total_amount = (
            None
            if unit_amount is None
            else round(unit_amount * rooms * nights, 2)
        )
        start_index = group["start_index"]
        final_day_index = max(
            (int(_get(day, "day_index", position)) for position, day in enumerate(days)),
            default=group["end_index"],
        )
        checkout_index = min(group["end_index"] + 1, final_day_index)
        items.append(_default_item(
            id=f"itinerary:hotel:{start_index}",
            type="hotel",
            day_index=start_index,
            day_end_index=checkout_index,
            name=str(_get(hotel, "name", "") or "未命名酒店"),
            amount=total_amount,
            amount_basis="group_total",
            traveler_count=travelers,
            per_person_amount=_per_person(total_amount, travelers),
            unit_amount=unit_amount,
            room_count=rooms,
            nights=nights,
            calculation_summary="room_night",
            price_source=(
                price_status
                if price_status in {"live", "estimated"}
                else "unavailable"
            ),
            linked_item_id=str(_get(hotel, "source_hotel_id", "") or ""),
            entity_source=str(_get(hotel, "source", "") or ""),
            source_url=str(_get(hotel, "source_url", "") or ""),
            price_checked_at=str(_get(hotel, "price_checked_at", "") or ""),
        ))
        group = None

    for day_position, day in enumerate(days):
        day_index = int(_get(day, "day_index", day_position))
        hotel = _get(day, "hotel")
        if hotel is None:
            flush()
            continue
        identity = (
            str(_get(hotel, "source", "") or ""),
            str(_get(hotel, "source_hotel_id", "") or ""),
            str(_get(hotel, "name", "") or ""),
            _amount(_get(hotel, "estimated_cost", 0)),
        )
        can_extend = (
            group is not None
            and group["identity"] == identity
            and group["end_index"] + 1 == day_index
        )
        if can_extend:
            group["end_index"] = day_index
            group["nights"] += 1
            continue
        flush()
        group = {
            "identity": identity,
            "hotel": hotel,
            "start_index": day_index,
            "end_index": day_index,
            "nights": 1,
        }
    flush()
    return items


def derive_budget_items(
    result: Any,
    traveler_count: int | None = None,
    room_count: int | None = None,
) -> list[BudgetLedgerItem]:
    """Build canonical group-total ledger rows from the current itinerary."""
    plan = _plan(result)
    if plan is None:
        return []

    travelers = _count(traveler_count or _get(plan, "traveler_count", 1))
    rooms = _count(
        room_count or _get(plan, "room_count", (travelers + 1) // 2),
        (travelers + 1) // 2,
    )
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
            linked_id = str(
                _get(attraction, "id", "") or f"{day_index}-{item_position}"
            )
            unit_amount = _amount(_get(attraction, "ticket_price", 0))
            total_amount = round(unit_amount * travelers, 2)
            items.append(_default_item(
                id=f"itinerary:attraction:{linked_id}",
                type="attraction",
                day_index=day_index,
                name=str(_get(attraction, "name", "") or "未命名景点"),
                amount=total_amount,
                amount_basis="per_person",
                traveler_count=travelers,
                per_person_amount=unit_amount,
                unit_amount=unit_amount,
                calculation_summary="per_person",
                price_source="estimated",
                linked_item_id=linked_id,
                entity_source="amap" if _get(attraction, "poi_id", "") else "",
            ))

        for item_position, meal in enumerate(_get(day, "meals", []) or []):
            linked_id = str(_get(meal, "id", "") or f"{day_index}-{item_position}")
            unit_amount = _amount(_get(meal, "estimated_cost", 0))
            total_amount = round(unit_amount * travelers, 2)
            items.append(_default_item(
                id=f"itinerary:meal:{linked_id}",
                type="meal",
                day_index=day_index,
                name=str(_get(meal, "name", "") or "未命名餐饮"),
                amount=total_amount,
                amount_basis="per_person",
                traveler_count=travelers,
                per_person_amount=unit_amount,
                unit_amount=unit_amount,
                calculation_summary="per_person",
                price_source="estimated",
                linked_item_id=linked_id,
            ))

        transportation = str(_get(day, "transportation", "") or "").strip()
        if transportation:
            is_last = day is transport_days[-1] if transport_days else False
            share = transport_remaining if is_last else min(
                transport_share, transport_remaining
            )
            transport_remaining = round(max(0, transport_remaining - share), 2)
            total_amount = round(share, 2) if transport_total > 0 else None
            items.append(_default_item(
                id=f"itinerary:transport:{day_index}",
                type="transport",
                day_index=day_index,
                name=transportation,
                amount=total_amount,
                amount_basis="group_total",
                traveler_count=travelers,
                per_person_amount=_per_person(total_amount, travelers),
                calculation_summary="shared_total",
                price_source="estimated" if total_amount is not None else "unavailable",
                linked_item_id=f"day:{day_index}:transport",
            ))

    items.extend(_hotel_items(days, travelers, rooms))
    return items


def sync_budget_items(
    result: Any,
    saved_items: Iterable[dict[str, Any] | BudgetLedgerItem] | None,
    traveler_count: int | None = None,
    room_count: int | None = None,
) -> list[BudgetLedgerItem]:
    """Refresh generated rows while preserving every user-owned override."""
    saved: list[BudgetLedgerItem] = []
    for raw in saved_items or []:
        try:
            saved.append(BudgetLedgerItem.model_validate(raw))
        except (TypeError, ValueError):
            continue

    plan = _plan(result)
    travelers = _count(traveler_count or _get(plan, "traveler_count", 1))
    saved_by_id = {item.id: item for item in saved}
    derived = derive_budget_items(result, travelers, room_count)
    merged: list[BudgetLedgerItem] = []
    derived_ids: set[str] = set()
    for item in derived:
        derived_ids.add(item.id)
        previous = saved_by_id.get(item.id)
        if previous and previous.user_locked:
            previous.traveler_count = travelers
            previous.per_person_amount = _per_person(previous.amount, travelers)
            previous.day_end_index = item.day_end_index
            previous.room_count = item.room_count
            previous.nights = item.nights
            if previous.price_source != "user":
                previous.unit_amount = item.unit_amount
                previous.calculation_summary = item.calculation_summary
            selected = previous
        else:
            selected = item
        merged.append(selected)

    for item in saved:
        if item.id not in derived_ids and (item.origin == "user" or item.user_locked):
            item.traveler_count = travelers
            item.per_person_amount = _per_person(item.amount, travelers)
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


def calculate_per_person_totals(
    totals: dict[str, float], traveler_count: int
) -> dict[str, float]:
    travelers = _count(traveler_count)
    return {
        key: round(_amount(value) / travelers, 2)
        for key, value in totals.items()
    }


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
