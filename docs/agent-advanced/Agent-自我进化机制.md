---
sidebar_position: 10
title: Agent 自我进化：让 Agent 从错误中学习
slug: self-evolution
---


你做了一个 Agent，让它写代码。

第一次，它忘了加异常处理，程序崩了。你修复了。

第二次，它又忘了加异常处理，程序又崩了。你又修复了。

第三次、第四次...它还是在犯同样的错误。

你开始怀疑：**这玩意儿怎么永远学不会？**

我之前也遇到过这个问题。我做过一个数据处理 Agent，犯了无数次同样的错误：文件路径写死、忘了关连接、异常没处理...

每次都是我手动修复。

后来我加了一个"自我进化机制"：让 Agent 分析自己的错误，生成改进建议，下次避免同样的问题。

效果立竿见影。同一类错误，第一次犯错后，后续基本不再犯。

这篇文章，我来分享怎么让 Agent 具备自我进化能力。


## 一、为什么 Agent 不会从错误中学习？

先搞清楚问题根源：**为什么 Agent 总是犯同样的错误？**

### 1.1 LLM 的"无状态"本质

LLM 是无状态的。每次调用，它都不记得上一次发生了什么。

```
第1次调用：读取文件 → 报错（文件不存在）
第2次调用：读取文件 → 报错（文件不存在）
第3次调用：读取文件 → 报错（文件不存在）
```

每一次都是全新的开始，它不知道"上次这里出错了"。

你可能会说：不是有对话历史吗？

对话历史存的是**用户的输入和 Agent 的输出**，不是**错误和教训**。

而且，对话历史越长，Token 越贵，最终会被截断。

### 1.2 传统 Agent 的局限

传统 Agent 的架构是这样的：

```
┌──────────────────────────────────────────┐
│            传统 Agent 架构                │
├──────────────────────────────────────────┤
│                                          │
│   用户输入 → LLM → 工具调用 → 输出        │
│                                          │
│   记忆：对话历史（有限长度）              │
│                                          │
│   ❌ 没有错误记忆                        │
│   ❌ 没有经验积累                        │
│   ❌ 没有自我反思                        │
└──────────────────────────────────────────┘
```

用户的反馈、错误信息、修复方案...这些宝贵的信息，传统 Agent 都留不住。

### 1.3 类比：新员工 vs 老员工

你可以把传统 Agent 理解为一个"永远的新员工"：

- 每次任务都是第一次做
- 犯过的错误记不住
- 没有经验积累

而我们要做的，是让 Agent 变成"老员工"：

- 记住犯过的错误
- 积累经验教训
- 越做越好


## 二、自我进化的三种机制

自我进化不是单一技术，是三种机制的组合：

| 机制 | 核心思路 | 类比 |
|------|---------|------|
| 反思 Reflection | 执行后分析，发现问题 | 复盘会 |
| 学习 Learning | 存储经验，下次复用 | 知识库 |
| 适应 Adaptation | 根据反馈调整行为 | 能力提升 |

### 2.1 反思机制

执行完任务后，让 Agent 自己分析：

- 做对了什么？
- 做错了什么？
- 下次怎么改进？

```python
def reflect(task: str, result: str, error: str = None):
    """反思执行结果"""
    prompt = f"""
任务：{task}

执行结果：{result}

{'错误信息：' + error if error else ''}

请分析：
1. 哪里做得好？
2. 哪里有问题？
3. 下次如何改进？

以 JSON 格式输出：
{{
  "successes": ["做得好的地方"],
  "problems": ["问题所在"],
  "improvements": ["改进建议"]
}}
"""
    return llm.invoke(prompt)
```

### 2.2 学习机制

把反思结果存起来，下次执行时参考：

