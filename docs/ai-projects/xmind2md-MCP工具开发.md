---
sidebar_position: 5
title: xmind2md MCP 工具开发实战
slug: xmind2md-mcp-development
---

# xmind2md MCP 工具开发实战

XMind 思维导图没法直接喂给 LLM 做 RAG——.xmind 文件是 ZIP 压缩包，里面是 JSON 结构，需要转换成 Markdown 才能被 AI 处理。手动解压、拷贝、转换的流程太繁琐，不如做成一个 MCP Server，让 Claude Desktop 直接调用。

## MCP 协议到底是什么

在正式进入项目之前，先花点时间搞清楚 MCP 是什么。

### 一句话解释

MCP 是 Anthropic 在 2024 年底推出的一个开放协议，目标是让 AI 模型能够以标准化的方式连接到外部工具和数据源。你可以把它理解为 AI 世界的 "USB 接口" -- 不管你的设备是什么品牌，只要插上 USB 就能通信。MCP 就是那个让 AI 模型和外部工具互相认识的通用接口。

### 协议架构

MCP 采用的是 Client-Server 架构，但这个 Client 不是你的用户界面，而是 AI 应用侧的客户端。整体流程长这样:

```
+------------------+     JSON-RPC 2.0     +------------------+
|                  | <===================> |                  |
|   AI 应用 (Host) |                       |   MCP Server     |
|   Claude Desktop |    stdio / SSE        |   (工具提供者)    |
|   Cursor, etc.   | <-------------------- |                  |
|                  |                       |   - Tools        |
|   MCP Client     |    工具调用请求        |   - Resources    |
|                  | ==================>   |   - Prompts      |
+------------------+                       +------------------+
```

关键概念:

- **MCP Host**: 启动 MCP 连接的 AI 应用，比如 Claude Desktop、Cursor 等
- **MCP Client**: Host 内部的客户端实例，负责与 MCP Server 通信
- **MCP Server**: 对外暴露 Tools、Resources、Prompts 等能力的服务进程
- **Transport**: 通信方式，支持 stdio (标准输入输出) 和 SSE (Server-Sent Events)

### MCP 的三种能力

MCP Server 可以向外提供三种类型的能力:

1. **Tools (工具)**: AI 可以调用的函数，比如读文件、查数据库、发请求。这是最常用的一种。
2. **Resources (资源)**: AI 可以读取的数据源，类似 GET 请求，只读不写。
3. **Prompts (提示词模板)**: 预定义的提示词模板，AI 客户端可以选择使用。

对于 xmind2md 这个项目，我们只需要实现 **Tools** 这种能力就够了。

### 通信流程

一次完整的工具调用流程大致如下:

```
1. AI 应用启动 -> 加载 MCP Server 配置 -> 启动 Server 进程
2. Client 与 Server 完成握手 (initialize)
3. Client 获取 Server 暴露的工具列表 (tools/list)
4. AI 模型根据用户意图决定调用哪个工具
5. Client 发送工具调用请求 (tools/call)
6. Server 执行工具逻辑，返回结果
7. Client 将结果传回 AI 模型，模型继续推理
```

整个过程基于 JSON-RPC 2.0 协议，消息都是标准的 JSON 格式，调试起来比较方便。

## 项目架构设计

搞清楚了 MCP 协议之后，接下来就是设计 xmind2md-mcp 的整体架构。

### 技术选型

- **语言**: JavaScript (Node.js)
- **MCP SDK**: `@modelcontextprotocol/sdk` (官方 SDK)
- **XMind 解析**: 自己解析 ZIP 内的 `content.json`，没用第三方库
- **进程模型**: stdio transport，单进程，无状态

### 架构图

```
+---------------------------------------------------+
|  Claude Desktop / Cursor / 其他 MCP Client        |
+---------------------------------------------------+
         |                              |
         | (stdio JSON-RPC 2.0)        |
         v                              |
+---------------------------------------------------+
|  xmind2md MCP Server (Node.js)                   |
|                                                   |
|  +-----------+    +------------------+            |
|  | Transport | -> | MCP Server 实例   |            |
|  |  (stdio)  |    |  - initialize    |            |
|  +-----------+    |  - tools/list    |            |
|                   |  - tools/call    |            |
|                   +------------------+            |
|                            |                      |
|                            v                      |
|  +-------------------------------------------+    |
|  |           Tool: xmind2md                  |    |
|  |                                            |    |
|  |  Input:  { filePath: string }              |    |
|  |                                            |    |
|  |  +----------+  +-----------+  +--------+  |    |
|  |  | ZIP 解压  |->| JSON 解析  |->| Markdown | |    |
|  |  | (unzip)  |  | content   |  | 生成     |  |    |
|  |  +----------+  +-----------+  +--------+  |    |
|  |                                            |    |
|  |  Output: { content: string }               |    |
|  +-------------------------------------------+    |
+---------------------------------------------------+
```

