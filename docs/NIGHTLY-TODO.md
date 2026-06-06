# 半夜自动化清单 (NIGHTLY-TODO)

> **流程**：用户 DM PM Agent → PM 整理 (澄清 + 拟定 action plan) → 写进这个文件 → 每天 0:00 cron 自动跑 pending items → 第二天 PM 汇报结果回 DM
>
> **作用域**：可自动化的开发任务 (git commit 级别, **不**包括 deploy / push / DELETE)
>
> **位置**：`docs/NIGHTLY-TODO.md` (跟项目, git 可见)
>
> **最后更新**：2026-06-06 创建

---

## 🚦 风险图例

| 图标 | 等级 | 含义 |
|------|------|------|
| 🟢 | 低 | 改 docs / 注释 / 格式化 / 加单测 |
| 🟡 | 中 | 改 src 代码 / 改 migration / 改依赖 |
| 🔴 | 高 | 改核心架构 / 改 schema / 改 token 配置 |

> **不跑的事** (cron 看到会自动 skip 并标 🚫 blocked):
> - `wrangler deploy` / `git push` / `wrangler d1 delete`
> - 需要用户决策的澄清
> - 实时 iPad 实测

---

## 📋 怎么用

**用户视角**（极简）：
1. 飞书 DM 跟我说："我想 X, 还要 Y"
2. 我整理 (clarify + plan) 后, 在这个文件加 ## Item
3. 半夜 0:00 自动跑
4. 早上/有空时我汇报结果

**用户不需要操作这个文件**, 全程 DM 完成。

---

## 📝 Item 模板 (PM Agent 复制后改 ID)

```markdown
## Item #XXX — <一句话标题>

**用户原话**:
> (引用用户原始 message, 越完整越好)

**Clarification** (PM 整理):
- 背景 / 上下文
- 用户没明说但实施需要的假设
- 如还有歧义 → 标 🚫 blocked, 等用户回

**Action Plan** (PM 拟定, 逐步可执行):
- [ ] 步骤 1
- [ ] 步骤 2
- [ ] 步骤 N
- [ ] `git commit -m "<conventional commit msg>"`

**Status**: ⏳ pending
**风险**: 🟢 / 🟡 / 🔴
**Started**: —
**Completed**: —
**Commit**: —

---
```

---

## 📋 清单 (空 → 慢慢加)

(暂无 pending items)

---

## 📦 归档 (已完成, 最近 30 天)

(完成时 PM Agent 移动到这里, 30 天后清掉, 完整历史在 git log)

