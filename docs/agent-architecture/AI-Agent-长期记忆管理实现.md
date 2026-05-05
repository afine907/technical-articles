---
slug: long-term-memory
sidebar_position: 1
title: 如何让 Agent 记住重要信息？
---

# 如何让 Agent 记住重要信息？

上一篇我们说到，Agent 的"工作记忆"有上限，用着用着就忘了。

用户在开始时说"我们要用 TypeScript + React"，聊了 50 轮后 Agent 给出的代码却是 Python + Django——关键信息在上下文压缩时被丢掉了。怎么让 Agent 记住重要信息，忘掉不重要的？

三种记忆管理策略：固定窗口、摘要压缩、优先级保留。

## 核心问题

记忆管理本质是一个选择题：**在有限的空间里，保留哪些内容？**

你不可能什么都记。上下文窗口就那么大，必须做取舍。

关键是：谁来选？怎么选？

最简单的方式是让 Agent 自己选——但 Agent 不知道什么重要。你说"记得我提到的技术栈"，它转头就忘。

所以必须**你来定规则**。

## 三种策略对比

> 完整的实现代码和架构图见 [Agent 记忆系统设计](./Agent-记忆系统设计.md)。这里聚焦每种策略的核心思路和实际效果。

| 策略 | 核心思路 | 优点 | 缺点 | 适用场景 |
|------|---------|------|------|---------|
| **固定窗口** | 只保留最近 N 条消息 | 实现简单、无额外成本 | 早期关键信息丢失 | 短对话、简单问答 |
| **摘要压缩** | 定期调用 LLM 生成摘要 | 信息保留完整 | 有 API 成本和延迟 | 超长对话、需要完整上下文 |
| **优先级保留** | 按消息类型打分排序 | 系统消息永不丢失 | 规则需要手动设计 | 大多数 Agent 场景（推荐） |

**固定窗口**的问题：用户在最开始说"我是产品经理，不懂技术"，聊了 30 轮后这条信息被丢掉，Agent 开始用专业术语。

**摘要压缩**的坑：频繁压缩，一个月花了 200 多美元 API 费用。改成只在 token 超过 80% 阈值时才压缩，成本降了 80%。

**优先级保留**的核心：系统消息永远保留。项目背景、用户偏好、约束条件这些"元信息"只占 5% 的 token，但对 Agent 行为影响最大。

## 实际代码示例

这是 jojo-code 项目的实现，简化版：

```python
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
import tiktoken

class Memory:
    def __init__(self, max_tokens=100000):
        self.messages = []
        self.max_tokens = max_tokens
        self.encoder = tiktoken.encoding_for_model("gpt-4")
    
    def add(self, message):
        """添加消息"""
        self.messages.append(message)
        if self.count_tokens() > self.max_tokens:
            self._compress()
    
    def _compress(self):
        """压缩：保留系统消息 + 最近消息"""
        # 分离系统消息
        system = [m for m in self.messages 
                  if isinstance(m, SystemMessage)]
        
        # 保留最近 20 条
        recent = self.messages[-20:]
        
        # 生成摘要占位符
        discarded = len(self.messages) - len(system) - 20
        if discarded > 0:
            summary = SystemMessage(
                content=f"[已压缩 {discarded} 条早期对话]"
            )
            self.messages = system + [summary] + recent
    
    def count_tokens(self):
        """计算 token 数量"""
        total = 0
        for msg in self.messages:
            total += len(self.encoder.encode(msg.content))
        return total
```

使用方式：

```python
memory = Memory(max_tokens=50000)

# 添加系统消息（优先级最高）
memory.add(SystemMessage(content="项目背景：使用 TypeScript + React"))

# 添加对话
memory.add(HumanMessage(content="帮我写一个按钮组件"))
memory.add(AIMessage(content="好的，这是一个 React 按钮..."))

# 获取上下文
context = memory.messages  # 用于 LLM 调用
```

## 我踩过的坑

**坑一：忘了区分消息类型**

一开始我把所有消息同等对待，结果压缩时把系统消息也删了。Agent 完全忘了项目背景，给出的方案完全跑偏。

**坑二：压缩太频繁**

有段时间我每加一条消息就检查 token，超过阈值就压缩。结果 Agent 的"短期记忆"也被压缩了，刚说的话就忘了。

解决：只在 token 超过 80% 阈值时才压缩，给最近对话留足空间。

**坑三：没做持久化**

程序重启后，所有对话历史都丢了。用户很不满："我刚才不是跟你说过了吗？"

解决：加了个自动保存到文件的功能，重启后能恢复。

## 下一步行动

1. **检查你的 Agent**：看看它是怎么管理记忆的，有没有丢关键信息
2. **加上消息类型区分**：至少区分系统消息和普通消息
3. **监控 token 使用**：实时输出 token 数量，避免突然超限

如果想要现成的方案，可以直接用 jojo-code 的 `ConversationMemory` 类。代码在 `src/jojo_code/memory/conversation.py`，核心逻辑不到 100 行。

---

记住一点：Agent 的记忆管理不是技术问题，是**优先级决策问题**。你得想清楚：什么信息最重要？什么可以丢？
