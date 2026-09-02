"""流式 JSON 字段增量提取。

LLM 在流式输出时吐出的是一坨尚未闭合的 JSON 文本（如
`{"action":"chat","reply":"你好`）。前端要的打字机文本只是其中某个字符串
字段（parse 用 `reply`、confirm-reply 用 `message`）的值。本模块从
**可能未闭合**的 JSON 缓冲里，稳健地取出该字段当前已确定的字符串值，
支持分块喂入时的单调增长——已确定的字符不会被回撤。
"""

from __future__ import annotations

import re
from typing import Tuple

_ESCAPE_MAP = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


def stream_extract_string_field(buffer: str, field: str) -> Tuple[str, bool]:
    """从（可能未闭合的）JSON 文本里取出 ``"field": "…"`` 的字符串值。

    返回 ``(value_so_far, closed)``：

    - ``value_so_far``：目前已能确定的字段值（转义已还原）。对逐渐增长的
      ``buffer`` 反复调用时该值单调增长，可安全地按 ``[已发送长度:]`` 增量推送。
    - ``closed``：字符串是否已读到闭合引号（True 表示该字段值已完整）。

    字段尚未出现、或值的开引号还没到达时返回 ``("", False)``。
    未完成的转义（末尾单独一个 ``\\``、不足 4 位的 ``\\uXXXX``）会被暂时保留
    到下一次调用，绝不吐出半个转义。
    """
    if not buffer or not field:
        return "", False

    # 定位 key 后值的开引号。JSON 里 key 先于同名值出现，故第一个匹配即真正的 key。
    key_match = re.search(r'"' + re.escape(field) + r'"\s*:\s*"', buffer)
    if not key_match:
        return "", False

    i = key_match.end()  # 值内容首字符位置（开引号之后）
    n = len(buffer)
    out: list[str] = []

    while i < n:
        ch = buffer[i]
        if ch == '"':
            # 未转义的闭引号 → 字符串结束
            return "".join(out), True
        if ch == "\\":
            if i + 1 >= n:
                # 转义符尚未到达其目标字符，等待下一块
                return "".join(out), False
            esc = buffer[i + 1]
            if esc == "u":
                if i + 6 > n:
                    # \uXXXX 的 4 位十六进制还没到齐
                    return "".join(out), False
                hex4 = buffer[i + 2 : i + 6]
                try:
                    out.append(chr(int(hex4, 16)))
                except ValueError:
                    # 非法 \u 序列，原样保留避免丢字
                    out.append(buffer[i : i + 6])
                i += 6
                continue
            out.append(_ESCAPE_MAP.get(esc, esc))
            i += 2
            continue
        out.append(ch)
        i += 1

    # buffer 到头仍未闭合
    return "".join(out), False
