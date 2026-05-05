---
sidebar_position: 1
slug: evaluation
---

# Agent 效果评估实战

> 改了一个 prompt，你怎么知道效果变好了？靠感觉？还是靠数据？

## 核心问题

做 Agent 开发，最关键的问题是：

**你改了 Agent 之后，怎么验证效果真的变好了？**

靠"感觉更好了"是不行的。你需要：
- 量化指标
- 对比基准
- 持续监控

## 评估框架设计

### 四个维度

| 维度 | 说明 | 评估方法 |
|------|------|----------|
| **准确性** | 输出是否正确？ | 金标准对比 |
| **完整性** | 是否覆盖所有要求？ | 检查清单 |
| **简洁性** | 是否冗余？ | Token 统计 |
| **效率** | 执行时间、成本？ | 时间 + Token |

### 核心指标

```
质量分 = (准确性 × 0.4) + (完整性 × 0.3) + (简洁性 × 0.15) + (可读性 × 0.15)

目标：质量分 > 3.5/5
```

## 评估方法

### 方法一：金标准对比（Gold Standard）

准备测试集 + 人工标注正确答案：

```json
[
  {
    "id": 1,
    "input": "在用户模块增加手机号登录",
    "expected": {
      "core_files": ["src/auth/session.py", "src/auth/middleware.py"],
      "boundary": ["src/payments/"],
      "risks": ["authenticate() 被多处调用"]
    }
  },
  {
    "id": 2,
    "input": "将登录模块从 session 改为 JWT",
    "expected": {
      "core_files": ["src/auth/"],
      "patterns": ["src/api_keys/jwt_util.py"]
    }
  }
]
```

然后对比 Agent 输出与金标准：

```python
def evaluate_agent(agent, test_cases):
    results = []
    for case in test_cases:
        output = agent.run(case["input"])
        score = compare_output(output, case["expected"])
        results.append({
            "id": case["id"],
            "score": score,
            "output": output
        })
    return results
```

### 方法二：LLM-as-Judge

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

输出格式：
{
  "completeness": 4,
  "accuracy": 5,
  "conciseness": 3,
  "readability": 4,
  "total": 16,
  "comment": "..."
}
```

### 方法三：人工评估

最可靠，但成本最高：

```
流程：
1. 准备评估界面
2. 展示 Agent 输出
3. 评估员打分
4. 统计结果
```

**建议**：先用 LLM-as-Judge 初筛，再用人工抽查 20%。

## 评估流程

```
┌─────────────────────────────────────────────────────────┐
│                    Agent 评估流程                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. 准备测试集                                           │
│     - 收集 20-50 个典型任务                              │
│     - 人工标注正确输出（金标准）                          │
│                                                          │
│  2. 运行 Agent                                          │
│     - 对每个任务运行 Agent                               │
│     - 记录输出、时间、Token                              │
│                                                          │
│  3. 自动评估                                            │
│     - 对比金标准                                         │
│     - LLM-as-Judge 评分                                  │
│                                                          │
│  4. 人工抽查                                            │
│     - 随机抽取 20% 输出                                  │
│     - 人工打分                                           │
│                                                          │
│  5. 生成报告                                            │
│     - 准确率、质量分、效率指标                           │
│     - 与之前版本对比                                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## 实战案例：评估 impact-analyzer

### 测试集

```json
[
  {"id": 1, "input": "在用户模块增加手机号登录", "type": "incremental"},
  {"id": 2, "input": "全新商品管理模块", "type": "new"},
  {"id": 3, "input": "重构认证系统", "type": "refactor"},
  {"id": 4, "input": "优化数据库查询性能", "type": "optimize"},
  {"id": 5, "input": "添加日志功能", "type": "incremental"}
]
```

### 评估脚本

```bash
# 创建评估目录
mkdir -p .harness/eval

# 运行评估
python scripts/evaluate_agent.py \
  --agent impact-analyzer \
  --test-cases .harness/eval/test_cases.json

# 查看报告
cat .harness/eval/report.md
```

