---
sidebar_position: 1
title: RAG 系统架构设计
slug: rag-system-architecture
---

# RAG 系统架构设计

> 上周面试被问到："你们的 RAG 系统是怎么设计的？" 我发现自己只会说"用向量数据库存文档，然后检索"——这显然不够。面试官追问架构演进路线时，我答不上来了。回来之后我系统梳理了 RAG 的三代架构，发现这里面的门道比想象中深得多。

## 一、什么是 RAG

RAG（Retrieval-Augmented Generation）= 检索增强生成。核心思路很简单：

```
用户提问 → 从知识库检索相关文档 → 把文档 + 问题一起给 LLM → 生成答案
```

为什么不直接用 LLM？
- LLM 有知识截止日期，不知道最新信息
- LLM 会"幻觉"，编造不存在的事实
- 企业私有数据 LLM 根本没见过

RAG 的价值：**让 LLM 基于真实数据回答，而不是靠"记忆"编造**。

## 二、RAG 三代架构演进

### 2.1 Naive RAG（第一代）

最简单的 RAG 实现，也是大多数项目的起点：

```
┌─────────────────────────────────────────────────┐
│                  Naive RAG                       │
│                                                  │
│  文档 → 切片 → Embedding → 存入向量数据库        │
│                                                  │
│  用户提问 → Embedding → 向量检索 → Top-K 结果    │
│       ↓                                          │
│  Prompt = 检索结果 + 用户问题                    │
│       ↓                                          │
│           LLM → 生成答案                         │
└─────────────────────────────────────────────────┘
```

**优点**：实现简单，快速上线
**缺点**：
- 检索质量不稳定（切片策略影响大）
- 没有对检索结果做筛选和重排
- 上下文窗口浪费（塞了一堆不相关的内容）

### 2.2 Advanced RAG（第二代）

在 Naive RAG 基础上增加了**预处理**和**后处理**两个环节：

```
┌──────────────────────────────────────────────────────────┐
│                    Advanced RAG                            │
│                                                           │
│  预处理（Pre-Retrieval）                                   │
│  ├── 文档清洗 & 分块优化                                   │
│  ├── 元数据提取（标题、章节、来源）                        │
│  └── 索引优化（混合索引、层级索引）                        │
│                                                           │
│  检索（Retrieval）                                         │
│  ├── 向量检索 + 关键词检索（混合检索）                    │
│  └── 查询改写（Query Rewriting）                          │
│                                                           │
│  后处理（Post-Retrieval）                                  │
│  ├── 重排序（Reranking）                                  │
│  ├── 去重 & 过滤                                          │
│  └── 上下文压缩（Context Compression）                    │
│                                                           │
│  生成（Generation）                                        │
│  └── LLM 基于精炼后的上下文生成答案                       │
└──────────────────────────────────────────────────────────┘
```

**核心改进**：
- **查询改写**：用户问"Python 怎么做异步"，改写为"Python asyncio 使用方法"
- **混合检索**：向量语义检索 + BM25 关键词检索，取长补短
- **重排序**：用 Cross-Encoder 对检索结果二次排序，提高相关性

### 2.3 Modular RAG（第三代）

把 RAG 拆成可插拔的模块，按需组合：

```
┌────────────────────────────────────────────────────────────┐
│                     Modular RAG                             │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 索引模块  │  │ 检索模块  │  │ 增强模块  │  │ 生成模块  │  │
│  │          │  │          │  │          │  │          │  │
│  │ • 向量索引│  │ • 语义检索│  │ • 查询改写│  │ • Prompt  │  │
│  │ • 图索引  │  │ • 图检索  │  │ • HyDE    │  │ • Chain   │  │
│  │ • 关系索引│  │ • 混合检索│  │ • 重排序  │  │ • 自校验  │  │
│  │ • 知识图谱│  │ • 路由    │  │ • 压缩    │  │ • 引用    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  编排层：根据任务类型选择模块组合                            │
│  ├── 简单问答 → Naive RAG 即可                             │
│  ├── 复杂分析 → Advanced RAG + 多轮检索                    │
│  └── 知识推理 → Modular RAG + 知识图谱                     │
└────────────────────────────────────────────────────────────┘
```

## 三、核心模块详解

### 3.1 文档加载（Loader）

```python
# LangChain 文档加载示例
from langchain_community.document_loaders import (
    PyPDFLoader,
    UnstructuredMarkdownLoader,
    CSVLoader,
    WebBaseLoader,
)

# PDF 文档
pdf_loader = PyPDFLoader("docs/architecture.pdf")
pdf_docs = pdf_loader.load()

# Markdown 文档
md_loader = UnstructuredMarkdownLoader("docs/api-guide.md")
md_docs = md_loader.load()

# 网页
web_loader = WebBaseLoader("https://docs.example.com/api")
web_docs = web_loader.load()
```

### 3.2 文档切片（Splitter）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 递归字符分割 - 最常用的策略
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,        # 每个切片最大 500 字符
    chunk_overlap=50,      # 相邻切片重叠 50 字符
    separators=["\n\n", "\n", "。", "！", "？", "，", " "],
    length_function=len,
)

