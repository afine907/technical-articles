---
sidebar_position: 1
slug: pipeline-design
---

# AI Native Pipeline：从需求到代码的全自动开发流水线

> 一个人，一个指令，完成从需求分析到代码验收的全流程。

## 起因

做 AI Agent 开发一年多，踩过不少坑。最痛的一个点是：**Agent 编排太复杂**。

买个 Agent 框架，配一堆工具，调各种 prompt，最后发现：
- Agent 之间信息传递不清晰
- 改了一个 Agent，不知道效果变好还是变坏
- 用户不知道 Agent 在干什么

于是我想：**能不能做一个简单的、可追溯的、可评估的开发流水线？**

## 核心设计

### 一个流程，五个节点

```
用户需求
    │
    ▼
┌─────────────────┐
│ impact-analyzer │ ← 代码影响分析
└────────┬────────┘
         │ Impact Map
         ▼
┌─────────────────┐
│   prd-agent     │ ← 需求分析
└────────┬────────┘
         │ Task Spec + PRD
         │ [PAUSE] Planning Gate
         ▼
┌─────────────────┐
│   spec-agent    │ ← 技术规格
└────────┬────────┘
         │ API + 数据模型
         ▼
┌─────────────────┐
│ coding-agent    │ ← 代码实现
└────────┬────────┘
         │ 代码 + 测试
         │ [PAUSE] Planning Gate
         ▼
┌─────────────────┐
│ verification    │ ← 自动验证
│   -agent        │
└────────┬────────┘
         │
         ▼
    完成 ✅
```

为什么是这 5 个节点？因为这是人类开发的自然流程：

1. **先看影响** - 改代码前，先知道会影响哪些文件
2. **再写需求** - 明确要做什么，验收标准是什么
3. **设计方案** - API 怎么设计，数据模型是什么
4. **写代码** - TDD 模式，先写测试再写实现
5. **验证验收** - 跑测试、Lint、类型检查

### Planning Gate：关键节点人工确认

AI 可以做很多事，但关键决策必须由人确认。

```
[Step 2/5] 分析需求...
  ✅ P0: JWT Token 生成/验证
  ✅ P1: Token 刷新
  
  [PAUSE] 确认需求? [y/n]
```

这个设计借鉴了 OpenAI 的 **Harness Engineering** 实践：
- Planning Gate 在关键节点暂停
- 用户确认后才继续
- 避免错误假设累积

### Task Spec：单一事实源

每个 Agent 都会往 Task Spec 里写内容：

```markdown
# Task Spec: 手机号登录

## 上下文（来自 impact-analyzer）
- Core Files: src/auth/session.py
- Risks: authenticate() 被 12 处调用

## 需求（来自 prd-agent）
- P0: 手机号 + 验证码登录
- 验收标准: 登录成功返回 JWT

## 技术决策（来自 spec-agent）
- API: POST /api/auth/login
- 为什么用 JWT: 项目已有 JWT 工具类

## 实现记录（来自 coding-agent）
- 新增: src/auth/phone_login.py
- 修改: src/auth/session.py
```

这样后续 Agent 就能看到完整上下文，而不是只看到上一个 Agent 的输出。

## 关键实现

### Impact Map：代码影响分析

增量开发最难的是：**不知道改了会破坏什么**。

Impact Map 解决这个问题：

```markdown
## Impact Map: 手机号登录

### Core Files (可修改)
- `src/auth/session.py` - SessionManager
- `src/auth/middleware.py` - authenticate()

### Dependent Files (不可破坏)  
- `src/api/routes/*.py` - 12 处调用 authenticate()
- `tests/auth/` - 23 个测试

### Boundary (不可触碰)
- `src/payments/` - 独立认证
- `src/admin/auth.py` - 管理员认证

### Risks
- 🔴 authenticate() 被 12 处调用，签名变更需全量修改
```

三类文件，清晰明确：
- **Core Files** - 本次改动的目标
- **Dependent Files** - 被影响，不能破坏
- **Boundary** - 绝对不能碰

### 自动验证：从 Spec 推断验收标准

传统做法：人工写验收标准

```yaml
verifications:
  - type: test
    command: pytest tests/auth/ -v
```

我们的做法：**从 Spec 自动推断**

```
spec 定义: POST /api/auth/login
→ 自动添加验证: curl 测试登录接口

spec 定义: 数据模型 User
→ 自动添加验证: 检查数据库 schema
```

这样用户不需要懂测试，Agent 自动生成验收标准。

## 实际效果

### 场景 1：增量开发

```bash
/pipeline 在现有登录模块基础上，增加 JWT 认证
```

执行过程：

```
[Step 1/5] 分析代码影响...
  ✅ Core Files: src/auth/session.py, src/auth/middleware.py
  ⚠️ Risks: authenticate() 被 12 处调用

[Step 2/5] 分析需求...
  ✅ P0: JWT Token 生成/验证
  ✅ P1: Token 刷新
  
  [PAUSE] 确认需求? y

[Step 3/5] 设计技术方案...
  ✅ POST /api/auth/login
  ✅ PyJWT + HS256

[Step 4/5] 编写代码...
  ✅ src/auth/jwt_manager.py
  ✅ tests/auth/test_jwt.py
  
  [PAUSE] 查看代码改动? y

[Step 5/5] 运行验证...
  ✅ 23 tests passed
  ✅ No lint errors

✅ 完成！
```

### 场景 2：全新项目

```bash
/pipeline 用户需要一个待办事项应用，包含增删改查功能
```

全新项目时，impact-analyzer 会跳过分析，建议参考现有项目结构。

## 技术栈

- **Claude Code Plugin** - 作为运行时
- **Markdown 文件** - Agent 之间传递信息
- **Bash + Grep** - 代码分析（无外部依赖）
- **GitHub Actions** - CI/CD + Agent 评估

## 下一步

- **更强的代码分析** - 更精准的影响范围
- **更好的上下文传递** - 让每个 Agent 看到完整决策链
- **更智能的验证** - 自动推断更多验收标准


**项目地址**: https://github.com/afine907/ai-native-pipeline

**下一篇**: [AI Native Pipeline 踩坑实录](#/articles/ai/AI-Native-Pipeline-踩坑实录)
