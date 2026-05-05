---
sidebar_position: 5
title: RAG 评估与优化
slug: rag-evaluation-optimization
---

# RAG 评估与优化

> "你的 RAG 系统效果怎么样？" "嗯……感觉还行？" 这是我第一次被面试官问到 RAG 评估时的回答。感觉还行——这三个字暴露了我根本不懂怎么量化评估 RAG 系统。回来之后我系统学习了 RAGAS 框架，才发现评估 RAG 有一整套科学的方法论。

## 一、RAG 评估为什么难

传统 ML 模型有明确的评估指标（准确率、F1、AUC），但 RAG 系统涉及多个环节，每个环节都可能出问题：

```
用户提问 → 检索 → 重排 → 生成
    ↑         ↑      ↑      ↑
  问题质量   检索质量  重排质量  生成质量
```

RAG 评估的核心挑战：**检索和生成是两个独立环节，需要分别评估，再看整体效果**。

## 二、RAGAS 评估框架

RAGAS（Retrieval Augmented Generation Assessment）是目前最流行的 RAG 评估框架。

### 2.1 核心指标

```
┌─────────────────────────────────────────────────────┐
│                  RAGAS 评估指标                       │
│                                                      │
│  Context 评估（检索质量）                              │
│  ├── Context Precision（上下文精度）                  │
│  │   检索到的文档中有多少是相关的？                    │
│  └── Context Recall（上下文召回）                     │
│      相关的文档有多少被检索到了？                      │
│                                                      │
│  Answer 评估（生成质量）                               │
│  ├── Faithfulness（忠实度）                           │
│  │   答案是否基于检索到的上下文？                      │
│  └── Answer Relevancy（答案相关性）                   │
│      答案是否回答了用户的问题？                        │
│                                                      │
│  整体评估                                              │
│  └── Answer Correctness（答案正确性）                 │
│      答案是否与标准答案一致？                          │
└─────────────────────────────────────────────────────┘
```

### 2.2 各指标详解

| 指标 | 评估对象 | 取值范围 | 含义 | 计算方式 |
|------|---------|---------|------|---------|
| Context Precision | 检索结果 | 0-1 | 检索到的文档中相关文档的比例 | LLM 判断每个检索结果是否相关 |
| Context Recall | Ground Truth | 0-1 | 标准答案中的信息被检索覆盖的比例 | 将标准答案分解为要点，检查是否被检索到 |
| Faithfulness | 生成答案 | 0-1 | 答案中的每个声明是否能从上下文推导出 | LLM 逐句验证声明与上下文的一致性 |
| Answer Relevancy | 用户问题 | 0-1 | 答案是否直接回答了用户的问题 | LLM 从答案反推问题，计算与原始问题的相似度 |
| Answer Correctness | Ground Truth | 0-1 | 答案与标准答案的一致程度 | 关键词匹配 + 语义相似度 |

## 三、评估流程搭建

### 3.1 准备评估数据集

```python
# 评估数据集格式
eval_dataset = {
    "question": [
        "什么是 RAG？",
        "向量数据库怎么选？",
        "Chunking 策略有哪几种？",
    ],
    "ground_truth": [
        "RAG 是检索增强生成，通过从外部知识库检索相关文档来增强 LLM 的生成能力。",
        "根据数据规模选择：小规模用 Chroma，中规模用 Qdrant/Weaviate，大规模用 Milvus。",
        "主要有固定分割、递归分割、语义分割、文档结构分割和 Agentic 切分。",
    ],
    "contexts": [
        ["RAG（Retrieval-Augmented Generation）是一种结合检索和生成的技术..."],
        ["Chroma 适合小规模数据，Milvus 适合大规模生产..."],
        ["递归字符分割是最常用的策略，语义分割效果最好但成本高..."],
    ],
    "answer": [
        "RAG 是检索增强生成的缩写，它通过从外部知识库检索相关文档来增强大语言模型的生成能力，从而减少幻觉并提供可引用的信息来源。",
        "根据数据规模选择：小规模（&lt;10万）用 Chroma，中规模（10-100万）用 Qdrant 或 Weaviate，大规模（&gt;100万）用 Milvus。",
        "主要切片策略包括：固定字符分割、递归字符分割（最常用）、语义分割、文档结构分割和 Agentic 切分。",
    ],
}

import pandas as pd
df = pd.DataFrame(eval_dataset)
```

### 3.2 配置 RAGAS 评估

