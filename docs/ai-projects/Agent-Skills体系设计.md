---
sidebar_position: 3
title: Agent Skills 体系与 Prompt 模板库
slug: agent-skills-system
---

# Agent Skills 体系与 Prompt 模板库

> 每次开发新的 Agent 功能，都要从零写 Prompt——翻译、代码审查、文档生成，每次都重复造轮子。于是我做了一个 Skills 仓库，把常用的 Agent 能力封装成可复用的 Prompt 模板，像乐高积木一样组合使用。

## 一、什么是 Agent Skills

Agent Skills = **可复用的 Agent 能力单元**。

```
传统开发：
  每个项目写自己的 Prompt → 重复劳动、质量不一

Skills 体系：
  ┌──────────────────────────────────────┐
  │          Skills 仓库                  │
  │                                       │
  │  📝 code-review    代码审查           │
  │  🌐 translate      多语言翻译         │
  │  📄 doc-generate   文档生成           │
  │  🐛 debug-assist   调试助手           │
  │  📊 data-analysis  数据分析           │
  │  🔒 security-audit 安全审计           │
  │  ...                                  │
  │                                       │
  │  每个 Skill = Prompt 模板 + 输入输出 Schema │
  └──────────────────────────────────────┘
         ↓
  Agent 按需加载 Skill → 组合执行 → 输出结果
```

## 二、Skill 架构设计

### 2.1 Skill 定义

```python
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum

class SkillCategory(str, Enum):
    CODE = "code"
    LANGUAGE = "language"
    DOCUMENT = "document"
    ANALYSIS = "analysis"
    SECURITY = "security"

@dataclass
class SkillParameter:
    name: str
    type: str  # "string" / "number" / "boolean" / "array"
    description: str
    required: bool = True
    default: Any = None

@dataclass
class Skill:
    name: str
    description: str
    category: SkillCategory
    prompt_template: str
    parameters: List[SkillParameter]
    output_schema: Optional[Dict] = None
    examples: List[Dict] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
```

### 2.2 Skill 文件格式

每个 Skill 用 YAML 文件定义：

```yaml
# skills/code-review.yaml
name: code-review
description: 审查代码质量、安全漏洞和性能问题
category: code
tags: [review, security, performance]

parameters:
  - name: language
    type: string
    description: 代码语言（python/javascript/typescript/go）
    required: true
  - name: code
    type: string
    description: 待审查的代码
    required: true
  - name: focus
    type: string
    description: 审查重点（security/performance/all）
    required: false
    default: all

prompt_template: |
  你是一个资深的编程语言代码审查专家。

  请审查以下代码，重点关注审查重点中列出的内容。

  请按以下格式返回审查结果：

  ## 问题列表
  - [严重程度: 高/中/低] 问题描述
    位置：行号
    建议：修复方案

  ## 改进建议
  1. 建议内容

  ## 整体评价
  一句话总结代码质量

examples:
  - input:
      language: python
      code: |
        def get_user(id):
            query = f"SELECT * FROM users WHERE id = {id}"
            return db.execute(query)
      focus: security
    output: |
      ## 问题列表
      - [严重程度: 高] SQL 注入漏洞
        位置：第 2 行
        建议：使用参数化查询 db.execute("SELECT * FROM users WHERE id = ?", (id,))

      ## 改进建议
      1. 添加类型注解
      2. 添加错误处理

      ## 整体评价
      代码存在严重的安全漏洞（SQL 注入），需要立即修复。
```

### 2.3 Skill 加载器

```python
import yaml
from pathlib import Path
from typing import Dict, List

class SkillLoader:
    """加载和管理 Skills"""

    def __init__(self, skills_dir: str = "./skills"):
        self.skills_dir = Path(skills_dir)
        self.skills: Dict[str, Skill] = {}

    def load_all(self):
        """加载所有 Skill 文件"""
        for file in self.skills_dir.glob("*.yaml"):
            skill = self._load_skill(file)
            self.skills[skill.name] = skill

    def _load_skill(self, file: Path) -> Skill:
        with open(file) as f:
            data = yaml.safe_load(f)

        parameters = [
            SkillParameter(**param) for param in data.get("parameters", [])
        ]

        return Skill(
            name=data["name"],
            description=data["description"],
            category=SkillCategory(data["category"]),
            prompt_template=data["prompt_template"],
            parameters=parameters,
            output_schema=data.get("output_schema"),
            examples=data.get("examples", []),
            tags=data.get("tags", []),
        )

    def get_skill(self, name: str) -> Skill:
        return self.skills[name]

    def search_skills(self, query: str) -> List[Skill]:
        """根据关键词搜索 Skills"""
        results = []
        for skill in self.skills.values():
            if (query.lower() in skill.name.lower() or
                query.lower() in skill.description.lower() or
                query.lower() in " ".join(skill.tags)):
                results.append(skill)
        return results

    def list_by_category(self, category: SkillCategory) -> List[Skill]:
        return [s for s in self.skills.values() if s.category == category]
```

