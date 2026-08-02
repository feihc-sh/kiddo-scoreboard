## Pull Request Checklist

> **硬门禁 (PRD §A.4 + §D.2)**: 所有项目必须 ✅ 才能 merge

### 本地验证

- [ ] 跑过 `./scripts/pre-pr-check.sh` 全 PASS
- [ ] 单端改动也跑过双端测试 (`test:unit` + `test:shared`)
- [ ] `test:unit` 无错（kiddo 现有 baseline 仍 PASS）
- [ ] `test:shared` 无错（mecha-challenge 新测试仍 PASS）
- [ ] `npm run typecheck` 无错
- [ ] commit message 含 `Co-Authored-By: Claude <noreply@anthropic.com>`

### 变更范围

- [ ] 只改 Phase 0 范围内文件（不污染 kiddo 现有代码）
- [ ] migrations 只新增（0016-0018），不改 0001-0015
- [ ] 不动 `.github/workflows/deploy.yml`（kiddo 现有 deploy）
- [ ] 不改 `src/db/types.ts` 现有内容
- [ ] 不动 `src/routes/*` 或 `public/app.html` / `public/admin/*`

### 文档

- [ ] README.md 已更新（如有变更）
- [ ] CHANGELOG.md 已追加新版本

### 双端覆盖（monorepo 要求）

| 端 | 测试命令 | 通过标准 |
|---|---|---|
| Web (kiddo) | `npm run test:unit` | 514+ tests PASS |
| Shared (types) | `npm run test:shared` | 22+ tests PASS |
| Miniprogram (stub) | `npm run test:miniprogram` | Phase 1 接入 |

---

**⚠️ FAIL 任一项目 → 禁止 merge**
