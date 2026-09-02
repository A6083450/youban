import unittest
from unittest.mock import MagicMock, patch


class MemoryServiceDegradeTest(unittest.TestCase):
    def setUp(self):
        from app.services import memory_service
        memory_service.reset_memory_service()
        self.ms = memory_service
        self.addCleanup(memory_service.reset_memory_service)

    def test_recall_returns_empty_when_memory_unavailable(self):
        with patch.object(self.ms, "get_memory", return_value=None):
            self.assertEqual(self.ms.recall_sync("u1", "偏好"), "")

    def test_recall_formats_results(self):
        fake = MagicMock()
        fake.search.return_value = {"results": [
            {"id": "m1", "memory": "喜欢自然风光"},
            {"id": "m2", "memory": "不吃辣"},
        ]}
        with patch.object(self.ms, "get_memory", return_value=fake):
            text = self.ms.recall_sync("u1", "偏好")
        self.assertIn("- 喜欢自然风光", text)
        self.assertIn("- 不吃辣", text)

    def test_recall_swallow_exceptions(self):
        fake = MagicMock()
        fake.search.side_effect = RuntimeError("embeddings 404")
        with patch.object(self.ms, "get_memory", return_value=fake):
            self.assertEqual(self.ms.recall_sync("u1", "偏好"), "")

    def test_remember_background_noops_without_user(self):
        with patch.object(self.ms, "get_memory", return_value=MagicMock()) as m:
            self.ms.remember_background("", [{"role": "user", "content": "hi"}])
        m.return_value.add.assert_not_called()

    def test_get_memory_returns_none_without_api_key(self):
        with patch.object(self.ms, "get_llm_settings",
                          return_value={"api_key": "", "base_url": "x", "model": "m", "timeout": 60}):
            self.ms.reset_memory_service()
            self.assertIsNone(self.ms.get_memory())


if __name__ == "__main__":
    unittest.main()
