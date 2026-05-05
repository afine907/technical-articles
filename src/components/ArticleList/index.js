import React from 'react';
import ArticleCard from '../ArticleCard';
import styles from './styles.module.css';

const groups = [
  {
    label: '🤖 AI / LLM',
    categories: [
      {
        label: 'Agent 开发',
        description: '架构设计、工程实践、进阶能力',
        items: [
          { docId: 'agent-architecture/long-term-memory', title: 'AI Agent 长期记忆管理实现', description: 'Agent 长期记忆的完整实现方案' },
          { docId: 'agent-architecture/Agent-Tool-Permission-Design', title: 'Agent 工具权限管理设计', description: 'Agent 工具权限管理设计' },
          { docId: 'agent-architecture/jojo-code-architecture', title: 'jojo-code 核心架构解析', description: 'jojo-code 核心架构源码级解析' },
          { docId: 'agent-architecture/multi-agent-collaboration', title: 'Agent 多 Agent 协作指南', description: '多 Agent 协作架构与实现' },
          { docId: 'agent-architecture/memory-system', title: 'Agent 记忆系统设计', description: 'Agent 记忆系统完整设计' },
          { docId: 'agent-engineering/langgraph-orchestration', title: 'LangGraph Agent 编排实战', description: 'LangGraph Agent 编排实战指南' },
          { docId: 'agent-engineering/state-management', title: 'Agent 状态管理设计', description: 'Agent 状态管理的完整方案' },
          { docId: 'agent-engineering/llm-context-window-management', title: 'LLM 上下文窗口管理策略', description: 'LLM 上下文窗口管理策略' },
          { docId: 'agent-engineering/mcp-guide', title: 'Agent MCP 实战指南', description: 'Model Context Protocol 实战' },
          { docId: 'agent-engineering/prompt-design', title: 'Agent Prompt 设计指南', description: 'Agent Prompt 工程最佳实践' },
          { docId: 'agent-engineering/tool-development', title: 'Agent 工具开发指南', description: 'Agent 工具开发完整指南' },
          { docId: 'agent-engineering/testing', title: 'Agent 测试指南', description: 'Agent 测试策略与实践' },
          { docId: 'agent-advanced/streaming-response', title: 'Agent 流式响应实现', description: 'Agent 流式响应完整实现' },
          { docId: 'agent-advanced/error-handling', title: 'Agent 错误处理与重试机制', description: 'Agent 错误处理最佳实践' },
          { docId: 'agent-advanced/performance-monitoring', title: 'Agent 性能监控与调优', description: 'Agent 性能监控与调优方案' },
          { docId: 'agent-advanced/self-evolution', title: 'Agent 自我进化机制', description: 'Agent 自我进化机制设计' },
        ],
      },
      {
        label: 'LLM 核心技术',
        description: 'RAG 架构、向量数据库、Embedding、LLM API 集成',
        items: [
          { docId: 'rag/rag-system-architecture', title: 'RAG 系统架构设计', description: 'Naive RAG → Advanced RAG → Modular RAG 演进与选型' },
          { docId: 'rag/vector-database-selection', title: '向量数据库选型实战', description: 'Chroma / FAISS / Milvus / Weaviate 对比与性能基准' },
          { docId: 'rag/embedding-model-selection', title: 'Embedding 模型选型与微调', description: 'OpenAI / BGE / M3E 对比，中文场景微调实战' },
          { docId: 'rag/chunking-strategies', title: 'Chunking 策略深度解析', description: '固定/语义/递归分割策略对比与效果实验' },
          { docId: 'rag/rag-evaluation-optimization', title: 'RAG 评估与优化', description: 'RAGAS 框架、优化策略与 A/B 测试' },
          { docId: 'llm-integration/multi-llm-api-integration', title: '多 LLM API 统一接入', description: 'OpenAI / Claude / DeepSeek / Qwen 统一接入层设计' },
          { docId: 'llm-integration/prompt-engineering-advanced', title: 'Prompt 工程进阶', description: 'CoT / Few-Shot / ReAct / Self-Consistency 技术详解' },
          { docId: 'llm-integration/llm-structured-output', title: 'LLM 输出结构化', description: 'JSON Mode / Structured Outputs / Function Calling 实战' },
          { docId: 'llm-integration/token-management-cost-optimization', title: 'Token 管理与成本优化', description: 'Prompt Cache / 上下文压缩 / 模型路由策略' },
        ],
      },
      {
        label: '架构与框架',
        description: '框架对比、Pipeline 设计、安全与降级',
        items: [
          { docId: 'ai-native-pipeline/pipeline-design', title: 'AI Native Pipeline 设计实践', description: '从需求到代码的全自动开发流水线' },
          { docId: 'ai-native-pipeline/pipeline-lessons', title: 'AI Native Pipeline 踩坑实录', description: 'Agent 开发的那些坑与解决方案' },
          { docId: 'ai-native-pipeline/evaluation', title: 'Agent 效果评估实战', description: '如何量化验证 Agent 改进效果' },
          { docId: 'agent-architecture-level/security-defense', title: 'Agent 安全威胁与防御策略', description: 'jojo-code 安全模块源码级剖析' },
          { docId: 'agent-architecture-level/model-degradation', title: 'Agent 多模型降级策略', description: '多模型架构与降级算法实战' },
          { docId: 'agent-architecture-level/typescript-python-architecture-practice', title: 'TypeScript + Python 双语言架构实践', description: '跨语言架构设计与实现' },
          { docId: 'agent-framework/framework-comparison', title: '主流 Agent 框架对比评测', description: 'LangGraph、LangChain、AutoGen、CrewAI 深度评测' },
        ],
      },
    ],
  },
  {
    label: '🎨 前端技术',
    categories: [
      {
        label: 'Agent 前端',
        description: 'Agent UI 组件、流式渲染、Generative UI',
        items: [
          { docId: 'agent-frontend/agent-sse-streaming-component', title: 'Agent SSE 流式可视化组件', description: 'React SSE 组件设计与 Agent 思考链可视化' },
          { docId: 'agent-frontend/agent-chat-ui-design', title: 'Agent 对话 UI 设计与实现', description: 'Chat 界面组件设计、消息流渲染与移动端适配' },
          { docId: 'agent-frontend/generative-ui-practice', title: 'Generative UI 实践', description: 'LLM 驱动的动态 UI 生成与 Vercel AI SDK 实战' },
          { docId: 'agent-frontend/agent-debug-panel', title: 'Agent 可视化调试面板', description: 'Agent 决策链路追踪与 Token 消耗展示' },
        ],
      },
      {
        label: '前端工程化',
        description: '监控、微前端、自动化测试',
        items: [
          { docId: 'frontend-engineering/frontend-monitoring-system', title: '前端监控体系设计', description: 'Sentry 集成、Error Boundary 与 Agent 场景监控' },
          { docId: 'frontend-engineering/micro-frontend-architecture', title: '微前端架构实践', description: 'qiankun、Module Federation 与 Agent 插件系统' },
          { docId: 'frontend-engineering/frontend-automation-testing', title: '前端自动化测试', description: '单元测试、E2E 测试与 CI 集成' },
        ],
      },
    ],
  },
  {
    label: '🐍 后端技术',
    categories: [
      {
        label: 'Python 后端实践',
        description: 'FastAPI 服务、数据库设计、Agent API',
        items: [
          { docId: 'backend-python/fastapi-langchain-practice', title: 'FastAPI + LangChain 实战', description: 'Agent API 服务搭建与流式响应实现' },
          { docId: 'backend-python/async-programming-concurrency', title: '异步编程与并发模型', description: 'asyncio / TaskGroup 与 Agent 并发编排' },
          { docId: 'backend-python/database-design-orm', title: '数据库设计与 ORM', description: 'SQLAlchemy 2.0 与 Agent 状态持久化' },
          { docId: 'backend-python/python-type-system-quality', title: 'Python 类型系统与代码质量', description: 'Pydantic / mypy / ruff 工具链实战' },
        ],
      },
    ],
  },
  {
    label: '☁️ 云原生部署',
    categories: [
      {
        label: '部署与运维',
        description: 'Docker、K8s、CI/CD、监控告警、生产环境',
        items: [
          { docId: 'agent-ops/deployment', title: 'Agent 部署上线指南', description: 'Agent 部署与运维完整指南' },
          { docId: 'cloud-native/docker-containerization', title: 'Docker 容器化实战', description: '多阶段构建、Compose 编排与镜像优化' },
          { docId: 'cloud-native/k8s-agent-deployment', title: 'K8s 部署 Agent 服务', description: 'Deployment / HPA 自动扩缩与资源管理' },
          { docId: 'cloud-native/cicd-pipeline-design', title: 'CI/CD 流水线设计', description: 'GitHub Actions 与 Agent 服务全流程部署' },
          { docId: 'cloud-native/monitoring-alerting-system', title: '监控告警体系', description: 'Prometheus + Grafana 与 Agent 决策链路追踪' },
          { docId: 'cloud-native/production-best-practices', title: '生产环境最佳实践', description: '零停机部署、灰度发布与安全加固' },
        ],
      },
    ],
  },
  {
    label: '🚀 项目实战',
    categories: [
      {
        label: '项目实战',
        description: 'Agent 实战项目、架构解析与技术总结',
        items: [
          { docId: 'agent-projects/project-development', title: 'Agent 实战项目开发', description: 'Agent 实战项目完整开发流程' },
          { docId: 'ai-projects/jojo-code-coding-agent', title: 'jojo-code 从零实现 Coding Agent', description: 'LangGraph 状态机、工具系统、TUI 交互架构解析' },
          { docId: 'ai-projects/agent-sse-flow', title: 'agent-sse-flow Agent 流式可视化', description: 'React SSE 组件设计与 Agent 思考过程可视化' },
          { docId: 'ai-projects/agent-skills-system', title: 'Agent Skills 体系与 Prompt 模板库', description: '可复用的 Agent 能力单元架构设计' },
          { docId: 'ai-projects/xmind2md-mcp-development', title: 'xmind2md MCP 工具开发实战', description: 'MCP 协议实现与 XMind 转 Markdown 工具' },
          { docId: 'ai-projects/ai-coding-tools-comparison', title: 'AI 编码工具全景对比', description: 'Cursor / Claude Code / Windsurf / Copilot 深度对比' },
          { docId: 'fullstack-agent-project/smart-city-agent-multi-agent', title: 'smart-city-agent 多 Agent 协同', description: '多 Agent 强化学习与智慧城市协同决策' },
          { docId: 'fullstack-agent-project/behavior-sense-stream-processing', title: 'behavior-sense 实时流处理', description: 'Flink 实时计算与 UEBA 行为分析引擎' },
          { docId: 'fullstack-agent-project/project-review-summary', title: '项目复盘与技术总结', description: '13 个 AI Agent 项目的架构选型与踩坑经验' },
        ],
      },
    ],
  },
];

// Flatten all categories for backward compatibility
const categories = groups.flatMap((g) => g.categories);

export { categories, groups };

export default function ArticleList() {
  return (
    <div className={styles.container}>
      {groups.map((group, groupIdx) => (
        <div key={groupIdx} className={styles.groupSection}>
          <h2 className={styles.groupTitle}>{group.label}</h2>
          {group.categories.map((category, catIdx) => (
            <section key={catIdx} className={styles.categorySection}>
              <h3 className={styles.categoryTitle}>{category.label}</h3>
              <p className={styles.categoryDescription}>{category.description}</p>
              <div className={styles.grid}>
                {category.items.map((item, itemIdx) => (
                  <ArticleCard
                    key={itemIdx}
                    title={item.title}
                    description={item.description}
                    category={category.label}
                    docId={item.docId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}
