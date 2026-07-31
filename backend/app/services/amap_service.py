"""高德地图服务封装(REST API)"""

from typing import List, Dict, Any, Optional
from ..config import get_settings
from ..models.schemas import Location, POIInfo, WeatherInfo


class AmapService:
    """高德地图服务封装类"""
    
    def __init__(self):
        """初始化服务"""
        # 历史 MCP 工具已移除,仅保留占位;当前图片/搜索均走高德 REST API
        self.mcp_tool = None
    
    def search_poi(self, keywords: str, city: str, citylimit: bool = True) -> List[POIInfo]:
        """
        搜索POI
        
        Args:
            keywords: 搜索关键词
            city: 城市
            citylimit: 是否限制在城市范围内
            
        Returns:
            POI信息列表
        """
        try:
            # 调用MCP工具
            result = self.mcp_tool.run({
                "action": "call_tool",
                "tool_name": "maps_text_search",
                "arguments": {
                    "keywords": keywords,
                    "city": city,
                    "citylimit": str(citylimit).lower()
                }
            })
            
            # 解析结果
            # 注意: MCP工具返回的是字符串,需要解析
            # 这里简化处理,实际应该解析JSON
            print(f"POI搜索结果: {result[:200]}...")  # 打印前200字符
            
            # TODO: 解析实际的POI数据
            return []
            
        except Exception as e:
            print(f"❌ POI搜索失败: {str(e)}")
            return []
    
    def get_weather(self, city: str) -> List[WeatherInfo]:
        """
        查询天气
        
        Args:
            city: 城市名称
            
        Returns:
            天气信息列表
        """
        try:
            # 调用MCP工具
            result = self.mcp_tool.run({
                "action": "call_tool",
                "tool_name": "maps_weather",
                "arguments": {
                    "city": city
                }
            })
            
            print(f"天气查询结果: {result[:200]}...")
            
            # TODO: 解析实际的天气数据
            return []
            
        except Exception as e:
            print(f"❌ 天气查询失败: {str(e)}")
            return []
    
    def plan_route(
        self,
        origin_address: str,
        destination_address: str,
        origin_city: Optional[str] = None,
        destination_city: Optional[str] = None,
        route_type: str = "walking"
    ) -> Dict[str, Any]:
        """
        规划路线
        
        Args:
            origin_address: 起点地址
            destination_address: 终点地址
            origin_city: 起点城市
            destination_city: 终点城市
            route_type: 路线类型 (walking/driving/transit)
            
        Returns:
            路线信息
        """
        try:
            # 根据路线类型选择工具
            tool_map = {
                "walking": "maps_direction_walking_by_address",
                "driving": "maps_direction_driving_by_address",
                "transit": "maps_direction_transit_integrated_by_address"
            }
            
            tool_name = tool_map.get(route_type, "maps_direction_walking_by_address")
            
            # 构建参数
            arguments = {
                "origin_address": origin_address,
                "destination_address": destination_address
            }
            
            # 公共交通需要城市参数
            if route_type == "transit":
                if origin_city:
                    arguments["origin_city"] = origin_city
                if destination_city:
                    arguments["destination_city"] = destination_city
            else:
                # 其他路线类型也可以提供城市参数提高准确性
                if origin_city:
                    arguments["origin_city"] = origin_city
                if destination_city:
                    arguments["destination_city"] = destination_city
            
            # 调用MCP工具
            result = self.mcp_tool.run({
                "action": "call_tool",
                "tool_name": tool_name,
                "arguments": arguments
            })
            
            print(f"路线规划结果: {result[:200]}...")
            
            # TODO: 解析实际的路线数据
            return {}
            
        except Exception as e:
            print(f"❌ 路线规划失败: {str(e)}")
            return {}
    
    def geocode(self, address: str, city: Optional[str] = None) -> Optional[Location]:
        """
        地理编码(地址转坐标)

        Args:
            address: 地址
            city: 城市

        Returns:
            经纬度坐标
        """
        try:
            arguments = {"address": address}
            if city:
                arguments["city"] = city

            result = self.mcp_tool.run({
                "action": "call_tool",
                "tool_name": "maps_geo",
                "arguments": arguments
            })

            print(f"地理编码结果: {result[:200]}...")

            # TODO: 解析实际的坐标数据
            return None

        except Exception as e:
            print(f"❌ 地理编码失败: {str(e)}")
            return None

    def get_poi_photo(self, name: str, city: Optional[str] = None) -> Optional[str]:
        """
        从高德地图获取景点图片

        Args:
            name: 景点名称
            city: 所在城市

        Returns:
            图片URL，未找到则返回 None
        """
        try:
            import requests
            import time as _time
            settings = get_settings()
            api_key = settings.vite_amap_web_key
            if not api_key:
                return None

            params = {
                "key": api_key,
                "keywords": name,
                "show_fields": "photos",
            }
            if city:
                params["region"] = city

            # 高德 Web 服务有 QPS 限制,前端多景点并发取图容易触发限流,
            # 非成功状态时退避重试
            data: Dict[str, Any] = {}
            for attempt in range(3):
                resp = requests.get(
                    "https://restapi.amap.com/v5/place/text",
                    params=params,
                    timeout=8,
                )
                data = resp.json()
                if str(data.get("status")) == "1":
                    break
                print(f"⚠️ 高德POI图片查询失败 ({name}): {data.get('info')} {data.get('infocode')}")
                if attempt < 2:
                    _time.sleep(0.6 * (attempt + 1))
            pois = data.get("pois") or []
            for poi in pois:
                photos = poi.get("photos") or []
                for photo in photos:
                    url = (photo.get("url") or "").strip()
                    if url:
                        return url
            return None
        except Exception as e:
            print(f"⚠️ 高德图片获取异常 ({name}): {e}")
            return None

    def get_poi_detail(self, poi_id: str) -> Dict[str, Any]:
        """
        获取POI详情

        Args:
            poi_id: POI ID

        Returns:
            POI详情信息
        """
        try:
            result = self.mcp_tool.run({
                "action": "call_tool",
                "tool_name": "maps_search_detail",
                "arguments": {
                    "id": poi_id
                }
            })

            print(f"POI详情结果: {result[:200]}...")

            # 解析结果并提取图片
            import json
            import re

            # 尝试从结果中提取JSON
            json_match = re.search(r'\{.*\}', result, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                return data

            return {"raw": result}

        except Exception as e:
            print(f"❌ 获取POI详情失败: {str(e)}")
            return {}


# 创建全局服务实例
_amap_service = None


def get_amap_service() -> AmapService:
    """获取高德地图服务实例(单例模式)"""
    global _amap_service
    
    if _amap_service is None:
        _amap_service = AmapService()
    
    return _amap_service


def reset_amap_service() -> None:
    """重置高德地图服务与 MCP 工具实例（用于运行时配置更新后热生效）。"""
    global _amap_service, _amap_mcp_tool
    _amap_service = None
    _amap_mcp_tool = None


def search_amap_attractions(city: str, keywords: str, language: str = "zh") -> str:
    """基于高德 POI 搜索景点，并用 LLM 提纯为结构化景点数据（替代小红书搜索）。

    返回格式与旧 search_xhs_attractions 一致：说明行 + 每行一个景点 JSON。
    """
    import json as _json
    import re as _re
    import httpx as _httpx
    from .llm_service import llm_complete

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
        data = resp.json()
        if data.get("status") != "1" and not data.get("pois"):
            raise RuntimeError(f"高德 POI 搜索返回错误: {data.get('info', 'unknown')} (infocode={data.get('infocode', '')})")
        pois = data.get("pois") or []
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
    try:
        content = llm_complete(extract_prompt, temperature=0.1)
        json_match = _re.search(r'\[.*\]', content, _re.DOTALL)
        extracted = _json.loads(json_match.group() if json_match else content)
        if not isinstance(extracted, list):
            extracted = [extracted] if isinstance(extracted, dict) else []
        extracted = [item for item in extracted if isinstance(item, dict)]
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
    try:
        remote_url = get_amap_service().get_poi_photo(name, city)
    except Exception as e:
        print(f"⚠️ 高德服务调用失败 ({name}): {e}")
        return ""
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
