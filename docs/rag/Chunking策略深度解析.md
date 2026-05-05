---
sidebar_position: 4
title: Chunking 策略深度解析
slug: chunking-strategies
---

# Chunking 策略深度解析

> 切片看起来是最简单的一步——不就是按字数切吗？但当我用 500 字符的固定切片处理一份 50 页的技术文档时，检索结果惨不忍睹：一句话被切成两半，上下文完全断裂，LLM 拿到残缺的片段根本没法回答。后来我才意识到：**切片策略直接决定了 RAG 系统的上限**。

## 一、切片为什么重要

RAG 系统的黄金法则：**Garbage In, Garbage Out**。

```
用户问题："LangGraph 的状态机是怎么实现的？"

糟糕的切片（刚好把关键信息切断）：
  片段 1: "...LangGraph 使用 StateGraph 来定义状态机，每个节点是一个"
  片段 2: "函数，边定义了状态转移条件..."

好的切片（完整保留语义）：
  片段: "LangGraph 使用 StateGraph 来定义状态机。每个节点是一个处理函数，
         边定义了状态转移条件。通过 add_conditional_edges 实现条件分支..."
```

好的切片 = **语义完整 + 长度适中 + 重叠合理**。

## 二、切片策略全景

### 2.1 策略对比

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 固定字符分割 | 按字符数硬切 | 实现最简单 | 切断语义 | 快速原型 |
| 递归字符分割 | 按分隔符层级递归 | 保留段落结构 | 不理解语义 | 通用场景 |
| 语义分割 | 用 Embedding 判断语义边界 | 语义完整 | 速度慢、成本高 | 高质量需求 |
| 文档结构分割 | 按标题/章节切 | 保留文档结构 | 依赖文档格式 | 结构化文档 |
| Agentic 切分 | 用 LLM 判断切分点 | 最智能 | 最贵、最慢 | 关键文档 |
| 混合策略 | 多种策略组合 | 平衡效果和成本 | 实现复杂 | 生产环境 |

### 2.2 可视化对比

```
原始文档：
┌─────────────────────────────────────────────────┐
│ 第一章 RAG 基础                                   │
│ 1.1 什么是 RAG                                    │
│ RAG 是检索增强生成的缩写。它通过从外部知识库       │
│ 检索相关文档来增强 LLM 的生成能力。               │
│ 1.2 RAG 的优势                                    │
│ 相比纯 LLM，RAG 可以减少幻觉、提供引用来源...     │
│ 第二章 向量数据库                                  │
│ 2.1 什么是向量数据库                              │
│ 向量数据库专门用于存储和检索高维向量...            │
└─────────────────────────────────────────────────┘

固定分割（chunk_size=100）：
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
│切片1 ││切片2 ││切片3 ││切片4 ││切片5 │
│"第一章 ││"1.1  ││"RAG 是││"检索增││"1.2  │  ← 语义被切断
│ RAG 基││什么  ││检索增 ││强生成 ││RAG 的│
│ 础"   ││RAG"  ││强生成 ││的缩写 ││优势" │
└──────┘└──────┘└──────┘└──────┘└──────┘

递归字符分割（按标题和段落）：
┌─────────────────┐┌─────────────────┐┌─────────────────┐
│   切片 1         ││   切片 2         ││   切片 3         │
│ "第一章 RAG 基础  ││ "1.2 RAG 的优势  ││ "第二章 向量数据库│
│  1.1 什么是 RAG  ││  相比纯 LLM..."  ││  2.1 什么是..."  │
│  RAG 是检索..."  ││                  ││                  │
└─────────────────┘└─────────────────┘└─────────────────┘

语义分割（按语义完整性）：
┌───────────────────┐┌───────────────────┐
│     切片 1         ││     切片 2         │
│ "什么是 RAG？      ││ "RAG 的优势：      │
│  RAG 是检索增强生成 ││  减少幻觉、提供引用 │
│  的缩写。通过从外部 ││  来源、知识可更新"  │
│  知识库检索..."     ││                    │
└───────────────────┘└───────────────────┘
```

## 三、LangChain 切片器实战

### 3.1 固定字符分割

```python
from langchain.text_splitter import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separator="\n",  # 优先按换行切
)

chunks = splitter.split_text(document)
```

**适用**：纯文本、没有明显结构的文档
**问题**：会在句子中间切断

### 3.2 递归字符分割（最常用）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 中文文档推荐配置
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=[
        "\n\n",      # 段落
        "\n",        # 换行
        "。",        # 中文句号
        "！",        # 中文感叹号
        "？",        # 中文问号
        "；",        # 中文分号
        "，",        # 中文逗号
        " ",         # 空格
        "",          # 最后手段：按字符切
    ],
    length_function=len,
    is_separator_regex=False,
)

chunks = splitter.split_text(document)
```

**关键参数**：
- `chunk_size`：建议 300-800 字符（中文）
- `chunk_overlap`：建议 chunk_size 的 10%-15%
- `separators`：中文一定要把中文标点加进去

### 3.3 语义分割

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

# 基于 Embedding 相似度的语义分割
splitter = SemanticChunker(
    OpenAIEmbeddings(model="text-embedding-3-small"),
    breakpoint_threshold_type="percentile",  # 用百分位数作为阈值
    breakpoint_threshold_amount=85,          # 相似度低于 85% 分位数时切分
)

chunks = splitter.split_text(document)
```

**原理**：计算相邻句子的 Embedding 相似度，当相似度骤降时认为语义发生了转换，在此处切分。

**优点**：切片语义最完整
**缺点**：需要调用 Embedding API，速度慢 10-100 倍，成本高

### 3.4 文档结构分割

