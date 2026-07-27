"""LLM服务模块:OpenAI 兼容客户端(原生 + langchain),支持运行时热更新"""

import asyncio
import os
from typing import Any, AsyncIterator, Dict, Optional

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
        default_headers={"User-Agent": _BROWSER_UA},
    )


def reset_llm():
    """重置客户端(配置热更新后调用)。"""
    global _client_instance
    _client_instance = None


async def iter_llm_stream(
    prompt: str, temperature: float = 0.1, disable_thinking: bool = False
) -> AsyncIterator[str]:
    """异步产出 LLM 流式回复的文本增量(content delta)。

    原生 OpenAI 客户端 stream=True 返回的是阻塞迭代器,这里在线程池里迭代,
    通过 asyncio.Queue 把每块 delta 桥接回事件循环,供 async SSE 端点消费。
    网络/鉴权等异常会透传到 async 侧抛出。

    disable_thinking: 推理模型(如 MiMo)会先输出几十秒 reasoning 才吐 content,
    对话类端点体感上完全不流式;置 True 时请求关闭思考,网关不支持该参数则自动回退。
    """
    client = get_openai_client()
    model_id = get_llm_settings()["model"]
    loop = asyncio.get_running_loop()
    queue: "asyncio.Queue[Any]" = asyncio.Queue()
    sentinel = object()

    def _worker() -> None:
        def _create(**extra):
            return client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                stream=True,
                **extra,
            )

        try:
            if disable_thinking:
                try:
                    stream = _create(extra_body={"thinking": {"type": "disabled"}})
                except Exception:
                    stream = _create()
            else:
                stream = _create()
            for chunk in stream:
                try:
                    delta = chunk.choices[0].delta.content or ""
                except (AttributeError, IndexError, TypeError):
                    delta = ""
                if delta:
                    loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:  # 透传给消费方抛出
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
