# 游伴聊天式重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TripStar 重构为「游伴」——Codex 式聊天布局（左侧计划列表 + 中间详情/对话），数据源从小红书切换为高德，数据统一落盘根目录 `data/`。

**Architecture:** 后端 FastAPI 新增 `/api/trip/parse` 自然语言解析接口与图片本地缓存；前端重构为固定侧边栏单页应用，`/` 为聊天主页、`/plan/:id` 为计划详情（复用 Result.vue）。小红书/Google 代码保留文件但停用。

**Tech Stack:** FastAPI + pydantic-settings, Vue 3 + vue-router + Ant Design Vue + vue-i18n, 高德 Web 服务 API (v5/place/text), Docker Compose。

## Global Constraints

- 小红书相关文件（`xhs_service.py`、`xhs_sign/`）保留但不再被调用；Google 地图文件（`google_map_service.py`）保留但停用
- 项目改名「游伴」仅显示层：页面标题、品牌文案、README 主标题；目录名/包名/容器名不变
- 数据根目录为项目根 `data/`，容器内 `/app/data`，由环境变量 `DATA_DIR` 控制
- 接口响应格式保持向后兼容：`/api/poi/photo` 仍返回 `{success, data: {photo_url}}`
- 前端必须通过 `npm run build`（vue-tsc）；后端必须通过 `python -m compileall`
- i18n 三语言（zh-CN/en/ja-JP）新增文案必须补齐
- 仓库无测试框架，验证以命令级检查 + 手动端到端为准，不要引入新测试框架

---

### Task 1: DATA_DIR 配置与数据目录迁移

**Files:**
- Modify: `backend/app/config.py`（新增 data_dir 配置与 `get_data_dir()`）
- Modify: `backend/app/api/routes/trip.py:22`（`_TASKS_DATA_DIR` 改用 `get_data_dir()`）
- Modify: `Dockerfile`（新增 ENV DATA_DIR 与 mkdir）
- Modify: `docker-compose.yaml`、`docker-compose.dev.yaml`（卷映射 `./data:/app/data`，移除 XHS_COOKIE 与命名卷）
- Modify: `.gitignore`（增加 `data/`）

**Interfaces:**
- Produces: `config.get_data_dir() -> Path` — 后续所有数据落盘（trip_tasks/images/conversations）都通过它定位

- [ ] **Step 1: config.py 新增 data_dir**

在 `backend/app/config.py` 的 `Settings` 类中（`log_level` 字段后）添加：

```python
    # 数据目录配置（计划 JSON / 图片缓存 / 对话记录）
    data_dir: str = ""
```

在文件末尾 `get_settings()` 之后添加：

```python
def get_data_dir() -> Path:
    """获取数据根目录：优先 DATA_DIR 环境变量，默认项目根 ./data。"""
    if settings.data_dir:
        return Path(settings.data_dir)
    # backend/app/config.py → parents[2] = 项目根
    return Path(__file__).resolve().parents[2] / "data"
```

- [ ] **Step 2: trip.py 改用 get_data_dir**

`backend/app/api/routes/trip.py` 第 22 行：

```python
_TASKS_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "trip_tasks"
```

改为：

```python
from ...config import get_data_dir

_TASKS_DATA_DIR = get_data_dir() / "trip_tasks"
```

（将 `from ...config import get_data_dir` 合并到文件顶部 import 区，不要重复 import。）

- [ ] **Step 3: Dockerfile 增加数据目录**

在 `Dockerfile` 的 `EXPOSE 7860` 之前添加：

```dockerfile
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
```

- [ ] **Step 4: docker-compose.yaml 卷映射**

`docker-compose.yaml` 全文替换为：

```yaml
services:
  trip-planner:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VITE_AMAP_WEB_JS_KEY: ${VITE_AMAP_WEB_JS_KEY:-your_amap_web_js_api_key_here}
        VITE_AMAP_WEB_KEY: ${VITE_AMAP_WEB_KEY:-your_amap_web_api_key_here}
    container_name: helloagents-trip-planner
    ports:
      - "7860:7860"
    environment:
      - LLM_API_KEY=${LLM_API_KEY:-}
      - LLM_BASE_URL=${LLM_BASE_URL:-https://api.openai.com/v1}
      - LLM_MODEL_ID=${LLM_MODEL_ID:-gpt-4}
      - LLM_TIMEOUT=600
      - VITE_AMAP_WEB_KEY=${VITE_AMAP_WEB_KEY:-your_amap_web_api_key_here}
      - DATA_DIR=/app/data
      - HOST=0.0.0.0
      - PORT=7860
      - LOG_LEVEL=INFO
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

`docker-compose.dev.yaml`：删除 `XHS_COOKIE`、`GOOGLE_MAPS_API_KEY`、`GOOGLE_MAPS_PROXY` 三行环境变量；volumes 中把 `trip_data_dev:/app/backend/data` 替换为 `./data:/app/data`；删除文件末尾的 `volumes: trip_data_dev:` 块；增加 `- DATA_DIR=/app/data` 环境变量。

- [ ] **Step 5: .gitignore**

`.gitignore` 中把 `backend/data/trip_tasks` 替换为：

```
data/
backend/runtime_settings.json
```

- [ ] **Step 6: 验证**

Run: `cd backend && python -m compileall app/config.py app/api/routes/trip.py && python -c "from app.config import get_data_dir; print(get_data_dir())"`
Expected: 无编译错误，输出 `/Users/liangjiaquan/gitReposition/TripStar/data`

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/api/routes/trip.py Dockerfile docker-compose.yaml docker-compose.dev.yaml .gitignore
git commit -m "feat: 数据目录统一迁移到根目录 data/ 并支持 DATA_DIR 配置"
```

---

### Task 2: 高德景点搜索 search_amap_attractions

**Files:**
- Modify: `backend/app/services/amap_service.py`（新增 `search_amap_attractions`）
- Modify: `backend/app/agents/trip_planner_agent.py:450,474-476`（切换调用）

**Interfaces:**
- Consumes: `config.get_settings().vite_amap_web_key`、`services.llm_service.get_llm()`
- Produces: `search_amap_attractions(city: str, keywords: str, language: str = "zh") -> str` — 返回与 `search_xhs_attractions` 相同格式的文本（每行一个景点 JSON，含 name/name_zh/name_en/reason/duration/reservation_required/reservation_tips/location）

- [ ] **Step 1: amap_service.py 新增景点搜索函数**

在 `backend/app/services/amap_service.py` 文件末尾（`reset_amap_service` 之后）添加：