```python
from ragas import evaluate
from ragas.metrics import (
    context_precision,
    context_recall,
    faithfulness,
    answer_relevancy,
    answer_correctness,
)
from ragas.dataset_schema import EvaluationDataset, SingleTurnSample

# 构建评估样本
samples = []
for _, row in df.iterrows():
    sample = SingleTurnSample(
        user_input=row["question"],
        response=row["answer"],
        retrieved_contexts=row["contexts"],
        reference=row["ground_truth"],
        reference_contexts=row["contexts"],
    )
    samples.append(sample)

dataset = EvaluationDataset(samples=samples)

# 运行评估
result = evaluate(
    dataset=dataset,
    metrics=[
        context_precision,
        context_recall,
        faithfulness,
        answer_relevancy,
        answer_correctness,
    ],
)

print(result)
# {'context_precision': 0.85, 'context_recall': 0.78,
#  'faithfulness': 0.92, 'answer_relevancy': 0.88,
#  'answer_correctness': 0.81}
```

### 3.3 可视化评估结果

```python
import matplotlib.pyplot as plt

metrics = {
    "Context Precision": 0.85,
    "Context Recall": 0.78,
    "Faithfulness": 0.92,
    "Answer Relevancy": 0.88,
    "Answer Correctness": 0.81,
}

# 雷达图
fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
categories = list(metrics.keys())
values = list(metrics.values())
values += values[:1]  # 闭合

angles = [n / float(len(categories)) * 2 * 3.14159 for n in range(len(categories))]
angles += angles[:1]

ax.fill(angles, values, alpha=0.25)
ax.plot(angles, values, linewidth=2)
ax.set_xticks(angles[:-1])
ax.set_xticklabels(categories)
ax.set_ylim(0, 1)
plt.title("RAGAS 评估结果")
plt.savefig("ragas_radar.png")
```

## 四、优化策略

### 4.1 查询改写（Query Rewriting）

用户的问题往往表述模糊，改写后检索效果更好：

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

rewrite_prompt = ChatPromptTemplate.from_template(
    """请将用户的问题改写为更适合检索的形式。
要求：
1. 补充缺失的上下文
2. 消除歧义
3. 使用更精确的术语

原始问题：{question}
改写后的问题："""
)

llm = ChatOpenAI(model="gpt-4o", temperature=0)
rewrite_chain = rewrite_prompt | llm

# 示例
original = "那个数据库怎么用？"
rewritten = rewrite_chain.invoke({"question": original})
# "向量数据库（如 Chroma、Milvus）的使用方法是什么？"
```

### 4.2 HyDE（假设性文档嵌入）

先让 LLM 生成一个"假设性答案"，用这个答案去检索：

```python
from langchain_core.prompts import ChatPromptTemplate

hyde_prompt = ChatPromptTemplate.from_template(
    """请根据以下问题，写一段可能的答案（不需要准确，只需要相关）。

问题：{question}

假设性答案："""
)

# 流程：问题 → LLM 生成假设答案 → 用假设答案的 Embedding 检索
# 优势：假设答案和真实文档在语义空间中更接近
```

### 4.3 重排序（Reranking）

用 Cross-Encoder 对检索结果二次排序：

```python
from sentence_transformers import CrossEncoder

# 加载重排序模型
reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

def rerank(query, documents, top_k=5):
    """对检索结果重排序"""
    pairs = [(query, doc.page_content) for doc in documents]
    scores = reranker.predict(pairs)

    # 按分数排序
    ranked = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)
    return [doc for doc, score in ranked[:top_k]]

# 使用
initial_results = retriever.invoke(query, k=20)  # 多检索一些
reranked_results = rerank(query, initial_results, top_k=5)  # 重排序取 Top 5
```

### 4.4 Parent-Child Retrieval

检索小片段，返回大片段：

```
Parent（大片段，1000 字符）
├── Child 1（小片段，200 字符）← 检索用
├── Child 2（小片段，200 字符）← 检索用
└── Child 3（小片段，200 字符）← 检索用

检索时：用 Child 做向量匹配（精度高）
返回时：返回 Parent（上下文完整）
```

```python
from langchain.retrievers import ParentDocumentRetriever
from langchain.storage import InMemoryStore
from langchain_chroma import Chroma

# 父文档存储
store = InMemoryStore()
child_splitter = RecursiveCharacterTextSplitter(chunk_size=200)
parent_splitter = RecursiveCharacterTextSplitter(chunk_size=1000)