### 项目文件结构

```
xmind2md-mcp/
  src/
    index.js          # 入口文件，启动 MCP Server
    tools.js           # 工具定义和注册
    xmind-parser.js    # XMind 文件解析逻辑
  package.json
  README.md
```

结构非常简洁。一个文件负责启动 Server，一个文件负责解析 XMind，一个文件负责把两者串起来。

## XMind 文件解析

XMind 文件解析是整个项目最核心的部分。理解 XMind 的文件格式是第一步。

### XMind 文件结构

当你把 `.xmind` 文件后缀改成 `.zip` 然后解压，会看到这样的结构:

```
my-mindmap.xmind (ZIP)
  |-- content.json       # 核心: 思维导图的树结构数据
  |-- metadata.json      # 元数据: 版本信息等
  |-- manifest.json      # 清单文件
  |-- Thumbnails/        # 缩略图
      |-- thumbnail.png
```

我们只需要关注 `content.json`。它的结构大概是这样的:

```json
[
  {
    "id": "root-sheet",
    "class": "sheet",
    "title": "我的思维导图",
    "rootTopic": {
      "id": "topic-1",
      "class": "topic",
      "title": "中心主题",
      "structureClass": "org.xmind.ui.map.unbalanced",
      "children": {
        "attached": [
          {
            "id": "topic-2",
            "class": "topic",
            "title": "分支主题 1",
            "children": {
              "attached": [
                {
                  "id": "topic-3",
                  "class": "topic",
                  "title": "子主题 1-1"
                },
                {
                  "id": "topic-4",
                  "class": "topic",
                  "title": "子主题 1-2"
                }
              ]
            }
          },
          {
            "id": "topic-5",
            "class": "topic",
            "title": "分支主题 2"
          }
        ]
      }
    }
  }
]
```

注意几个关键点:

- 顶层是个数组，每个元素是一张 Sheet (XMind 支持多 Sheet)
- 每个 Sheet 有一个 `rootTopic`，这就是思维导图的中心节点
- 子节点在 `children.attached` 数组里
- 每个 Topic 可能有 `markers` (标记)、`labels` (标签)、`notes` (备注) 等属性

### 解析代码

下面是 `xmind-parser.js` 的完整实现:

```javascript
const unzipper = require('unzipper');
const fs = require('fs');

/**
 * 解析 XMind 文件并返回 Markdown 字符串
 * @param {string} filePath - XMind 文件的绝对路径
 * @returns {Promise<string>} 转换后的 Markdown 内容
 */
async function parseXmind(filePath) {
  // 1. 读取 ZIP 文件
  const zipBuffer = await fs.promises.readFile(filePath);

  // 2. 解压并读取 content.json
  const contentJson = await readZipFile(zipBuffer, 'content.json');
  const sheets = JSON.parse(contentJson);

  // 3. 遍历每个 Sheet，生成 Markdown
  const markdownParts = sheets.map((sheet) => {
    return convertSheetToMarkdown(sheet);
  });

  return markdownParts.join('\n\n---\n\n');
}

/**
 * 从 ZIP buffer 中读取指定文件的内容
 */
async function readZipFile(buffer, fileName) {
  const unzipperLib = require('unzipper');
  const entries = await unzipperLib.Open.buffer(buffer);
  const entry = entries.files.find((e) => e.path === fileName);

  if (!entry) {
    throw new Error(`ZIP 中未找到文件: ${fileName}`);
  }

  const content = await entry.buffer();
  return content.toString('utf-8');
}

/**
 * 将一个 Sheet 转换为 Markdown
 */
function convertSheetToMarkdown(sheet) {
  const lines = [];

  // Sheet 标题作为一级标题
  if (sheet.title) {
    lines.push(`# ${sheet.title}`);
    lines.push('');
  }

  // 从 rootTopic 开始递归转换
  if (sheet.rootTopic) {
    convertTopic(sheet.rootTopic, lines, 1);
  }

  return lines.join('\n');
}

/**
 * 递归转换 Topic 节点为 Markdown 格式
 * @param {Object} topic - XMind Topic 对象
 * @param {string[]} lines - 累积输出行
 * @param {number} depth - 当前深度 (决定标题级别)
 */
function convertTopic(topic, lines, depth) {
  // 标题级别: 1 级是 h1，其余用 h2 到 h6 封顶
  const headingLevel = Math.min(depth, 6);
  const prefix = '#'.repeat(headingLevel);

  lines.push(`${prefix} ${topic.title || '未命名主题'}`);
  lines.push('');

  // 如果有备注，作为引用块输出
  if (topic.notes && topic.notes.plain) {
    lines.push(`> ${topic.notes.plain}`);
    lines.push('');
  }

  // 如果有标签，以行内标记输出
  if (topic.labels && topic.labels.length > 0) {
    lines.push(`标签: ${topic.labels.join(', ')}`);
    lines.push('');
  }

  // 递归处理子节点
  if (topic.children && topic.children.attached) {
    const children = topic.children.attached;
    children.forEach((child) => {
      // 子节点深度 +1
      convertTopic(child, lines, depth + 1);
    });
  }
}

