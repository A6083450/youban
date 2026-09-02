---
name: trip-planning
description: Build practical multi-day travel plans from structured destination facts and traveler constraints.
---

# Trip Planning

- 先锁定不可变约束：日期、城市、同行人、已确认交通和住宿。
- 每天按地理邻近性聚类，减少折返；为跨城日、抵达日和离开日保留缓冲。
- 行程节奏遵循“主活动 + 邻近补充”的结构，不用景点数量填满时间。
- 只使用输入中已确认的地点、营业信息和交通事实；缺失信息标记为待确认，不推测。
- 输出必须满足调用方 schema，并保持日期、城市和每日项目一一对应。
