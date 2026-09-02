"""昵称登录与用户身份路由(轻量身份区分,非安全鉴权)"""

import asyncio

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...services import memory_service, user_service

router = APIRouter(prefix="/auth", tags=["用户"])


class LoginPayload(BaseModel):
    nickname: str = Field(..., max_length=50, description="用户昵称,输入即登录")


@router.post("/login", summary="昵称登录", description="输入昵称即登录;同昵称视为同一用户")
async def login(payload: LoginPayload):
    try:
        user = user_service.login(payload.nickname)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"success": True, "user": user}


@router.get("/me", summary="校验当前用户", description="按 X-User-Id 返回用户信息,不存在时 404")
async def me(x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    return {"success": True, "user": user}


@router.get("/memories", summary="我的记忆", description="返回 AI 对当前用户的长期记忆")
async def my_memories(x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    items = await asyncio.to_thread(memory_service.list_memories, user["user_id"])
    return {"success": True, "items": items}


@router.delete("/memories/{memory_id}", summary="删除一条记忆")
async def remove_memory(memory_id: str, x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    ok = await asyncio.to_thread(memory_service.delete_memory, memory_id, user["user_id"])
    if not ok:
        raise HTTPException(status_code=404, detail="记忆不存在或无法删除")
    return {"success": True}
