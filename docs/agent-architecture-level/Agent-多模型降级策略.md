---
sidebar_position: 1
title: LLM 宕机了怎么办？多模型降级策略
slug: model-degradation
---

# LLM 宕机了怎么办？多模型降级策略

凌晨3点，GPT-4 API 返回 503，你的 Agent 挂了。用户投诉，你被叫起来修 bug。

我之前遇到过这种情况，后来加了一个多模型降级方案：主模型不可用时，自动切换到备用模型。再也没有半夜被叫起来过。

这篇文章，我来分享怎么实现多模型降级。

## 为什么需要多模型？

单一模型有三个问题：

**1. 可用性风险**

任何 API 都可能挂：Rate Limit、服务升级、网络故障...

**2. 成本不可控**

GPT-4 很贵，简单任务用它纯属浪费。

**3. 能力差异**

不同任务需要不同能力。简单问答用 GPT-4 是浪费，复杂推理用 GPT-3.5 可能不行。

## 降级策略设计

核心思路：**主模型失败 → 切换备用模型 → 再失败 → 再切换 → 全部失败才报错**。

```
请求 → GPT-4 → 失败 → GPT-3.5 → 失败 → Claude → 失败 → 报错
        ↓ 成功            ↓ 成功         ↓ 成功
      返回结果         返回结果       返回结果
```

## 简单实现

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class Model:
    name: str
    invoke: callable
    cost_per_1k: float  # 输入成本

class ModelFallback:
    def __init__(self, models: list[Model]):
        self.models = models
    
    def invoke(self, messages: list) -> Any:
        errors = []
        
        for model in self.models:
            try:
                result = model.invoke(messages)
                print(f"使用 {model.name} 成功")
                return result
            except Exception as e:
                errors.append(f"{model.name}: {str(e)}")
                print(f"{model.name} 失败，尝试下一个...")
                continue
        
        raise Exception(f"所有模型都失败: {errors}")

# 使用
models = [
    Model("gpt-4", gpt4.invoke, 0.03),
    Model("gpt-3.5", gpt35.invoke, 0.001),
    Model("claude-3", claude.invoke, 0.003),
]

fallback = ModelFallback(models)
result = fallback.invoke(messages)
```

## 成本优化：智能路由

不是所有请求都需要 GPT-4。可以根据任务复杂度选择模型。

```python
def estimate_complexity(message: str) -> str:
    """评估任务复杂度"""
    keywords = {
        "high": ["分析", "设计", "架构", "优化", "debug"],
        "medium": ["实现", "编写", "创建"],
        "low": ["解释", "翻译", "总结"],
    }
    
    for level, words in keywords.items():
        if any(w in message for w in words):
            return level
    return "low"

def select_model(message: str, models: dict) -> Model:
    """根据复杂度选择模型"""
    complexity = estimate_complexity(message)
    
    if complexity == "high":
        return models["gpt-4"]
    elif complexity == "medium":
        return models["gpt-3.5"]
    else:
        return models["claude-haiku"]  # 最便宜的
```

这样，简单任务自动用便宜的模型，成本能降低 70%+。

## 完整示例

```python
class SmartModelRouter:
    def __init__(self):
        self.models = {
            "gpt-4": Model("gpt-4", gpt4.invoke, 0.03),
            "gpt-3.5": Model("gpt-3.5", gpt35.invoke, 0.001),
            "claude-haiku": Model("claude-haiku", claude.invoke, 0.00025),
        }
        
        # 降级链
        self.fallback_chain = ["gpt-4", "gpt-3.5", "claude-haiku"]
    
    def invoke(self, messages: list, force_model: str = None) -> Any:
        # 指定模型
        if force_model:
            return self.models[force_model].invoke(messages)
        
        # 智能选择
        complexity = self._estimate_complexity(messages[-1]["content"])
        primary = self._get_primary_model(complexity)
        
        # 降级
        for model_name in self.fallback_chain:
            try:
                return self.models[model_name].invoke(messages)
            except Exception as e:
                print(f"{model_name} 失败: {e}")
                continue
        
        raise Exception("所有模型都不可用")
    
    def _estimate_complexity(self, message: str) -> str:
        # 简化版：根据长度判断
        if len(message) > 500:
            return "high"
        elif len(message) > 100:
            return "medium"
        return "low"
    
    def _get_primary_model(self, complexity: str) -> str:
        return {
            "high": "gpt-4",
            "medium": "gpt-3.5",
            "low": "claude-haiku",
        }[complexity]
```

## 我踩过的坑

**坑一：降级太频繁**

有一次 GPT-4 刚升级完，不稳定，大量请求降级到 GPT-3.5，质量明显下降。

解决：设置失败阈值，连续失败3次才降级。

**坑二：忘了回切**

GPT-4 恢复后，请求还是走 GPT-3.5，因为降级后没自动切回来。

解决：定期尝试主模型，成功就切回。

**坑三：配置太复杂**

一开始我搞了复杂的规则：任务类型、时间、成本预算...结果根本没人能维护。

解决：保持简单，就三层：主模型 → 备用模型 → 最便宜的兜底。

## 下一步行动

1. **列出可用模型**：你有哪些 API key，对应的成本是多少
2. **定义降级链**：主模型 → 备用 → 兜底
3. **加监控**：记录每次用的是哪个模型，成本多少


多模型不是为了炫技，是为了省钱和保命。
