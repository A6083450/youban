import asyncio
import threading
import unittest
from collections import Counter
from unittest.mock import patch

from app.agents.langgraph_planner_test import _OrchestrationModel, _request
from app.agents.trip_plan_orchestrator import empty_checkpoint
from app.agents.trip_research_agents import (
    ResearchCallbacks,
    ResearchContext,
    ResearchSources,
    run_parallel_research,
)
from app.models.schemas import TripRequest


def _cities_request(cities):
    return TripRequest(
        city=cities[0],
        cities=[{"city": city, "days": 1} for city in cities],
        start_date="2026-08-01",
        end_date=f"2026-08-{len(cities):02d}",
        travel_days=len(cities),
        transportation="公共交通",
        accommodation="经济型酒店",
        preferences=["历史文化"],
    )


async def _noop_save():
    return None


async def _noop_progress(_stage, _message, _value, _details):
    return None


class ParallelTripResearchTest(unittest.TestCase):
    def test_first_multi_city_wave_contains_every_research_category(self):
        request = _cities_request(["北京", "上海", "广州"])
        first_wave = []
        lock = threading.Lock()
        gate = threading.Barrier(6)
        active = 0
        peak = 0

        def arrive(category):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                should_wait = len(first_wave) < 6
                if should_wait:
                    first_wave.append(category)
            if should_wait:
                gate.wait(timeout=1)
            with lock:
                active -= 1
            return category

        context = ResearchContext(
            request=request,
            search=empty_checkpoint()["search"],
            sources=ResearchSources(
                attractions=lambda *_: arrive("attractions"),
                weather=lambda *_: arrive("weather"),
                hotels=lambda *_: arrive("hotels"),
            ),
            callbacks=ResearchCallbacks(_noop_save, _noop_progress),
        )
        asyncio.run(run_parallel_research(context))

        self.assertEqual(set(first_wave), {"attractions", "weather", "hotels"})
        self.assertEqual(peak, 6)

    def test_duplicate_city_is_queried_once_with_monotonic_progress(self):
        request = _cities_request(["北京", "北京"])
        calls = Counter()
        progress = []

        def record(category):
            calls[category] += 1
            return category

        async def emit(_stage, _message, value, _details):
            progress.append(value)

        context = ResearchContext(
            request=request,
            search=empty_checkpoint()["search"],
            sources=ResearchSources(
                attractions=lambda *_: record("attractions"),
                weather=lambda *_: record("weather"),
                hotels=lambda *_: record("hotels"),
            ),
            callbacks=ResearchCallbacks(_noop_save, emit),
        )
        asyncio.run(run_parallel_research(context))

        self.assertEqual(calls, Counter({"attractions": 1, "weather": 1, "hotels": 1}))
        self.assertEqual(progress, sorted(progress))
        self.assertTrue(all(10 <= value <= 75 for value in progress))

    def test_research_agents_run_together_before_main_agent_aggregation(self):
        from app.agents import trip_planner_agent as tpa

        request = _request(3)
        model = _OrchestrationModel(request)
        barrier = threading.Barrier(3)
        started = []
        started_lock = threading.Lock()
        messages = []
        save_count = 0
        active_saves = 0
        peak_saves = 0

        def arrive(name, result):
            with started_lock:
                started.append(name)
            barrier.wait(timeout=1)
            return result

        async def progress(_stage, message, _value, _details=None):
            messages.append(message)

        async def save_checkpoint(_checkpoint):
            nonlocal save_count, active_saves, peak_saves
            active_saves += 1
            peak_saves = max(peak_saves, active_saves)
            await asyncio.sleep(0.001)
            active_saves -= 1
            save_count += 1

        with patch.object(tpa, "get_chat_model", return_value=model), \
             patch.object(tpa, "_fetch_attractions_text",
                          side_effect=lambda *_: arrive("attractions", "故宫|天安门")), \
             patch.object(tpa, "_fetch_weather_text",
                          side_effect=lambda *_: arrive("weather", "[]")), \
             patch.object(tpa, "_fetch_hotels_text",
                          side_effect=lambda *_: arrive("hotels", "如家酒店")), \
             patch.object(tpa, "_recall_memory", return_value=""), \
             patch.object(tpa, "_remember_plan", return_value=None):
            plan = asyncio.run(tpa.LangGraphTripPlanner().plan_trip(
                request,
                progress_callback=progress,
                checkpoint_callback=save_checkpoint,
                user_id="u1",
            ))

        self.assertCountEqual(started, ["attractions", "weather", "hotels"])
        self.assertEqual(peak_saves, 1)
        self.assertGreaterEqual(save_count, 3)
        self.assertIn("🧭 主 Agent 正在汇总并校验所有 Agent 结果...", messages)
        self.assertEqual(model.summary_calls, 1)
        self.assertEqual(model.review_calls, 1)
        self.assertEqual([day.day_index for day in plan.days], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()
