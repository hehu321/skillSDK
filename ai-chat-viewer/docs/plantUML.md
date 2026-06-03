Searched web: "plantuml javascript frontend rendering OR wasm"
Searched web: "plantuml-wasm OR plantuml.js OR @plantuml"
Searched web: "plantuml.js github repository"
Searched web: "site:github.com/plantuml/plantuml.js readme OR setup OR installation"
Searched web: "plantuml client side OR browser OR wasm OR webassembly OR teaVM"
Searched web: "plantuml-wasm OR plantuml-teavm OR "plantuml" OR "plantuml-js""

针对你的问题：“**PlantUML 只能服务端实现吗，前端没有三方包可以实现吗？**” 

简而言之：**不是只能在服务端实现，纯前端（浏览器端）渲染在技术上是可行的，但由于其技术架构的限制，在实际生产（特别是移动端/H5/轻量级 SDK）中非常不推荐。** 

目前业内主流的做法依然是 **“前端压缩编码 + 服务端/私有服务渲染”**。

以下是具体的原理分析、方案对比以及针对我们当前项目的建议：

---

### 一、 为什么纯前端渲染 PlantUML 非常困难？

PlantUML 的底层设计与 Mermaid 这种原生 JavaScript 编写的库有本质不同：
1. **语言依赖**：PlantUML 是用 **Java** 编写的。
2. **排版引擎依赖**：PlantUML 强依赖 **Graphviz**（用 C/C++ 编写）来进行图表布局计算（时序图除外）。

要在浏览器中纯前端运行 PlantUML，必须：
* 用 **TeaVM** 或 **CheerpJ** 这类工具将 Java 字节码转译为 JavaScript (`plantuml.js`)。
* 用 **WebAssembly (WASM)** 编译一份 Graphviz (`viz-global.js`) 运行在浏览器中。

这导致了两个致命的缺点：
1. **体积极其臃肿**：转译后的 JS 和 WASM 文件体积通常在 **10MB ~ 20MB** 以上。对于网页或 UMD 库来说，这个体积是不可接受的。
2. **性能与兼容性差**：在 JS 中模拟 JVM 运行非常消耗 CPU 和内存，渲染复杂图表时极易导致浏览器卡顿甚至假死，必须依赖 Web Worker 异步执行。
3. **缺乏官方维护的 npm 包**：曾经的 `plantuml.js` 库已停止维护。虽然可以通过 PlantUML 官方源码自行编译出浏览器产物，但没有像 `mermaid` 那样开箱即用、轻量且维护良好的 npm 包。

---

### 二、 两种主流的实现方案对比

#### 方案 1：前端轻量编码 + 渲染服务（推荐，95% 场景使用）
这是目前 GitLab、各 Markdown 编辑器等最常用的方案。

* **实现原理**：
  1. 前端安装一个非常轻量（仅几 KB）的 npm 包：[`plantuml-encoder`](https://www.npmjs.com/package/plantuml-encoder)。
  2. 前端用这个包将 PlantUML 文本压缩并转换为一串自定义的 base64 字符。
  3. 将字符拼接到 PlantUML 渲染服务的接口地址上（例如官方的：`http://www.plantuml.com/plantuml/svg/{encoded_string}`）。
  4. 前端直接用一个普通的 `<img>` 标签展示该 URL 即可。
* **代码示例**：
  ```javascript
  import plantumlEncoder from 'plantuml-encoder';

  const umlCode = 'A -> B: Hello';
  const encoded = plantumlEncoder.encode(umlCode);
  const imageUrl = `https://www.plantuml.com/plantuml/svg/${encoded}`;
  
  // 在前端直接渲染：<img src={imageUrl} alt="UML Diagram" />
  ```
* **优点**：前端极其轻量；加载速度极快；渲染准确度 100%。
* **缺点**：依赖网络请求。如果是敏感数据，直接请求公网官方服务器会有隐私泄露风险（企业通常需要**私有化部署**一个 PlantUML Server，用 Docker 部署非常简单，不占用主业务服务的算力）。

#### 方案 2：静态资源 CDN + WebAssembly（纯前端单机运行）
如果绝对不能有任何后端服务参与，必须完全离线运行，可以采用此方案。

* **实现原理**：
  1. 从 PlantUML 官方仓库下载源码，使用 `./gradlew teavm` 编译出浏览器所需的 `plantuml.js` 和 `viz-global.js` 静态资源。
  2. 将这两个巨大的文件放在 CDN 上，在前端代码中通过 `<script>` 标签或动态 `import` 异步加载它们。
  3. 通过其暴露的 JS API 在前端解析和生成 SVG。
* **优点**：100% 纯前端运行，无需任何服务器，隐私性极高，支持离线。
* **缺点**：首屏加载极慢（要下载十多兆的 JS/WASM），运行开销大，集成难度高。

---

### 三、 针对我们当前项目的建议

由于我们正在设计的 `ai-chat-viewer` 项目：
* 是一个需要打包成 UMD/PC/移动端的多端适配 SDK；
* 对包体积（Bundle Size）和首屏加载速度有极高要求；
* 需要在 Webpack 中进行 ES5 兼容转译。

因此：
1. **如果只是为了画图，强烈建议优先使用 Mermaid**：
   * Mermaid 是原生 JS 开发，包体积小（Gzip 后 1M 左右），完全在前端渲染，非常契合我们目前的 Markdown 渲染设计方案。
2. **如果必须支持 PlantUML**：
   * **不要尝试纯前端渲染**。
   * 建议采用 **方案 1（前端编码 + 渲染服务）**。如果项目用于企业内网，只需在内网私有化部署一个 PlantUML 的 Docker 镜像，然后在前端配置对应的 `PLANTUML_SERVER_URL`，即可安全、轻量地实现 PlantUML 图表渲染。