```python
class ExperienceStore:
    def __init__(self):
        self.experiences = []
    
    def save(self, context: str, problem: str, solution: str):
        """保存经验"""
        self.experiences.append({
            "context": context,
            "problem": problem,
            "solution": solution
        })
    
    def get_relevant(self, task: str) -> list:
        """获取相关经验"""
        # 简单关键词匹配，生产环境可以用向量检索
        return [e for e in self.experiences if e["context"] in task]
```

### 2.3 适应机制

根据经验调整执行策略：

```python
def execute_with_adaptation(task: str, store: ExperienceStore):
    """带适应能力的执行"""
    # 1. 查询相关经验
    experiences = store.get_relevant(task)
    
    # 2. 把经验注入到 Prompt
    tips = "\n".join([f"- {e['solution']}" for e in experiences])
    
    enhanced_prompt = f"""
任务：{task}

根据之前经验，请注意：
{tips}
"""
    
    # 3. 执行
    return llm.invoke(enhanced_prompt)
```


## 三、实现：最简单的自我进化 Agent

先实现一个最简单的版本：执行 → 反思 → 学习。

### 3.1 完整代码

```python
import json
from typing import TypedDict
from pathlib import Path

class Experience(TypedDict):
    context: str      # 任务上下文
    problem: str      # 问题描述
    solution: str     # 解决方案
    timestamp: str    # 时间戳

class SimpleSelfImprovingAgent:
    """最简单的自我进化 Agent"""
    
    def __init__(self, experience_file: str = "experiences.json"):
        self.experience_file = Path(experience_file)
        self.experiences = self._load_experiences()
    
    def _load_experiences(self) -> list[Experience]:
        if self.experience_file.exists():
            return json.loads(self.experience_file.read_text())
        return []
    
    def _save_experiences(self):
        self.experience_file.write_text(
            json.dumps(self.experiences, indent=2, ensure_ascii=False)
        )
    
    def execute(self, task: str) -> str:
        """执行任务"""
        # 查询相关经验
        tips = self._get_tips(task)
        
        # 构建 Prompt
        prompt = self._build_prompt(task, tips)
        
        # 调用 LLM
        return llm.invoke(prompt)
    
    def learn(self, task: str, result: str, feedback: str):
        """从反馈中学习"""
        # 反思
        reflection = self._reflect(task, result, feedback)
        
        # 保存经验
        for problem, solution in zip(
            reflection["problems"], 
            reflection["solutions"]
        ):
            self.experiences.append({
                "context": task[:50],  # 简化上下文
                "problem": problem,
                "solution": solution,
                "timestamp": datetime.now().isoformat()
            })
        
        self._save_experiences()
    
    def _get_tips(self, task: str) -> list[str]:
        """获取相关经验"""
        return [
            e["solution"] 
            for e in self.experiences 
            if e["context"] in task
        ]
    
    def _build_prompt(self, task: str, tips: list[str]) -> str:
        prompt = f"任务：{task}\n\n"
        
        if tips:
            prompt += "根据之前经验，请注意：\n"
            for tip in tips:
                prompt += f"- {tip}\n"
        
        return prompt
    
    def _reflect(self, task: str, result: str, feedback: str) -> dict:
        prompt = f"""
任务：{task}
执行结果：{result}
用户反馈：{feedback}

请分析问题并给出改进建议：
{{
  "problems": ["问题1", "问题2"],
  "solutions": ["解决方案1", "解决方案2"]
}}
"""
        response = llm.invoke(prompt)
        return json.loads(response)
```

### 3.2 使用示例

```python
agent = SimpleSelfImprovingAgent()

# 第一次执行
result = agent.execute("读取 config.yaml 文件")

# 假设失败了，用户反馈
agent.learn(
    task="读取 config.yaml 文件",
    result=result,
    feedback="文件路径错误，应该先检查文件是否存在"
)

# 第二次执行类似任务
result = agent.execute("读取 users.yaml 文件")
# 这次 Agent 会自动检查文件是否存在
```

### 3.3 架构图

