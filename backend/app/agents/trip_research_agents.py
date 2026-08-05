from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import partial
from typing import Awaitable, Callable, Literal, Optional, TypedDict

from ..models.schemas import TripRequest

ResearchCategory = Literal["attractions", "weather", "hotels"]
ProgressDetails = Optional[list[dict[str, str]]]
_RESEARCH_CONCURRENCY = 6
_START_PROGRESS = 10
_END_PROGRESS = 75
_CATEGORIES: tuple[ResearchCategory, ...] = ("attractions", "weather", "hotels")
_CATEGORY_META: dict[ResearchCategory, tuple[str, str]] = {
    "attractions": ("attraction_search", "景点研究 Agent"),
    "weather": ("weather_search", "天气研究 Agent"),
    "hotels": ("hotel_search", "酒店研究 Agent"),
}


class ResearchMaps(TypedDict):
    attractions: dict[str, str]
    weather: dict[str, str]
    hotels: dict[str, str]


@dataclass(frozen=True)
class ResearchSources:
    attractions: Callable[[str, str, str], str]
    weather: Callable[[str], str]
    hotels: Callable[[str, str], str]


@dataclass(frozen=True)
class ResearchCallbacks:
    save_checkpoint: Callable[[], Awaitable[None]]
    emit_progress: Callable[[str, str, int, ProgressDetails], Awaitable[None]]


@dataclass(frozen=True)
class ResearchContext:
    request: TripRequest
    search: ResearchMaps
    sources: ResearchSources
    callbacks: ResearchCallbacks


@dataclass(frozen=True)
class ResearchJob:
    category: ResearchCategory
    city: str
    fetch: Callable[[], str]


@dataclass(frozen=True)
class ResearchBundle:
    attractions: dict[str, str]
    weather: dict[str, str]
    hotels: dict[str, str]


def _job_fetch(context: ResearchContext, category: ResearchCategory,
               city: str) -> Callable[[], str]:
    request = context.request
    if category == "attractions":
        keywords = request.preferences[0] if request.preferences else "景点"
        language = (request.language or "zh").strip().lower().split("-")[0]
        return partial(context.sources.attractions, city, keywords, language)
    if category == "weather":
        return partial(context.sources.weather, city)
    return partial(context.sources.hotels, city, request.accommodation)


def _unique_cities(request: TripRequest) -> list[str]:
    return list(dict.fromkeys(stay.city for stay in request.cities))


def _prepare_jobs(context: ResearchContext) -> tuple[list[ResearchJob], ResearchMaps]:
    results: ResearchMaps = {"attractions": {}, "weather": {}, "hotels": {}}
    jobs = []
    for city in _unique_cities(context.request):
        for category in _CATEGORIES:
            cached = context.search[category].get(city)
            if isinstance(cached, str) and cached:
                results[category][city] = cached
                continue
            jobs.append(ResearchJob(
                category=category,
                city=city,
                fetch=_job_fetch(context, category, city),
            ))
    return jobs, results


def _ordered_bundle(request: TripRequest, results: ResearchMaps) -> ResearchBundle:
    cities = _unique_cities(request)
    ordered = {
        category: {city: results[category][city] for city in cities}
        for category in _CATEGORIES
    }
    return ResearchBundle(
        attractions=ordered["attractions"],
        weather=ordered["weather"],
        hotels=ordered["hotels"],
    )


async def run_parallel_research(context: ResearchContext) -> ResearchBundle:
    jobs, results = _prepare_jobs(context)
    city_count = len(_unique_cities(context.request))
    total = city_count * len(_CATEGORIES)
    completed = total - len(jobs)
    if not jobs:
        await context.callbacks.emit_progress(
            "hotel_search", "♻️ 已恢复全部研究 Agent 结果", _END_PROGRESS,
            [{"type": "found", "title": "已恢复研究结果", "content": "复用 checkpoint"}],
        )
        return _ordered_bundle(context.request, results)

    await context.callbacks.emit_progress(
        "attraction_search", f"🚀 {len(jobs)} 个研究 Agent 正在并行执行...",
        _START_PROGRESS, None,
    )
    semaphore = asyncio.Semaphore(_RESEARCH_CONCURRENCY)
    completion_lock = asyncio.Lock()

    async def run_job(job: ResearchJob) -> None:
        nonlocal completed
        async with semaphore:
            text = await asyncio.to_thread(job.fetch)
        async with completion_lock:
            context.search[job.category][job.city] = text
            results[job.category][job.city] = text
            completed += 1
            await context.callbacks.save_checkpoint()
            stage, label = _CATEGORY_META[job.category]
            progress = _START_PROGRESS + int(
                (_END_PROGRESS - _START_PROGRESS) * completed / total
            )
            await context.callbacks.emit_progress(
                stage, f"✅ {label} 已完成 {job.city}", progress, None,
            )

    outcomes = await asyncio.gather(*(run_job(job) for job in jobs), return_exceptions=True)
    failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
    if failures:
        raise failures[0]
    return _ordered_bundle(context.request, results)
