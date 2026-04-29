---
sidebar_position: 1
slug: /AI-Native-Pipeline-踩坑实录
---

# AI Native Pipeline 踩坑实录

> 做 Agent 开发，最怕的不是 Agent 不聪明，而是你不知道它什么时候变蠢了。

## 坑一：Agent 改了，不知道效果变好还是变坏

### 问题

最初，我改了一个 Agent 的 prompt，感觉效果更好了。但跑了几次发现：

> "等等，之前这个 case 能过的，怎么现在过不了了？"

没有对比，没有量化，全凭感觉。

### 解决：建立评估框架

我设计了一套评估流程：

```
1. 准备测试集（20-50 个典型任务）
2. 运行 Agent，记录输出
3. 对比金标准
4. 生成报告
```

核心指标：

| 指标 | 计算方式 | 目标 |
|------|----------|------|
| **准确率** | 正确输出 / 总输出 | > 80% |
| **完整率** | 覆盖要求 / 总要求 | > 90% |
| **平均耗时** | 总时间 / 任务数 | < 60s |
| **Token 消耗** | 总 Token / 任务数 | < 10K |

### 评估方法

**方法 1：金标准对比**

```python
test_cases = [
    {
        "input": "在用户模块增加手机号登录",
        "expected_output": {
            "core_files": ["src/auth/session.py"],
            "boundary": ["src/payments/"],
            "risks": ["authenticate() 被多处调用"]
        }
    },
    # ... 更多测试用例
]

def evaluate_agent(agent, test_cases):
    results = []
    for case in test_cases:
        output = agent.run(case["input"])
        score = compare_output(output, case["expected_output"])
        results.append(score)
    return sum(results) / len(results)
```

**方法 2：LLM-as-Judge**

用另一个 LLM 评估 Agent 输出：

```
你是一个评估专家。请评估以下 Agent 输出的质量。

任务：{input}
Agent 输出：{output}

请从以下维度打分（1-5分）：
1. 完整性：是否覆盖所有要求？
2. 准确性：信息是否正确？
3. 简洁性：是否冗余？
4. 可读性：是否易于理解？
```

### 对比评估流程

```
1. 保存修改前的评估结果
2. 修改 Agent
3. 运行相同的测试集
4. 对比结果

对比维度：
- 准确率是否提升？
- Token 消耗是否减少？
- 执行时间是否缩短？
```

---

## 坑二：代码分析依赖外部工具

### 问题

impact-analyzer 需要分析代码依赖关系。我一开始用的是 ctags：

```bash
ctags -R --fields=+n --languages=Python ./src/
```

结果：
- 某些机器没装 ctags
- 不同语言需要不同工具
- 调用关系分析不够智能

### 解决：无工具降级方案

我设计了两层分析：

**层 1：有工具时（精确模式）**

```bash
# 使用 ctags / tree-sitter
ctags -R --fields=+n ./src/
```

**层 2：无工具时（降级模式）**

```bash
# 使用 grep + LLM 理解
grep -rn "import\|require\|from" ./src --include="*.py"
grep -rn "关键词" ./src --include="*.py"
```

然后让 LLM 理解代码语义。

### Agent 实现

```markdown
## 工具检测

# 检测 ctags
command -v ctags && echo "ctags available" || echo "use grep"

# ctags 可用时（精确模式）
ctags -R --fields=+n --languages=Python ./src/

# ctags 不可用时（降级模式）
# 使用 Read + grep 组合
# 1. grep 快速扫描引用
# 2. Read 关键文件提取结构
# 3. 让 LLM 理解代码语义
```

---

## 坑三：Agent 之间信息传递不清晰

### 问题

coding-agent 收到 spec.md，但不知道：
- impact-analyzer 发现了哪些风险
- prd-agent 为什么这样划分优先级
- spec-agent 为什么选择这个 API 设计

**每个 Agent 都是"信息孤岛"**。

### 解决：Task Spec 作为单一事实源

```markdown
# Task Spec

## 上下文（来自 impact-analyzer）
- Core Files: src/auth/session.py
- Risks: authenticate() 被 12 处调用

## 需求（来自 prd-agent）
- 功能列表: ...
- 验收标准: ...

## 技术决策（来自 spec-agent）
- API 设计: POST /api/auth/login
- 为什么这样设计: 项目已有 JWT 工具类

## 实现记录（来自 coding-agent）
- 修改文件: ...
- 关键改动: ...
```

**每个 Agent 都往 Task Spec 里写内容**，后续 Agent 就能看到完整上下文。

---

## 坑四：验收标准需要人工预定义

### 问题

传统做法：用户写验收标准

```yaml
verifications:
  - type: test
    command: pytest tests/ -v
  - type: lint
    command: ruff check src/
```

问题：
- 用户可能不知道怎么写验收标准
- 验收标准可能不完整

### 解决：从 Spec 自动推断验收标准

verification-agent 会分析 spec.md，自动推断验证项：

```
spec 定义: POST /api/auth/login
→ 自动添加验证: curl 测试登录接口

spec 定义: 数据模型 User
→ 自动添加验证: 检查数据库 schema

spec 定义: 使用 pytest
→ 自动添加验证: pytest tests/ -v
```

这样用户不需要懂测试，Agent 自动生成验收标准。

---

## 坑五：复杂任务不知道怎么拆

### 问题

一个任务涉及 5 个 API、3 个模块，直接扔给 coding-agent 会：

- 输出太长，超出 token 限制
- 一个地方出错，整体失败
- 没法并行，效率低

### 解决：自动任务拆解

当 SPEC 复杂度高时（API > 3 或跨模块或前后端都有），自动触发 task-breakdown：

```
[Step 3.5] 任务拆解
  → 分析依赖关系
  → 生成执行计划

任务拆解:
| ID | 任务 | 依赖 | 执行 |
|----|------|------|------|
| T1 | 后端 - 登录 API | - | 并行 |
| T2 | 后端 - 验证码 API | - | 并行 |
| T3 | 前端 - 登录页 | - | 并行 |
| T4 | 前端 - 验证码页 | T3 | 串行 |
| T5 | 集成测试 | T1,T2,T3,T4 | 最后 |

执行计划:
- 阶段1（并行）: T1, T2, T3
- 阶段2（串行）: T4
- 阶段3（验收）: T5
```

---

## 坑六：没有 Planning Gate，错误累积

### 问题

早期版本没有 Planning Gate，Agent 一路跑到底。结果：

- 需求理解错了 → Spec 设计错了 → 代码写错了 → 全白干
- 错误在最后才发现，返工成本高

### 解决：关键节点人工确认

```
[Step 2/5] 分析需求...
  ✅ P0: JWT Token 生成/验证
  ✅ P1: Token 刷新
  
  [PAUSE] 确认需求? [y/n]
```

借鉴 OpenAI 的 **Harness Engineering** 实践：
- Planning Gate 在关键节点暂停
- 用户确认后才继续
- 避免错误假设累积

**两个 Planning Gate**：
- **Step 2 后**：确认需求范围
- **Step 4 后**：确认代码改动

---

## 总结

做 Agent 开发，核心不是让 Agent 更聪明，而是：

1. **可评估** - 改了 Agent，能知道效果变好还是变坏
2. **可追溯** - 每个 Agent 的决策都有记录
3. **可干预** - 关键节点能暂停，人工确认

**Less is More**：五个节点，每个打磨到极致，比十个节点各做一半要好。

---

**上一篇**: [AI Native Pipeline 设计实践](#/articles/ai/AI-Native-Pipeline-设计实践)

**下一篇**: [Agent 效果评估实战](#/articles/ai/Agent-效果评估实战)
