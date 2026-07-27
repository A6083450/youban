"""后台管理 API 路由

后台密码以明文存放在数据目录（DATA_DIR，Docker 部署时映射到宿主机）的
admin_password.txt 中，每次登录/管理请求都重新读取该文件进行校验，
修改文件内容即可即时更换密码，无需重启服务。
"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ...config import get_data_dir, get_runtime_settings, update_runtime_settings
from ...services.amap_service import reset_amap_service
from ...services.google_map_service import reset_google_map_service
from ...services.llm_service import reset_llm
from ...agents.trip_planner_agent import reset_trip_planner_agent

router = APIRouter(prefix="/admin", tags=["后台管理"])

DEFAULT_ADMIN_PASSWORD = "admin@123"
ADMIN_PASSWORD_FILENAME = "admin_password.txt"


def get_admin_password_file() -> Path:
    """后台密码文件路径：数据目录下的 admin_password.txt。"""
    return get_data_dir() / ADMIN_PASSWORD_FILENAME


def ensure_admin_password_file() -> Path:
    """确保密码文件存在，不存在则写入默认密码。"""
    path = get_admin_password_file()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(DEFAULT_ADMIN_PASSWORD + "\n", encoding="utf-8")
    return path


def read_admin_password() -> str:
    """每次调用都从文件重新读取明文密码。"""
    path = ensure_admin_password_file()
    try:
        password = path.read_text(encoding="utf-8").strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取后台密码文件失败: {e}") from e
    return password or DEFAULT_ADMIN_PASSWORD


def verify_admin_token(x_admin_token: str = Header(default="")) -> None:
    """校验管理请求携带的 X-Admin-Token 头（值为后台密码）。"""
    if not x_admin_token or x_admin_token != read_admin_password():
        raise HTTPException(status_code=401, detail="后台密码校验失败，请重新登录")


class AdminLoginPayload(BaseModel):
    """后台登录请求。"""

    password: str = Field(default="", description="后台密码")


class AdminSettingsPayload(BaseModel):
    """后台配置表单提交的运行时配置。"""

    vite_amap_web_key: Optional[str] = Field(default=None, description="高德 Web 服务 Key")
    vite_amap_web_js_key: Optional[str] = Field(default=None, description="高德 JS SDK Key")
    google_maps_api_key: Optional[str] = Field(default=None, description="Google Maps API Key")
    google_maps_proxy: Optional[str] = Field(default=None, description="Google Maps 代理地址")
    xhs_cookie: Optional[str] = Field(default=None, description="小红书 Cookie")
    openai_api_key: Optional[str] = Field(default=None, description="LLM API Key")
    openai_base_url: Optional[str] = Field(default=None, description="LLM Base URL")
    openai_model: Optional[str] = Field(default=None, description="LLM 模型")


@router.post("/login")
async def admin_login(payload: AdminLoginPayload):
    """后台登录：与密码文件中的明文密码比对。"""
    if payload.password != read_admin_password():
        raise HTTPException(status_code=401, detail="密码错误")
    return {"success": True, "message": "登录成功"}


@router.get("/trips", dependencies=[Depends(verify_admin_token)])
async def list_all_trips(limit: int = 100):
    """管理员查看全部用户的游玩计划(含用户昵称,按更新时间倒序)。"""
    from ...services.user_service import list_users
    from .trip import _load_history_items

    safe_limit = max(1, min(int(limit or 100), 500))
    items = _load_history_items(safe_limit, all_users=True)
    nickname_by_id = {u.get("user_id"): u.get("nickname", "") for u in list_users()}
    for item in items:
        item["nickname"] = nickname_by_id.get(item.get("user_id") or "", "")
    return {"success": True, "items": items}


@router.delete("/trips/{task_id}", dependencies=[Depends(verify_admin_token)])
async def admin_delete_trip(task_id: str):
    """管理员删除任意用户的游玩计划。

    复用普通删除逻辑（连同任务状态/对话记录/无引用的缓存图片一并清理，
    进行中的任务会被拒绝），并额外要求后台密码校验。
    """
    from .trip import _delete_trip_plan

    return await _delete_trip_plan(task_id)


@router.get("/settings", dependencies=[Depends(verify_admin_token)])
async def get_admin_settings():
    """获取完整运行时配置（仅后台）。"""
    return {
        "success": True,
        "message": "ok",
        "data": get_runtime_settings(),
    }


@router.put("/settings", dependencies=[Depends(verify_admin_token)])
async def save_admin_settings(payload: AdminSettingsPayload):
    """保存运行时配置并立即生效（仅后台）。"""
    try:
        updates = payload.model_dump(exclude_unset=True)
        updated = update_runtime_settings(updates)

        # 重置单例，确保新配置立即生效
        reset_llm()
        reset_amap_service()
        reset_google_map_service()
        reset_trip_planner_agent()
        from ...services.memory_service import reset_memory_service
        reset_memory_service()

        return {
            "success": True,
            "message": "配置已保存并立即生效",
            "data": updated,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败: {str(e)}") from e
