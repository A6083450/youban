import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class UserServiceTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = patch(
            "app.services.user_service.get_data_dir",
            return_value=Path(self._tmp.name),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        from app.services import user_service
        user_service.clear_users_for_test()
        self.svc = user_service

    def test_login_creates_user_and_returns_stable_id(self):
        user = self.svc.login("小明")
        self.assertEqual(user["nickname"], "小明")
        self.assertTrue(user["user_id"])
        again = self.svc.login("小明")
        self.assertEqual(again["user_id"], user["user_id"])

    def test_login_normalizes_whitespace_and_casefold(self):
        a = self.svc.login("  Alice ")
        b = self.svc.login("alice")
        self.assertEqual(a["user_id"], b["user_id"])
        self.assertEqual(a["nickname"], "Alice")  # 保留首次输入的显示昵称

    def test_login_rejects_empty_and_too_long(self):
        with self.assertRaises(ValueError):
            self.svc.login("   ")
        with self.assertRaises(ValueError):
            self.svc.login("超" * 21)

    def test_get_user(self):
        user = self.svc.login("bob")
        self.assertEqual(self.svc.get_user(user["user_id"])["nickname"], "bob")
        self.assertIsNone(self.svc.get_user("nope"))

    def test_persisted_across_reload(self):
        user = self.svc.login("carol")
        self.svc.clear_users_for_test(keep_file=True)
        self.assertEqual(self.svc.login("carol")["user_id"], user["user_id"])


if __name__ == "__main__":
    unittest.main()
