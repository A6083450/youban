import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class AuthEndpointTest(unittest.TestCase):
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

        from fastapi import FastAPI
        from app.api.routes import auth
        app = FastAPI()
        app.include_router(auth.router, prefix="/api")
        self.client = TestClient(app)

    def test_login_success(self):
        resp = self.client.post("/api/auth/login", json={"nickname": "小星"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["user"]["nickname"], "小星")
        self.assertTrue(body["user"]["user_id"])

    def test_login_same_nickname_same_user(self):
        first = self.client.post("/api/auth/login", json={"nickname": "Neo"}).json()
        second = self.client.post("/api/auth/login", json={"nickname": " neo "}).json()
        self.assertEqual(first["user"]["user_id"], second["user"]["user_id"])

    def test_login_invalid_nickname(self):
        resp = self.client.post("/api/auth/login", json={"nickname": "   "})
        self.assertEqual(resp.status_code, 422)

    def test_me_roundtrip(self):
        user = self.client.post("/api/auth/login", json={"nickname": "回环"}).json()["user"]
        ok = self.client.get("/api/auth/me", headers={"X-User-Id": user["user_id"]})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["user"]["nickname"], "回环")
        missing = self.client.get("/api/auth/me", headers={"X-User-Id": "ghost123"})
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
