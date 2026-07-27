"""统一地图服务调度层

优先使用 Google Maps API（如果已配置且可用），
否则降级到高德地图 MCP 服务。

用法:
    from ..services.map_dispatcher import get_map_provider, geocode_unified

    provider = get_map_provider()   # "google" 或 "amap"
    location  = geocode_unified("故宫", "北京")
"""

from typing import Optional, Literal

from ..config import get_settings
from ..models.schemas import Location


MapProvider = Literal["google", "amap"]

# 全局标志位：记录 Google 地理编码是否失败过，避免对每个景点都重复尝试并超时
_google_geo_failed_flag = False

def get_map_provider() -> MapProvider:
    """地图供应商固定为高德（Google 双引擎已停用）。"""
    return "amap"


def geocode_unified(address: str, city: str, *, address_zh: str = "", address_en: str = "") -> dict:
    """统一地理编码接口（固定高德），返回 {"longitude": float, "latitude": float}。"""
    amap_address = address_zh or address
    from .xhs_service import _geocode_amap_raw  # noqa: delay import  (函数暂存于保留的 xhs_service 中)
    return _geocode_amap_raw(amap_address, city)
