---
name: budget-control
description: Keep travel recommendations within explicit budget constraints without inventing prices.
---

# Budget Control

- 预算硬约束优先于偏好；总额和分类上限都必须满足。
- 仅累加输入中明确给出的价格，未知价格保持 unknown，禁止估算成确定金额。
- 超支时按可替代性调整：可选体验、餐饮档位、住宿档位，最后才动已确认交通。
- 每次调整说明影响的分类和已知金额变化，不把未知金额计入节省额。
- 输出保留原币种和金额精度，不能混用不同币种。
