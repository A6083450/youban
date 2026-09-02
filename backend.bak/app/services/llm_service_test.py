import unittest
from dataclasses import dataclass
from unittest.mock import patch

from app.services.llm_service import iter_llm_stream


@dataclass(frozen=True, slots=True)
class _ResponseEvent:
    type: str
    delta: str


class _FakeResponses:
    def __init__(self) -> None:
        self.reasoning: dict[str, str] | None = None

    def create(
        self,
        *,
        model: str,
        input: str,
        temperature: float,
        stream: bool,
        reasoning: dict[str, str] | None = None,
    ) -> tuple[_ResponseEvent, ...]:
        self.reasoning = reasoning
        return (
            _ResponseEvent(type="response.reasoning_text.delta", delta="hidden"),
            _ResponseEvent(type="response.output_text.delta", delta="O"),
            _ResponseEvent(type="response.output_text.delta", delta="K"),
        )


class _FakeCompletions:
    def create(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        stream: bool,
        extra_body: dict[str, dict[str, str]],
    ) -> tuple[()]:
        return ()


class _FakeChat:
    def __init__(self) -> None:
        self.completions = _FakeCompletions()


class _FakeClient:
    def __init__(self) -> None:
        self.responses = _FakeResponses()
        self.chat = _FakeChat()


class IterLlmStreamTest(unittest.IsolatedAsyncioTestCase):
    async def test_disable_thinking_stream_uses_responses_reasoning_none(self) -> None:
        client = _FakeClient()

        with (
            patch("app.services.llm_service.get_openai_client", return_value=client),
            patch(
                "app.services.llm_service.get_llm_settings",
                return_value={
                    "model": "deepseek-v4-flash",
                    "base_url": "https://api.deepseek.com",
                },
            ),
        ):
            chunks = [
                chunk
                async for chunk in iter_llm_stream("reply with OK", disable_thinking=True)
            ]

        self.assertEqual(["O", "K"], chunks)
        self.assertEqual({"effort": "none"}, client.responses.reasoning)

    async def test_non_deepseek_stream_omits_deepseek_reasoning_option(self) -> None:
        client = _FakeClient()

        with (
            patch("app.services.llm_service.get_openai_client", return_value=client),
            patch(
                "app.services.llm_service.get_llm_settings",
                return_value={
                    "model": "gpt-4",
                    "base_url": "https://api.openai.com/v1",
                },
            ),
        ):
            chunks = [
                chunk
                async for chunk in iter_llm_stream("reply with OK", disable_thinking=True)
            ]

        self.assertEqual(["O", "K"], chunks)
        self.assertIsNone(client.responses.reasoning)


if __name__ == "__main__":
    unittest.main()