```python
def search_amap_attractions(city: str, keywords: str, language: str = "zh") -> str:
    """基于高德 POI 搜索景点，并用 LLM 提纯为结构化景点数据（替代小红书搜索）。

    返回格式与旧 search_xhs_attractions 一致：说明行 + 每行一个景点 JSON。
    """
    import json as _json
    import re as _re
    import httpx as _httpx
    from .llm_service import get_llm

    settings = get_settings()
    if not settings.vite_amap_web_key:
        raise RuntimeError("高德 Web Key 未配置，无法搜索景点，请先在设置页配置 VITE_AMAP_WEB_KEY")

    print(f"🔍 [AMAP_SERVICE] 正在呼叫高德 POI 搜索: {city} {keywords}")
    kw = f"{keywords}景点" if keywords and keywords != "景点" else "热门景点"
    try:
        resp = _httpx.get(
            "https://restapi.amap.com/v5/place/text",
            params={
                "key": settings.vite_amap_web_key,
                "keywords": kw,
                "region": city,
                "city_limit": "true",
                "types": "110000",  # 风景名胜
                "page_size": 20,
            },
            timeout=10,
        )
        pois = resp.json().get("pois") or []
    except Exception as e:
        raise RuntimeError(f"高德 POI 搜索请求失败: {e}")

    if not pois:
        return f"未在高德地图检索到关于 {city} {keywords} 的景点。"

    # 组装 POI 摘要供 LLM 提纯
    poi_lines = []
    poi_locations: dict = {}
    for poi in pois[:12]:
        name = poi.get("name", "")
        if not name:
            continue
        loc_str = poi.get("location", "")
        if "," in loc_str:
            try:
                lon, lat = loc_str.split(",")
                poi_locations[name] = {"longitude": float(lon), "latitude": float(lat)}
            except ValueError:
                pass
        poi_lines.append(
            f"- {name} | 地址: {poi.get('address', '无')} | 类型: {poi.get('type', '')}"
        )
    poi_text = "\n".join(poi_lines)

    _lang = (language or "zh").strip().lower().split("-")[0]
    _lang_names = {"en": "English", "ja": "Japanese", "ko": "Korean", "fr": "French", "de": "German", "es": "Spanish"}
    translation_instruction = ""
    if _lang != "zh" and _lang in _lang_names:
        translation_instruction = f"""
**极其重要的翻译要求:**
目标语言为 {_lang_names[_lang]}。你必须将 "name", "reason", "reservation_tips" 翻译为 {_lang_names[_lang]}。
- "name_zh" 始终保持简体中文，"name_en" 始终保持英文，不受目标语言影响！
- "duration" 和 "reservation_required" 保持原始数值/布尔值不变。
"""

    extract_prompt = f"""
以下是高德地图 POI 接口返回的【{city}】真实景点列表（名称、地址、类型均真实存在）。
请从中筛选出最值得游玩的 6-10 个景点，返回严格的 JSON 数组，不要输出 JSON 以外的任何文字！
{translation_instruction}
数组中每个对象必须包含以下字段:
"name": 景点官方名称(按目标语言填写；中文则与 name_zh 相同，必须来自 POI 列表)
"name_zh": 景点中文简体名称(必须来自 POI 列表原文)
"name_en": 景点英文名称(国际通用官方英文名)
"reason": 推荐理由/游玩建议(结合景点类型与常识，80字以内)
"duration": 建议游玩时长(数字, 分钟)
"reservation_required": 是否需要提前预约(布尔值)。故宫、博物馆类热门景点通常为 true，其余默认 false
"reservation_tips": 预约提示(字符串)。需要预约时给出官方渠道建议；不需要则填空字符串

POI 列表如下:
{poi_text}

JSON 返回示例:
[
  {{"name": "故宫博物院", "name_zh": "故宫博物院", "name_en": "The Palace Museum", "reason": "必去打卡，建议走中轴线。", "duration": 240, "reservation_required": true, "reservation_tips": "需提前7天在故宫官网或微信小程序预约"}}
]
"""
    llm = get_llm()
    try:
        response = llm._client.chat.completions.create(
            model=llm.model,
            messages=[{"role": "user", "content": extract_prompt}],
            temperature=0.1,
        )
        content = response.choices[0].message.content
        json_match = _re.search(r'\[.*\]', content, _re.DOTALL)
        extracted = _json.loads(json_match.group() if json_match else content)
    except Exception as e:
        print(f"❌ 大模型提纯高德景点数据异常: {e}")
        return "尝试提取高德景点结构化数据失败，降级回常规处理。"

    final_result = "这是高德地图热门景点的提取结果，附带确切坐标（图片由前端单独从高德获取）：\n"
    for item in extracted:
        name = item.get("name", "")
        if not name:
            continue
        name_zh = item.get("name_zh", name)
        # 优先使用 POI 真实坐标（高德 GCJ-02，与前端高德地图一致）
        loc = poi_locations.get(name_zh) or poi_locations.get(name)
        if not loc:
            from .map_dispatcher import geocode_unified
            loc = geocode_unified(name, city, address_zh=name_zh, address_en=item.get("name_en", name))
        item["location"] = loc
        final_result += _json.dumps(item, ensure_ascii=False) + "\n"

    print(f"✅ [AMAP_SERVICE] 高德景点数据挖掘完毕，共 {len(extracted)} 个景点。")
    return final_result
```

- [ ] **Step 2: trip_planner_agent.py 切换调用**

`backend/app/agents/trip_planner_agent.py` 第 450 行：

```python
            from ..services.xhs_service import search_xhs_attractions
```

改为：

```python
            from ..services.amap_service import search_amap_attractions
```

第 474-476 行：

```python
                attraction_response = await asyncio.to_thread(
                    search_xhs_attractions, city, keywords, _lang
                )
```

改为：

```python
                attraction_response = await asyncio.to_thread(
                    search_amap_attractions, city, keywords, _lang
                )
```

同时将第 170 行 PLANNER_AGENT_PROMPT 中的：

```
9. **景点图片**: 不需要在JSON中填写 image_url 字段，图片由前端根据景点名称自动从小红书获取。
```

改为：

```
9. **景点图片**: 不需要在JSON中填写 image_url 字段，图片由前端根据景点名称自动从高德地图获取。
```

- [ ] **Step 3: 验证编译**

Run: `cd backend && python -m compileall app/services/amap_service.py app/agents/trip_planner_agent.py`
Expected: 无错误

- [ ] **Step 4: 验证真实搜索（需 .env 中已配置 VITE_AMAP_WEB_KEY 与 LLM key）**