chunks = splitter.split_documents(pdf_docs)
print(f"原始文档 {len(pdf_docs)} 个，切片后 {len(chunks)} 个")
```

### 3.3 向量化（Embedding）

```python
from langchain_openai import OpenAIEmbeddings
from langchain_community.embeddings import HuggingFaceBgeEmbeddings

# OpenAI Embedding（效果好，需要 API Key）
openai_embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# 本地 BGE 模型（免费，中文效果好）
bge_embeddings = HuggingFaceBgeEmbeddings(
    model_name="BAAI/bge-small-zh-v1.5",
    model_kwargs={"device": "cuda"},
)

# 向量化文档
doc_vectors = openai_embeddings.embed_documents([doc.page_content for doc in chunks])
```

### 3.4 向量存储（VectorStore）

```python
from langchain_chroma import Chroma
from langchain_community.vectorstores import FAISS

# Chroma（适合开发和小规模生产）
vectorstore = Chroma.from_documents(
    documents=chunks,
    embedding=openai_embeddings,
    persist_directory="./chroma_db",
    collection_name="docs",
)

# FAISS（适合大规模数据，纯内存，速度快）
vectorstore = FAISS.from_documents(
    documents=chunks,
    embedding=openai_embeddings,
)

# 检索
retriever = vectorstore.as_retriever(
    search_type="mmr",        # 最大边际相关性，兼顾相关性和多样性
    search_kwargs={"k": 5},   # 返回 Top 5
)
results = retriever.invoke("RAG 系统怎么设计")
```

### 3.5 检索链（Retrieval Chain）

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

# Prompt 模板
template = """基于以下上下文回答用户的问题。
如果上下文中没有相关信息，请说"我没有找到相关信息"，不要编造答案。

上下文：
{context}

问题：{question}

回答："""

prompt = ChatPromptTemplate.from_template(template)
llm = ChatOpenAI(model="gpt-4o", temperature=0)

def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)

# 构建 RAG 链
rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)

# 使用
answer = rag_chain.invoke("什么是 RAG？")
print(answer)
```

## 四、选型决策树

```
你的场景是什么？
│
├── 数据量 < 1000 文档
│   ├── 快速原型 → Naive RAG + Chroma
│   ├── 生产环境 → Advanced RAG + Chroma
│   └── 预算有限 → Naive RAG + FAISS（本地）
│
├── 数据量 1000-10000 文档
│   ├── 通用场景 → Advanced RAG + Milvus/Zilliz
│   ├── 需要实时更新 → Modular RAG + Milvus
│   └── 企业级 → Advanced RAG + Weaviate
│
├── 数据量 > 10000 文档
│   ├── 需要高性能 → Modular RAG + Milvus Cluster
│   ├── 需要图谱 → Modular RAG + Neo4j + 向量库
│   └── 多租户 → Modular RAG + Weaviate
│
└── 特殊需求
    ├── 实时流式 → RAG + Streaming Retriever
    ├── 多模态 → Multimodal RAG + CLIP
    └── 代码搜索 → RAG + Code Embedding
```

## 五、踩坑记录

### 坑 1：切片太大导致检索噪音

**问题**：chunk_size 设为 2000，检索回来的文档包含大量无关内容，LLM 答案质量反而下降。

**解决**：chunk_size 控制在 300-800 字符，chunk_overlap 设为 chunk_size 的 10%-15%。对于结构化文档（如 API 文档），按章节/段落切片效果更好。

### 坑 2：纯向量检索漏掉关键词

**问题**：用户搜索"HTTP 405 错误"，向量检索返回了关于 HTTP 通用错误的内容，但没找到包含 "405" 的精确匹配。

**解决**：使用混合检索（Hybrid Search），向量语义检索 + BM25 关键词检索，用 RRF（Reciprocal Rank Fusion）融合排序。

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

# BM25 关键词检索器
bm25_retriever = BM25Retriever.from_documents(chunks)
bm25_retriever.k = 5

# 向量检索器
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 5})

# 混合检索：各占 50% 权重
ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.5, 0.5],
)
```

### 坑 3：检索到了但 LLM 没用

**问题**：检索返回了正确答案所在的文档，但 LLM 回答时忽略了上下文，自己编了一个答案。

**解决**：在 Prompt 中明确要求"只基于以下上下文回答"，并加上"如果上下文中没有相关信息，请说'我没有找到相关信息'"。同时用 `temperature=0` 减少随机性。

### 坑 4：中文检索效果差

**问题**：用 OpenAI 的 `text-embedding-ada-002` 做中文文档检索，效果不理想。

**解决**：换成中文优化的 Embedding 模型，如 `BAAI/bge-small-zh-v1.5` 或 `text-embedding-3-small`（OpenAI 新模型，中文支持更好）。如果预算允许，可以用 `text-embedding-3-large`。

### 坑 5：向量数据库内存爆炸

**问题**：10 万文档存入 FAISS，内存占用超过 8GB，服务器频繁 OOM。

**解决**：
- 小规模（&lt;10 万）：FAISS 内存够用
- 中规模（10-100 万）：用 Chroma（磁盘持久化）或 Milvus Lite
- 大规模（&gt;100 万）：用 Milvus Cluster 或 Weaviate，支持分布式部署

## 七、参考资料

- Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (2020)
- Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey" (2024)
- LangChain RAG 文档：https://python.langchain.com/docs/tutorials/rag/
- RAGAS 评估框架：https://docs.ragas.io/
