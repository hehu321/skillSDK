Searched web: "mermaid version 10 11 breaking changes release notes"
Searched web: "mermaid v9 vs v11 differences OR breaking changes OR migration"
Searched web: "mermaid breaking changes v10 OR v11 render async ESM"

从 **Mermaid 9.4.3** 到 **11.15.0**，该库经历了两代大版本（v10 和 v11）的重构，发生了很多颠覆性的变化。以下是它们的核心区别分析，主要分为**构建与模块系统**、**API 调用方式**、**语法与图表功能**、**渲染引擎**四个维度：

---

### 1. 核心对比一览表

| 对比维度 | Mermaid 9.4.3 (旧版本) | Mermaid 11.15.0 (最新版本) |
| :--- | :--- | :--- |
| **模块格式** | 支持 CommonJS / UMD（提供 `mermaid.min.js`） | **仅支持 Native ESM**（只提供 `.esm.min.mjs`） |
| **构建兼容性** | 极佳，可轻易打包进 ES5/UMD 库和老旧 Webpack | 较差，需要现代构建工具（Vite/webpack5）或特殊 ESM 转译配置 |
| **`render` API**| 同步/回调形式，直接返回 SVG 字符串 | **完全异步 (Async)**，返回 `Promise<{ svg, bindFunctions }>` |
| **DOM 挂载 API**| 使用 `mermaid.init()` | `mermaid.init()` 已废弃，改用更可控的 `mermaid.run()` |
| **图表布局算法** | 主要依赖 Dagre 布局引擎 | 引入了更先进的 **ELK 布局算法**，支持更优的自动排版 |
| **标签 Markdown**| 不支持或仅部分支持 Markdown 语法标签 | 支持标准 Markdown 标签（v11.13.0 起默认关闭，需用 `["\`code\`"]` 语法启用） |

---

### 2. 详细区别分析

#### 2.1 模块系统与打包体积（对我们项目的关键影响）
*   **Mermaid 9.4.3**：提供了打包好的 UMD 格式单文件（`dist/mermaid.min.js`）。这意味着它可以直接作为 script 引入，并且在不支持 ESM 的旧工程（比如我们的 ES5 构建环境）中，可以通过简单的别名（alias）直接使用。
*   **Mermaid 11.15.0**：彻底放弃了 CJS/UMD 格式，转向 **ESM-Only**。如果你在打包目标为 ES5 的 Webpack 工程里直接引入 11.15.0，会面临大量的 ESM 语法报错（如 `import/export` 无法解析），必须配置复杂的 `babel-loader` 或 `TRANSPILE_DEPENDENCIES` 进行彻底的二次编译。

#### 2.2 API 的异步化重构
*   在 **9.4.3** 中，渲染的核心调用是同步的（或支持回调）：
    ```javascript
    const svgCode = mermaid.render('id', code); // 同步返回
    ```
*   在 **11.15.0** 中，为了不阻塞浏览器主线程并配合 ESM 动态加载，`render` 被重构为了**强异步方法**：
    ```javascript
    const { svg, bindFunctions } = await mermaid.render('id', code);
    ```
    *这导致在前端集成时，所有包装组件（如 React 中的渲染组件）必须用异步状态机（`useState` + `useEffect`）来处理渲染结果，否则会报错。*

#### 2.3 标签的 Markdown 解析器变动
*   在 11.0.0 早期版本中，Mermaid 默认将所有 Flowchart 节点标签当作 Markdown 解析，导致历史图表中的换行符 `\n` 或特殊字符直接失效，引起了大范围的渲染崩溃。
*   在 **11.15.0** 中，官方修复了这一设计（自 11.13.0 起恢复）。默认情况下标签依然是普通文本，如果开发者需要使用加粗、斜体等 Markdown 样式，必须显式地使用 **双引号+反引号** 语法：
    ```markdown
    %% 11.15.0 中显式开启 Markdown 标签
    flowchart TD
        A["`This is **bold** text`"]
    ```

#### 2.4 新增的图表类型
11.15.0 相比 9.4.3 增加了大量新型图表，AI 输出这些图表的概率也越来越高：
*   **思维导图 (Mindmap)**：11.x 中已原生稳定。
*   **象限图 (Quadrant Chart)**：用于做四象限分析。
*   **桑基图 (Sankey)**：用于数据流向分析。
*   **XY 折线/柱状图 (XY Chart)**：基础数据图表。
*   **网络拓扑图 (Block Diagram)**。
*   **架构图 (Architecture Diagram)**：可绘制 AWS/GCP 等云架构。
*   **数据包结构图 (Packet Diagram)**：用于展示网络协议包结构。

#### 2.5 运行时环境要求
*   **9.4.3**：兼容性极强，可以在较旧的浏览器和较老的 Node.js（Node 14+）中运行。
*   **11.15.0**：由于使用了较新的 JS 语法特性和部分 WebAssembly，它要求 Node.js 18+ 以及现代常青浏览器（Chrome, Firefox, Safari 等较新版本）。

---

### 3. 总结与建议

*   **对于我们当前的项目 (`ai-chat-viewer`)**：
    当前项目的 Webpack 构建目标是 **ES5**，且需要输出为 UMD 库供其他团队消费。在这个技术约束下，**锁定 `mermaid@9.4.3` 是目前最稳妥的选择**。它能通过 `mermaid/dist/mermaid.min.js` 别名配置完美融入 ES5 链路，不需要引入复杂的 ESM 转译。
*   **未来升级展望**：
    如果未来项目整体升级为现代前端架构（例如打包目标升为 ES2022+，全面改用 Vite 或 Webpack 5 现代模式），可以考虑升级至 11.15.0，以获得更美观的默认样式、更强大的 ELK 排版引擎以及对 Mindmap、架构图等新图表的支持。