module.exports = { parseXmind };
```

这里有几个设计决策值得注意:

1. **深度限制**: 标题级别最多到 h6 (Markdown 标准限制)，所以用 `Math.min(depth, 6)` 做了兜底
2. **备注处理**: XMind 的 `notes.plain` 是纯文本备注，直接作为 Markdown 引用块输出
3. **标签处理**: 标签以逗号分隔的行内文本输出，保持简洁
4. **多 Sheet 支持**: 如果 XMind 文件有多个 Sheet，用分隔线隔开

## MCP Server 实现

搞定了 XMind 解析，接下来把 MCP Server 的架子搭起来。

### 初始化项目

首先创建 `package.json`:

```json
{
  "name": "xmind2md-mcp",
  "version": "1.0.0",
  "description": "MCP Server: 将 XMind 思维导图转换为 Markdown",
  "main": "src/index.js",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "unzipper": "^0.12.0"
  }
}
```

### 入口文件

`src/index.js` 负责启动 MCP Server 并注册工具:

```javascript
#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { parseXmind } = require('./xmind-parser');

// 创建 MCP Server 实例
const server = new McpServer({
  name: 'xmind2md',
  version: '1.0.0',
});

// 注册 xmind2md 工具
server.tool(
  'xmind2md',                          // 工具名称
  '将 XMind 思维导图文件转换为 Markdown 格式', // 工具描述
  {                                     // 参数 Schema (Zod)
    filePath: z.string().describe('XMind 文件的绝对路径'),
  },
  async ({ filePath }) => {
    try {
      // 调用解析器
      const markdown = await parseXmind(filePath);

      // 返回结果给 AI
      return {
        content: [
          {
            type: 'text',
            text: markdown,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `转换失败: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// 启动 Server，使用 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('xmind2md MCP Server 已启动');
}

main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});
```

这里有几个关键点:

1. **McpServer**: 这是 MCP SDK 提供的高层 API，封装了底层的 JSON-RPC 通信细节
2. **server.tool()**: 注册工具的 API，接受名称、描述、参数 Schema 和处理函数
3. **Zod Schema**: 参数验证使用了 Zod 库，MCP SDK 内部集成了它
4. **返回格式**: 工具返回的结果必须是 `{ content: [{ type: 'text', text: '...' }] }` 这个结构
5. **错误处理**: 出错时设置 `isError: true`，让 AI 知道工具调用失败了

### 注册到 Claude Desktop

要让 Claude Desktop 识别这个 MCP Server，需要在配置文件中添加入口。配置文件位置:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "xmind2md": {
      "command": "node",
      "args": ["/absolute/path/to/xmind2md-mcp/src/index.js"],
      "env": {}
    }
  }
}
```

配置完成后重启 Claude Desktop，它就会自动启动你的 MCP Server。你可以在对话中说 "帮我把桌面上的思维导图转成 Markdown"，Claude 就会调用这个工具。

## 工具注册的细节

MCP SDK 提供了两种注册工具的方式，理解它们的区别很重要。

### 方式一: 高层 API (server.tool)

就是上面例子中用的方式，简洁直观:

```javascript
server.tool('xmind2md', '描述', { filePath: z.string() }, async (params) => {
  // 处理逻辑
  return { content: [{ type: 'text', text: '结果' }] };
});
```

适合大多数场景，推荐使用。

### 方式二: 低层 API (server.setRequestHandler)

更底层的方式，直接处理 JSON-RPC 请求:

```javascript
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types');

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'xmind2md',
        description: '将 XMind 思维导图文件转换为 Markdown 格式',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'XMind 文件的绝对路径' },
          },
          required: ['filePath'],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'xmind2md') {
    const markdown = await parseXmind(args.filePath);
    return {
      content: [{ type: 'text', text: markdown }],
    };
  }
});
```

低层 API 的优势是完全控制消息格式，但在实际开发中用得不多。除非你需要做很特殊的协议定制，否则用高层 API 就够了。

### 工具描述的重要性

工具的 `description` 字段会直接展示给 AI 模型，所以写清楚很关键。写得越具体，AI 就越能准确判断什么时候该调用这个工具。

好的描述: `将 XMind (.xmind) 思维导图文件转换为 Markdown 格式。接受文件的绝对路径，返回 Markdown 字符串。`

差的描述: `转换工具。`

记住，这个描述是写给 AI 看的，不是给人看的。

## 踩过的坑

开发过程中遇到了不少问题，这里记录几个比较有代表性的。

### 坑 1: XMind 格式版本差异

**问题**: 早期的 XMind (XMind 7 及之前) 使用 XML 格式存储思维导图数据，而 XMind 8+ 切换到了 JSON 格式。如果你的工具只处理 JSON，用户传入旧版 XMind 文件时会直接报 `content.json 未找到` 的错误。

**解决**: 在解析逻辑中增加格式检测。先尝试读取 `content.json` (新版格式)，如果找不到再尝试读取 `content.xml` (旧版格式)。至少要给出清晰的错误提示，告诉用户文件格式不被支持。

```javascript
let contentJson;
try {
  contentJson = await readZipFile(zipBuffer, 'content.json');
} catch (e) {
  try {
    const contentXml = await readZipFile(zipBuffer, 'content.xml');
    throw new Error(
      '检测到旧版 XMind 格式 (XML)，当前仅支持 XMind 8+ 的 JSON 格式'
    );
  } catch (xmlError) {
    throw new Error('XMind 文件格式无法识别，确认文件未损坏且为 XMind 8+ 版本');
  }
}
```

### 坑 2: 文件路径的安全性

**问题**: MCP Server 接收的是用户提供的文件路径，这意味着理论上可以读取系统上的任意文件。虽然 MCP 本身有权限控制，但在工具层面也应该做基本校验。

**解决**: 在工具处理函数中校验文件路径:

```javascript
const path = require('path');
const fs = require('fs');

