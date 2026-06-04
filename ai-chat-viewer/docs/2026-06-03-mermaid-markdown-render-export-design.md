# Mermaid Markdown 渲染与图片导出技术方案

- 方案日期：`2026-06-03`
- 目标工程：`ai-chat-viewer`
- 方案类型：`前端渲染能力增强`
- 参考文档：
  - [`docs/weAgentCUI-ai-reply-rendering.md`](./weAgentCUI-ai-reply-rendering.md)
  - [`AGENTS.md`](../AGENTS.md)
  - [Mermaid GitHub Repository](https://github.com/mermaid-js/mermaid)
  - [Mermaid MIT License](https://github.com/mermaid-js/mermaid/blob/develop/LICENSE)
  - [Mermaid Usage](https://mermaid.js.org/config/usage)

## 1. 背景

### 1.1 场景说明

当前 `ai-chat-viewer` 已支持通过 `react-markdown` 渲染 Markdown 文本、代码块、表格和公式。AI 回复中可能输出如下 Mermaid 代码块：

````markdown
```mermaid
sequenceDiagram
  用户->>AI: 发起请求
  AI->>工具: 调用工具
  工具-->>AI: 返回结果
  AI-->>用户: 输出答案
```
````

现状中该内容会被当作普通代码块展示，无法看到流程图、时序图等可视化结果。后续需要在聊天消息、工具输出等 Markdown 场景中自动识别 Mermaid 语法，只展示图表结果和必要状态，不展示 Mermaid 源码，并在 PC 端支持把图表导出为图片。

同时 AI 回复存在流式输出场景，Mermaid 代码块在输出过程中可能处于不完整状态。如果边输出边渲染，会导致频繁解析失败、页面抖动和性能浪费，因此需要对流式过程做稳定态渲染控制。

### 1.2 需求目标

1. 支持 Markdown fenced code block 中的 `mermaid` 语法渲染为图表。
2. Mermaid 展示结构采用“标题栏 + 图表区”，去掉源码区，不展示 Mermaid 原始代码。
3. 渲染成功后，图表在图表区内按容器尺寸等比缩小并完整展示，不依赖用户缩放、拖拽或滚动查看。
4. 流式输出期间不触发 Mermaid 渲染，内容稳定后再渲染；流式期间展示 loading 效果和生成中文案，提示用户图表正在生成。
5. 渲染失败时显示图片加文本提示：`图表生成有问题，请重新提问试试`，并支持国际化。
6. 仅 PC 端支持导出图片；非 PC 端不显示“导出图片”按钮。
7. 图片下载方法以参数形式注入，组件只负责生成图片文件流和文件大小，不内置下载或兜底下载逻辑。
8. 未传下载方法或传入方法不是函数时，通过 toast 提示用户当前环境不支持导出。
9. PC 默认下载方法通过 Pedestal 获取默认保存目录、打开系统保存文件弹窗，并通过 `window.require('fs')` 写入用户确认的文件路径。
10. 缺少 PC 下载能力时提示当前环境不支持导出；保存弹窗或文件写入失败时提示导出失败；用户取消保存不提示失败。
11. Mermaid.js 采用本地 npm 包接入，不依赖远程服务；v1 使用 Mermaid 当前最新版本，并通过 Webpack/Babel 对 ES5 设备做转译适配。本轮复核 npm latest 为 `mermaid@11.15.0`。

### 1.3 非目标

1. 不新增后端接口，不改 `StreamMessage`、`SessionMessage`、`MessagePart` 协议结构。
2. 不实现 Mermaid 在线编辑器、图表语法补全、手动缩放、拖拽平移、缩放小地图、PDF 导出。
3. 首期只生成 PNG 图片文件流，不导出 SVG/PDF。
4. 不接入 Mermaid Chart 等商业托管服务。
5. 不在渲染失败态向普通用户展示 Mermaid 原始错误堆栈。
6. 不为移动端、H5 WebView 提供导出入口；PC 端下载能力由外部传入方法处理。
7. 不内置 `<a download>`、打开图片 URL、长按保存等下载兜底逻辑。
8. v1 不做 Mermaid 图表暗黑主题自适配。是否使用动态 `import()`、独立拆包或外部挂载 Mermaid，需要结合 7.4 的包体与 ES5 验证结果单独决策。

## 2. 方案图

### 2.1 整体方案图

```mermaid
flowchart TD
    A["AI 回复 Markdown 内容"] --> B["ReactMarkdown 解析"]
    B --> C{"code block language"}
    C -->|"mermaid"| D["MermaidBlock"]
    C -->|"其他语言"| E["CodeBlock"]
    D --> F{"是否流式中"}
    F -->|"是"| G["展示 loading + 生成中文案<br/>不渲染图表<br/>不显示导出按钮"]
    F -->|"否"| H["调用 Mermaid render 生成 SVG"]
    H --> I{"渲染结果"}
    I -->|"成功"| J["按图表区等比缩放<br/>完整展示 SVG 图表"]
    I -->|"失败"| K["展示图片提示 + 国际化文案<br/>隐藏导出按钮"]
    J --> O{"是否 PC 端"}
    O -->|"是"| L["展示导出图片按钮"]
    O -->|"否"| P["隐藏导出图片按钮"]
    L --> M["点击后生成 PNG 文件流和文件大小"]
    M --> N["调用注入的 downloadImage(payload)"]
```

### 2.2 方案核心

核心方案是在现有 Markdown code renderer 层拦截 `language-mermaid`，将其路由到新的 `MermaidBlock`。`MermaidBlock` 负责流式 loading、稳定态渲染、图表区内等比缩小完整展示、失败态提示和 PC 端导出按钮；源码不展示。导出时组件生成 PNG 图片文件流和文件大小，真正的下载动作完全交给外部注入的 `downloadImage` 方法。

## 3. 时序图

### 3.1 流式消息渲染时序

```mermaid
sequenceDiagram
    participant Server as 服务端/宿主
    participant Hook as useChatSession
    participant Bubble as MessageBubble
    participant MD as ReactMarkdown
    participant MermaidBlock as MermaidBlock
    participant Mermaid as Mermaid.js

    Server->>Hook: text.delta
    Hook->>Bubble: 更新 message/part isStreaming=true
    Bubble->>MD: 渲染 Markdown
    MD->>MermaidBlock: 渲染 language-mermaid
    MermaidBlock-->>MermaidBlock: 展示 loading + 生成中文案
    Note over MermaidBlock,Mermaid: 流式中不调用 mermaid.render

    Server->>Hook: text.done 或 session.status=idle
    Hook->>Bubble: 更新 message/part isStreaming=false
    Bubble->>MD: 重新渲染 Markdown
    MD->>MermaidBlock: 渲染稳定 Mermaid 内容
    MermaidBlock->>Mermaid: render(id, code)
    Mermaid-->>MermaidBlock: SVG 或错误
    MermaidBlock-->>Bubble: 成功显示图表；失败显示提示态
```

### 3.2 图片导出时序

```mermaid
sequenceDiagram
    participant User as 用户
    participant Block as MermaidBlock
    participant Converter as SVG 转 PNG
    participant Downloader as downloadImage 参数
    participant Pedestal as Pedestal PC 能力
    participant Dialog as 系统保存弹窗
    participant Fs as Node fs
    participant Toast as showToast

    Block->>Block: 根据 isPc 和渲染结果决定是否展示导出按钮
    alt 非 PC 端
        Block-->>User: 不展示导出按钮
    else PC 端
        User->>Block: 点击导出图片
        Block->>Block: 校验 downloadImage 是否为函数
        alt 未传或类型错误
            Block->>Toast: showToast(t("mermaid.exportUnsupported"))
        else 方法有效
            Block->>Converter: svgToPngBlob(svg)
            Converter-->>Block: { fileStream, fileSize }
            Block->>Downloader: downloadImage({ fileStream, fileSize, filename, mimeType, diagramId })
            Downloader->>Downloader: 校验 Pedestal/dialog/window.require/fs 能力
            alt 缺少 PC 下载能力
                Downloader-->>Block: reject unsupported
                Block->>Toast: showToast(t("mermaid.exportUnsupported"))
            else PC 下载能力可用
                Downloader->>Pedestal: getLocalSettingInfo()
                Pedestal-->>Downloader: { fileDownloadFolderAddress }
                Downloader->>Dialog: showSaveDialog({ filters, defaultPath })
                Dialog-->>Downloader: { canceled, filePath }
                alt 用户取消保存
                    Downloader-->>Block: resolve
                else 用户确认路径
                    alt dialog/fs 任一失败
                        Downloader-->>Block: reject
                        Block->>Toast: showToast(t("mermaid.exportFailed"))
                    else 写入文件
                        Downloader->>Fs: writeFile(filePath, fileStream bytes)
                        Fs-->>Downloader: success
                        Downloader-->>Block: resolve
                    end
                end
            end
        end
    end
```

## 4. 技术细节

### 4.1 调整点

1. 新增 `MermaidBlock` 组件，负责 Mermaid 流式 loading、图表展示、失败态和 PC 端导出入口。
2. 新增 Mermaid 导出转换工具，仅负责 SVG 转 PNG 图片文件流，不负责下载。
3. 新增 PC 文件下载公共方法，基于 Pedestal 保存弹窗和 `window.require('fs')` 写入文件，供 Mermaid 导出或后续其他 PC 下载场景复用。
4. 扩展 `createMarkdownComponents`，识别 `language-mermaid`。
5. 新增 `MarkdownRuntimeConfigContext`，由 `MessageBubble`、`ToolCard` 通过 Provider 注入 `isStreaming`、`isPc` 与 `downloadImage`，避免动态重建 `ReactMarkdown components`。
6. 新增 Mermaid 相关 i18n 文案。
7. 新增 Mermaid 样式文件，复用现有 `CodeBlock` 的标题栏、折叠、按钮和暗黑模式设计语言，但不展示源码区。
8. 流式 loading 优先复用现有三点 pulse 效果；如果现有样式作用域无法直接复用，则在 `MermaidBlock` 样式中新增命名空间内的三点 loading，视觉效果与现有 `.loading-dot` 保持一致。
9. `package.json` 增加 Mermaid 当前最新版本依赖。本轮复核为 `mermaid@11.15.0`，实施时再次执行 `npm view mermaid version` 确认最新精确版本。
10. `webpack.shared.js` 扩展依赖转译机制，支持 Mermaid ESM 包及其主要依赖族进入 Babel 转译。
11. Mermaid 加载策略需要在实施前单独确认。若继续采用最新版 Mermaid，7.4 的验证结果表明静态 import 风险较高，应优先评估动态 `import()`、独立拆包、外部挂载或按图表类型裁剪能力；如果仍选择静态 import，必须通过包体预算和最终 ES5 产物检查。

### 4.2 核心实现方式

#### 4.2.1 组件结构

`MermaidBlock` 结构如下：

```tsx
<div className="mermaid-block">
  <div className="mermaid-block__header">
    <button className="mermaid-block__toggle">mermaid + arrow</button>
    <div className="mermaid-block__actions">
      {isPc && renderSuccess ? <button>{t('mermaid.exportImage')}</button> : null}
    </div>
  </div>
  {!collapsed ? (
    <div className="mermaid-block__preview">
      {isStreaming ? <MermaidLoading /> : renderSuccess ? svg : failureState}
    </div>
  ) : null}
</div>
```

图表区在标题栏下方展示，固定白底并居中展示图表。组件内部仍保留 Mermaid 原始字符串用于渲染，但不在 UI 上展示源码，也不提供源码复制按钮。

图表自适应完整展示规则：

1. Mermaid 渲染成功后，读取 SVG `viewBox`；如果缺失 `viewBox`，再读取 SVG `width` / `height` 或 `getBBox()` 结果作为图表原始尺寸。
2. 图表区保留稳定 `min-height: 160px`，最大可用高度按 `min(500px, 60vh)` 计算，避免 loading 切换到最终图表时撑爆聊天界面。
3. 根据图表区可用宽度、最大可用高度和 SVG 原始尺寸计算等比缩放比例：`scale = min(containerWidth / svgWidth, maxPreviewHeight / svgHeight, 1)`。
4. 默认只对超出图表区的图表做等比缩小，小图不强制放大，展示时保持居中。
5. 预览缩放只影响 UI 展示层，不修改 Mermaid 渲染产物，也不影响导出时使用的原始 SVG 尺寸。
6. v1 不提供手动缩放、滚轮缩放、双指缩放、拖拽平移、小地图等交互能力，也不把横向或纵向滚动作为大图查看方式。

`MermaidLoading` 设计：

1. 优先抽取并复用 `Content.less` 中 `.loading-dot` 的三点 pulse 动画，形成可在 Mermaid 卡片内使用的轻量 loading。
2. 若现有 `.loading-dot` 强依赖页面作用域，则新增 `.mermaid-block__loading`、`.mermaid-block__loading-dot`、`.mermaid-block__loading-text`，动画参数与现有 `loading-pulse` 保持一致。
3. 文案使用 `t('mermaid.rendering')`，中文为 `图表生成中...`，英文为 `Generating chart...`。
4. loading 只出现在 `isStreaming=true` 的 Mermaid 图表区，不展示导出按钮，也不调用 `mermaid.render()`。

#### 4.2.2 Markdown 运行时配置

`createMarkdownComponents(true)` 必须保持静态引用，不接收 `isStreaming`、`isPc`、`downloadImage` 等动态参数。原因是 `ReactMarkdown` 的 `components` 引用变化会导致内部 Markdown 渲染器整体重挂载，在流式场景中可能造成卡顿、闪烁和用户选择态丢失。

新增轻量 Context 传递 Mermaid 运行时配置：

```ts
export interface MermaidDownloadImagePayload {
  fileStream: Blob;
  fileSize: number;
  filename: string;
  mimeType: 'image/png';
  diagramId: string;
}

export type MermaidDownloadImageHandler = (
  payload: MermaidDownloadImagePayload,
) => Promise<void> | void;

export interface MarkdownRuntimeConfig {
  isStreaming?: boolean;
  isPc?: boolean;
  downloadImage?: MermaidDownloadImageHandler;
}

export const MarkdownRuntimeConfigContext = React.createContext<MarkdownRuntimeConfig>({});
```

使用方式：

```tsx
const markdownComponents = useMemo(() => createMarkdownComponents(true), []);
const runtimeConfig = useMemo(
  () => ({ isStreaming, isPc, downloadImage }),
  [isStreaming, isPc, downloadImage],
);

<MarkdownRuntimeConfigContext.Provider value={runtimeConfig}>
  <ReactMarkdown components={markdownComponents}>
    {normalizeMarkdownHtml(content)}
  </ReactMarkdown>
</MarkdownRuntimeConfigContext.Provider>
```

兼容与约束：

1. `createMarkdownComponents(true)` 继续等价于 `{ includeCodeBlock: true }`。
2. `language-mermaid` 返回 `MermaidBlock`，`MermaidBlock` 内部通过 `useContext(MarkdownRuntimeConfigContext)` 获取运行时配置。
3. 非 Mermaid 代码块继续返回 `CodeBlock`。
4. `MessageBubble`、`ToolCard` 中 `markdownComponents` 继续使用空依赖 `useMemo`，避免流式过程中重建 renderer。
5. `MarkdownRuntimeConfigContext.Provider` 的 `value` 必须使用 `useMemo` 缓存，避免父组件普通重渲染时制造新对象引用，导致多个 `MermaidBlock` 无意义 re-render。

#### 4.2.3 流式状态传递

`MessageBubble` 在渲染 `part.content` 时计算运行时状态：

```ts
isStreaming: Boolean(part.isStreaming || message.isStreaming)
```

无 `parts` 回退渲染 `message.content` 时传入：

```ts
isStreaming: Boolean(message.isStreaming)
```

这些状态通过 `MarkdownRuntimeConfigContext.Provider` 注入给当前 `ReactMarkdown`，不作为 `createMarkdownComponents` 的参数。

`ToolCard` 中 `input/output/error` 的 Markdown 需要继续支持 Mermaid。v1 不新增 `ToolCardProps` 的 `isPc`、`downloadImage` 字段，避免接口扩散。实现时 `ToolCard` 内部读取父级 `MarkdownRuntimeConfigContext`，用 `useMemo` 合并父级 `isPc/downloadImage`，并用 `part.status === 'running' || part.isStreaming` 覆盖 `isStreaming`。这样 Tool 输出中的 Mermaid 在 PC 端仍可复用父级下载能力，running 状态展示 Mermaid loading。

`ThinkingBlock` 首期不启用 Mermaid 渲染，避免思考过程流式频繁重绘。

#### 4.2.4 Mermaid 渲染

使用 Mermaid 本地包：

```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
});
```

v1 固定使用浅色 `default` 主题，图表预览区和导出图片均使用白底。暗黑模式只适配 Mermaid 卡片标题栏、按钮、loading 和失败态，不改变 Mermaid 图表主题，避免暗黑主题图表在白底上出现文字或线条不可读。

渲染流程：

1. `isStreaming=true` 时展示 loading 效果和 `mermaid.rendering` 文案，不调用 `mermaid.render()`。
2. `isStreaming=false` 且 `code.trim()` 非空时渲染。
3. 使用 `React.useId()` 生成实例级 id。由于 React 18 的 `useId()` 可能生成 `:r0:` 这类包含冒号的值，必须清洗掉冒号和其他特殊字符，只保留 `[A-Za-z0-9_-]`，最终输出 `mermaid-chart-${safeId}`，避免同一 message/part 内多个 Mermaid 块发生 `diagramId` 冲突。
4. 使用递增 render token，丢弃过期异步渲染结果。
5. 以 `code + theme` 为 key 缓存 SVG，v1 中 `theme` 固定为 `default`。缓存采用模块级 LRU，最大 50 条，超出后淘汰最久未访问项，避免长会话中 SVG 字符串无限增长。
6. Mermaid 源码只作为渲染输入，不作为 UI 文本展示。

#### 4.2.5 失败态

渲染失败时：

1. `WeLog` 记录错误摘要。
2. 图表区展示 `src/imgs/warn_icon.svg`。
3. 文案展示 `t('mermaid.renderFailed')`。
4. 隐藏“导出图片”按钮。
5. 不展示 Mermaid 源码和解析错误详情。

文案：

```ts
'mermaid.renderFailed': '图表生成有问题，请重新提问试试'
'mermaid.exportImage': '导出图片'
'mermaid.exportFailed': '导出图片失败'
'mermaid.exportUnsupported': '当前环境不支持导出图片'
'mermaid.rendering': '图表生成中...'
```

英文：

```ts
'mermaid.renderFailed': 'There was a problem generating the chart. Please try asking again.'
'mermaid.exportImage': 'Export image'
'mermaid.exportFailed': 'Failed to export image'
'mermaid.exportUnsupported': 'Image export is not supported in this environment.'
'mermaid.rendering': 'Generating chart...'
```

#### 4.2.6 SVG 转 PNG 文件流

`svgToPngBlob(svgElement)` 只负责把已渲染的 SVG 转为 PNG `Blob`，不执行下载动作。图表区的自适应缩放只属于预览展示层，导出转换必须基于原始 SVG 逻辑尺寸和最大导出尺寸计算，不能直接截取或复用缩放后的预览尺寸。

实现要求：

1. 通过 `XMLSerializer` 序列化当前 SVG 节点，确保 SVG 内部 `<style>` 标签被完整保留，避免导出图片丢失颜色、线宽、字体等 Mermaid 样式。
2. PNG 输出固定白底；绘制 SVG 前先用 `#ffffff` 填充 canvas。
3. 使用 `window.devicePixelRatio || 1` 计算 canvas 物理像素尺寸，绘制前执行 `ctx.scale(dpr, dpr)`，避免 Retina 屏幕导出模糊。
4. 设置最大宽高限制，大图按比例缩放，避免 canvas 过大导致内存峰值过高。
5. 使用 `HTMLImageElement.onload` 后再绘制 SVG，并设置 5 秒超时；超时未加载完成时主动 reject。
6. 捕获 canvas taint、`SecurityError`、图片加载失败和 `canvas.toBlob(null)`，统一抛出可被 `MermaidBlock` 捕获的导出失败错误。
7. 转换完成后释放临时 object URL、canvas 引用和 image 引用。
8. 成功时返回 `{ fileStream: blob, fileSize: blob.size }`，再由 `downloadImage` 接管下载。
9. SVG 缓存为模块级 LRU，不随单个组件卸载清空；组件卸载时只需清理自身临时资源和异步任务。

#### 4.2.7 PC 文件下载公共方法

新增 `src/utils/pcFileDownload.ts`，封装 PC 端文件保存能力。该方法不属于 Mermaid 组件内部能力，而是页面层或业务层传给 `downloadImage` 的公共实现，后续其他 PC 下载场景也可以复用。

公共方法类型：

```ts
export interface PcFileDownloadPayload {
  fileStream: Blob;
  fileSize: number;
  filename: string;
  mimeType?: string;
  extensions?: string[];
}

export type PcFileDownloadErrorCode = 'unsupported' | 'dialog_failed' | 'write_failed';

export interface PcFileDownloadError extends Error {
  code: PcFileDownloadErrorCode;
  cause?: unknown;
}

export async function downloadFileWithPedestal(
  payload: PcFileDownloadPayload,
): Promise<void>;
```

实现流程：

1. 校验 `payload.fileStream` 是 `Blob`、`payload.filename` 是非空字符串；`fileSize` 作为调用方传入的文件大小元信息，不参与写入逻辑。
2. 校验 PC 能力是否可用：`window.Pedestal.callMethod`、`window.Pedestal.remote.dialog.showSaveDialog`、`window.require`、`window.require('fs')` 以及 `fs.promises.writeFile` 或 `fs.writeFile`。缺任一关键能力时抛出 `code: 'unsupported'`。
3. 调用 `window.Pedestal.callMethod('method://pedestal/getLocalSettingInfo', {})` 获取 `fileDownloadFolderAddress`。该调用失败不阻断导出，默认保存路径降级为安全文件名。
4. 对 `filename` 做安全字符清洗：移除 `/ \ : * ? " < > |` 等路径或系统保留字符，空值兜底为 `mermaid-chart.png`。Mermaid 导出默认确保 `.png` 后缀。
5. 组装保存弹窗参数：

```ts
const saveDialogPayload = {
  filters: [{ name: 'Files', extensions: ['png'] }],
  defaultPath,
};
```

其中 `defaultPath` 优先使用 `fileDownloadFolderAddress + 安全文件名`；拼接前需要去掉默认目录末尾多余的 `/` 或 `\`，并按目录中已有分隔符风格补一个分隔符。如果默认目录为空或不可用，则只使用安全文件名。

6. 调用 `window.Pedestal.remote.dialog.showSaveDialog(saveDialogPayload)`，返回 `{ canceled, filePath }`。
7. 当 `canceled === true` 时直接 resolve，不写文件，不提示 toast，不视为导出失败。
8. 当用户确认且 `filePath` 有值时，使用 `await fileStream.arrayBuffer()` 转为 `Uint8Array`，再通过 `fs.promises.writeFile(filePath, bytes)` 写入。若宿主只提供 callback 版本，则用 `fs.writeFile(filePath, bytes, callback)` 封装为 Promise。
9. `showSaveDialog` 异常或返回确认但缺少 `filePath` 时抛出 `code: 'dialog_failed'`；文件写入失败时抛出 `code: 'write_failed'`。
10. `MermaidBlock` 仍只调用注入的 `downloadImage`。如果 `downloadImage` reject 且错误码为 `unsupported`，提示 `mermaid.exportUnsupported`；其他异常提示 `mermaid.exportFailed`。

需要同步补充类型：

1. 在 `src/types/bridge/hwext.ts` 的 `Pedestal` 类型中补充可选 `remote.dialog.showSaveDialog` 定义。
2. 在全局类型中补充最小化 `window.require` 定义，仅覆盖本方法需要的 `fs` 写入能力，不引入 `@types/node` 依赖。

Mermaid 接入示例：

```ts
const downloadMermaidImage: MermaidDownloadImageHandler = async ({
  fileStream,
  fileSize,
  filename,
  mimeType,
}) => {
  await downloadFileWithPedestal({
    fileStream,
    fileSize,
    filename,
    mimeType,
    extensions: ['png'],
  });
};
```

#### 4.2.8 Mermaid 依赖与构建

当前工程需要同时支持页面 bundle、PC bundle 和 UMD library，Webpack 目标为 ES5。Mermaid 最新版本为 ESM 包，v1 采用“最新版 Mermaid + ES5 转译适配”策略：

1. 实施时先执行 `npm view mermaid version` 复核 latest，并在 `package.json` 写入精确版本号。本轮复核 latest 为 `mermaid@11.15.0`。
2. 业务代码从 `mermaid` 标准入口导入，不引用 `dist` 私有路径，不配置 Mermaid 入口别名。
3. v1 继续静态 import Mermaid，避免 UMD library 和 PC bundle 在运行时依赖异步 chunk publicPath。
4. 保留 Webpack `target: ['web', 'es5']` 和 `output.environment` 的 ES5 输出约束。
5. 扩展 `webpack.shared.js` 的依赖转译机制，支持精确包名和前缀匹配。Mermaid 相关转译名单包括：

```js
const TRANSPILE_DEPENDENCIES = [
  // existing entries...
  'mermaid',
  'd3',
  'd3-*',
  'dagre-d3-es',
  'cytoscape',
  'cytoscape-*',
  'dompurify',
  'marked',
  'uuid',
  'es-toolkit',
  'khroma',
  'roughjs',
  'stylis',
  'ts-dedent',
  'dayjs',
  'katex',
  '@mermaid-js/*',
  '@braintree/*',
  '@iconify/*',
  '@upsetjs/*',
];
```

6. `shouldTranspileDependency` 需要支持 `*` 前缀规则，例如 `d3-*`、`cytoscape-*`、`@mermaid-js/*`。
7. 如果构建报出新的 Mermaid transitive dependency 语法兼容问题，优先补充转译白名单，而不是回退 Mermaid 版本。
8. 最新版入口是 ESM，ES5 兼容性以最终构建产物为准：

```bash
npx es-check es5 'dist/**/*.js' 'dist/lib/**/*.js'
```

9. 若最终产物 ES5 检查失败，继续补充 `TRANSPILE_DEPENDENCIES` 或前缀匹配规则，并重新执行完整构建验证。

### 4.3 兼容与边界

1. 只识别标准 fenced code block：` ```mermaid `。
2. `mermaid` 语言名大小写不敏感。
3. 流式中不渲染 Mermaid，只展示 loading 效果，避免半截语法导致错误态闪烁。
4. 渲染失败不影响整条消息展示，失败范围限定在当前 Mermaid 卡片。
5. 导出按钮只在 PC 端且 SVG 成功生成后展示。
6. 非 PC 端不支持导出，也不显示导出按钮。
7. PC 端点击导出时，如果 `downloadImage` 未传或不是函数，提示 `mermaid.exportUnsupported`。
8. PC 端点击导出时，如果 `downloadImage` reject 且错误码为 `unsupported`，提示 `mermaid.exportUnsupported`。
9. PC 端点击导出时，如果 `downloadImage` reject 且不是 `unsupported`，提示 `mermaid.exportFailed`。
10. 用户在系统保存弹窗中取消保存时，公共下载方法直接 resolve，不提示 toast，不视为失败。
11. 导出处理中按钮禁用，避免重复触发。
12. 下载动作完全由传入的 `downloadImage` 负责，组件不实现 `<a download>`、打开 URL、长按保存等兜底逻辑。
13. 大图表在图表区内按容器宽高等比缩小并完整展示，不提供横向或纵向滚动作为查看方式；极端复杂图可能文字变小，但优先保证整体可见且不撑破聊天气泡。
14. Canvas 转换 PNG 文件流时需要控制最大尺寸，避免内存峰值过高。
15. loading 动画只在当前 Mermaid 块处于流式状态时展示；如果用户折叠卡片，则停止展示图表区 loading。
16. `ReactMarkdown components` 引用必须稳定；动态运行时配置只通过 `MarkdownRuntimeConfigContext` 传递。
17. v1 固定 Mermaid 浅色主题和白底图表，不随暗黑模式切换图表主题。
18. 同一消息或同一 part 内允许出现多个 Mermaid 块，`diagramId` 使用 `useId()` 生成，不能只依赖 `message.id + part.partId`。

### 4.4 相关接口联动

本方案不新增后端接口，但新增前端可选接口：

```ts
export interface MermaidDownloadImagePayload {
  fileStream: Blob;
  fileSize: number;
  filename: string;
  mimeType: 'image/png';
  diagramId: string;
}

export type MermaidDownloadImageHandler = (
  payload: MermaidDownloadImagePayload,
) => Promise<void> | void;
```

接入点：

1. `MessageBubbleProps` 可新增可选字段 `downloadMermaidImage?: MermaidDownloadImageHandler`。
2. `ContentProps` 可新增可选字段 `downloadMermaidImage?: MermaidDownloadImageHandler`，向下透传到 `MessageBubble`。
3. `MarkdownRuntimeConfigContext` 接收 `isStreaming`、`isPc` 和 `downloadImage`。
4. `createMarkdownComponents(true)` 只负责创建静态 Markdown component map，不接收运行时配置。
5. PC 判定统一从页面层传入或复用现有 `isPcMiniApp()` 结果，避免 `MermaidBlock` 内部自行判断宿主。
6. 组件内部提供 `svgToPngBlob(svg)` 能力，输出 `Blob` 和 `blob.size`，再调用业务传入的下载方法。
7. 页面层在 PC 端可引入 `downloadFileWithPedestal` 作为默认 `downloadMermaidImage` 实现；非 PC 端不传下载方法且不展示导出按钮。
8. `src/types/bridge/hwext.ts` 需要补充 Pedestal 保存弹窗类型；`src/types/global.d.ts` 需要补充 `window.require` 的最小 fs 写入类型。

PC 端页面层接入示例：

```ts
import { downloadFileWithPedestal } from '../utils/pcFileDownload';

const downloadMermaidImage: MermaidDownloadImageHandler = async ({
  fileStream,
  fileSize,
  filename,
  mimeType,
}) => {
  await downloadFileWithPedestal({
    fileStream,
    fileSize,
    filename,
    mimeType,
    extensions: ['png'],
  });
};
```

### 4.5 文档需要同步修改的内容

1. 更新 `docs/weAgentCUI-ai-reply-rendering.md`，补充 `text` Markdown 中 Mermaid 代码块的渲染规则。
2. 更新 `docs/weAgentCUI-opencode-cases.md`，新增 Mermaid 渲染、PC 保存弹窗导出、用户取消保存、非 PC 隐藏导出验证 case。
3. 更新 `AGENTS.md`，在高风险渲染区补充 Mermaid 流式、自适应完整展示、PC-only 导出、Pedestal 文件下载公共方法、下载方法注入、Context 配置传递、Mermaid 最新版和 ES5 转译适配注意事项。
4. 如项目维护依赖清单或开源合规清单，需要登记 `mermaid` 及 MIT License。

## 5. 性能

1. Mermaid 渲染只在内容稳定后执行，避免流式过程中每个 token 都触发解析和 SVG 布局。
2. 流式 loading 使用轻量三点 CSS 动画，不引入额外图片或 JS 定时器。
3. v1 如果继续使用 Mermaid 当前最新版本并采用静态 import，必须重点评估包体和构建耗时。根据 7.4 的本地验证，`mermaid@11.15.0` 静态进入主 bundle 后体积和构建耗时上升明显，且 ES5 最终产物检查未稳定通过；因此最新版静态 import 不能直接视为低风险方案。
4. 使用 `code + theme` 缓存 SVG，避免历史消息、折叠展开、父组件重渲染时重复计算。
5. 使用 render token 防止异步结果乱序覆盖。
6. 图片导出只在 PC 端用户点击时执行，不占用普通渲染路径性能。
7. Canvas 转 PNG 文件流按设备像素比提升清晰度，但设置最大宽高和 5 秒加载超时，避免大图或异常 SVG 导致内存峰值过高或按钮长期禁用。
8. PC 文件写入只在用户确认保存路径后执行；用户取消保存时不做 `arrayBuffer` 转换和 `fs.writeFile`。
9. 组件只生成 `Blob` 和 `Blob.size`，不执行下载动作，减少浏览器兼容分支和额外资源保留时间。
10. 多个 Mermaid 图同时出现时，不做全局批量同步渲染；每个 `MermaidBlock` 独立渲染，后续可按需要增加视口内懒渲染。
11. `ReactMarkdown components` 引用保持稳定，动态状态变化不会触发整棵 Markdown 子树重挂载。
12. `MarkdownRuntimeConfigContext.Provider` 的 value 使用 `useMemo`，减少无关重渲染。
13. 预览区自适应缩放只在 SVG 渲染成功和容器尺寸变化时计算，不绑定滚轮、拖拽或持续动画，避免额外交互计算。
14. SVG 缓存采用 50 条 LRU 上限，控制长会话内存占用。

## 6. 功耗

1. 不新增轮询、长连接或后台任务。
2. 不在流式阶段持续执行 Mermaid 解析，降低 CPU 持续占用。
3. loading 动画仅在 Mermaid 块流式输出期间展示，内容稳定或卡片折叠后停止。
4. 导出图片为 PC 用户主动触发的一次性计算，完成后释放临时 object URL、canvas 和图片引用。
5. PC 文件写入只在保存弹窗确认后发生；用户取消保存时不触发文件流读取和本地写入。
6. 非 PC 端不展示导出入口，避免移动端大图转换带来的额外 CPU、内存和功耗消耗。

## 7. 影响范围

### 7.1 直接影响

1. `src/components/markdownComponents.tsx`
2. `src/components/MessageBubble.tsx`
3. `src/components/ToolCard.tsx`
4. 新增 Mermaid 组件、样式、导出工具和类型定义。
5. `src/i18n/resources/zh.ts`、`src/i18n/resources/en.ts`
6. `package.json`、`webpack.shared.js`
7. 新增 `src/utils/pcFileDownload.ts`，并补充 `src/types/bridge/hwext.ts`、`src/types/global.d.ts` 中 PC 保存弹窗和 `window.require('fs')` 的最小类型。

### 7.2 间接影响

1. Markdown 渲染链路中的代码块展示。
2. WeAgentCUI 和 SkillCUI 中 assistant/tool Markdown 内容展示。
3. 主页面 bundle、UMD library 构建体积、Mermaid ESM 依赖转译和 ES5 构建兼容性。
4. Mermaid 卡片内部 loading 样式复用或新增命名空间样式。
5. Markdown runtime context 配置传递。
6. ToolCard 内部 Context 继承与 `isStreaming` 覆盖逻辑。
7. Jest 测试中需要 mock Mermaid、canvas 转换能力、LRU 缓存、Pedestal 保存弹窗、Node fs 写入能力和 `downloadImage` 注入函数。
8. PC 端导出入口与非 PC 端隐藏逻辑。

### 7.3 不影响

1. 不改变 `HWH5EXT`、`Pedestal` 现有协议；仅补充已有 PC 能力的类型声明和公共调用封装。
2. 不影响后端会话、消息、历史接口。
3. 不影响普通 Markdown 段落、列表、表格、数学公式渲染。
4. 不影响非 Mermaid 代码块的 `CodeBlock` 展示与复制能力。
5. 不影响创建个人助理、助手选择、助手详情等页面业务流程。

### 7.4 Mermaid 11 ES5 转译体积验证

本节记录一次本地临时验证，目的是评估 `mermaid@11.15.0` 在当前项目中静态引入并尝试 ES5 转译后的包体积、构建耗时和兼容风险。验证在临时 detached worktree 中完成，验证结束后已删除临时 worktree，未把实验代码带回主工作区。

验证方式：

1. 从当前 `HEAD` 创建临时 worktree，复制当前 `node_modules` 和 `package-lock.json`，避免影响当前工作区已有文档改动。
2. 先执行当前基线 `npm run build`，记录 `dist` 总体积、JS raw 体积和 gzip 体积。
3. 通过 `npm install mermaid@11.15.0 --save-exact --ignore-scripts` 安装 Mermaid 最新版。
4. 在临时入口中静态 import Mermaid，并执行 `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })`，确保 Mermaid 进入主页面 bundle。
5. 临时扩展 Webpack/Babel：支持 `.mjs`、补充 Mermaid/D3/Cytoscape/KaTeX/parser/react-router/parse5/vfile/unified 等依赖转译，并尝试对 CJS/UMD 依赖增加 shim。
6. 执行 `npm run build`，使用 Node `zlib.gzipSync` 统计 JS gzip 体积。
7. 使用 `npx es-check@9.2.0 es5 'dist/**/*.js'` 检查最终构建产物是否满足 ES5 语法。

主页面基线结果：

| 指标 | 当前基线 |
| --- | ---: |
| `dist` 总体积 | `4,091,904` bytes，约 `3.9M` |
| JS raw 总体积 | `2,258,162` bytes，约 `2.15 MiB` |
| JS gzip 总体积 | `693,504` bytes，约 `677 KiB` |
| vendor JS raw | `1,760,401` bytes，约 `1.68 MiB` |
| Webpack 构建耗时 | 约 `7s` |

引入 `mermaid@11.15.0` 并尝试 ES5 转译后的主页面结果：

| 指标 | Mermaid 11 临时验证结果 | 相比基线 |
| --- | ---: | ---: |
| `dist` 总体积 | `7,565,312` bytes，约 `7.2M` | 增加约 `3.31 MiB` |
| JS raw 总体积 | `5,728,656` bytes，约 `5.46 MiB` | 增加约 `3.31 MiB` |
| JS gzip 总体积 | `1,601,627` bytes，约 `1.53 MiB` | 增加约 `887 KiB` |
| vendor JS raw | `5,228,147` bytes，约 `4.99 MiB` | 增加约 `3.31 MiB` |
| Webpack 构建耗时 | 约 `67s` 到 `84s` | 增加约 `10` 倍 |

补充验证现象：

1. Babel 转译过程中多次提示 Mermaid 依赖中的大文件超过 `500KB`，包括 `katex.mjs`、`cytoscape.esm.mjs`、`@mermaid-js/parser` chunk。
2. 仅补 Mermaid 相关白名单不足以通过构建，过程中暴露 `dayjs`、`@braintree/sanitize-url`、`cytoscape-fcose`、`cytoscape-cose-bilkent` 的 CJS/ESM 互操作问题。
3. 继续补白名单后，`es-check` 仍持续暴露现有 Markdown/React 依赖链中的非 ES5 语法，例如 `@remix-run/router`、`parse5`、`vfile`、`unified`、`trough`、`internmap` 等。
4. 尝试“所有进入 bundle 的 `node_modules` 默认转译”后，会触发大量 `core-js`、React CJS/ESM 互操作和 loader 解析问题，不适合作为当前项目的直接方案。
5. `npx es-check@9.2.0 es5 'dist/**/*.js'` 在多轮补充后仍未稳定通过，因此本次验证结论不能视为 Mermaid 11 静态 import + ES5 转译方案已经可落地。
6. UMD 基线 Webpack 产物也较大：`dist/lib/index.js` raw `5,477,963` bytes、gzip `1,849,828` bytes；`dist/lib/skill-cui.js` raw `5,054,492` bytes、gzip `1,798,488` bytes。由于主页面 ES5 检查尚未稳定通过，未继续记录 Mermaid 11 后的稳定 UMD 产物，UMD 体积和兼容风险需要单独验证。

验证结论：

1. `mermaid@11.15.0` 静态进入主页面 bundle 后，包体积和构建耗时上升显著。
2. 当前项目要做到最终 bundle ES5 语法通过，不只是补 Mermaid 依赖白名单，还会牵出既有 Markdown、router、unified、core-js 等依赖链问题。
3. 如果 v1 继续坚持 Mermaid 最新版，建议优先评估动态 `import()`、独立拆包、外部挂载或按图表类型裁剪能力，而不是直接把 Mermaid 11 静态打入主 bundle 和 UMD library。
4. 如果首期只需要流程图、时序图等基础能力，仍建议把 Mermaid 版本策略作为高优先级技术决策重新评估。

## 8. 实现风险与降级

1. Provider value 如果不使用 `useMemo`，父组件普通重渲染会制造新的 Context value 引用，导致同一 Markdown 中的多个 `MermaidBlock` 发生额外 re-render。实现时必须缓存 runtime config。
2. Mermaid 最新版依赖链较大，且本地验证显示 `mermaid@11.15.0` 静态 import 会显著增加包体积和构建耗时，并可能牵出 Mermaid 外的既有依赖 ES5 问题。实施时必须以最终 bundle ES5 检查、构建错误和包体预算为准；如继续使用最新版，优先评估动态加载、独立拆包或外部挂载，而不是只依赖转译白名单。
3. SVG 缓存如果使用无限 Map，长会话中可能累积较多 SVG 字符串。v1 采用 50 条 LRU 上限，超出后淘汰最久未访问项。
4. `ToolCard` 不新增对外 props，内部通过父级 `MarkdownRuntimeConfigContext` 继承 `isPc/downloadImage`，仅覆盖 `isStreaming`。如果 ToolCard 没有父级配置，则按默认非 PC/无下载方法处理。
5. 图片导出过程中任何转换失败、超时、canvas 安全异常或下载方法异常，都只影响当前 Mermaid 卡片的导出动作，不阻断消息正文展示。
6. 图表区以完整展示优先，极端宽图或长图被等比缩小后可能出现文字变小。该情况不作为渲染失败处理，也不提供手动缩放或拖拽查看；可引导用户重新提问生成更简洁的图表。
7. PC 公共下载方法依赖 Pedestal 保存弹窗和 `window.require('fs')`。若宿主未提供相关能力，公共方法抛出 `unsupported`，Mermaid 导出层提示 `当前环境不支持导出图片`。
8. 用户取消系统保存弹窗属于正常操作，公共方法直接 resolve；保存弹窗异常、返回确认但缺少 `filePath` 或 fs 写入失败才视为导出失败并提示 `导出图片失败`。

## 9. 测试范围

### 9.1 功能测试

1. assistant 消息中 ` ```mermaid ` 成功渲染为卡片结构。
2. 卡片顶部展示 `mermaid` 和折叠按钮，不展示源码复制按钮。
3. 展开态只展示图表区，不展示源码区。
4. PC 端渲染成功后显示“导出图片”按钮。
5. 渲染失败后显示 `warn_icon.svg` + `图表生成有问题，请重新提问试试`，不显示导出按钮。
6. 流式过程中不触发 Mermaid 渲染，展示 loading 效果和 `图表生成中...` 文案，不显示导出按钮。
7. 流式结束后触发 Mermaid 渲染。
8. 非 PC 端渲染成功后不显示“导出图片”按钮。
9. PC 端点击导出图片时成功生成 PNG `Blob`，并向 `downloadImage` 传入 `fileStream` 与 `fileSize`。
10. PC 端未传 `downloadImage` 或传入值不是函数时，toast 提示 `当前环境不支持导出图片`。
11. `downloadImage` reject `unsupported` 时，toast 提示 `当前环境不支持导出图片`。
12. `downloadImage` 其他执行失败时，toast 提示 `导出图片失败`。
13. PC 公共下载方法能读取 `fileDownloadFolderAddress` 并作为保存弹窗默认目录。
14. 用户取消系统保存弹窗时不写文件、不提示失败。
15. 用户确认保存路径时通过 `window.require('fs')` 写入文件。
16. 普通代码块仍显示为原 `CodeBlock`。
17. 同一条消息或同一 part 中多个 Mermaid 块都能正常渲染，且 `diagramId` 不冲突。
18. 动态切换 `isStreaming`、`isPc`、`downloadImage` 时，`ReactMarkdown components` 引用不重建。
19. ToolCard 内 Mermaid 能继承父级 `isPc/downloadImage`，并按 tool running 状态展示 loading。
20. SVG 缓存超过 50 条时淘汰最久未访问项。
21. 宽图、长图和普通图都能在图表区内完整展示，不出现内容裁切或撑破聊天气泡。
22. 图表预览区不出现手动缩放、拖拽平移、小地图等控件，也不响应滚轮缩放或拖拽移动。
23. PC 端导出图片使用原始 SVG 转换结果，不受图表区预览缩放比例影响。

### 9.2 兼容测试

1. Chrome / Safari PC 环境基础渲染和导出。
2. PC miniapp 环境的导出按钮、PNG 文件流生成、Pedestal 保存弹窗和本地 fs 写入。
3. 非 PC WebView 中不显示导出按钮。
4. iOS / Android / Harmony WebView 的 SVG 渲染和失败态展示。
5. PC、移动端 WebView、窄屏聊天气泡内，图表均按当前容器宽度等比缩小完整展示。
6. 暗黑模式下标题栏、loading 态、失败态和按钮可读性；图表区固定白底，Mermaid 图表保持浅色主题并可读。
7. UMD library 构建后由外部页面消费时 Mermaid 依赖加载是否正常。
8. 构建验证必须覆盖 `npm run build`、`npm run build:pc`、`npm run build:lib`、`npm run build:skill-cui-lib`。
9. 最终构建产物需要通过 `npx es-check es5 'dist/**/*.js' 'dist/lib/**/*.js'` 或等价 ES5 语法检查；若失败，需结合 7.4 的验证结论复核 Mermaid 加载策略、转译白名单、CJS/ESM 互操作和 core-js 注入方式后重新构建。

### 9.3 文档一致性检查

1. `weAgentCUI-ai-reply-rendering.md` 中 Markdown 渲染链路与实现一致。
2. `weAgentCUI-opencode-cases.md` 中测试 case 覆盖 Mermaid 成功、失败、PC 保存弹窗导出、用户取消保存和非 PC 隐藏导出。
3. `AGENTS.md` 中新增依赖、Markdown 风险、自适应完整展示、PC-only 导出、Pedestal 文件下载公共方法、下载方法注入、Context 配置传递和构建验证说明。
4. 开源合规文档登记 Mermaid MIT License。

## 10. 最终建议

推荐采用“MermaidBlock 专用组件 + 图表区自适应完整展示 + PC-only 导出入口 + Pedestal 文件下载公共方法 + 图片文件流下载方法注入”的方案。

原因：

1. 改动收口在 Markdown 展示层，不影响协议和后端。
2. 同时满足图表完整展示、失败态和 PC 端图片导出。
3. 流式期间不渲染 Mermaid，但用轻量 loading 给用户明确反馈，能降低性能抖动和错误闪烁，同时避免空白等待。
4. 下载方法参数注入后，下载动作由业务侧统一处理，`MermaidBlock` 不需要承载端差异和下载兜底逻辑；PC 端默认可复用 `downloadFileWithPedestal` 完成保存弹窗和本地写入。
5. `MarkdownRuntimeConfigContext` 能保证 `ReactMarkdown components` 引用稳定，降低流式阶段整体重挂载风险。
6. 图表预览只做自动等比缩小，不提供缩放拖拽交互，能降低实现复杂度并避免多端手势差异。
7. Provider value 使用 `useMemo`、ToolCard 继承父级 Context、SVG LRU 上限和 Mermaid ES5 预检能进一步降低实施阶段风险。
8. Mermaid 最新版保持语法和功能能力最新；Mermaid.js 是 MIT 开源库，可用于商业产品，上线前按公司开源合规流程登记依赖即可。但根据 7.4 验证结果，最新版静态 import + ES5 转译不应作为默认低风险路径，实施前需要先确认包体预算、加载策略和 ES5 兜底方案。

推荐实施顺序：

1. 增加 i18n、类型和 SVG 转 PNG 文件流 helper。
2. 新增 `downloadFileWithPedestal` 公共方法，并补充 Pedestal 保存弹窗和 `window.require('fs')` 的最小类型。
3. 实现 `MermaidBlock` 与样式，优先复用现有三点 loading 效果，并实现图表区等比缩小完整展示。
4. 新增 `MarkdownRuntimeConfigContext`，Provider value 使用 `useMemo`，保持 `createMarkdownComponents(true)` 静态引用。
5. 接入 `markdownComponents.tsx`，识别 `language-mermaid`。
6. 通过 Provider 传递流式状态、PC 判定和下载 handler；PC 页面层注入 `downloadFileWithPedestal`，ToolCard 继承父级 Context 并覆盖自身 `isStreaming`。
7. 先完成 Mermaid 版本和加载策略决策。本轮复核最新版本为 `mermaid@11.15.0`，但静态 import 需先通过包体预算和 ES5 可行性门禁。
8. 如果继续使用 Mermaid 最新版，优先评估动态加载、独立拆包、外部挂载或按图表类型裁剪能力；若仍选择静态 import，再扩展 Webpack Mermaid 相关转译白名单和前缀匹配能力。
9. 对最终构建产物执行 ES5 语法检查；如果失败，不能只机械补充 `TRANSPILE_DEPENDENCIES`，还需要复核加载策略、CJS/ESM 互操作和 core-js 注入方式。
10. 补齐单测和文档。
11. 运行测试与构建验证。

## 11. 安全

1. Mermaid 使用 `securityLevel: 'strict'`，默认禁用不安全交互能力。
2. 不启用 Mermaid click callback、外部链接跳转等交互能力。
3. Mermaid 源码和 SVG 渲染均在本地前端执行，不上传到第三方服务，也不在 UI 上展示 Mermaid 源码。
4. 渲染失败不向用户暴露底层错误堆栈，避免泄露内部实现细节。
5. SVG 转 PNG 时不引入外部图片资源，降低 canvas taint 风险；若仍触发 `SecurityError`，需捕获并提示导出失败。
6. 传给 `downloadImage` 的文件名使用固定前缀和安全字符，避免注入特殊路径字符。
7. 传给 `downloadImage` 的内容限定为 PNG `Blob`、文件大小和必要元信息，不传 Mermaid 源码。
8. `diagramId` 由 `useId()` 生成并清洗，避免用户内容参与 DOM id 拼接。
9. PC 公共下载方法只使用清洗后的文件名构造 `defaultPath`，实际写入路径必须来自用户在系统保存弹窗中确认的 `filePath`。
10. PC 公共下载方法不接受外部传入任意目标路径，避免调用方绕过系统保存弹窗直接写入本地文件。
11. 现有 Markdown 链路已使用 `rehypeRaw`，本次不扩大 raw HTML 能力；如后续安全要求提升，应单独评估 HTML sanitize。
12. MIT License 允许使用、复制、修改、分发和销售，但需要保留版权和许可声明；公司发版前需按开源合规流程登记。

## 12. 单元测试

### 12.1 `MermaidBlock` 单测

1. `isStreaming=true` 时不调用 Mermaid render。
2. `isStreaming=true` 时展示三点 loading 和 `mermaid.rendering` 文案。
3. `isStreaming=false` 且代码合法时调用 Mermaid render，并展示 SVG。
4. Mermaid render 抛错时展示 `warn_icon.svg` 和 `mermaid.renderFailed`。
5. 渲染失败时不展示导出按钮。
6. PC 端渲染成功时展示导出按钮。
7. 非 PC 端渲染成功时不展示导出按钮。
8. UI 中不展示 Mermaid 源码区和源码复制按钮。
9. PC 端点击导出按钮时调用传入的 `downloadImage`。
10. `downloadImage` 未传或类型错误时调用 `showToast(t('mermaid.exportUnsupported'))`。
11. `downloadImage` reject `unsupported` 时调用 `showToast(t('mermaid.exportUnsupported'))`。
12. `downloadImage` 其他抛错时调用 `showToast(t('mermaid.exportFailed'))`。
13. `downloadImage` resolve 时不提示失败，包括用户取消保存弹窗的 resolve 场景。
14. 折叠按钮能隐藏图表区和 loading 态。
15. Mermaid 初始化参数包含 `startOnLoad: false`、`securityLevel: 'strict'`、`theme: 'default'`。
16. 同一消息或同一 part 内多个 Mermaid 块生成不同 `diagramId`。
17. 暗黑模式下图表预览区仍为白底，图表内容保持浅色主题可读。
18. SVG 原始尺寸超过图表区时，按 `min(containerWidth / svgWidth, maxPreviewHeight / svgHeight, 1)` 计算等比缩小比例。
19. SVG 原始尺寸未超过图表区时，不强制放大并保持居中。
20. 宽图、长图渲染后完整落在图表区内，不出现横向或纵向滚动查看依赖。
21. 图表预览区不绑定滚轮缩放、双指缩放、拖拽平移相关事件。

### 12.2 `markdownComponents` 单测

1. `language-mermaid` 返回 `MermaidBlock`。
2. `language-ts` / `language-js` 等普通代码块仍返回 `CodeBlock`。
3. 旧调用 `createMarkdownComponents(true)` 行为兼容。
4. `createMarkdownComponents(true)` 不接收动态 Mermaid 配置。
5. `MarkdownRuntimeConfigContext` 能透传 `isStreaming`、`isPc` 和 `downloadImage`。
6. 动态修改 Context value 时，`components` 引用保持稳定，不触发整棵 Markdown 子树重挂载。
7. Provider value 通过 `useMemo` 缓存，父组件无关重渲染时不制造新的 runtime config 引用。

### 12.3 `MessageBubble` 回归单测

1. assistant 消息中的 Mermaid 代码块按卡片结构展示。
2. 流式 assistant 消息中的 Mermaid 不渲染图表，但展示 loading 态。
3. 历史 assistant 消息中的 Mermaid 直接进入稳定渲染。
4. 同一 text part 内多个 Mermaid 代码块都能渲染，且互不覆盖。
5. ToolCard 内 Mermaid 继承父级 `isPc/downloadImage`，并按 `part.status === 'running' || part.isStreaming` 展示 loading。
6. ToolCard 不新增 `isPc`、`downloadImage` 对外 props。
7. 普通 Markdown 段落、列表、代码块、权限卡片、问题卡片不回归。

### 12.4 导出工具单测

1. SVG 转 PNG 成功路径。
2. `canvas.toBlob` 返回空时抛错。
3. 转换结果返回 PNG `Blob` 和 `blob.size`。
4. 不创建 `<a download>`，不打开图片 URL，不做下载兜底。
5. 结束后释放临时 object URL。
6. 大图按最大尺寸限制缩放。
7. SVG 内部 `<style>` 在序列化结果中保留。
8. 使用 `window.devicePixelRatio` 绘制高清 PNG。
9. 导出 PNG 使用白底。
10. 图片加载超过 5 秒时 reject。
11. canvas taint 或 `SecurityError` 会 reject，并由 `MermaidBlock` 提示导出失败。
12. SVG 缓存超过 50 条时淘汰最久未访问项。
13. 导出转换基于原始 SVG 逻辑尺寸和最大导出尺寸计算，不使用预览区缩放后的展示尺寸。

### 12.5 PC 文件下载公共方法单测

1. 正常路径下调用 `window.Pedestal.callMethod('method://pedestal/getLocalSettingInfo', {})` 获取默认保存目录。
2. `showSaveDialog` 的入参包含 `filters: [{ name: 'Files', extensions: ['png'] }]` 和清洗后的 `defaultPath`。
3. `fileDownloadFolderAddress` 为空或获取失败时，`defaultPath` 降级为安全文件名。
4. 用户取消保存时不调用 `fs.writeFile`，方法 resolve。
5. 用户确认保存路径时，将 `Blob.arrayBuffer()` 转为 `Uint8Array` 后写入 `filePath`。
6. `fs.promises.writeFile` 可用时优先使用 Promise 版本。
7. 仅提供 callback 版 `fs.writeFile` 时，能封装为 Promise 并正常 resolve/reject。
8. 缺少 `Pedestal`、`remote.dialog.showSaveDialog`、`window.require` 或 `fs.writeFile` 时 reject `code: 'unsupported'`。
9. `showSaveDialog` 异常或返回确认但无 `filePath` 时 reject `code: 'dialog_failed'`。
10. 文件写入失败时 reject `code: 'write_failed'`。
11. 文件名包含路径分隔符或系统保留字符时会被清洗，并保留 `.png` 后缀。

### 12.6 构建验证

1. `npm run build`
2. `npm run build:pc`
3. `npm run build:lib`
4. `npm run build:skill-cui-lib`
5. `npx es-check es5 'dist/**/*.js' 'dist/lib/**/*.js'`
6. 验证 Mermaid 最新版、加载策略、转译白名单和前缀匹配在 UMD/ES5 构建中可用；若 ES5 检查失败，需结合 7.4 复核加载策略、CJS/ESM 互操作和 core-js 注入方式，不能只验证补充 `TRANSPILE_DEPENDENCIES`。