### 评估报告

```markdown
# Agent 评估报告

**Agent**: impact-analyzer
**版本**: v2.0
**日期**: 2026-04-28

## 测试集

- 任务数：20
- 来源：真实需求 + 边界用例

## 结果

| 指标 | v1.0 | v2.0 | 变化 |
|------|------|------|------|
| 准确率 | 75% | 85% | +10% |
| 质量分 | 3.2/5 | 3.8/5 | +0.6 |
| 平均耗时 | 45s | 38s | -7s |
| Token 消耗 | 8.5K | 6.2K | -2.3K |

## 典型案例

### 改进案例 1
- 输入：在用户模块增加手机号登录
- v1.0 输出：遗漏了 boundary 文件
- v2.0 输出：正确识别了所有 boundary

### 改进案例 2
- 输入：全新模块
- v1.0 输出：仍然尝试分析代码（浪费时间）
- v2.0 输出：直接跳过分析（更高效）

## 结论

v2.0 版本在准确率、质量分、效率上都有提升，建议合并。
```

## CI/CD 集成

### GitHub Actions 自动评估

```yaml
# .github/workflows/evaluate.yml
name: Agent Evaluation

on:
  pull_request:
    branches: [master]
  workflow_dispatch:

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: pip install -r requirements.txt
      
      - name: Run evaluation
        env:
          LONGCAT_API_KEY: ${{ secrets.LONGCAT_API_KEY }}
        run: |
          python scripts/evaluate_agent.py \
            --agent impact-analyzer \
            --test-cases tests/eval/test_cases.json \
            --output .harness/eval/report.json
      
      - name: Comment PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('.harness/eval/report.json'));
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Agent Evaluation Results\n\n| Metric | Score |\n|--------|-------|\n| Accuracy | ${report.accuracy}% |\n| Quality | ${report.quality}/5 |\n| Time | ${report.time}s |`
            });
```

### 质量门禁

```yaml
# 检查评估结果
- name: Check quality gate
  run: |
    python scripts/check_quality_gate.py \
      --report .harness/eval/report.json \
      --min-accuracy 80 \
      --min-quality 3.5
```

## 持续监控

### AgentOps 面板

```
┌─────────────────────────────────────────┐
│          Agent 监控面板                  │
├─────────────────────────────────────────┤
│  今日执行: 42 次                         │
│  成功率: 90%                            │
│  平均耗时: 45s                          │
│  Token 消耗: 12K/任务                   │
│                                          │
│  错误 Top 3:                            │
│  1. timeout (3 次)                      │
│  2. api_error (2 次)                    │
│  3. invalid_output (1 次)               │
└─────────────────────────────────────────┘
```

### 告警规则

- 准确率 < 70% → 发送告警
- 错误率 > 10% → 发送告警
- 平均耗时 > 60s → 发送告警

## 快速开始

### 最小评估集

时间有限？至少做这些：

1. **准备 5 个典型任务**
2. **运行 Agent，检查输出是否正确**
3. **记录执行时间**
4. **与之前的输出对比**

### 评估模板

```bash
# 创建测试集
cat > test_cases.json << 'EOF'
[
  {"id": 1, "input": "任务描述 1"},
  {"id": 2, "input": "任务描述 2"},
  {"id": 3, "input": "任务描述 3"}
]
EOF

# 运行评估
python evaluate.py --test-cases test_cases.json

# 查看报告
cat report.md
```

## 总结

Agent 评估的核心是：

1. **量化指标** - 不靠感觉，靠数据
2. **对比基准** - 改了要能对比
3. **持续监控** - 不是一次性工作

**没有评估，就没有改进**。


**上一篇**: [AI Native Pipeline 踩坑实录](pipeline-lessons)

**项目地址**: https://github.com/afine907/ai-native-pipeline
