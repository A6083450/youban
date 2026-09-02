"""AI 行程问答路由"""

from fastapi import APIRouter, Header, HTTPException
from ...models.schemas import TripChatRequest, TripChatResponse, TripChatEditResponse
from ...services.chat_service import chat_with_trip_context, chat_edit_trip


def _clean_user_id(x_user_id) -> str:
    """Header 参数防御:直接调用端点函数(测试/内部)时默认值不是 str。"""
    return x_user_id.strip() if isinstance(x_user_id, str) else ""

router = APIRouter(prefix="/chat", tags=["AI问答"])


@router.post(
    "/ask",
    response_model=TripChatResponse,
    summary="行程智能问答",
    description="根据当前旅行计划上下文,回答用户关于行程的问题"
)
async def ask_about_trip(request: TripChatRequest, x_user_id: str = Header(default="")):
    """
    AI 行程问答

    Args:
        request: 包含用户提问、旅行计划上下文和历史对话

    Returns:
        AI 回复
    """
    try:
        print(f"\n💬 收到行程问答: {request.message[:50]}...")

        # 将 history 转换为 dict 列表
        history = [{"role": m.role, "content": m.content} for m in (request.history or [])]

        reply = await chat_with_trip_context(
            message=request.message,
            trip_plan_dict=request.trip_plan,
            history=history,
            user_id=_clean_user_id(x_user_id),
        )

        print(f"✅ AI 回复: {reply[:80]}...")

        return TripChatResponse(
            success=True,
            reply=reply,
        )

    except Exception as e:
        print(f"❌ 行程问答失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"AI问答服务异常: {str(e)}"
        )


@router.post(
    "/edit",
    response_model=TripChatEditResponse,
    summary="行程智能问答/修改",
    description="Agent 式对话:回答问题,或按用户要求直接修改旅行计划"
)
async def edit_trip(request: TripChatRequest, x_user_id: str = Header(default="")):
    try:
        print(f"\n✏️ 收到行程修改对话: {request.message[:50]}...")

        history = [{"role": m.role, "content": m.content} for m in (request.history or [])]
        result = await chat_edit_trip(
            message=request.message,
            trip_plan_dict=request.trip_plan,
            history=history,
            user_id=_clean_user_id(x_user_id),
        )

        print(f"✅ 回复: {result['reply'][:80]}... | 修改 {len(result['changes'])} 处")

        return TripChatEditResponse(
            success=True,
            reply=result["reply"],
            updated_plan=result["updated_plan"],
            changes=result["changes"],
        )

    except Exception as e:
        print(f"❌ 行程修改对话失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"AI修改服务异常: {str(e)}"
        )