function validateFilePath(filePath) {
  // 1. 必须是绝对路径
  if (!path.isAbsolute(filePath)) {
    throw new Error('请提供文件的绝对路径');
  }

  // 2. 必须是 .xmind 后缀
  if (!filePath.toLowerCase().endsWith('.xmind')) {
    throw new Error('仅支持 .xmind 格式的文件');
  }

  // 3. 文件必须存在
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  // 4. 文件不能太大 (防止内存溢出)
  const stats = fs.statSync(filePath);
  if (stats.size > 50 * 1024 * 1024) {
    throw new Error('文件过大，不支持超过 50MB 的 XMind 文件');
  }
}
```

### 坑 3: 空节点和特殊字符

**问题**: XMind 中可以创建空标题的节点 (标题为空字符串或 undefined)，还有一些特殊字符 (比如换行符、emoji) 在 Markdown 渲染时会出问题。

**解决**: 在生成 Markdown 之前做文本清理:

```javascript
function cleanTitle(title) {
  if (!title || title.trim() === '') {
    return '未命名主题';
  }
  // 移除控制字符，但保留换行
  return title.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}
```

### 坑 4: MCP Server 进程生命周期

**问题**: 在开发调试时，MCP Server 进程有时候不会正常退出，导致端口占用或者调试信息残留在终端。

**解决**: 确保监听了 `process` 的退出信号:

```javascript
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// 未捕获的异常也要优雅退出
process.on('uncaughtException', (error) => {
  console.error('未捕获异常:', error);
  process.exit(1);
});
```

### 坑 5: unzipper 库的内存问题

**问题**: 用 `unzipper` 解压大文件时，默认会把整个内容加载到内存中。如果 XMind 文件里嵌入了大量图片附件，内存占用会暴增。

**解决**: 对于纯文本思维导图 (没有嵌入图片)，可以直接用 Node.js 内置的 `zlib` 模块配合 `tar` 来处理，或者在解压前先检查 ZIP 内容大小，对超大文件给出警告。实际项目中大多数思维导图不会有太多嵌入媒体，所以这个坑的触发概率不高，但了解一下没有坏处。

## 总结

`xmind2md-mcp` 这个项目不大，代码量也不多，但它完整地走通了 MCP 工具开发的全流程: 理解协议、设计架构、解析数据格式、注册工具、处理边界情况。

对于前端开发者转型 AI 方向来说，MCP 是一个非常好的切入点。你不需要去研究大模型的底层原理，只需要思考: **AI 在什么场景下需要一个工具? 这个工具该提供什么能力? 怎么把能力描述清楚让 AI 能正确调用?** 这些问题的答案，恰恰是前端开发者擅长的产品思维和工程实践的结合。

如果你也有类似的需求 -- 某个重复性操作想让 AI 帮你做 -- 不妨试试写一个 MCP Server。从一个最简单的工具开始，比如读取一个文件、查询一个 API，你会发现整个过程比想象中简单，而且很有成就感。

## 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP 规范 (Specification)](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Anthropic MCP 博客文章](https://www.anthropic.com/news/model-context-protocol)
- [XMind 文件格式说明](https://support.xmind.net/hc/zh-cn/articles/360011408332-XMind-%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)
