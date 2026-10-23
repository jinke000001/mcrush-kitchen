# 挑战文件 v1

权威解析器：`src/challenges/index.ts`。文件上限 32 KiB，UTF-8 JSON；只允许以下字段，不能额外加入会员、优惠券、订阅、Token、活动原文或图片。

| 字段 | 约束 |
|---|---|
| `schemaVersion` | 固定 `mcrush-challenge-1` |
| `rulesVersion` | 固定 `mcd-three-shifts-2`，随项目规则版本更新 |
| `title` | 1–48 字符普通文本，不能包含 HTML、控制或文字方向字符 |
| `levelId` | `first-shift` / `lunch-line` / `night-relay` |
| `seed` | 1–4294967295 的整数 |
| `template` | `balanced` / `fryer-rush` / `drinks-rush` |
| `createdAt` | `YYYY-MM-DDTHH:mm:ss.sssZ` UTC，实际生成时间 |
| `expiresAt` | 同上，晚于生成时间且不超过查询后七天 |
| `source.provider` | 固定 `mcd-campaign-calendar` |
| `source.fetchedAt` | 同上，实际只读查询时间 |
| `source.articles` | 1–8 条 `{ "title": "公开文章标题", "url": null }`；标题最多 120 字符，URL 若确实返回则按主文规则填写 |

字段顺序不限。所有时间均含毫秒与末尾 `Z`；不要将北京时间直接加 `Z`，需要转换到 UTC。校验允许最多五分钟设备时钟误差。过期挑战需重新查询，不能只改日期。

三关始终使用它们自己的设备、菜单和关卡规则。第一关不生成芝士堡或鸡块。原味保持原生订单；炸物和饮品模板只替换部分内置餐品，维持每单餐品数量，不产生重复餐品，既有波次与堂食/外带窗口保留。

仓库的 `public/challenges/fryer-rush-2026-10-23.json` 是一次真实查询后的历史实例。它会过期，不能在未来调用时原样冒充最新活动。`docs/mcp-evidence.json` 记录该次脱敏查询观察，不包含原始响应，也不证明其他导入文件的真伪。