```
┌─────────────────────────────────────────────┐
│        简单自我进化 Agent 架构               │
├─────────────────────────────────────────────┤
│                                             │
│   ┌──────────┐                              │
│   │ 用户输入  │                              │
│   └────┬─────┘                              │
│        ↓                                    │
│   ┌──────────┐     ┌──────────────┐        │
│   │ 查询经验  │ ←──│ 经验存储      │        │
│   └────┬─────┘     └──────────────┘        │
│        ↓                                    │
│   ┌──────────┐                              │
│   │ 注入 Prompt │                            │
│   └────┬─────┘                              │
│        ↓                                    │
│   ┌──────────┐                              │
│   │ 执行任务  │                              │
│   └────┬─────┘                              │
│        ↓                                    │
│   ┌──────────┐                              │
│   │ 用户反馈  │                              │
│   └────┬─────┘                              │
│        ↓                                    │
│   ┌──────────┐     ┌──────────────┐        │
│   │ 反思学习  │ ──→│ 保存经验      │        │
│   └──────────┘     └──────────────┘        │
│                                             │
└─────────────────────────────────────────────┘
```


## 四、进阶：多维度经验库

简单版本的问题是：经验检索太粗糙。用关键词匹配，经常找不准。

### 4.1 向量检索经验

用语义相似度检索，而不是关键词匹配：

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class VectorExperienceStore:
    """向量经验库"""
    
    def __init__(self):
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.experiences = []
        self.embeddings = []
    
    def save(self, context: str, problem: str, solution: str):
        """保存经验并生成向量"""
        text = f"{context} {problem}"
        embedding = self.model.encode(text)
        
        self.experiences.append({
            "context": context,
            "problem": problem,
            "solution": solution
        })
        self.embeddings.append(embedding)
    
    def get_relevant(self, query: str, top_k: int = 3) -> list:
        """检索最相关的经验"""
        if not self.experiences:
            return []
        
        query_embedding = self.model.encode(query)
        
        # 计算余弦相似度
        similarities = [
            np.dot(query_embedding, e) / 
            (np.linalg.norm(query_embedding) * np.linalg.norm(e))
            for e in self.embeddings
        ]
        
        # 返回 top_k
        top_indices = np.argsort(similarities)[-top_k:][::-1]
        return [self.experiences[i] for i in top_indices]
```

### 4.2 分层经验库

不同类型的经验，存储和检索方式不同：

| 经验类型 | 示例 | 存储方式 | 检索方式 |
|---------|------|---------|---------|
| 代码模板 | 读取文件的代码 | 代码库 | 任务描述 |
| 错误处理 | 文件不存在的处理 | 错误类型 | 错误信息 |
| 最佳实践 | 永远检查文件路径 | 规则表 | 任务类型 |

```python
class LayeredExperienceStore:
    """分层经验库"""
    
    def __init__(self):
        self.code_templates = {}    # 代码模板
        self.error_handlers = {}    # 错误处理
        self.best_practices = []    # 最佳实践
    
    def save_code_template(self, task_type: str, code: str):
        """保存代码模板"""
        self.code_templates[task_type] = code
    
    def save_error_handler(self, error_type: str, handler: str):
        """保存错误处理方案"""
        self.error_handlers[error_type] = handler
    
    def save_best_practice(self, practice: str):
        """保存最佳实践"""
        self.best_practices.append(practice)
    
    def get_code_template(self, task_type: str) -> str:
        return self.code_templates.get(task_type, "")
    
    def get_error_handler(self, error_type: str) -> str:
        return self.error_handlers.get(error_type, "")
