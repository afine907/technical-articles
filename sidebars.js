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
  ],
};

export default sidebars;
