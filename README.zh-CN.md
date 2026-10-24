# ReadItLater 思源笔记插件

一个思源笔记插件,移植自 Obsidian 插件 [obsidian-ReadItLater](https://github.com/DominikPieper/obsidian-ReadItLater)(作者 Dominik Pieper)。

## 目录

- [简介](#简介)
- [安装](#安装)
- [使用](#使用)
- [模板引擎](#模板引擎)
- [收件箱目录与资源](#收件箱目录与资源)
- [图床](#图床)
- [内容类型](#内容类型)
- [API](#api)
- [与 Obsidian 版的差异](#与-obsidian-版的差异)
- [开发](#开发)

## 简介

用 ReadItLater 把网页存进思源。将网页归档以备稍后阅读、在第二大脑中引用,或用于其它灵活场景。

ReadItLater 不只是把网页转成 Markdown。每种内容类型都有专属模板,精心挑选的变量让归档过程更顺手。

### 插件亮点

- 简单但强大的模板引擎
- 精心挑选的预定义模板变量,归档流程直接明了
- 兼容思源桌面端、移动端与浏览器端
- 文章图片下载到工作空间资源目录(或图床)
- URL 列表批量处理

## 安装

从发布页下载最新版 `package.zip`,在思源中打开 `设置 - 集市`,使用 `导入插件` 手动安装,然后启用插件。

也可以在思源集市中搜索 ReadItLater 直接安装(上架后可用)。

## 使用

点击顶栏的 ReadItLater 图标,或在命令面板中运行 `从剪贴板创建` 命令,即可创建单条笔记。也可以把一批 URL(以设置中的分隔符分隔)通过 `从剪贴板批量创建` 命令一次建成多条笔记。

若想把内容追加进已有文档,聚焦编辑器后运行 `插入到光标位置` 命令。

剪藏前请先在插件设置(`设置 - 插件 - 稍后读`)中选择目标笔记本。笔记会创建为该笔记本 `收件箱路径` 下的文档,文档标题即标题模板的渲染结果。

## 模板引擎

每种内容类型都有专属模板,可在插件设置中编辑。

### 变量

变量使用 `{{ content }}` 语法渲染;嵌套数据用点号访问,如 `{{ author.name }}`。

### 过滤器

变量输出可用过滤器加工,多个过滤器用 `|` 串联,前一个的输出作为后一个的输入。

- `blockquote`:每行加引用前缀
- `capitalize`:首字母大写
- `upper` / `lower`:全部大写 / 小写
- `replace(search, replacement)`:替换
- `join(separator)`:数组合并
- `striptags`:去 HTML 标签
- `map(key)`:从对象数组提取字段
- `numberLexify`:数字可读化(`1234567` → `1.2M`)

### 循环

```
{% for chapter in videoChapters %}
{{ chapter }}
{% endfor %}
```

## 收件箱目录与资源

`收件箱路径` 和 `资源目录` 设置支持模板变量:

| 目录模板变量 | 说明 |
| --- | --- |
| date | 当前日期(格式取自插件设置) |
| fileName | 新笔记标题 |
| contentType | 检测到的内容类型标识 |

下载的图片默认上传到工作空间资源目录(默认 `assets`),内核会自动创建缺失目录。

### 图床

开启 **使用图床** 后,资源上传到自托管图床(Sanyue-ImgHub / [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 兼容接口)而不是本地资源目录:

- **图床上传 URL**(必填)——上传目标地址
- **图床外链 URL**(可选)——笔记中外链的前缀,适用于上传地址与公开地址不一致的场景;留空则与上传地址相同
- **图床 Access Token**(可选)——以 `Authorization: Bearer <token>` 发送
- **上传至图床的资源**——多选:图片、视频、文件、自定义(逗号分隔的扩展名,不受类别限制);默认勾选图片和视频

可点击「检验」按钮上传探针文件验证连通性,探针会自动清理。

已上传外链按源 URL 持久化去重:重剪同一篇文章不会向图床重复上传。更换图床后请清空插件数据目录中的 `imgbed-links.json`。

## 内容类型

根据 URL 结构判定内容类型。支持网页正文存档与多种服务的嵌入内容。每种内容类型都有标题与正文模板,可在插件设置中编辑。

内容类型按 URL 检测优先级排列:

### 网页文章

使用 [Mozilla Readability](https://github.com/mozilla/readability) 提取正文并转换为 Markdown;不可读页面创建仅含链接的空笔记。开启后图片下载到资源目录。

### Youtube

嵌入视频播放器;配置 Youtube Data API v3 密钥后可获取元数据、章节等。

### Youtube 频道

保存频道标题、头像、视频列表地址与订阅数。需要 Youtube Data API v3 密钥。

### Twitter / X.com

保存推文内容。

### Bluesky

保存帖子内容,可选下载嵌入内容与回复。

### Stack Exchange

保存问题、最佳回答与其它回答。

### Pinterest

保存图片与描述。

### Mastodon

保存嘟文,可选下载媒体附件与回复。

### Vimeo

嵌入视频播放器与章节。

### Bilibili

嵌入视频播放器。

### TikTok

保存视频描述并嵌入播放器。

### 文本片段

非 URL 剪贴板内容的兜底类型:原样保存剪贴板文本。

## API

其它插件可通过以下方式调用:

```ts
const readItLater = siyuan.ws.app.plugins.find((p) => p.name === 'siyuan-read-it-later');
await readItLater.api.processContent('https://example.com/some-article');
```

`api` 为 [src/ReadtItLaterApi.ts](src/ReadtItLaterApi.ts) 中 `ReadItLaterApi` 类的实例:

- `processContent(content: string)` —— 创建单条笔记
- `processContentBatch(contentBatch: string)` —— 按分隔符批量创建
- `insertContentAtEditorCursorPosition(content: string, protyle: IProtyle)` —— 插入到光标处

## 与 Obsidian 版的差异

- 笔记以思源文档(内核 API)存储,标题即文档标题
- 保存前需在设置中选择目标笔记本
- 移除了思源没有对应机制的分享菜单入口(`extendShareMenu`)
- 网络请求经思源内核 forward proxy 转发,所有前端无 CORS 问题
- 图片下载在所有前端可用,不再限于桌面端
- 日期格式化用 dayjs 替代 moment,格式串兼容

## 开发

```bash
npm install
npm run dev      # 开发构建(watch 模式)
npm run build    # 生产构建(index.js)
npm run lint     # ESLint 自动修复
```

构建产物为 esbuild 打包的单一 `index.js`(CommonJS),与 `plugin.json`、`index.css`、`i18n/` 语言文件一起由思源加载。本地试用:将仓库内容复制到 `<workspace>/data/plugins/siyuan-read-it-later/` 后重载界面。

打包发布:

```bash
npm run build && zip -r package.zip index.js index.css plugin.json i18n.json i18n icon.png preview.png README.md README.zh-CN.md
```

## 许可

MIT —— 见 [LICENSE](LICENSE)。原始 Obsidian 插件版权归 Dominik Pieper;思源移植版沿用同一许可。
