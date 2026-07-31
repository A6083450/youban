"""行程 JSON 容错解析:多层修复管线(从 MultiAgentTripPlanner 平移)

解析顺序:基础清理 → 未转义引号修复 → 截断修复 → 正则提取
→ Python 字面量解析 → 错误引导修复 → LLM 修复(最后手段)。
"""

import json

from ..models.schemas import TripPlan, TripRequest


def strip_comments_outside_strings(s: str) -> str:
    """移除 // 和 /* */ 注释,但不碰字符串值内部的内容(如 https:// URL)"""
    out = []
    i, n = 0, len(s)
    in_str = False
    esc = False
    while i < n:
        ch = s[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < n and s[i + 1] == '/':
            while i < n and s[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and s[i + 1] == '*':
            i += 2
            while i + 1 < n and not (s[i] == '*' and s[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def remove_trailing_commas(s: str) -> str:
    """移除 },] 前的尾逗号,但不碰字符串值内部的内容"""
    out = []
    i, n = 0, len(s)
    in_str = False
    esc = False
    while i < n:
        ch = s[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == ',':
            j = i + 1
            while j < n and s[j] in ' \t\r\n':
                j += 1
            if j < n and s[j] in '}]':
                # 尾逗号,跳过
                i += 1
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


def sanitize_json_str(json_str: str) -> str:
    """清理大模型输出中常见的 JSON 格式污染"""
    import re as _re
    # 1. 移除可能包裹在外面的 ```json ... ``` 标记
    json_str = _re.sub(r'^```(?:json)?\s*', '', json_str.strip())
    json_str = _re.sub(r'```\s*$', '', json_str.strip())
    # 2. 移除 JS 风格注释(字符串感知,不会误伤 URL 中的 //)
    json_str = strip_comments_outside_strings(json_str)
    # 3. 移除 JSON 值中的控制字符
    json_str = _re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', json_str)
    # 4. 修复尾部逗号(字符串感知)
    json_str = remove_trailing_commas(json_str)
    # 5. 修复中文引号和全角标点
    #    注意: 中文双引号""必须替换为单引号，因为它们通常出现在 JSON 字符串值内部
    #    如果替换为标准双引号会破坏 JSON 结构！
    json_str = json_str.replace('“', "'").replace('”', "'")
    json_str = json_str.replace('‘', "'").replace('’', "'")
    json_str = json_str.replace('：', ':')
    json_str = json_str.replace('，', ',')
    # 6. 修复 LLM 在 budget 等数值字段中输出算术表达式的问题
    #    例如: "total_attractions": 30+54+120+120=324 → "total_attractions": 324
    #    模式: 冒号后面跟着 数字[+-*/]数字...=最终结果
    def _fix_arithmetic_expr(m):
        """将算术表达式替换为等号后的最终结果，若无等号则尝试 eval"""
        expr = m.group(1).strip()
        if '=' in expr:
            # 取等号后面的最终结果
            return m.group(0).replace(m.group(1), expr.split('=')[-1].strip())
        else:
            # 没有等号，尝试安全计算
            try:
                result = eval(expr, {"__builtins__": {}}, {})
                return m.group(0).replace(m.group(1), str(result))
            except Exception:
                return m.group(0)
    # 匹配 JSON 键值对中冒号后的算术表达式（含 +、-、*、= 且以数字开头）
    json_str = _re.sub(
        r':\s*(\d+(?:\s*[+\-*/]\s*\d+)+(?:\s*=\s*\d+)?)',
        _fix_arithmetic_expr,
        json_str
    )
    return json_str


def fix_unescaped_quotes(json_str: str) -> str:
    """修复 JSON 字符串值内部未转义的双引号

    例如: "description": "这是"好的"景点"
    修复为: "description": "这是'好的'景点"
    """
    result = []
    i = 0
    in_string = False
    escape_next = False

    while i < len(json_str):
        ch = json_str[i]

        if escape_next:
            result.append(ch)
            escape_next = False
            i += 1
            continue

        if ch == '\\' and in_string:
            escape_next = True
            result.append(ch)
            i += 1
            continue

        if ch == '"':
            if not in_string:
                in_string = True
                result.append(ch)
            else:
                # 看下一个非空白字符是否是 JSON 结构字符
                rest = json_str[i+1:].lstrip()
                if rest and rest[0] in (',', '}', ']', ':'):
                    # 这是真正的字符串结尾引号
                    in_string = False
                    result.append(ch)
                elif not rest:
                    # 到末尾了，也是结尾引号
                    in_string = False
                    result.append(ch)
                else:
                    # 内嵌的未转义引号，替换为单引号
                    result.append("'")
        else:
            result.append(ch)

        i += 1

    return ''.join(result)


def error_guided_json_fix(json_str: str):
    """错误引导修复:按 json.JSONDecodeError 的报告位置逐点修复,直到能解析。

    覆盖场景:单引号/未加引号的键、键值对之间缺逗号、单引号字符串值、末尾多余内容。
    返回解析后的 dict;修复不了则抛出最后一个 JSONDecodeError。
    """
    import json as _json
    import re as _re

    s = json_str
    last_error = None
    for _ in range(50):
        try:
            return _json.loads(s)
        except _json.JSONDecodeError as e:
            last_error = e
            pos, msg = e.pos, e.msg
            fixed = False

            if "property name" in msg:
                # pos 处应出现对象键
                if pos < len(s) and s[pos] == "'":
                    # 单引号键 → 双引号
                    end = s.find("'", pos + 1)
                    if end != -1:
                        key = s[pos + 1:end]
                        s = s[:pos] + '"' + key + '"' + s[end + 1:]
                        fixed = True
                elif pos < len(s) and s[pos] in '}]':
                    # pos 指向 } 或 ],但前面多了逗号(尾逗号遗漏)→ 删掉前一个非空白逗号
                    j = pos - 1
                    while j >= 0 and s[j] in ' \t\r\n':
                        j -= 1
                    if j >= 0 and s[j] == ',':
                        s = s[:j] + s[j + 1:]
                        fixed = True
                else:
                    # 未加引号的键:token 到冒号为止
                    m = _re.compile(r"([A-Za-z_一-鿿][\w一-鿿\-]*)").match(s, pos)
                    if m:
                        rest = s[m.end():].lstrip()
                        if rest.startswith(':'):
                            s = s[:pos] + '"' + m.group(1) + '"' + s[m.end():]
                            fixed = True
            elif "Expecting ',' delimiter" in msg:
                # 键值对之间缺逗号
                s = s[:pos] + ',' + s[pos:]
                fixed = True
            elif "Expecting value" in msg and pos < len(s) and s[pos] == "'":
                # 单引号字符串值 → 双引号(内部双引号转义)
                end = s.find("'", pos + 1)
                if end != -1:
                    val = s[pos + 1:end].replace('"', '\\"')
                    s = s[:pos] + '"' + val + '"' + s[end + 1:]
                    fixed = True
            elif "Extra data" in msg:
                # 合法 JSON 之后还有多余内容 → 截断
                s = s[:pos]
                fixed = True

            if not fixed:
                break
    raise last_error if last_error else ValueError("错误引导修复失败")


def repair_truncated_json(json_str: str) -> str:
    """修复被 max_tokens 截断的不完整 JSON。

    策略：
    1. 如果最后一个字符在字符串值内部，先关闭该字符串。
    2. 移除最后一个不完整的键值对（trailing comma 之后的碎片）。
    3. 根据打开/关闭的括号差额，补齐缺失的 ] 和 }。
    """
    import re as _re

    s = json_str.rstrip()
    if not s:
        return s

    # --- Step 1: 关闭未终止的字符串 ---
    in_str = False
    escape = False
    for ch in s:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
    if in_str:
        # 去掉尾部可能的碎片转义符
        s = s.rstrip('\\')
        s += '"'

    # --- Step 2: 移除尾部不完整的键值对碎片 ---
    # 常见模式: 值字符串闭合后紧跟着换行但后面没有逗号/括号
    # 或者尾部是 "key": 但缺少值
    # 尝试反复去除尾部碎片直到以合法的 JSON 结构字符结尾
    for _ in range(10):
        stripped = s.rstrip()
        if not stripped:
            break
        last = stripped[-1]
        if last in ('}', ']', '"', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                    'e', 'l', 's'):
            # 'e' for true/false, 'l' for null, 's' unlikely but safe
            break
        # 当前尾部是非法字符(如冒号、逗号、空键名开头等)，回退一个 token
        s = stripped[:-1]

    # 移除尾部悬挂的逗号
    s = _re.sub(r',\s*$', '', s)

    # --- Step 3: 补齐缺失的闭合括号 ---
    # 扫描非字符串中的括号
    stack = []
    in_str2 = False
    esc2 = False
    for ch in s:
        if esc2:
            esc2 = False
            continue
        if ch == '\\' and in_str2:
            esc2 = True
            continue
        if ch == '"':
            in_str2 = not in_str2
            continue
        if in_str2:
            continue
        if ch in ('{', '['):
            stack.append(ch)
        elif ch == '}' and stack and stack[-1] == '{':
            stack.pop()
        elif ch == ']' and stack and stack[-1] == '[':
            stack.pop()

    # 用精确的 stack 逆序关闭
    closing = [']' if c == '[' else '}' for c in reversed(stack)]
    if closing:
        s += '\n' + ''.join(closing)

    return s


def llm_repair_json(broken_json: str) -> str:
    """使用 LLM 修复无法自动修复的 JSON（最后手段）"""
    from ..services.llm_service import llm_complete
    # 尽量发送完整内容;过长时保留头尾
    if len(broken_json) > 8000:
        body = f"开头部分:\n{broken_json[:2000]}\n\n...(中间省略)...\n\n尾部部分:\n{broken_json[-5000:]}"
    else:
        body = broken_json

    repair_prompt = f"""以下是一段存在语法错误的旅行计划 JSON（可能有未闭合引号、缺失/多余逗号、未加引号的键、括号不匹配等问题）。
请修复所有语法错误使其成为合法的 JSON，保持原有内容和结构不变。
只输出修复后的完整 JSON，不要输出任何解释文字。

{body}
"""
    try:
        content = llm_complete(repair_prompt, temperature=0.0, max_tokens=6000)
        # 从修复结果中提取 JSON
        import re as _re
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()
        if "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()
        match = _re.search(r'\{[\s\S]*\}', content)
        if match:
            return match.group()
        return content
    except Exception as e:
        print(f"⚠️  LLM 修复 JSON 失败: {e}")
        return broken_json


def parse_trip_plan(response: str, request: TripRequest) -> TripPlan:
    """
    解析规划 LLM 的响应,带有多层容错清理

    Args:
        response: LLM 响应文本
        request: 原始请求

    Returns:
        旅行计划

    Raises:
        ValueError: 所有修复手段均失败
    """
    import re as _re
    try:
        # 尝试从响应中提取JSON
        if "```json" in response:
            json_start = response.find("```json") + 7
            json_end = response.find("```", json_start)
            # 如果没有找到闭合的 ```，说明输出被截断，取到末尾
            if json_end == -1 or json_end <= json_start:
                json_str = response[json_start:].strip()
            else:
                json_str = response[json_start:json_end].strip()
        elif "```" in response:
            json_start = response.find("```") + 3
            json_end = response.find("```", json_start)
            if json_end == -1 or json_end <= json_start:
                json_str = response[json_start:].strip()
            else:
                json_str = response[json_start:json_end].strip()
        elif "{" in response:
            json_start = response.find("{")
            json_end = response.rfind("}")
            if json_end > json_start:
                json_str = response[json_start:json_end + 1]
            else:
                # 没有闭合的 }，取到末尾（截断场景）
                json_str = response[json_start:]
        else:
            raise ValueError("响应中未找到JSON数据")

        # ====== 第1轮：基础清理 + 解析 ======
        json_str = sanitize_json_str(json_str)

        parse_attempts = [
            ("基础清理", json_str),
        ]

        # 预生成各轮修复候选
        fixed_quotes = fix_unescaped_quotes(json_str)
        parse_attempts.append(("修复未转义引号", fixed_quotes))

        # 截断修复
        repaired = repair_truncated_json(json_str)
        if repaired != json_str:
            parse_attempts.append(("截断修复", repaired))
            # 截断修复 + 引号修复
            repaired_fixed = fix_unescaped_quotes(repaired)
            if repaired_fixed != repaired:
                parse_attempts.append(("截断+引号修复", repaired_fixed))

        # 暴力正则提取
        match = _re.search(r'\{[\s\S]*\}', json_str)
        if match:
            brutal = sanitize_json_str(match.group())
            brutal = fix_unescaped_quotes(brutal)
            parse_attempts.append(("正则提取", brutal))
            # 对正则提取的结果也做截断修复
            brutal_repaired = repair_truncated_json(brutal)
            if brutal_repaired != brutal:
                parse_attempts.append(("正则+截断修复", brutal_repaired))

        # 依次尝试每种修复
        last_error = None
        for attempt_name, candidate in parse_attempts:
            try:
                data = json.loads(candidate)
                if attempt_name != "基础清理":
                    print(f"✅ JSON 通过「{attempt_name}」成功解析")
                # 转换为TripPlan对象
                return TripPlan(**data)
            except (json.JSONDecodeError, Exception) as e:
                last_error = e
                if attempt_name == "基础清理":
                    pos = e.pos if hasattr(e, 'pos') else 0
                    context_start = max(0, pos - 60)
                    context_end = min(len(candidate), pos + 60)
                    print(f"⚠️  首次 JSON 解析失败: {e}")
                    print(f"   出错位置附近内容: ...{candidate[context_start:context_end]}...")
                else:
                    print(f"⚠️  「{attempt_name}」仍失败: {e}")

        # ====== 补充手段：Python 字面量解析 ======
        # 覆盖 json.loads 处理不了但结构完好的输出:单引号、Python 风格 True/False/None、
        # 以及清理规则遗漏的尾逗号(literal_eval 天然兼容)
        import ast as _ast
        for attempt_name, candidate in parse_attempts:
            try:
                data = _ast.literal_eval(candidate)
                if isinstance(data, dict):
                    print(f"✅ JSON 通过「{attempt_name}+Python字面量」成功解析")
                    return TripPlan(**data)
            except (ValueError, SyntaxError, MemoryError, RecursionError):
                continue
            except Exception as e_trip:
                # literal_eval 成功但 TripPlan 校验失败,记录后继续其他候选
                last_error = e_trip
                print(f"⚠️  「{attempt_name}+Python字面量」TripPlan 校验失败: {e_trip}")

        # ====== 补充手段：错误引导修复 ======
        # 按 JSONDecodeError 报告的位置逐点修复(单引号/未加引号键、缺逗号等)
        for attempt_name, candidate in parse_attempts:
            try:
                data = error_guided_json_fix(candidate)
                if isinstance(data, dict):
                    print(f"✅ JSON 通过「{attempt_name}+错误引导修复」成功解析")
                    return TripPlan(**data)
            except Exception as e_guided:
                last_error = e_guided
                continue

        # ====== 最终手段：LLM 修复 ======
        print("🔧 所有本地修复均失败，尝试使用 LLM 修复 JSON...")
        llm_fixed = llm_repair_json(json_str)
        llm_fixed = sanitize_json_str(llm_fixed)
        try:
            data = json.loads(llm_fixed)
            print("✅ JSON 通过 LLM 修复成功解析")
            return TripPlan(**data)
        except Exception as e_llm:
            print(f"⚠️  LLM 修复后仍然解析失败: {e_llm}")
            # 落盘原始响应,便于排查模型输出中的具体问题
            try:
                import os as _os
                import time as _time
                debug_dir = _os.path.join(_os.path.dirname(__file__), '..', '..', 'data', 'debug')
                _os.makedirs(debug_dir, exist_ok=True)
                debug_path = _os.path.join(debug_dir, f"failed_itinerary_{_time.strftime('%Y%m%d_%H%M%S')}.txt")
                with open(debug_path, 'w', encoding='utf-8') as f:
                    f.write(response)
                print(f"📝 失败响应已保存: {debug_path}")
            except Exception as e_dump:
                print(f"⚠️  保存失败响应出错: {e_dump}")
            # 最终 raise 最初的错误
            raise ValueError(f"行程 JSON 解析失败: {str(last_error)}") from last_error

    except ValueError:
        raise
    except Exception as e:
        print(f"⚠️  解析响应失败: {str(e)}")
        raise ValueError(f"行程 JSON 解析失败: {str(e)}") from e
