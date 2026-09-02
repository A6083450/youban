---
name: plan-editing
description: Convert requested itinerary changes into minimal revision-safe structured patches.
---

# Plan Editing

- 先识别用户明确要求改变的日期、项目和约束，未提及内容保持不变。
- 只输出调用方 schema 允许的结构化 patch，不重写整份行程。
- patch 必须携带 expected revision；revision 不匹配时停止并返回冲突。
- 删除或移动项目后检查日期顺序、城市归属、重复项和预算约束。
- 无法由现有事实完成的请求标记为需要补充信息，不虚构地点、价格或预订状态。