```


## 五、进阶：反思触发策略

不是每次执行都需要反思。反思太频繁：

- LLM 调用费用爆炸
- 产生大量无用经验
- 存储和检索变慢

### 5.1 何时反思？

| 场景 | 是否反思 | 原因 |
|------|---------|------|
| 执行成功，无反馈 | ❌ 否 | 没必要 |
| 执行失败 | ✅ 是 | 需要分析原因 |
| 用户给负反馈 | ✅ 是 | 需要改进 |
| 用户给正反馈 | ⚠️ 可选 | 可以强化正确做法 |

### 5.2 反思触发器

```python
class ReflectionTrigger:
    """反思触发器"""
    
    def should_reflect(
        self, 
        success: bool, 
        feedback: str = None
    ) -> bool:
        """判断是否需要反思"""
        
        # 执行失败，必须反思
        if not success:
            return True
        
        # 用户给了负面反馈
        if feedback and self._is_negative(feedback):
            return True
        
        # 其他情况不反思
        return False
    
    def _is_negative(self, feedback: str) -> bool:
        """判断反馈是否负面"""
        negative_keywords = [
            "错误", "不对", "不行", "失败", 
            "问题", "bug", "报错"
        ]
        return any(kw in feedback.lower() for kw in negative_keywords)
```

### 5.3 批量反思

积累一批错误后，统一反思：

```python
class BatchReflector:
    """批量反思器"""
    
    def __init__(self, batch_size: int = 5):
        self.batch_size = batch_size
        self.errors = []
    
    def add_error(self, task: str, result: str, error: str):
        """积累错误"""
        self.errors.append({
            "task": task,
            "result": result,
            "error": error
        })
        
        if len(self.errors) >= self.batch_size:
            return self._batch_reflect()
        return None
    
    def _batch_reflect(self) -> list:
        """批量反思"""
        prompt = "以下是最近几次执行的错误：\n\n"
        
        for i, e in enumerate(self.errors):
            prompt += f"错误 {i+1}:\n"
            prompt += f"任务: {e['task']}\n"
            prompt += f"错误: {e['error']}\n\n"
        
        prompt += "请分析这些错误的共同模式，给出改进建议。"
        
        reflection = llm.invoke(prompt)
        self.errors = []  # 清空
        
        return reflection
```


## 六、进阶：主动学习 vs 被动学习

### 6.1 被动学习

传统方式：等用户给反馈，再学习。

```
执行 → 等反馈 → 反思 → 学习
```

问题：用户不会每次都给反馈。

### 6.2 主动学习

让 Agent 主动发现问题和改进机会：

```python
def proactive_reflection(task: str, result: str):
    """主动反思：没有反馈也能发现问题"""
    
    prompt = f"""
任务：{task}

执行结果：
{result}

请主动检查：
1. 结果是否符合预期？
2. 有没有潜在问题？
3. 可以优化什么？

如果一切正常，输出 {{"status": "ok"}}
如果有问题，输出 {{"status": "improvement", "suggestions": ["建议1", "建议2"]}}
"""
    
    return llm.invoke(prompt)
```

### 6.3 对比

| 方式 | 触发条件 | 优点 | 缺点 |
|------|---------|------|------|
| 被动学习 | 用户反馈 | 准确，学习有价值内容 | 依赖用户，覆盖不全 |
| 主动学习 | 每次执行 | 覆盖全面，不依赖用户 | 可能产生噪音 |

建议：**被动学习为主，主动学习为辅**。


## 七、完整架构设计

把前面的内容整合起来，得到一个完整的自我进化架构：

```
┌─────────────────────────────────────────────────────────┐
│                  自我进化 Agent 完整架构                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  执行层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │ 任务解析  │→│ 经验注入  │→│ 工具执行  │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘      │   │
│  └─────────────────────────────────────────────────┘   │
│                          ↓                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  反思层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │ 触发判断  │→│ 问题分析  │→│ 改进生成  │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘      │   │
│  └─────────────────────────────────────────────────┘   │
│                          ↓                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  学习层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │ 经验提取  │→│ 向量化    │→│ 持久化    │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘      │   │
│  └─────────────────────────────────────────────────┘   │
│                          ↓                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  存储层                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │ 向量库    │  │ 关系库    │  │ 文件库    │      │   │
│  │  │ (经验)    │  │ (规则)    │  │ (模板)    │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.1 生产级代码骨架

