# 主流 Agent 框架对比，选型不再纠结

新项目启动，LangChain、LangGraph、AutoGen、CrewAI...选哪个？

我之前也被这个问题困扰过，试了一圈后总结出这张表：

## 核心对比

| 框架 | 核心特点 | 学习曲线 | 适合场景 |
|------|---------|---------|---------|
| LangChain | 链式调用，组件丰富 | 中等 | 简单流程、快速原型 |
| LangGraph | 图状流程，循环支持 | 中高 | 复杂 Agent、生产级 |
| AutoGen | 多 Agent 协作 | 低 | 团队协作模拟 |
| CrewAI | 角色扮演，任务分配 | 低 | 业务流程自动化 |
| OpenAI Assistants | 托管服务 | 最低 | 不想自己运维 |

## 详细分析

### LangChain

最老牌的框架，生态最完善。

```python
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

chain = LLMChain(
    llm=llm,
    prompt=PromptTemplate.from_template("翻译：{text}")
)
result = chain.run("Hello")
```

**优点**：
- 文档齐全，社区活跃
- 组件丰富（Prompt、Memory、Tool）
- 各种 LLM 都支持

**缺点**：
- 链式结构不支持循环（Agent 需要循环）
- 抽象太多，调试困难

**适合**：简单流程、快速验证想法。

### LangGraph

LangChain 团队出的，专门为 Agent 设计。

```python
from langgraph.graph import StateGraph

workflow = StateGraph(State)
workflow.add_node("thinking", thinking_node)
workflow.add_node("execute", execute_node)
workflow.add_conditional_edges("thinking", router)
graph = workflow.compile()
```

**优点**：
- 图状结构，支持循环
- 状态管理清晰
- 可视化调试

**缺点**：
- 学习曲线稍陡
- 文档还在完善

**适合**：复杂 Agent、生产级应用。这是我目前用的方案。

### AutoGen

微软出的，主打多 Agent 协作。

```python
from autogen import AssistantAgent, UserProxyAgent

assistant = AssistantAgent("assistant")
user = UserProxyAgent("user")

user.initiate_chat(assistant, message="帮我写个爬虫")
```

**优点**：
- 多 Agent 协作简单
- 人机交互友好
- 代码执行安全

**缺点**：
- 单 Agent 场景杀鸡用牛刀
- 定制化能力有限

**适合**：需要多个 Agent 协作的复杂任务。

### CrewAI

角色扮演式的多 Agent 框架。

```python
from crewai import Agent, Task, Crew

researcher = Agent(role="研究员", goal="收集信息")
writer = Agent(role="写手", goal="撰写文章")

crew = Crew(agents=[researcher, writer], tasks=[task])
crew.kickoff()
```

**优点**：
- 概念简单，上手快
- 角色分工清晰

**缺点**：
- 底层封装太深
- 灵活性不如 LangGraph

**适合**：业务流程自动化、内容生成。

## 选型决策树

```
你的 Agent 需要？

├─ 简单问答/单次处理
│   └─→ LangChain 或 OpenAI Assistants
│
├─ 多轮对话/工具调用（单 Agent）
│   └─→ LangGraph（推荐）
│
├─ 多 Agent 协作
│   ├─ 模拟团队讨论
│   │   └─→ AutoGen
│   │
│   └─ 业务流程分工
│       └─→ CrewAI
│
└─ 不想运维
    └─→ OpenAI Assistants API
```

## 我的建议

**如果你刚开始学**：用 LangChain 跑通一个简单例子，理解基本概念。

**如果你要上生产**：LangGraph。它的状态管理和可视化调试对生产环境非常重要。

**如果你做多 Agent**：先试试 AutoGen，它的人机交互做得很好。

## 我踩过的坑

**坑一：选了太复杂的框架**

一开始用 AutoGen，结果发现我的场景只需要单 Agent，多 Agent 的那些功能都用不上，反而增加了复杂度。

**坑二：忽略社区活跃度**

选了个小众框架，遇到问题 Google 都搜不到。后来换回 LangChain/LangGraph，问题都能在 GitHub Issue 里找到答案。

**坑三：版本兼容**

LangChain 更新太快，今天写的代码明天就跑不通了。

解决：锁定版本号，不要用 `^` 或 `~`。

## 下一步行动

1. **定义需求**：单 Agent 还是多 Agent？简单流程还是复杂逻辑？
2. **跑一个 Demo**：用选定的框架实现最简单的 Agent
3. **评估文档和社区**：遇到问题能找到答案吗？

---

没有最好的框架，只有最适合的。先跑起来，再优化。
