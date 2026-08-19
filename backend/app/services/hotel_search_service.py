from __future__ import annotations

import re

from ..models.schemas import HotelCandidateInfo
from .flyai_provider import FlyAIProvider, FlyAIProviderError


_NAME_NOISE = re.compile(r"[\s·•・()（）\-—_]+")


def _normalized_name(value: str) -> str:
    return _NAME_NOISE.sub("", value).lower()


def _amap_candidates(city: str, accommodation: str) -> list[HotelCandidateInfo]:
    from .amap_service import get_amap_service

    return [
        HotelCandidateInfo(
            id=poi.id,
            name=poi.name,
            type=poi.type,
            address=poi.address,
            location=poi.location,
            tel=poi.tel,
            source="amap",
            price_status="unavailable",
        )
        for poi in get_amap_service().search_hotels(city, accommodation)
    ]


def search_hotel_candidates(
    city: str,
    accommodation: str,
    check_in_date: str,
    check_out_date: str,
) -> list[HotelCandidateInfo]:
    """Use FlyAI for priced inventory and AMap only for enrichment/fallback."""
    try:
        flyai = FlyAIProvider().search_hotels(
            city,
            accommodation,
            check_in_date,
            check_out_date,
        )
    except FlyAIProviderError as error:
        print(f"⚠️ FlyAI 酒店查询不可用，回退高德: {error}")
        flyai = []

    if not flyai:
        return _amap_candidates(city, accommodation)
    if all(item.location is not None and item.address for item in flyai):
        return flyai

    try:
        amap_by_name = {
            _normalized_name(item.name): item
            for item in _amap_candidates(city, accommodation)
        }
    except Exception:
        amap_by_name = {}
    enriched = []
    for item in flyai:
        amap = amap_by_name.get(_normalized_name(item.name))
        if amap is not None:
            item.address = item.address or amap.address
            item.location = item.location or amap.location
            item.tel = item.tel or amap.tel
            item.type = item.type or amap.type
        enriched.append(item)
    return enriched
