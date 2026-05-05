// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  aiSidebar: [
    {
      type: 'category',
      label: '🚀 AI Native Pipeline 系列',
      link: {
        type: 'generated-index',
        description: '从需求到代码的全自动开发流水线',
      },
      items: [
        'ai-native-pipeline/AI-Native-Pipeline-设计实践',
        'ai-native-pipeline/AI-Native-Pipeline-踩坑实录',
        'ai-native-pipeline/Agent-效果评估实战',
      ],
    },
    {
      type: 'category',
      label: '🏗️ Agent 架构设计',
      link: {
        type: 'generated-index',
        description: 'Agent 核心架构与设计模式',
      },
      items: [
        'agent-architecture/AI-Agent-长期记忆管理实现',
        'agent-architecture/Agent-Tool-Permission-Design',
        'agent-architecture/jojo-code-核心架构解析',
        'agent-architecture/Agent-多Agent协作指南',
        'agent-architecture/Agent-记忆系统设计',
      ],
    },
    {
      type: 'category',
      label: '⚙️ 工程实践',
      link: {
        type: 'generated-index',
        description: 'Agent 开发工程实践',
      },
      items: [
        'agent-engineering/LangGraph-Agent-编排实战',
        'agent-engineering/Agent-状态管理设计',
        'agent-engineering/llm-context-window-management',
        'agent-engineering/Agent-MCP实战指南',
        'agent-engineering/Agent-Prompt设计指南',
        'agent-engineering/Agent-工具开发指南',
        'agent-engineering/Agent-测试指南',
      ],
    },
    {
      type: 'category',
      label: '⚡ 进阶能力',
      link: {
        type: 'generated-index',
        description: 'Agent 进阶开发能力',
      },
      items: [
        'agent-advanced/Agent-流式响应实现',
        'agent-advanced/Agent-错误处理与重试机制',
        'agent-advanced/Agent-性能监控与调优',
        'agent-advanced/Agent-自我进化机制',
      ],
    },
    {
      type: 'category',
      label: '🏛️ 架构师视角',
      link: {
        type: 'generated-index',
        description: 'Agent 架构师级别的技术深度',
      },
      items: [
        'agent-architecture-level/Agent-安全威胁与防御策略',
        'agent-architecture-level/Agent-多模型降级策略',
        'agent-architecture-level/typescript-python-architecture-practice',
      ],
    },
    {
      type: 'category',
      label: '🎯 实战项目',
      link: {
        type: 'generated-index',
        description: 'Agent 实战项目开发',
      },
      items: [
        'agent-projects/Agent-实战项目开发',
      ],
    },
    {
      type: 'category',
      label: '🚢 运维部署',
      link: {
        type: 'generated-index',
        description: 'Agent 部署与运维',
      },
      items: [
        'agent-ops/Agent-部署上线指南',
      ],
    },
    {
      type: 'category',
      label: '📊 框架对比',
      link: {
        type: 'generated-index',
        description: '主流 Agent 框架对比评测',
      },
      items: [
        'agent-framework/主流-Agent-框架对比评测',
      ],
    },
    {
      type: 'category',
      label: '📚 RAG 知识库构建',
      link: {
        type: 'generated-index',
        description: 'RAG 系统架构、向量数据库、Embedding 选型与评估优化',
      },
      items: [
        'rag/RAG-系统架构设计',
        'rag/向量数据库选型实战',
        'rag/Embedding模型选型与微调',
        'rag/Chunking策略深度解析',
        'rag/RAG评估与优化',
      ],
    },
    {
      type: 'category',
      label: '🔌 LLM API 集成实战',
      link: {
        type: 'generated-index',
        description: '多 LLM 统一接入、Prompt 工程、输出结构化与成本优化',
      },
      items: [
        'llm-integration/多LLM-API统一接入',
        'llm-integration/Prompt工程进阶',
        'llm-integration/LLM输出结构化',
        'llm-integration/Token管理与成本优化',
      ],
    },
    {
      type: 'category',
      label: '🚀 AI 项目实战沉淀',
      link: {
        type: 'generated-index',
        description: 'GitHub AI 项目的架构解析与实战经验',
      },
      items: [
        'ai-projects/jojo-code-Coding-Agent实战',
        'ai-projects/agent-sse-flow流式可视化',
        'ai-projects/Agent-Skills体系设计',
        'ai-projects/xmind2md-MCP工具开发',
        'ai-projects/AI编码工具全景对比',
      ],
    },
    {
      type: 'category',
      label: '🖥️ Agent 前端交互',
      link: {
        type: 'generated-index',
        description: 'Agent UI 设计、SSE 流式渲染、Generative UI 与可视化调试',
      },
      items: [
        'agent-frontend/Agent-SSE流式可视化组件',
        'agent-frontend/Agent对话UI设计与实现',
        'agent-frontend/Generative-UI实践',
        'agent-frontend/Agent可视化调试面板',
      ],
    },
    {
      type: 'category',
      label: '🛠️ 前端工程化',
      link: {
        type: 'generated-index',
        description: '前端监控、微前端架构与自动化测试',
      },
      items: [
        'frontend-engineering/前端监控体系设计',
        'frontend-engineering/微前端架构实践',
        'frontend-engineering/前端自动化测试',
      ],
    },
    {
      type: 'category',
      label: '🐍 Python 后端实践',
      link: {
        type: 'generated-index',
        description: 'FastAPI 服务、异步编程、数据库设计与代码质量',
      },
      items: [
        'backend-python/FastAPI-LangChain实战',
        'backend-python/异步编程与并发模型',
        'backend-python/数据库设计与ORM',
        'backend-python/Python类型系统与代码质量',
      ],
    },
    {
      type: 'category',
      label: '☁️ 云原生部署',
      link: {
        type: 'generated-index',
        description: 'Docker 容器化、K8s 部署、CI/CD 与监控告警',
      },
      items: [
        'cloud-native/Docker容器化实战',
        'cloud-native/K8s部署Agent服务',
        'cloud-native/CICD流水线设计',
        'cloud-native/监控告警体系',
        'cloud-native/生产环境最佳实践',
      ],
    },
    {
      type: 'category',
      label: '🌐 全栈 Agent 项目实战',
      link: {
        type: 'generated-index',
        description: '多 Agent 协同、实时流处理与面试表达',
      },
      items: [
        'fullstack-agent-project/smart-city-agent多Agent协同',
        'fullstack-agent-project/behavior-sense实时流处理',
        'fullstack-agent-project/项目复盘与面试表达',
      ],
    },
  ],
};

export default sidebars;
