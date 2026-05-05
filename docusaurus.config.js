// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'jojo 的技术空间',
  tagline: '🤖 AI Agent 开发者 · 技术探索者',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://afine907.github.io',
  baseUrl: '/afine907-wiki/',
  organizationName: 'afine907',
  projectName: 'afine907-wiki',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/', // docs 作为首页
        },
        blog: false, // 禁用 blog
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  plugins: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        indexDocs: true,
        indexBlog: false,
        language: ['zh', 'en'],
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      breadcrumbs: true,
      docs: {
        sidebar: {
          autoCollapseCategories: true,
          hideable: true,
        },
      },
      announcementBar: {
        id: 'welcome',
        content: '欢迎来到 jojo 的技术空间 — AI Agent 架构设计与工程实践',
        backgroundColor: 'var(--ifm-color-primary)',
        textColor: '#fff',
        isCloseable: true,
      },
      metadata: [
        { name: 'keywords', content: 'AI Agent, LangGraph, LLM, 架构设计, 工程实践' },
        { name: 'author', content: 'jojo' },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'zh_CN' },
      ],
      navbar: {
        title: 'jojo 的技术空间',
        logo: {
          alt: 'jojo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'aiSidebar',
            label: '🤖 AI / LLM',
            position: 'left',
          },
          {
            href: 'https://github.com/afine907',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: '文档',
            items: [
              {
                label: 'AI Native Pipeline 系列',
                to: '/ai-native-pipeline/pipeline-design',
              },
            ],
          },
          {
            title: '社区',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/afine907',
              },
            ],
          },
        ],
        copyright: `MIT © 2024-2026 jojo`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['python', 'typescript', 'bash', 'json', 'yaml', 'markdown'],
        showLineNumbers: true,
      },
    }),
};

export default config;
