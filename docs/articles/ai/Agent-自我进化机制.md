# Agent 自我进化：让 Agent 学会反思和改进

你的 Agent 写了代码，但有 Bug。用户反馈后，你手动修复。下次遇到类似问题，Agent 还是犯同样的错误。

我之前做过一个 Agent，经常犯同样的错误：忘了加异常处理、用错 API 参数、写死路径...每次都要人工修复。

后来我加了一个"反思机制"，让 Agent 能从错误中学习。效果明显好很多。

这篇文章，我来分享怎么让 Agent 自我进化。

## 什么是自我进化？

传统 Agent：

```
任务 → 执行 → 结果
         ↑
      人工修复错误
```

自我进化 Agent：

```
任务 → 执行 → 结果 → 反思 → 改进策略 → 下次执行更好
                ↓
            自动学习
```

核心思路：**让 Agent 分析自己的错误，生成改进建议，下次避免同样的错误**。

## 最简单的反思机制

执行完后，让 Agent 自己点评：

```python
def reflect_on_result(task: str, result: str, feedback: str = None):
    """反思执行结果"""
    prompt = f"""
任务：{task}

执行结果：
{result}

{'用户反馈：' + feedback if feedback else ''}

请反思：
1. 执行过程有什么问题？
2. 如何改进？
3. 有什么经验教训？

以结构化格式输出：
```json
{{
  "problems": ["问题1", "问题2"],
  "improvements": ["改进1", "改进2"],
  "lessons": ["教训1", "教训2"]
}}
```
"""
    
    reflection = llm.invoke(prompt)
    return parse_json(reflection)
```

使用：

```python
result = agent.execute("读取 config.yaml")
reflection = reflect_on_result("读取 config.yaml", result, "文件路径错误")

print(reflection["improvements"])
# 输出: ["检查文件是否存在再读取", "使用绝对路径"]
```

## 更进阶：错误案例库

把错误和改进建议存起来，下次避免：

```python
import json
from pathlib import Path

class ExperienceStore:
    def __init__(self, path: str = "experiences.json"):
        self.path = Path(path)
        self.experiences = self._load()
    
    def _load(self) -> list:
        if self.path.exists():
            return json.loads(self.path.read_text())
        return []
    
    def save(self, error: str, improvement: str, context: str):
        """保存经验"""
        self.experiences.append({
            "error": error,
            "improvement": improvement,
            "context": context,
            "timestamp": datetime.now().isoformat()
        })
        self.path.write_text(json.dumps(self.experiences, indent=2, ensure_ascii=False))
    
    def get_relevant(self, task: str) -> list[str]:
        """获取相关经验"""
        relevant = []
        for exp in self.experiences:
            if exp["context"] in task or any(kw in task for kw in exp["context"].split()):
                relevant.append(exp["improvement"])
        return relevant
```

使用：

```python
store = ExperienceStore()

# 保存错误经验
store.save(
    error="读取了不存在的文件",
    improvement="读取前用 os.path.exists 检查",
    context="读取文件"
)

# 下次执行时查询
task = "读取 users.json 的内容"
tips = store.get_relevant(task)
print(tips)
# 输出: ["读取前用 os.path.exists 检查"]
```

## 完整的自我进化流程

```python
class SelfImprovingAgent:
    def __init__(self):
        self.experience_store = ExperienceStore()
        self.llm = get_llm()
    
    def execute(self, task: str):
        """执行任务"""
        # 1. 查询相关经验
        tips = self.experience_store.get_relevant(task)
        
        # 2. 注入经验到 Prompt
        enhanced_task = task
        if tips:
            enhanced_task = f"""
任务：{task}

注意，根据之前经验：
{chr(10).join(f'- {tip}' for tip in tips)}
"""
        
        # 3. 执行
        result = self.llm.invoke(enhanced_task)
        
        return result
    
    def learn_from_feedback(self, task: str, result: str, feedback: str):
        """从反馈中学习"""
        # 反思
        reflection = self._reflect(task, result, feedback)
        
        # 保存经验
        for problem, improvement in zip(reflection["problems"], reflection["improvements"]):
            self.experience_store.save(
                error=problem,
                improvement=improvement,
                context=task
            )
    
    def _reflect(self, task: str, result: str, feedback: str) -> dict:
        """反思并生成改进建议"""
        prompt = f"""
任务：{task}

执行结果：{result}

用户反馈：{feedback}

请分析：
1. 哪里做错了？
2. 应该怎么改？
"""
        reflection = self.llm.invoke(prompt)
        return parse_structured_output(reflection)
```

使用流程：

```python
agent = SelfImprovingAgent()

# 第一次执行
result = agent.execute("读取 config.yaml")

# 用户反馈错误
agent.learn_from_feedback(
    task="读取 config.yaml",
    result=result,
    feedback="文件不存在，应该先检查路径"
)

# 第二次执行，自动应用经验
result = agent.execute("读取 users.yaml")
# 这次 Agent 会自动检查文件是否存在
```

## 实际效果

我做了一个测试：让 Agent 执行 10 次文件读取任务，故意给错误的路径。

| 执行次数 | 是否先检查文件 | 结果 |
|---------|--------------|------|
| 1 | ❌ 否 | 报错 |
| 2（学习后）| ✅ 是 | 成功 |
| 3 | ✅ 是 | 成功 |
| ... | ✅ 是 | 成功 |

第一次犯错后，Agent 学会了"读取前检查文件"，后续不再犯同样的错误。

## 我踩过的坑

**坑一：反思太频繁**

每次执行都反思，LLM 调用费用爆炸。

解决：只在失败或有反馈时反思。

**坑二：经验太泛**

保存的经验是"要小心"，对后续任务没有实际帮助。

解决：经验要具体："读取文件前用 `os.path.exists()` 检查"。

**坑三：经验冲突**

存了两条矛盾的经验：一个说"用相对路径"，一个说"用绝对路径"。

解决：给经验加上下文条件：

```python
{
  "error": "文件不存在",
  "improvement": "用绝对路径",
  "context": "跨目录读取文件",  # 条件
  "priority": 1
}
```

## 下一步行动

1. **收集错误案例**：记录 Agent 犯过的错误
2. **实现反思机制**：让 Agent 分析错误并生成改进建议
3. **建立经验库**：把改进建议结构化存储，下次自动应用

自我进化的核心是：**从错误中学习，避免重复犯错**。

---

Agent 不怕犯错，怕的是一直犯同样的错。让它学会反思，就是给它进化的能力。
