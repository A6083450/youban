"""运行时配置 API 路由（公开部分）

完整配置的读取与保存已迁移到后台管理接口 /api/admin/settings（需密码校验），
此处仅保留前端地图渲染所需的公开字段。
"""

from fastapi import APIRouter

from ...config import get_public_runtime_settings

router = APIRouter(prefix="/settings", tags=["运行时配置"])


@router.get("")
async def get_settings():
    """获取公开运行时配置（仅地图相关字段，不含敏感信息）。"""
    return {
        "success": True,
        "message": "ok",
        "data": get_public_runtime_settings(),
    }
