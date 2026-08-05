"""LLM服务模块:OpenAI 兼容客户端(原生 + langchain),支持运行时热更新"""

import asyncio  # noqa: ANYIO_OK - 同步 SDK 流需要线程与事件循环桥接
import os
from typing import Any, AsyncIterator, Dict, Optional
from urllib.parse import urlparse

from openai import OpenAI

from ..config import get_settings

# 伪装浏览器 UA:部分第三方中转开启了 Cloudflare/WAF 拦截 Python 默认客户端特征
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_client_instance: Optional[OpenAI] = None


def get_llm_settings() -> Dict[str, Any]:
    """实时读取 LLM 配置(支持前端设置页热更新)。"""
    settings = get_settings()
    api_key = (
        settings.openai_api_key
        or os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    base_url = (
        settings.openai_base_url
        or os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    model = (
        settings.openai_model
        or os.getenv("LLM_MODEL_ID")
        or os.getenv("OPENAI_MODEL")
        or "gpt-4"
    )
    return {
        "api_key": api_key.strip(),
        "base_url": base_url.rstrip("/"),
        "model": model.strip(),
        "timeout": int(os.getenv("LLM_TIMEOUT", "60")),
    }


def get_openai_client() -> OpenAI:
    """获取原生 OpenAI 客户端(单例,带浏览器 UA)。"""
    global _client_instance
    if _client_instance is None:
        cfg = get_llm_settings()
        _client_instance = OpenAI(
            api_key=cfg["api_key"],
            base_url=cfg["base_url"],
            timeout=cfg["timeout"],
            default_headers={"User-Agent": _BROWSER_UA},
        )
        print(f"✅ LLM 客户端初始化成功: {cfg['base_url']} / {cfg['model']}")
    return _client_instance


def get_chat_model(
    temperature: float = 0.2,
    timeout: Optional[int] = None,
    max_tokens: Optional[int] = None,
):
    """获取 langchain ChatOpenAI 实例(LangGraph 节点用,轻量对象每次新建)。"""
    from langchain_openai import ChatOpenAI

    cfg = get_llm_settings()
    return ChatOpenAI(
        model=cfg["model"],
        api_key=cfg["api_key"],
        base_url=cfg["base_url"],
        temperature=temperature,
        timeout=timeout or cfg["timeout"],
        max_tokens=max_tokens,
        max_retries=1,
        use_responses_api=True,
        default_headers={"User-Agent": _BROWSER_UA},
    )


def reset_llm():
    """重置客户端(配置热更新后调用)。"""
    global _client_instance
    _client_instance = None


def llm_complete(
    prompt: str, temperature: float = 0.1, max_tokens: Optional[int] = None
) -> str:
    """同步单次补全(Responses API),返回纯文本输出。"""
    client = get_openai_client()
    kwargs: Dict[str, Any] = {}
    if max_tokens is not None:
        kwargs["max_output_tokens"] = max_tokens
    response = client.responses.create(
        model=get_llm_settings()["model"],
        input=prompt,
        temperature=temperature,
        **kwargs,
    )
    return response.output_text or ""


def _supports_reasoning_effort(base_url: str, model_id: str) -> bool:
    return urlparse(base_url).hostname == "api.deepseek.com" and model_id == "deepseek-v4-flash"


async def iter_llm_stream(
    prompt: str, temperature: float = 0.1, disable_thinking: bool = False
) -> AsyncIterator[str]:
    """通过 Responses API 在线程池中迭代阻塞流,并异步产出正文增量。

    `disable_thinking` 仅对官方 DeepSeek v4-flash 发送 `reasoning.effort=none`。
    """
    client = get_openai_client()
    llm_settings = get_llm_settings()
    model_id = llm_settings["model"]
    supports_reasoning_effort = _supports_reasoning_effort(llm_settings["base_url"], model_id)
    loop = asyncio.get_running_loop()
    queue: "asyncio.Queue[Any]" = asyncio.Queue()
    sentinel = object()

    def _worker() -> None:
        def _create(**extra):
            return client.responses.create(
                model=model_id,
                input=prompt,
                temperature=temperature,
                stream=True,
                **extra,
            )

        try:
            if disable_thinking and supports_reasoning_effort:
                stream = _create(reasoning={"effort": "none"})
            else:
                stream = _create()
            for event in stream:
                if getattr(event, "type", "") == "response.output_text.delta":
                    delta = getattr(event, "delta", "") or ""
                    if delta:
                        loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:  # noqa: BROAD_EXCEPT_OK - 在线程边界向协程转发 SDK 异常
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    fut = loop.run_in_executor(None, _worker)
    try:
        while True:
            item = await queue.get()
            if item is sentinel:
                break
            if isinstance(item, BaseException):
                raise item
            yield item
    finally:
        # 消费方提前退出(如客户端断开)时,后台线程会随 HTTP 流关闭自行收尾
        if not fut.done():
            fut.cancel()