```python
from langchain.text_splitter import MarkdownHeaderTextSplitter

# 按 Markdown 标题层级切分
headers_to_split_on = [
    ("#", "h1"),
    ("##", "h2"),
    ("###", "h3"),
]

splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)

# 每个切片会自动带上标题元数据
chunks = splitter.split_text(markdown_doc)
# chunks[0].metadata = {"h1": "第一章", "h2": "1.1 什么是 RAG"}
```

**适用**：Markdown、HTML、有明确层级结构的文档
**优点**：切片自带上下文（标题层级），检索时可以展示完整路径

### 3.5 Agentic 切分（LLM 判断）

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o", temperature=0)

def agentic_split(text, llm):
    prompt = f"""请将以下文档切分成独立的、语义完整的片段。
每个片段应该：
1. 包含一个完整的概念或主题
2. 长度在 200-500 字符之间
3. 可以独立理解，不依赖上下文

文档：
{text}

请用 "---" 分隔每个片段："""

    response = llm.invoke(prompt)
    return response.content.split("---")
```

**适用**：高价值文档（如法律合同、技术规范），切片质量要求极高
**缺点**：成本高（每个文档都要调 LLM），速度慢

## 四、Overlap 策略详解

Overlap（重叠）是防止语义断裂的关键机制：

```
无重叠：
  片段 1: [==================]
  片段 2:                    [==================]
  → 中间的信息可能丢失

有重叠：
  片段 1: [==================]
  片段 2:          [==================]
  → 重叠区域保留了上下文连续性
```

### Overlap 多少合适？

| Overlap 比例 | 效果 | 适用场景 |
|-------------|------|---------|
| 0% | 无重叠，信息可能丢失 | 不推荐 |
| 5% | 轻微重叠，轻微改善 | 简单文档 |
| 10-15% | **推荐**，平衡效果和冗余 | 大多数场景 |
| 20-30% | 强重叠，冗余多但上下文好 | 对话记录、长文本 |
| &gt;30% | 过度重叠，浪费存储和计算 | 不推荐 |

```python
# 推荐配置
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=75,  # 500 * 15% = 75
)
```

## 五、Metadata 提取

切片时保留元数据，检索时可以做更精准的过滤：

```python
from langchain_core.documents import Document

def split_with_metadata(docs, splitter):
    """切片时保留元数据"""
    all_chunks = []
    for doc in docs:
        chunks = splitter.split_documents([doc])
        for i, chunk in enumerate(chunks):
            chunk.metadata.update({
                "source": doc.metadata.get("source", "unknown"),
                "chunk_index": i,
                "total_chunks": len(chunks),
                "title": doc.metadata.get("title", ""),
                "section": extract_section(chunk.page_content),
            })
        all_chunks.extend(chunks)
    return all_chunks

def extract_section(text):
    """提取第一行作为 section 标识"""
    first_line = text.strip().split("\n")[0]
    return first_line[:100] if first_line else ""
```

## 六、实验对比

我在同一份 10 页的技术文档上测试了不同策略：

| 策略 | 切片数 | 平均长度 | 检索准确率 | 生成质量 |
|------|--------|---------|-----------|---------|
| 固定 500 字符 | 45 | 500 | 62% | 中等 |
| 递归分割 500 | 38 | 420 | 78% | 良好 |
| 递归分割 300 | 62 | 280 | 75% | 良好 |
| 语义分割 | 28 | 580 | 88% | 优秀 |
| 结构分割 | 22 | 650 | 85% | 优秀 |
| 结构 + 递归 | 30 | 480 | **91%** | **优秀** |

**结论**：结构分割 + 递归分割的组合效果最好，性价比最高。

## 七、踩坑记录

### 坑 1：chunk_size 太大导致检索噪音

**问题**：chunk_size 设为 2000，检索回来的文档包含 5-6 个不相关的主题，LLM 被干扰。

**解决**：chunk_size 控制在 300-800 字符。宁可切小一点（检索更多片段），也不要切太大（引入噪音）。

### 坑 2：中文文档用英文分隔符

**问题**：默认的 separators 是 `["\n\n", "\n", ". ", " ", ""]`，中文句号 `。` 和逗号 `，` 不在里面，导致中文句子被从中间切断。

**解决**：自定义 separators，把中文标点加进去：
```python
separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
```

### 坑 3：切片后丢失上下文

**问题**：技术文档中的"如上所述"、"见第 3.2 节"等引用，在切片后失去了指代对象。

**解决**：
1. 用 Metadata 保留标题层级（`h1 > h2 > h3`）
2. 切片时在每个片段开头加上标题路径
3. 检索时返回片段 + 其所属的章节标题

### 坑 4：过度切片导致碎片化

**问题**：chunk_size=100，一篇 1000 字的文章被切成 10 个片段，每个片段只有一两句话，丢失了完整上下文。

**解决**：chunk_size 不要小于 200 字符。对于中文，300-500 字符是甜区。

### 坑 5：语义分割对短文档效果差

**问题**：100 字的短文档用语义分割，只切出 1 个片段，但因为阈值计算问题，这个片段被截断了。

**解决**：短文档（< chunk_size）直接不切，作为一个整体片段。加一个判断：
```python
if len(text) < chunk_size:
    return [text]
```

## 九、参考资料

- LangChain Text Splitters：https://python.langchain.com/docs/how_to/#text-splitters
- SemanticChunker 文档：https://python.langchain.com/docs/how_to/semantic-chunker/
- LlamaIndex 文档分层：https://docs.llamaindex.ai/en/stable/module_guides/loadinging/node_parsers/
- RAG 最佳实践：https://docs.smith.langchain.com/evaluation/cookbook/rag_enhanced_generation