# 向量存储（存 Child）
vectorstore = Chroma(collection_name="children", embedding=embeddings)

parent_retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=store,
    child_splitter=child_splitter,
    parent_splitter=parent_splitter,
)

# 检索时自动返回 Parent
results = parent_retriever.invoke("RAG 怎么优化")
```

### 4.5 Self-RAG

让 LLM 自己判断是否需要检索、检索结果是否有用：

```python
self_rag_prompt = """请回答以下问题。

首先判断：这个问题是否需要外部知识？
- 如果需要，请标记 [RETRIEVE]
- 如果不需要，请直接回答

如果需要检索，检索到以下上下文：
{context}

请判断：这些上下文是否与问题相关？
- 如果相关，请基于上下文回答，标记 [RELEVANT]
- 如果不相关，请标记 [NOT RELEVANT] 并说明

问题：{question}
"""
```

## 五、A/B 测试框架

```python
import random
import time
from dataclasses import dataclass
from typing import List

@dataclass
class RAGVariant:
    name: str
    retriever: object  # 检索器
    chain: object      # RAG 链

@dataclass
class EvalResult:
    variant: str
    question: str
    answer: str
    latency: float
    faithfulness: float
    relevancy: float

class RAGABTest:
    def __init__(self, variants: List[RAGVariant], eval_questions: List[dict]):
        self.variants = variants
        self.questions = eval_questions

    def run(self, n_runs=100):
        results = []
        for q in self.questions:
            for variant in self.variants:
                start = time.time()
                answer = variant.chain.invoke(q["question"])
                latency = time.time() - start

                # 评估
                faith = evaluate_faithfulness(answer, q["contexts"])
                rel = evaluate_relevancy(answer, q["question"])

                results.append(EvalResult(
                    variant=variant.name,
                    question=q["question"],
                    answer=answer,
                    latency=latency,
                    faithfulness=faith,
                    relevancy=rel,
                ))
        return results

    def compare(self, results):
        """对比两个变体的效果"""
        import pandas as pd
        df = pd.DataFrame([vars(r) for r in results])
        summary = df.groupby("variant").agg({
            "latency": "mean",
            "faithfulness": "mean",
            "relevancy": "mean",
        })
        return summary
```

## 六、踩坑记录

### 坑 1：评估数据集质量差

**问题**：ground_truth 写得太笼统（如"RAG 是一种技术"），导致所有变体的得分都很高，无法区分优劣。

**解决**：ground_truth 要具体、可验证。不要写"RAG 是一种技术"，要写"RAG 是检索增强生成，通过从外部知识库检索文档来增强 LLM，核心组件包括 Embedding、向量数据库和 LLM"。

### 坑 2：过度优化检索指标

**问题**：Context Precision 刷到 0.95，但实际用户体验没有提升——因为为了提高精度，把检索范围缩得太窄，很多边缘情况的答案找不到了。

**解决**：不要单独看某个指标，要看 Faithfulness + Answer Relevancy 的组合。检索精度高但召回低 = 漏掉很多信息；召回高但精度低 = 噪音太多。

### 坑 3：评估结果和实际效果不一致

**问题**：RAGAS 评分很高，但用户反馈说答案质量不行。

**解决**：RAGAS 评估的是"答案是否基于上下文"，但没有评估"答案是否容易理解"。需要加上人工评估环节，让真实用户打分。

### 坑 4：A/B 测试样本不够

**问题**：只用了 10 个问题做 A/B 测试，结果波动很大，今天 A 好明天 B 好。

**解决**：A/B 测试至少需要 50-100 个问题，覆盖不同类型（简单/复杂/模糊/边界）。问题越多，结果越稳定。

### 坑 5：优化了一个指标，其他指标下降

**问题**：用 HyDE 提高了 Context Recall，但 Faithfulness 下降了——因为假设性答案引入了偏差。

**解决**：优化时要监控所有指标，用加权综合分数：
```python
综合分 = 0.3 * precision + 0.2 * recall + 0.3 * faithfulness + 0.2 * relevancy
```

## 八、参考资料

- RAGAS 官方文档：https://docs.ragas.io/
- LlamaIndex 评估指南：https://docs.llamaindex.ai/en/stable/module_guides/evaluating/
- ASQA 评估数据集：https://github.com/google-research/google-research/tree/master/asqa
- REPLUG: Retrieval-Augmented Black-Box Language Models (2023)