```python
class ProductionSelfImprovingAgent:
    """生产级自我进化 Agent"""
    
    def __init__(self):
        # 经验存储
        self.vector_store = VectorExperienceStore()
        self.rule_store = RuleStore()
        self.template_store = TemplateStore()
        
        # 反思触发器
        self.reflection_trigger = ReflectionTrigger()
        
        # 批量反思器
        self.batch_reflector = BatchReflector(batch_size=5)
    
    async def execute(self, task: str) -> AgentResult:
        """执行任务"""
        # 1. 查询相关经验
        experiences = self.vector_store.get_relevant(task)
        rules = self.rule_store.get_applicable(task)
        template = self.template_store.get_template(task)
        
        # 2. 构建增强 Prompt
        enhanced_prompt = self._build_enhanced_prompt(
            task, experiences, rules, template
        )
        
        # 3. 执行
        result = await self.llm.ainvoke(enhanced_prompt)
        
        # 4. 检查是否成功
        success = self._check_success(result)
        
        # 5. 触发反思（如果需要）
        if self.reflection_trigger.should_reflect(success):
            await self._reflect_and_learn(task, result)
        
        return result
    
    async def learn_from_feedback(
        self, 
        task: str, 
        result: str, 
        feedback: str
    ):
        """从用户反馈中学习"""
        reflection = await self._reflect(task, result, feedback)
        
        # 提取经验
        for insight in reflection["insights"]:
            self.vector_store.save(
                context=task,
                problem=insight["problem"],
                solution=insight["solution"]
            )
    
    async def _reflect_and_learn(self, task: str, result: str):
        """反思并学习"""
        # 主动反思
        reflection = await self._proactive_reflect(task, result)
        
        if reflection["status"] == "improvement":
            for suggestion in reflection["suggestions"]:
                self.vector_store.save(
                    context=task,
                    problem=suggestion["problem"],
                    solution=suggestion["solution"]
                )
```


## 八、效果评估

我做了一个测试：让 Agent 执行 100 次文件操作任务，看自我进化的效果。

### 8.1 测试场景

任务类型：
- 读取文件（50 次）
- 写入文件（30 次）
- 文件格式转换（20 次）

故意设置的错误：
- 文件不存在
- 权限不足
- 格式错误

### 8.2 对比结果

| 指标 | 无进化 | 有进化 | 提升 |
|------|-------|-------|------|
| 首次成功率 | 45% | 45% | - |
| 第二次成功率 | 45% | 78% | +33% |
| 最终成功率 | 45% | 92% | +47% |
| 平均重试次数 | 3.2 | 1.3 | -59% |
| LLM 调用成本 | $12.5 | $8.3 | -34% |

### 8.3 学习曲线

```
成功率
  ↑
100%│                          ●──●──●
    │                    ●──●
 80%│              ●──●
    │        ●──●
 60%│  ●──●
    │●
 40%│
    └──────────────────────────────→ 任务次数
      0  10  20  30  40  50  60  70

    ━━━ 无进化（一直 45%）
    ─── 有进化（快速提升）
```


## 九、我踩过的坑

### 坑一：经验噪音

**问题**：存了太多无用的经验，检索时噪音很大。

**例子**：
```
经验1：读取文件时检查文件是否存在
经验2：代码要写注释
经验3：变量命名要规范
经验4：读取文件时用绝对路径
```

经验2和3是通用编程规范，对"读取文件"任务帮助不大，反而增加噪音。

**解决**：给经验加标签，检索时只返回相关标签的经验：

```python
def save(self, context: str, problem: str, solution: str):
    # 自动提取标签
    tags = self._extract_tags(context + " " + problem)
    
    self.experiences.append({
        "context": context,
        "problem": problem,
        "solution": solution,
        "tags": tags  # ["file", "io", "error-handling"]
    })
```