### 2.4 Skill 执行器

```python
from string import Template

class SkillExecutor:
    """执行 Skill"""

    def __init__(self, llm_gateway):
        self.gateway = llm_gateway
        self.loader = SkillLoader()
        self.loader.load_all()

    async def execute(self, skill_name: str, **params) -> str:
        skill = self.loader.get_skill(skill_name)

        # 验证参数
        self._validate_params(skill, params)

        # 渲染 Prompt
        prompt = self._render_prompt(skill, params)

        # 调用 LLM
        response = await self.gateway.chat(
            messages=[LLMMessage(role="user", content=prompt)],
        )

        return response.content

    def _render_prompt(self, skill: Skill, params: dict) -> str:
        prompt = skill.prompt_template
        for key, value in params.items():
            prompt = prompt.replace(f"{{{key}}}", str(value))

        # 处理 focus_items 等特殊参数
        if "focus" in params:
            focus_map = {
                "security": "1. 安全漏洞（SQL 注入、XSS、命令注入等）",
                "performance": "1. 性能问题（N+1 查询、内存泄漏等）",
                "all": "1. 安全漏洞\n2. 性能问题\n3. 代码规范",
            }
            prompt = prompt.replace("{focus_items}", focus_map.get(params["focus"], focus_map["all"]))

        return prompt

    def _validate_params(self, skill: Skill, params: dict):
        for param in skill.parameters:
            if param.required and param.name not in params:
                raise ValueError(f"Missing required parameter: {param.name}")
```

## 三、Skills 组合

多个 Skill 可以组合成复杂的工作流：

```python
class SkillPipeline:
    """Skill 管道 - 串联多个 Skill"""

    def __init__(self, executor: SkillExecutor):
        self.executor = executor

    async def code_review_with_fix(self, language: str, code: str) -> dict:
        """代码审查 + 自动修复"""

        # Step 1: 审查代码
        review = await self.executor.execute(
            "code-review",
            language=language,
            code=code,
            focus="all",
        )

        # Step 2: 生成修复方案
        fix = await self.executor.execute(
            "code-fix",
            language=language,
            code=code,
            review=review,
        )

        # Step 3: 解释修复
        explanation = await self.executor.execute(
            "explain-code",
            language=language,
            code=fix,
        )

        return {
            "review": review,
            "fixed_code": fix,
            "explanation": explanation,
        }

# 使用
executor = SkillExecutor(gateway)
pipeline = SkillPipeline(executor)

result = await pipeline.code_review_with_fix("python", """
def get_user(id):
    query = f"SELECT * FROM users WHERE id = {id}"
    return db.execute(query)
""")
```

## 四、踩坑记录

### 坑 1：Prompt 模板的变量冲突

**问题**：模板里有 `{language}` 和 `{code}`，但 `{code}` 里也可能包含花括号（如 Python 字典），导致渲染错误。

**解决**：用双花括号 `{{` 转义，或者用更安全的模板引擎（如 Jinja2）替代 Python 字符串替换。

### 坑 2：Skill 的 Prompt 太长

**问题**：一个 Skill 的 Prompt 加上示例有 2000 Token，加上用户输入就超了。

**解决**：Prompt 模板控制在 500 Token 以内，示例放在一起单独管理，按需加载。

### 坑 3：Skills 版本管理

**问题**：修改了一个 Skill 的 Prompt，但已经上线的 Agent 还在用旧版本。

**解决**：给每个 Skill 加版本号，Agent 启动时锁定版本，更新需要显式升级。

### 坑 4：不同模型对同一 Skill 效果差异大

**问题**：GPT-4o 上效果很好的 Skill，换成 DeepSeek 后输出质量下降。

**解决**：每个 Skill 维护一个"推荐模型"列表，在执行时自动选择最优模型。

## 六、参考资料

- Prompt 模板最佳实践：https://docs.smith.langchain.com/prompt-hub
- LangChain Prompt Templates：https://python.langchain.com/docs/concepts/prompt_templates/
- OpenAI Cookbook：https://cookbook.openai.com/
