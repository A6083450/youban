"""对话流式(SSE 打字机)端点的端到端回归测试。

用 mock 的分块 LLM 流验证:
- /trip/parse/stream 与 /trip/confirm-reply/stream 逐块吐出 delta 文本(打字机内容);
- 增量拼接后等于自然语言字段(reply / message)的完整值;
- 结束推一条 final 结构化结果并以 [DONE] 收尾。
不依赖真实 LLM;不传 X-User-Id 以跳过 mem0。
"""

import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.main import app

client = TestClient(app)


def _make_fake_stream(chunks):
    async def _fake(prompt, temperature=0.1, **kwargs):
        for c in chunks:
            yield c
    return _fake


def _parse_sse(text):
    events = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block.startswith("data:"):
            continue
        data = block[len("data:"):].strip()
        if data == "[DONE]":
            events.append(("done", None))
        else:
            events.append(("evt", json.loads(data)))
    return events


def _deltas(events):
    return "".join(
        e[1]["text"] for e in events if e[0] == "evt" and e[1]["type"] == "delta"
    )


def _finals(events):
    return [e[1]["payload"] for e in events if e[0] == "evt" and e[1]["type"] == "final"]


class ParseStreamEndpointTest(unittest.TestCase):
    def test_parse_stream_emits_reply_deltas_then_final(self):
        chunks = [
            '{"action":"chat","emotion":"neutral",',
            '"reply":"你好',
            '呀朋友","follow_up_question":"",',
            '"recommendations":[],"need_clarify":false,',
            '"clarify_question":"","summary":"","cities":[]}',
        ]
        with patch("app.api.routes.trip.iter_llm_stream", _make_fake_stream(chunks)):
            resp = client.post(
                "/api/trip/parse/stream",
                json={"text": "随便聊聊", "language": "zh"},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.headers["content-type"])
        events = _parse_sse(resp.text)
        self.assertEqual(_deltas(events), "你好呀朋友")
        finals = _finals(events)
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0]["action"], "chat")
        self.assertEqual(finals[0]["reply"], "你好呀朋友")
        self.assertTrue(any(e[0] == "done" for e in events))


class ConfirmStreamEndpointTest(unittest.TestCase):
    def test_confirm_stream_emits_message_deltas_then_final(self):
        chunks = [
            '{"action":"chat","confidence":0.2,',
            '"message":"这个季节',
            '大理很舒服","cities":[],"start_date":"","end_date":"",',
            '"transportation":"","accommodation":"","preferences":[],',
            '"inferred_fields":[],"suggestions":[]}',
        ]
        draft = {
            "cities": [{"city": "大理", "days": 3}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
        }
        with patch("app.api.routes.trip.iter_llm_stream", _make_fake_stream(chunks)):
            resp = client.post(
                "/api/trip/confirm-reply/stream",
                json={"text": "大理天气怎么样", "draft": draft, "language": "zh"},
            )
        self.assertEqual(resp.status_code, 200)
        events = _parse_sse(resp.text)
        self.assertEqual(_deltas(events), "这个季节大理很舒服")
        finals = _finals(events)
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0]["action"], "chat")
        self.assertEqual(finals[0]["message"], "这个季节大理很舒服")


if __name__ == "__main__":
    unittest.main()