### 坑二：经验冲突

**问题**：存了两条矛盾的经验。

**例子**：
```
经验1：读取配置文件用相对路径
经验2：读取配置文件用绝对路径
```

**解决**：给经验加条件：

```python
{
    "context": "读取配置文件",
    "condition": "在 Docker 容器内",  # 条件
    "solution": "用绝对路径",
    "priority": 1
}

{
    "context": "读取配置文件",
    "condition": "本地开发环境",
    "solution": "用相对路径",
    "priority": 0
}
```

### 坑三：过度反思

**问题**：每次执行都反思，LLM 费用爆炸。

**解决**：只在失败或用户反馈时反思。

```python
def should_reflect(self, success: bool, feedback: str) -> bool:
    if not success:
        return True
    if feedback and self._is_negative(feedback):
        return True
    return False
```

### 坑四：经验遗忘

**问题**：经验库越来越大，旧的经验被忽略。

**解决**：定期清理低质量经验，或者用优先级排序：

```python
def cleanup(self):
    """清理低质量经验"""
    # 删除从未被引用的经验
    self.experiences = [
        e for e in self.experiences 
        if e.get("use_count", 0) > 0
    ]
    
    # 或者保留高优先级的
    self.experiences.sort(key=lambda e: e.get("priority", 0), reverse=True)
    self.experiences = self.experiences[:100]  # 只保留 top 100
```

### 坑五：反思质量不稳定

**问题**：LLM 生成的反思质量参差不齐，有时候很泛，有时候很具体。

**解决**：用 Few-shot 示例引导：

```python
REFLECTION_EXAMPLES = """
好的反思示例：
问题：文件不存在错误
解决方案：读取前用 os.path.exists() 检查，不存在则提示用户

差的反思示例：
问题：代码有问题
解决方案：要小心
"""

prompt = f"""
{REFLECTION_EXAMPLES}

现在请反思这个错误：
{error}

给出具体的、可执行的改进建议。
"""
```


## 十、与其他能力的结合

自我进化不是孤立的，可以和其他 Agent 能力结合：

### 10.1 自我进化 + 工具学习

```
执行工具 → 失败 → 反思 → 学习工具正确用法 → 下次成功
```

### 10.2 自我进化 + Prompt 优化

```
执行 → 反思 → 生成更好的 Prompt → 下次用新 Prompt
```

### 10.3 自我进化 + 多 Agent

```
Agent A 执行 → 失败
Agent B（导师）分析 → 给出改进建议
Agent A 学习 → 下次改进
```


## 十一、总结

自我进化的核心就三步：

1. **反思**：执行后分析，发现问题
2. **学习**：存储经验，结构化保存
3. **适应**：下次执行时应用经验

实现方式从简单到复杂：

| 级别 | 存储 | 检索 | 适用场景 |
|------|-----|------|---------|
| 简单版 | JSON 文件 | 关键词匹配 | 个人项目 |
| 进阶版 | 向量库 | 语义相似度 | 小团队 |
| 生产级 | 多层存储 | 混合检索 | 企业应用 |

记住：**Agent 不怕犯错，怕的是一直犯同样的错**。

让 Agent 学会反思和积累经验，就是给它进化的能力。


## 十二、下一步行动

1. **收集错误案例**：记录你的 Agent 犯过的错误，看看哪些是重复的
2. **实现简单反思**：在执行失败时，让 Agent 分析原因
3. **建立经验库**：把反思结果结构化存储
4. **测试效果**：对比有无自我进化的成功率差异


## 附录：参考资料

- Reflexion: Language Agents with Verbal Reinforcement Learning (论文)
- Generative Agents: Interactive Simulacra of Human Behavior (论文)
- LangGraph 官方文档 - Reflection Pattern
- AutoGen 官方示例 - Learning from Feedback


进化不是一蹴而就的，是一点一滴积累出来的。