Run: `cd backend && python -c "from app.services.amap_service import search_amap_attractions; print(search_amap_attractions('西安', '美食', 'zh')[:600])"`
Expected: 输出以「这是高德地图热门景点的提取结果」开头、包含景点 JSON 行的文本；若 Key 未配置则报明确错误文案

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/amap_service.py backend/app/agents/trip_planner_agent.py
git commit -m "feat: 景点搜索数据源从小红书切换为高德 POI + LLM 提纯"
```

---

### Task 3: 景点图片高德下载缓存 + /poi/photo 改造

**Files:**
- Modify: `backend/app/services/amap_service.py`（新增 `get_cached_poi_photo`）
- Modify: `backend/app/api/routes/poi.py`（`/photo` 只走高德缓存）
- Modify: `backend/app/api/main.py`（挂载 `/api/images` 静态目录）
- Modify: `frontend/src/views/Result.vue:1831-1837`（相对图片路径补 apiBase 前缀）

**Interfaces:**
- Consumes: `config.get_data_dir()`（Task 1）
- Produces: `get_cached_poi_photo(name: str, city: str | None) -> str` — 返回可直接访问的图片 URL（本地 `/api/images/<hash>.jpg` 或高德远程 URL，失败返回 ""）；响应格式不变 `{success, data:{name, photo_url}}`

- [ ] **Step 1: amap_service.py 新增缓存下载函数**

在 `search_amap_attractions`（Task 2）之后添加：

```python
def get_cached_poi_photo(name: str, city: Optional[str] = None) -> str:
    """获取景点图片并缓存到 data/images/，返回可访问 URL。

    命中本地缓存直接返回 "/api/images/<hash>.<ext>"；
    未命中则从高德获取远程 URL 并尝试下载落盘，下载失败时返回远程 URL。
    """
    import hashlib
    import requests as _requests
    from ..config import get_data_dir

    images_dir = get_data_dir() / "images"
    try:
        images_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"⚠️ 创建图片缓存目录失败: {e}")
        return ""

    digest = hashlib.md5(f"{city or ''}:{name}".encode("utf-8")).hexdigest()[:16]

    # 命中缓存
    for ext in ("jpg", "jpeg", "png", "webp"):
        cached = images_dir / f"{digest}.{ext}"
        if cached.exists() and cached.stat().st_size > 0:
            return f"/api/images/{cached.name}"

    # 未命中：走高德
    remote_url = get_amap_service().get_poi_photo(name, city)
    if not remote_url:
        return ""

    # 尝试下载落盘
    try:
        resp = _requests.get(remote_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code == 200 and len(resp.content) > 1024:
            content_type = resp.headers.get("Content-Type", "")
            ext = "png" if "png" in content_type else ("webp" if "webp" in content_type else "jpg")
            target = images_dir / f"{digest}.{ext}"
            target.write_bytes(resp.content)
            return f"/api/images/{target.name}"
    except Exception as e:
        print(f"⚠️ 图片下载失败 ({name}): {e}")

    return remote_url
```

- [ ] **Step 2: poi.py /photo 只走高德缓存**

`backend/app/api/routes/poi.py` 中 `get_attraction_photo` 函数体（第 104-137 行 try 块）替换为：

```python
    try:
        from ...services.amap_service import get_cached_poi_photo
        photo_url = await asyncio.to_thread(get_cached_poi_photo, name, city)

        if not photo_url:
            print(f"⚠️ 无法为 {name} 找到图片，返回空")

        return {
            "success": True,
            "message": "获取图片成功",
            "data": {
                "name": name,
                "photo_url": photo_url
            }
        }
```

同时在文件顶部 import 区添加 `import asyncio`，并更新路由装饰器 description 为 `"根据景点名称获取图片（高德 POI，本地缓存）"`。

- [ ] **Step 3: main.py 挂载图片静态目录**

`backend/app/api/main.py` 在「注册路由」代码块之后添加：

```python
# 挂载景点图片缓存目录
from ..config import get_data_dir
_images_dir = get_data_dir() / "images"
_images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/images", StaticFiles(directory=str(_images_dir)), name="images")
```

- [ ] **Step 4: Result.vue 相对路径补前缀**

`frontend/src/views/Result.vue` 约 1835 行：

```ts
        if (data.success && data.data.photo_url) {
          attractionPhotos.value[name] = data.data.photo_url
```

改为：

```ts
        if (data.success && data.data.photo_url) {
          const url = String(data.data.photo_url)
          attractionPhotos.value[name] = url.startsWith('/') ? `${apiBase}${url}` : url
```

（确认该作用域内 `apiBase` 变量名与 1832 行所用一致，若不同则用同一个变量。）

- [ ] **Step 5: 验证**

Run: `cd backend && python -m compileall app/services/amap_service.py app/api/routes/poi.py app/api/main.py`
Expected: 无错误

启动后端后验证：
Run: `curl -s "http://localhost:8000/api/poi/photo?name=兵马俑&city=西安"`
Expected: `photo_url` 为 `/api/images/<hash>.jpg`（或高德远程 URL），且 `data/images/` 下出现对应文件；`curl -sI "http://localhost:8000/api/images/<hash>.jpg"` 返回 200

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/amap_service.py backend/app/api/routes/poi.py backend/app/api/main.py frontend/src/views/Result.vue
git commit -m "feat: 景点图片改为高德获取并下载缓存到 data/images"
```

---

### Task 4: /api/trip/parse 自然语言解析接口 + 对话落盘

**Files:**
- Modify: `backend/app/models/schemas.py`（TripRequest 新增 `origin_text`）
- Modify: `backend/app/api/routes/trip.py`（新增 `/parse` 路由、计划提交时写对话文件）

**Interfaces:**
- Consumes: `services.llm_service.get_llm()`、`config.get_data_dir()`
- Produces:
  - `POST /api/trip/parse` 请求 `{text, language, today}` → 响应 `{success, need_clarify, clarify_question, summary, trip}`；`trip` 为 TripRequest 兼容字典（city/cities/start_date/end_date/travel_days/transportation/accommodation/preferences/free_text_input/origin_text）
  - `TripRequest.origin_text: Optional[str]` — 用户原始输入句子
  - 对话文件 `data/conversations/<plan_id>.json`：`{"plan_id", "messages": [{"role", "content"}]}`

- [ ] **Step 1: schemas.py TripRequest 增加 origin_text**

在 `free_text_input` 字段后添加：

```python
    origin_text: Optional[str] = Field(default="", description="用户自然语言原始输入")
```

- [ ] **Step 2: trip.py 新增 /parse 路由**

在 `plan_trip` 路由之前添加：

```python
class TripParseRequest(BaseModel):
    text: str
    language: str = "zh"
    today: str = ""


@router.post("/parse", summary="自然语言行程解析", description="把一句话旅行描述解析为结构化 TripRequest")
async def parse_trip_text(payload: TripParseRequest):
    from pydantic import BaseModel as _BM  # noqa: F401  (仅为文档化，实际用顶部 import)
    import re as _re
    from datetime import datetime as _dt, timedelta as _td
    from ...services.llm_service import get_llm

    today_str = payload.today or _dt.now().strftime("%Y-%m-%d")
    tomorrow = (_dt.strptime(today_str, "%Y-%m-%d") + _td(days=1)).strftime("%Y-%m-%d")

    prompt = f"""你是旅行意图解析助手。今天是 {today_str}。
请把用户的旅行描述解析为严格 JSON（不要输出任何其他文字）：
{{
  "cities": [{{"city": "城市名", "days": 天数}}],
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "transportation": "公共交通|自驾|步行|混合",
  "accommodation": "经济型酒店|舒适型酒店|豪华酒店|民宿",
  "preferences": ["历史文化|自然风光|美食|购物|艺术|休闲 中匹配的标签"],
  "need_clarify": false,
  "clarify_question": "",
  "summary": "一句话行程摘要"
}}
规则：
1. 用户未提日期 → start_date 用 {tomorrow}（明天）；提到"下周末"等相对日期请换算为具体日期
2. 未提天数 → 每个城市 3 天；end_date = start_date + 总天数 - 1
3. 未提交通/住宿 → 公共交通 / 经济型酒店
4. 如果描述中没有任何可辨认的城市或目的地 → need_clarify=true，clarify_question 用友好语气追问目的地，其余字段给默认值
5. preferences 只能从给定标签中选取，没有匹配则空数组
用户描述：{payload.text}"""

    defaults = {
        "success": True,
        "need_clarify": True,
        "clarify_question": "想去哪里玩呢？告诉我目的地和大概天数，我来帮你规划～",
        "summary": "",
        "trip": None,
    }

    try:
        llm = get_llm()
        response = await asyncio.to_thread(
            lambda: llm._client.chat.completions.create(
                model=llm.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
        )
        content = response.choices[0].message.content or ""
        match = _re.search(r'\{[\s\S]*\}', content)
        data = json.loads(match.group() if match else content)
    except Exception as e:
        print(f"⚠️ 自然语言解析失败: {e}")
        return defaults

    try:
        cities = [
            {"city": str(c.get("city", "")).strip(), "days": max(1, min(int(c.get("days", 3)), 15))}
            for c in (data.get("cities") or [])
            if str(c.get("city", "")).strip()
        ]
        if not cities:
            return {**defaults, "clarify_question": data.get("clarify_question") or defaults["clarify_question"]}

        start_date = str(data.get("start_date") or tomorrow)
        total_days = sum(c["days"] for c in cities)
        end_date = str(data.get("end_date") or "")
        if not end_date:
            end_date = (_dt.strptime(start_date, "%Y-%m-%d") + _td(days=total_days - 1)).strftime("%Y-%m-%d")

        need_clarify = bool(data.get("need_clarify")) and not cities
        return {
            "success": True,
            "need_clarify": need_clarify,
            "clarify_question": str(data.get("clarify_question") or ""),
            "summary": str(data.get("summary") or ""),
            "trip": {
                "city": cities[0]["city"],
                "cities": cities,
                "start_date": start_date,
                "end_date": end_date,
                "travel_days": total_days,
                "transportation": str(data.get("transportation") or "公共交通"),
                "accommodation": str(data.get("accommodation") or "经济型酒店"),
                "preferences": [str(p) for p in (data.get("preferences") or [])],
                "free_text_input": payload.text,
                "origin_text": payload.text,
            },
        }
    except Exception as e:
        print(f"⚠️ 解析结果后处理失败: {e}")
        return defaults
```

同时在 trip.py 顶部 import 区添加 `from pydantic import BaseModel`（若尚无）。

- [ ] **Step 3: plan_trip 写对话文件**

在 `plan_trip` 函数中 `_persist_task_state(task_id, _tasks[task_id])` 之后添加：

```python
    # 落盘对话记录（自然语言输入 → 结构化确认）
    try:
        conv_dir = _TASKS_DATA_DIR.parent / "conversations"
        conv_dir.mkdir(parents=True, exist_ok=True)
        origin = (request.origin_text or "").strip()
        messages = []
        if origin:
            messages.append({"role": "user", "content": origin})
        messages.append({
            "role": "assistant",
            "content": f"已确认行程：{_city_display}，{request.start_date} 至 {request.end_date}，共 {request.travel_days} 天。",
        })
        with open(conv_dir / f"{task_id}.json", "w", encoding="utf-8") as f:
            json.dump({"plan_id": task_id, "messages": messages}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️  保存对话记录失败: {e}")
```

- [ ] **Step 4: 验证**

Run: `cd backend && python -m compileall app/api/routes/trip.py app/models/schemas.py`
Expected: 无错误

启动后端后：
Run: `curl -s -X POST http://localhost:8000/api/trip/parse -H 'Content-Type: application/json' -d '{"text":"下周末去西安玩3天，喜欢美食","language":"zh","today":"2026-07-24"}'`
Expected: 返回 `trip.cities[0].city == "西安"`、`travel_days == 3`、start_date 为 2026-08-01（下周六）或合理日期

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/schemas.py backend/app/api/routes/trip.py
git commit -m "feat: 新增自然语言行程解析接口 /api/trip/parse 与对话落盘"
```

---

### Task 5: 停用 Google 引擎与小红书调用清理

**Files:**
- Modify: `backend/app/services/map_dispatcher.py`（provider 固定 amap）
- Modify: `backend/app/agents/trip_planner_agent.py:183-244`（初始化固定高德工具）
- Modify: `backend/app/api/routes/trip.py:371-393`（移除 XHSCookieExpiredError 特殊分支）
- Modify: `backend/app/api/routes/settings.py`（注释保留 xhs_cookie 字段——不改，仅前端隐藏）

**Interfaces:**
- Produces: `get_map_provider()` 恒返回 `"amap"`；`geocode_unified()` 恒走高德

- [ ] **Step 1: map_dispatcher.py 固定高德**

`get_map_provider` 函数体替换为：

```python
def get_map_provider() -> MapProvider:
    """地图供应商固定为高德（Google 双引擎已停用）。"""
    return "amap"
```

`geocode_unified` 函数体替换为：

```python
def geocode_unified(address: str, city: str, *, address_zh: str = "", address_en: str = "") -> dict:
    """统一地理编码接口（固定高德），返回 {"longitude": float, "latitude": float}。"""
    amap_address = address_zh or address
    from .xhs_service import _geocode_amap_raw  # noqa: delay import  (函数暂存于保留的 xhs_service 中)
    return _geocode_amap_raw(amap_address, city)
```

- [ ] **Step 2: trip_planner_agent.py 初始化固定高德**

`__init__` 中第 191-201 行：

```python
            # ---------- 判断地图供应商 ----------
            from ..services.map_dispatcher import get_map_provider
            self.map_provider = get_map_provider()
            print(f"  - 地图供应商: {self.map_provider.upper()}")

            if self.map_provider == "google":
                tool_prefix = "google"
                self._init_google_tools(settings)
            else:
                tool_prefix = "amap"
                self._init_amap_tools(settings)
```

替换为：

```python
            # ---------- 地图供应商固定为高德 ----------
            self.map_provider = "amap"
            print(f"  - 地图供应商: AMAP")
            tool_prefix = "amap"
            self._init_amap_tools(settings)
```

（`_init_google_tools` 方法与 `google_map_service.py` 文件保留不删。）

- [ ] **Step 3: trip.py 移除小红书异常分支**

第 375-384 行：

```python
        # 针对小红书 Cookie 过期异常做出特殊处理返回给前端
        try:
            from ...services.xhs_service import XHSCookieExpiredError

            if isinstance(e, XHSCookieExpiredError):
                error_msg = f"【认证失败】{str(e)}"
            else:
                error_msg = str(e)
        except ImportError:
            error_msg = str(e)
```

替换为：

```python
        error_msg = str(e)
```

- [ ] **Step 4: 验证**

Run: `cd backend && python -m compileall app/services/map_dispatcher.py app/agents/trip_planner_agent.py app/api/routes/trip.py && python -c "from app.services.map_dispatcher import get_map_provider; assert get_map_provider() == 'amap'; print('ok')"`
Expected: 输出 `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/map_dispatcher.py backend/app/agents/trip_planner_agent.py backend/app/api/routes/trip.py
git commit -m "refactor: 地图引擎固定为高德，移除小红书异常分支（代码保留停用）"
```

---

### Task 6: 前端布局重构 — 固定侧边栏 App.vue + 路由

**Files:**
- Rewrite: `frontend/src/App.vue`（固定左侧栏：品牌「游伴」+ 新建计划 + 计划列表 + 底部设置/语言）
- Modify: `frontend/src/main.ts`（路由改为 `/` 与 `/plan/:id`）
- Create: `frontend/src/views/ChatHome.vue`（占位版，Task 7 补全）
- Create: `frontend/src/views/PlanView.vue`（包 Result.vue）
- Create: `frontend/src/stores/plans.ts`（计划列表共享状态）

**Interfaces:**
- Produces:
  - `stores/plans.ts`：`plans: Ref<TripHistoryItem[]>`、`plansLoading: Ref<boolean>`、`refreshPlans(): Promise<void>`
  - 路由：`/` → ChatHome；`/plan/:id` → PlanView（props.id）
  - 全局事件 `window.dispatchEvent(new CustomEvent('youban:plans-updated'))` 触发侧边栏刷新

- [ ] **Step 1: stores/plans.ts**

创建 `frontend/src/stores/plans.ts`：

```ts
import { ref } from 'vue'
import { getTripHistory } from '@/services/api'
import type { TripHistoryItem } from '@/types'

export const plans = ref<TripHistoryItem[]>([])
export const plansLoading = ref(false)

export const refreshPlans = async () => {
  plansLoading.value = true
  try {
    plans.value = await getTripHistory(50)
  } catch {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

export const PLANS_UPDATED_EVENT = 'youban:plans-updated'

export const notifyPlansUpdated = () => {
  window.dispatchEvent(new CustomEvent(PLANS_UPDATED_EVENT))
}
```

- [ ] **Step 2: main.ts 路由**

`frontend/src/main.ts` 全文替换为：

```ts
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles/global.css'
import App from './App.vue'
import ChatHome from './views/ChatHome.vue'
import PlanView from './views/PlanView.vue'
import { i18n } from './i18n'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'ChatHome', component: ChatHome },
    { path: '/plan/:id', name: 'PlanView', component: PlanView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

const app = createApp(App)

app.use(router)
app.use(Antd)
app.use(i18n)

app.mount('#app')
```

- [ ] **Step 3: App.vue 重写为固定侧边栏布局**

`frontend/src/App.vue` 全文替换为：

```vue
<template>
  <div id="app">
    <aside class="sidebar">
      <div class="sidebar-header">
        <router-link to="/" class="sidebar-brand">{{ t('app.brand') }}</router-link>
      </div>

      <div class="sidebar-new">
        <button type="button" class="new-plan-btn" @click="goNewPlan">
          <span class="new-plan-plus">+</span>
          <span>{{ t('sidebar.newPlan') }}</span>
        </button>
      </div>

      <div class="sidebar-section-title">{{ t('sidebar.plans') }}</div>
      <div class="sidebar-list">
        <div v-if="plansLoading" class="sidebar-hint">{{ t('common.loading') }}</div>
        <div v-else-if="plans.length === 0" class="sidebar-hint">{{ t('sidebar.empty') }}</div>
        <button
          v-for="item in plans"
          :key="item.plan_id"
          type="button"
          class="sidebar-item"
          :class="{ active: activePlanId === item.plan_id }"
          @click="openPlan(item.plan_id)"
        >
          <span class="sidebar-item-city">{{ item.city }}</span>
          <span class="sidebar-item-date">{{ item.start_date }} ~ {{ item.end_date }}</span>
        </button>
      </div>

      <div class="sidebar-footer">
        <a-select v-model:value="locale" size="small" class="sidebar-lang" :aria-label="t('app.language.label')">
          <a-select-option value="zh-CN">{{ t('app.language.zh') }}</a-select-option>
          <a-select-option value="ja-JP">{{ t('app.language.ja') }}</a-select-option>
          <a-select-option value="en-US">{{ t('app.language.en') }}</a-select-option>
        </a-select>
        <button type="button" class="sidebar-settings" :title="t('settings.open')" :aria-label="t('settings.open')" @click="openSettingsDialog">
          <svg width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M600.704 64a32 32 0 0 1 30.464 22.208l35.2 109.376c14.784 7.232 28.928 15.36 42.432 24.512l112.384-24.192a32 32 0 0 1 34.432 15.36L944.32 364.8a32 32 0 0 1-4.032 37.504l-77.12 85.12a357.12 357.12 0 0 1 0 49.024l77.12 85.248a32 32 0 0 1 4.032 37.504l-88.704 153.6a32 32 0 0 1-34.432 15.296L708.8 803.904c-13.44 9.088-27.648 17.28-42.368 24.512l-35.264 109.376A32 32 0 0 1 600.704 960H423.296a32 32 0 0 1-30.464-22.208L357.696 828.48a351.616 351.616 0 0 1-42.56-24.64l-112.32 24.256a32 32 0 0 1-34.432-15.36L79.68 659.2a32 32 0 0 1 4.032-37.504l77.12-85.248a357.12 357.12 0 0 1 0-48.896l-77.12-85.248A32 32 0 0 1 79.68 364.8l88.704-153.6a32 32 0 0 1 34.432-15.296l112.32 24.256c13.568-9.152 27.776-17.408 42.56-24.64l35.2-109.312A32 32 0 0 1 423.232 64H600.64zm-23.424 64H446.72l-36.352 113.088-24.512 11.968a294.113 294.113 0 0 0-34.816 20.096l-22.656 15.36-116.224-25.088-65.28 113.152 79.68 88.192-1.92 27.136a293.12 293.12 0 0 0 0 40.192l1.92 27.136-79.808 88.192 65.344 113.152 116.224-25.024 22.656 15.296a294.113 294.113 0 0 0 34.816 20.096l24.512 11.968L446.72 896h130.688l36.48-113.152 24.448-11.904a288.282 288.282 0 0 0 34.752-20.096l22.592-15.296 116.288 25.024 65.28-113.152-79.744-88.192 1.92-27.136a293.12 293.12 0 0 0 0-40.256l-1.92-27.136 79.808-88.128-65.344-113.152-116.288 24.96-22.592-15.232a287.616 287.616 0 0 0-34.752-20.096l-24.448-11.904L577.344 128zM512 320a192 192 0 1 1 0 384 192 192 0 0 1-384zm0 64a128 128 0 1 0 0 256 128 128 0 0 0 0-256z"/></svg>
        </button>
      </div>
    </aside>

    <main class="main-area">
      <router-view />
    </main>

    <a-modal
      v-model:open="settingsVisible"
      :title="t('settings.title')"
      :width="720"
      :confirm-loading="settingsSaving"
      :ok-text="t('settings.saveApply')"
      :cancel-text="t('settings.cancel')"
      @ok="saveSettingsNow"
    >
      <a-spin :spinning="settingsLoading">
        <a-form layout="vertical">
          <a-form-item :label="t('settings.labels.apiBaseUrl')">
            <a-input v-model:value="settingsForm.api_base_url" :placeholder="t('settings.placeholders.apiBaseUrl')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.amapJsKey')">
            <a-input-password v-model:value="settingsForm.vite_amap_web_js_key" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.amapWebKey')">
            <a-input-password v-model:value="settingsForm.vite_amap_web_key" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiBaseUrl')">
            <a-input v-model:value="settingsForm.openai_base_url" :placeholder="t('settings.placeholders.openaiBaseUrl')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiModel')">
            <a-input v-model:value="settingsForm.openai_model" :placeholder="t('settings.placeholders.openaiModel')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiApiKey')">
            <a-input-password v-model:value="settingsForm.openai_api_key" allow-clear />
          </a-form-item>
        </a-form>
      </a-spin>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { setAppLocale, type AppLocale } from '@/i18n'
import { getRuntimeSettings, saveRuntimeSettings } from '@/services/api'
import { plans, plansLoading, refreshPlans, PLANS_UPDATED_EVENT } from '@/stores/plans'
import type { RuntimeSettings } from '@/types'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()

const activePlanId = computed(() => (route.name === 'PlanView' ? String(route.params.id || '') : ''))

watch(
  locale,
  (nextLocale) => {
    setAppLocale(nextLocale as AppLocale)
    document.title = t('app.title')
  },
  { immediate: true }
)

const goNewPlan = () => {
  router.push('/')
}

const openPlan = (planId: string) => {
  if (!planId) return
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  router.push(`/plan/${planId}`)
}

// ===== 设置弹窗 =====
const settingsVisible = ref(false)
const settingsLoading = ref(false)
const settingsSaving = ref(false)
const settingsForm = reactive<RuntimeSettings>({
  api_base_url: '',
  vite_amap_web_key: '',
  vite_amap_web_js_key: '',
  google_maps_api_key: '',
  google_maps_proxy: '',
  xhs_cookie: '',
  openai_api_key: '',
  openai_base_url: '',
  openai_model: '',
})

const openSettingsDialog = async () => {
  settingsVisible.value = true
  settingsLoading.value = true
  try {
    const settings = await getRuntimeSettings()
    Object.assign(settingsForm, settings)
  } catch (error: any) {
    message.error(error?.message || t('settings.messages.loadFailed'))
  } finally {
    settingsLoading.value = false
  }
}

const saveSettingsNow = async () => {
  settingsSaving.value = true
  try {
    const saved = await saveRuntimeSettings({ ...settingsForm })
    Object.assign(settingsForm, saved)
    message.success(t('settings.messages.saved'))
    settingsVisible.value = false
  } catch (error: any) {
    message.error(error?.message || t('settings.messages.saveFailed'))
  } finally {
    settingsSaving.value = false
  }
}

const onPlansUpdated = () => {
  void refreshPlans()
}

onMounted(() => {
  void refreshPlans()
  window.addEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
})

onUnmounted(() => {
  window.removeEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

* {
  box-sizing: border-box;
}

#app {
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  min-height: 100vh;
}

/* ─── 固定左侧栏（Codex 式会话列表） ─── */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
  background: #F5F0E8;
  border-right: 1px solid rgba(61, 50, 41, 0.08);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 18px 16px 10px;
}

.sidebar-brand {
  color: #3D3229;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-decoration: none;
}

.sidebar-new {
  padding: 4px 12px 12px;
}

.new-plan-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 12px;
  background: rgba(217, 119, 87, 0.08);
  color: #C4603D;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-plan-btn:hover {
  background: rgba(217, 119, 87, 0.16);
}

.new-plan-plus {
  font-size: 18px;
  line-height: 1;
}

.sidebar-section-title {
  padding: 4px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.45);
  letter-spacing: 0.06em;
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-hint {
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  padding: 12px 8px;
}

.sidebar-item {
  width: 100%;
  border: none;
  border-radius: 10px;
  background: transparent;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item:hover {
  background: rgba(217, 119, 87, 0.08);
}

.sidebar-item.active {
  background: rgba(217, 119, 87, 0.14);
}

.sidebar-item-city {
  color: #3D3229;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-date {
  color: rgba(61, 50, 41, 0.5);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.08);
}

.sidebar-lang {
  flex: 1;
}

.sidebar-settings {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(61, 50, 41, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.sidebar-settings:hover {
  background: rgba(61, 50, 41, 0.06);
  color: #3D3229;
}

/* ─── 主内容区 ─── */
.main-area {
  flex: 1;
  min-width: 0;
  background: #FAF7F2;
}

@media (max-width: 768px) {
  #app {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid rgba(61, 50, 41, 0.08);
  }
  .sidebar-list {
    max-height: 200px;
  }
}
</style>
```

- [ ] **Step 4: PlanView.vue 与 ChatHome 占位**

创建 `frontend/src/views/PlanView.vue`：

```vue
<template>
  <Result :plan-id="id" :key="id" />
</template>

<script setup lang="ts">
import Result from './Result.vue'

defineProps<{ id: string }>()
</script>
```

创建 `frontend/src/views/ChatHome.vue`（占位，Task 7 替换）：

```vue
<template>
  <div class="chat-home">ChatHome</div>
</template>

<script setup lang="ts">
</script>
```

- [ ] **Step 5: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功（Result.vue 此时仍含 NavBar 引用不影响构建；Landing/Home/History 未被路由引用）

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.vue frontend/src/main.ts frontend/src/views/ChatHome.vue frontend/src/views/PlanView.vue frontend/src/stores/plans.ts
git commit -m "feat: 前端重构为 Codex 式固定侧边栏单页布局"
```

---

### Task 7: PlanComposer 聊天输入组件 + ChatHome 完整实现

**Files:**
- Create: `frontend/src/components/PlanComposer.vue`（聊天输入框 + 确认卡片 + 进度）
- Rewrite: `frontend/src/views/ChatHome.vue`（消息流 + 欢迎语 + 建议 chips）
- Modify: `frontend/src/services/api.ts`（新增 `parseTripText`）
- Modify: `frontend/src/types/index.ts`（新增解析类型、TripFormData 增加 `origin_text`）

**Interfaces:**
- Consumes: `POST /api/trip/parse`（Task 4）、`generateTripPlan`（现有）、`stores/plans.notifyPlansUpdated`（Task 6）
- Produces:
  - `parseTripText(text: string, language: string): Promise<TripParseApiResponse>`
  - `TripParseApiResponse = { success: boolean; need_clarify: boolean; clarify_question: string; summary: string; trip?: ParsedTripDraft | null }`
  - PlanComposer emit：`(e: 'created', planId: string)`

- [ ] **Step 1: types/index.ts 新增类型**

在文件末尾添加：

```ts
// ============ 自然语言解析类型 ============

export interface ParsedTripDraft {
  city: string
  cities: CityStay[]
  start_date: string
  end_date: string
  travel_days: number
  transportation: string
  accommodation: string
  preferences: string[]
  free_text_input: string
  origin_text: string
}

export interface TripParseApiResponse {
  success: boolean
  need_clarify: boolean
  clarify_question: string
  summary: string
  trip?: ParsedTripDraft | null
}
```

并把 `TripFormData` 中 `free_text_input: string` 后添加一行：

```ts
  origin_text?: string
```

- [ ] **Step 2: api.ts 新增 parseTripText**

在 `getTripHistory` 之后添加：

```ts
/**
 * 自然语言行程解析
 */
export async function parseTripText(text: string, language: string): Promise<TripParseApiResponse> {
  try {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const response = await apiClient.post<TripParseApiResponse>('/api/trip/parse', {
      text,
      language,
      today: todayStr,
    })
    return response.data
  } catch (error: any) {
    console.error('解析旅行描述失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.parseTripTextFailed'))
  }
}
```

并在文件顶部 import 的 `@/types` 列表中加入 `TripParseApiResponse`。

- [ ] **Step 3: PlanComposer.vue**

创建 `frontend/src/components/PlanComposer.vue`：

```vue
<template>
  <div class="composer">
    <!-- 解析中的提示 -->
    <div v-if="parsing" class="composer-status">
      <span class="dot-spinner"></span>
      <span>{{ t('composer.parsing') }}</span>
    </div>

    <!-- AI 追问 -->
    <div v-if="clarifyQuestion" class="clarify-card">
      <span>{{ clarifyQuestion }}</span>
    </div>

    <!-- 确认卡片 -->
    <div v-if="draft" class="confirm-card">
      <div class="confirm-title">{{ t('composer.confirmTitle') }}</div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.cities') }}</span>
        <div class="city-chips">
          <span v-for="c in draft.cities" :key="c.city" class="city-chip">{{ c.city }} · {{ c.days }}{{ t('composer.daysUnit') }}</span>
        </div>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.dates') }}</span>
        <a-range-picker
          v-model:value="dateRange"
          size="small"
          class="confirm-picker"
          :allow-clear="false"
        />
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.prefs') }}</span>
        <div class="pref-chips">
          <span
            v-for="opt in preferenceOptions"
            :key="opt"
            class="pref-chip"
            :class="{ active: draft.preferences.includes(opt) }"
            @click="togglePreference(opt)"
          >{{ preferenceLabel(opt) }}</span>
        </div>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.transport') }}</span>
        <a-select v-model:value="draft.transportation" size="small" class="confirm-select">
          <a-select-option value="公共交通">{{ t('home.transportation.public') }}</a-select-option>
          <a-select-option value="自驾">{{ t('home.transportation.drive') }}</a-select-option>
          <a-select-option value="步行">{{ t('home.transportation.walk') }}</a-select-option>
          <a-select-option value="混合">{{ t('home.transportation.mixed') }}</a-select-option>
        </a-select>
        <a-select v-model:value="draft.accommodation" size="small" class="confirm-select">
          <a-select-option value="经济型酒店">{{ t('home.accommodation.budget') }}</a-select-option>
          <a-select-option value="舒适型酒店">{{ t('home.accommodation.comfort') }}</a-select-option>
          <a-select-option value="豪华酒店">{{ t('home.accommodation.luxury') }}</a-select-option>
          <a-select-option value="民宿">{{ t('home.accommodation.homestay') }}</a-select-option>
        </a-select>
      </div>
      <div class="confirm-actions">
        <button type="button" class="confirm-cancel" @click="draft = null">{{ t('composer.cancel') }}</button>
        <button type="button" class="confirm-submit" :disabled="generating" @click="handleGenerate">
          {{ generating ? t('composer.generating') : t('composer.generate') }}
        </button>
      </div>
      <div v-if="generating" class="composer-progress">
        <div class="progress-track"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
        <p class="progress-text">{{ progressText }}</p>
      </div>
    </div>

    <!-- 输入框 -->
    <div class="input-box" :class="{ disabled: generating || parsing }">
      <textarea
        v-model="inputText"
        class="input-textarea"
        :placeholder="t('composer.placeholder')"
        :disabled="generating || parsing"
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
      ></textarea>
      <button
        type="button"
        class="send-btn"
        :disabled="!inputText.trim() || generating || parsing"
        :aria-label="t('composer.send')"
        @click="handleSend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import dayjs, { type Dayjs } from 'dayjs'
import { parseTripText, generateTripPlan } from '@/services/api'
import { getCurrentLocale } from '@/i18n'
import { notifyPlansUpdated } from '@/stores/plans'
import type { ParsedTripDraft, TripFormData, TripTaskEvent } from '@/types'

const emit = defineEmits<{
  (e: 'sent', text: string): void
  (e: 'created', planId: string): void
}>()

const { t } = useI18n()
const router = useRouter()

const inputText = ref('')
const parsing = ref(false)
const clarifyQuestion = ref('')
const draft = ref<ParsedTripDraft | null>(null)
const dateRange = ref<[Dayjs, Dayjs] | null>(null)
const generating = ref(false)
const progress = ref(0)
const progressText = ref('')

const preferenceOptions = ['历史文化', '自然风光', '美食', '购物', '艺术', '休闲']
const preferenceLabelKeys: Record<string, string> = {
  历史文化: 'home.interests.history',
  自然风光: 'home.interests.nature',
  美食: 'home.interests.food',
  购物: 'home.interests.shopping',
  艺术: 'home.interests.art',
  休闲: 'home.interests.leisure',
}
const preferenceLabel = (value: string) => t(preferenceLabelKeys[value] || value)

watch(draft, (val) => {
  if (val) {
    dateRange.value = [dayjs(val.start_date), dayjs(val.end_date)]
  } else {
    dateRange.value = null
  }
})

const togglePreference = (value: string) => {
  if (!draft.value) return
  const idx = draft.value.preferences.indexOf(value)
  if (idx === -1) draft.value.preferences.push(value)
  else draft.value.preferences.splice(idx, 1)
}

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || parsing.value || generating.value) return
  emit('sent', text)
  inputText.value = ''
  clarifyQuestion.value = ''
  draft.value = null
  parsing.value = true
  try {
    const res = await parseTripText(text, getCurrentLocale())
    if (res.need_clarify || !res.trip) {
      clarifyQuestion.value = res.clarify_question || t('composer.clarifyFallback')
      return
    }
    draft.value = res.trip
  } catch (error: any) {
    message.error(error?.message || t('composer.parseFailed'))
  } finally {
    parsing.value = false
  }
}

const stageText = (stage: TripTaskEvent['stage']) => {
  if (stage === 'attraction_search') return t('home.loading.searchingAttractions')
  if (stage === 'weather_search') return t('home.loading.queryingWeather')
  if (stage === 'hotel_search') return t('home.loading.recommendingHotels')
  if (stage === 'planning' || stage === 'graph_building') return t('home.loading.generatingPlan')
  if (stage === 'completed') return t('home.loading.done')
  return t('home.loading.initializing')
}

const handleGenerate = async () => {
  if (!draft.value || !dateRange.value || generating.value) return
  const d = draft.value
  const start = dateRange.value[0].format('YYYY-MM-DD')
  const end = dateRange.value[1].format('YYYY-MM-DD')
  const travelDays = dateRange.value[1].diff(dateRange.value[0], 'day') + 1
  if (travelDays < 1 || travelDays > 30) {
    message.warning(t('home.messages.travelDaysTooLong'))
    return
  }

  generating.value = true
  progress.value = 5
  progressText.value = t('home.loading.initializing')
  try {
    sessionStorage.removeItem('tripPlan')
    sessionStorage.removeItem('graphData')
    sessionStorage.removeItem('planId')

    const requestData: TripFormData = {
      city: d.city,
      cities: d.cities,
      start_date: start,
      end_date: end,
      travel_days: travelDays,
      transportation: d.transportation,
      accommodation: d.accommodation,
      preferences: d.preferences,
      free_text_input: d.free_text_input,
      origin_text: d.origin_text,
      language: getCurrentLocale(),
    }

    const response = await generateTripPlan(requestData, {
      onTaskEvent: (event) => {
        if (Number.isFinite(event.progress)) {
          progress.value = Math.max(0, Math.min(100, event.progress))
        }
        progressText.value = event.message || stageText(event.stage)
      }
    })

    if (response.success && response.data) {
      const planId = response.plan_id || ''
      sessionStorage.setItem('tripPlan', JSON.stringify(response.data))
      if (response.graph_data) {
        sessionStorage.setItem('graphData', JSON.stringify(response.graph_data))
      }
      if (planId) {
        sessionStorage.setItem('planId', planId)
      }
      message.success(t('home.messages.generateSuccess'))
      notifyPlansUpdated()
      emit('created', planId)
      draft.value = null
      router.push(`/plan/${planId}`)
    } else {
      message.error(response.message || t('home.messages.generateFailed'))
    }
  } catch (error: any) {
    message.error(error?.message || t('home.messages.generateRetry'))
  } finally {
    generating.value = false
    progress.value = 0
    progressText.value = ''
  }
}
</script>

<style scoped>
.composer {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}

.composer-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #C4603D;
  font-size: 14px;
  margin-bottom: 12px;
}

.dot-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(217, 119, 87, 0.25);
  border-top-color: #D97757;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.clarify-card {
  background: rgba(217, 119, 87, 0.08);
  border: 1px solid rgba(217, 119, 87, 0.2);
  border-radius: 14px;
  padding: 14px 18px;
  color: #3D3229;
  font-size: 14px;
  margin-bottom: 12px;
}

.confirm-card {
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.12);
  border-radius: 16px;
  padding: 20px 22px;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(100, 80, 60, 0.06);
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  margin-bottom: 14px;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.confirm-label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: #6B5D52;
}

.city-chips, .pref-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.city-chip {
  background: rgba(217, 119, 87, 0.1);
  border: 1px solid rgba(217, 119, 87, 0.3);
  color: #C4603D;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
}

.pref-chip {
  border: 1px solid rgba(100, 80, 60, 0.15);
  color: #6B5D52;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.pref-chip.active {
  border-color: #D97757;
  background: rgba(217, 119, 87, 0.1);
  color: #C4603D;
}

.confirm-picker {
  flex: 1;
  min-width: 240px;
}

.confirm-select {
  min-width: 140px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.confirm-cancel {
  border: 1px solid rgba(100, 80, 60, 0.15);
  background: #fff;
  color: #6B5D52;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
}

.confirm-submit {
  border: none;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  border-radius: 10px;
  padding: 8px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.confirm-submit:disabled {
  opacity: 0.6;
  cursor: wait;
}

.composer-progress {
  margin-top: 14px;
}

.progress-track {
  width: 100%;
  height: 6px;
  background: rgba(100, 80, 60, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #D97757, #C4603D);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-text {
  margin-top: 8px;
  text-align: center;
  color: #C4603D;
  font-size: 13px;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.18);
  border-radius: 20px;
  padding: 12px 14px;
  box-shadow: 0 4px 20px rgba(100, 80, 60, 0.08);
  transition: border-color 0.2s ease;
}

.input-box:focus-within {
  border-color: #D97757;
  box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.1);
}

.input-box.disabled {
  opacity: 0.7;
}

.input-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 15px;
  color: #3D3229;
  background: transparent;
  line-height: 1.5;
}

.input-textarea::placeholder {
  color: #A89888;
}

.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 4: ChatHome.vue 完整实现**

`frontend/src/views/ChatHome.vue` 全文替换为：

```vue
<template>
  <div class="chat-home">
    <div class="chat-scroll">
      <div class="welcome">
        <h1 class="welcome-title">{{ t('chatHome.title') }}</h1>
        <p class="welcome-desc">{{ t('chatHome.desc') }}</p>
        <div class="suggestions">
          <button
            v-for="s in suggestions"
            :key="s"
            type="button"
            class="suggestion-chip"
            @click="fillSuggestion(s)"
          >{{ s }}</button>
        </div>
      </div>
      <div v-if="sentMessages.length" class="sent-list">
        <div v-for="(m, i) in sentMessages" :key="i" class="sent-bubble">{{ m }}</div>
      </div>
    </div>
    <div class="chat-input-area">
      <PlanComposer ref="composerRef" @sent="onSent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PlanComposer from '@/components/PlanComposer.vue'

const { t, tm } = useI18n()
const composerRef = ref<InstanceType<typeof PlanComposer> | null>(null)
const sentMessages = ref<string[]>([])

const suggestions = computed(() => {
  const list = tm('chatHome.suggestions')
  return Array.isArray(list) ? (list as string[]) : []
})

const fillSuggestion = (text: string) => {
  const composer = composerRef.value as any
  if (composer) {
    composer.inputText = text
  }
}

const onSent = (text: string) => {
  sentMessages.value.push(text)
}
</script>

<style scoped>
.chat-home {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 48px 24px 24px;
  display: flex;
  flex-direction: column;
}

.welcome {
  margin: auto auto 32px;
  max-width: 760px;
  width: 100%;
  text-align: center;
}

.welcome-title {
  font-size: 40px;
  font-weight: 800;
  color: #3D3229;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.welcome-desc {
  font-size: 16px;
  color: #6B5D52;
  margin: 0 0 28px;
}

.suggestions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.suggestion-chip {
  border: 1px solid rgba(217, 119, 87, 0.3);
  background: rgba(217, 119, 87, 0.06);
  color: #C4603D;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.suggestion-chip:hover {
  background: rgba(217, 119, 87, 0.14);
}

.sent-list {
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
}

.sent-bubble {
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  padding: 10px 16px;
  font-size: 14px;
  max-width: 80%;
}

.chat-input-area {
  padding: 16px 24px 24px;
}
</style>
```

注意：`fillSuggestion` 通过 ref 直接改 `inputText`，需要在 PlanComposer 中用 `defineExpose({ inputText })` 暴露。在 PlanComposer `<script setup>` 末尾添加：

```ts
defineExpose({ inputText })
```

- [ ] **Step 5: i18n 新增文案**

在 `frontend/src/i18n/locales/zh.json` 顶层添加（与 `home` 同级）：

```json
  "sidebar": {
    "newPlan": "新建计划",
    "plans": "游玩计划",
    "empty": "还没有计划，说一句话开始吧"
  },
  "chatHome": {
    "title": "想去哪里玩？",
    "desc": "用一句话描述你的旅行，游伴帮你搞定行程、预算和地图",
    "suggestions": ["下周末去西安玩3天，喜欢美食", "五一去成都看大熊猫，4天", "国庆节从北京自驾去草原5天"]
  },
  "composer": {
    "placeholder": "例如：下周末去西安玩3天，喜欢美食和历史文化…",
    "send": "发送",
    "parsing": "游伴正在理解你的旅行想法…",
    "confirmTitle": "我理解的行程是这样的，确认一下？",
    "cities": "目的地",
    "daysUnit": "天",
    "dates": "日期",
    "prefs": "偏好",
    "transport": "出行",
    "cancel": "再想想",
    "generate": "生成计划",
    "generating": "生成中…",
    "clarifyFallback": "想去哪里玩呢？告诉我目的地和大概天数～",
    "parseFailed": "没听懂，换个说法试试？"
  }
```

并在 zh.json 的 `app` 对象中把品牌相关值改为「游伴」（`title` 改为 `游伴 · AI 旅行智能体`，新增 `"brand": "游伴"`）；`api` 对象中新增 `"parseTripTextFailed": "解析旅行描述失败"`。

在 `en.json`、`ja.json` 中添加对应翻译（sidebar/chatHome/composer 三个节点 + `app.brand` + `api.parseTripTextFailed`）。英文：`"brand": "YouBan"`、`"title": "YouBan · AI Travel Agent"`；日文：`"brand": "游伴（ユーバン）"`。

- [ ] **Step 6: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功无 TS 错误

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/PlanComposer.vue frontend/src/views/ChatHome.vue frontend/src/services/api.ts frontend/src/types/index.ts frontend/src/i18n/locales/
git commit -m "feat: 一句话自然语言输入 + 确认卡片式计划生成"
```

---

### Task 8: Result.vue 嵌入改造（去 NavBar / 去 GitHub / 固定高德）

**Files:**
- Modify: `frontend/src/views/Result.vue`（多处定点修改）

**Interfaces:**
- Consumes: PlanView 传入 `plan-id` prop（已有 `defineProps<{ planId?: string }>()`，兼容）

- [ ] **Step 1: 移除 NavBar**

删除第 5 行：`<NavBar @brand-click="goBack" @cta-click="goBack" />`
删除第 582 行：`import NavBar from '@/components/NavBar.vue'`
若 `goBack` 函数仅被 NavBar 使用则一并删除其定义（用 grep 确认无其他引用后删除）。

- [ ] **Step 2: 去掉分享海报中的 GitHub 二维码**

约第 2038-2043 行，把二维码 data 从 `https://github.com/1sdv/TripStar` 改为当前页面 URL：

```ts
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.href)}`
```

并把下方 `https://github.com/1sdv/TripStar` 文本行删除。

- [ ] **Step 3: 前端地图固定高德**

用 grep 找到所有 `mapProviderType.value = 'google'` 赋值点（以及判断 Google key 的分支），把赋值统一改为 `'amap'`；保留 google 相关变量与函数不动（死代码），确保 `mapProviderType` 永远不会变成 `'google'`。

- [ ] **Step 4: 适配无顶栏布局**

Result.vue 模板顶部原本为 NavBar 预留的 padding（若有 `padding-top: 70px` 之类样式）需要移除；检查根容器样式并调整。

- [ ] **Step 5: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Result.vue
git commit -m "refactor: Result 嵌入新布局，移除 NavBar/GitHub 链接，地图固定高德"
```

---

### Task 9: 清理遗留页面与设置项

**Files:**
- Delete: `frontend/src/views/Landing.vue`、`frontend/src/views/Home.vue`、`frontend/src/views/History.vue`、`frontend/src/components/NavBar.vue`
- Modify: `frontend/src/styles/global.css`（删除 `.btn-github-bg` 相关无用样式块，约 6665-6672 行）
- Modify: `frontend/src/services/api.ts`（settings 保存/读取保留 google/xhs 字段透传，不删，保持后端兼容）

**Interfaces:**
- Consumes: 无
- Produces: 无（纯清理）

- [ ] **Step 1: 删除遗留文件前先确认无引用**

Run: `/usr/bin/grep -rn "Landing\|views/Home\|views/History\|NavBar" frontend/src --include="*.vue" --include="*.ts" | /usr/bin/grep -v "^frontend/src/views/Landing\|^frontend/src/views/Home.vue\|^frontend/src/views/History.vue\|^frontend/src/components/NavBar.vue"`
Expected: 无输出（Task 6/8 已移除全部引用）

- [ ] **Step 2: 删除文件**

```bash
git rm frontend/src/views/Landing.vue frontend/src/views/Home.vue frontend/src/views/History.vue frontend/src/components/NavBar.vue
```

- [ ] **Step 3: global.css 删除 GitHub 按钮样式**

删除 `.btn-github-bg` 与 `.btn-github-bg:hover` 两个规则块（纯清理，不影响渲染）。

- [ ] **Step 4: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "chore: 删除 Landing/Home/History/NavBar 遗留页面与 GitHub 样式"
```

---

### Task 10: 改名「游伴」与 README

**Files:**
- Modify: `frontend/index.html`（`<title>游伴</title>`）
- Modify: `README.md`（主标题改为「游伴」，标注数据源为高德）
- Modify: `frontend/src/i18n/locales/zh.json` / `en.json` / `ja.json`（`app.title` 等已在 Task 7 改，此任务核对补漏）

- [ ] **Step 1: index.html**

第 12 行 `<title>TripStar</title>` 改为 `<title>游伴</title>`。

- [ ] **Step 2: README.md**

主标题 `# 旅途星辰 - AI 旅行智能体` 改为 `# 游伴 - AI 旅行智能体`；「核心亮点」中「小红书深度集成」一条替换为「**高德数据驱动**: 景点推荐与图片数据来源于高德地图真实 POI 数据，景点图片自动下载缓存到本地 data 目录。」；其余「小红书」提及（架构图、流程说明）批量替换为「高德」（保持语句通顺即可，不追求重写 README 全文）。

- [ ] **Step 3: 核对 i18n 品牌文案**

Run: `/usr/bin/grep -n "TripStar\|旅途星辰" frontend/src/i18n/locales/*.json frontend/index.html`
Expected: 无残留（除有意保留的日文注音外）

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html README.md frontend/src/i18n/locales/
git commit -m "docs: 项目显示名改为「游伴」"
```

---

### Task 11: 端到端验证

**Files:** 无（验证任务）

- [ ] **Step 1: 后端启动 + 接口冒烟**

Run: `cd backend && python run.py`（后台）
依次验证：
- `curl -s http://localhost:8000/health` → healthy
- `curl -s -X POST http://localhost:8000/api/trip/parse -H 'Content-Type: application/json' -d '{"text":"下周末去西安玩3天，喜欢美食","language":"zh"}'` → 返回西安行程
- `curl -s "http://localhost:8000/api/poi/photo?name=大雁塔&city=西安"` → photo_url 为 `/api/images/...` 或远程 URL
- `curl -s "http://localhost:8000/api/trip/history?limit=50"` → items 数组

- [ ] **Step 2: 前端构建 + dev 冒烟**

Run: `cd frontend && npm run build`
打开 dev server，浏览器验证：
1. 首页显示「想去哪里玩？」+ 输入框 + 左侧栏
2. 输入一句话 → 出现确认卡片 → 点「生成计划」→ 进度条推进 → 跳转 `/plan/:id` 显示完整详情（地图为高德）
3. 左侧栏出现新计划，点击可切换
4. 设置弹窗无小红书/Google 项，保存正常

- [ ] **Step 3: Docker 构建验证**

Run: `docker compose build && docker compose up -d && curl -s http://localhost:7860/health`
Expected: healthy；宿主机 `./data` 目录下出现 `trip_tasks/`、`images/`、`conversations/`

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "chore: 端到端验证收尾"
```

---

## Self-Review 记录

- Spec 覆盖：布局(任务6/7/8)、一句话输入(4/7)、高德数据源(2/3/5)、data 目录与 Docker(1/3/11)、改名(10)、去 GitHub(8/9)、设置页隐藏 XHS(6 的设置弹窗已不含 xhs 项)
- 已知取舍：Result.vue 的 google 地图死代码保留（强制 amap），避免 4700 行文件大改引入回归
- 类型一致性：`TripParseApiResponse`/`ParsedTripDraft`（前后端字段一致）、`get_cached_poi_photo` 返回字符串 URL、`notifyPlansUpdated` 事件名前后一致
