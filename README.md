# 个人博客（Hugo + PaperMod）

基于 [PaperMod](https://github.com/adityatelange/hugo-PaperMod) 的个人技术笔记站，源码托管在 GitHub，
每次 push 由 GitHub Actions 自动构建并发布到 GitHub Pages。

**线上地址：** https://huoguo565656.github.io/

---

## 一分钟上手

| 我想…… | 怎么做 |
|---|---|
| **改个错别字** | 打开 GitHub 网页，进 `content/posts/` 找到那个文件，点铅笔图标改，Commit。约 40 秒后生效 |
| **写新文章** | `./scripts/new-post.sh "文章标题" --slug my-post` → 写内容 → `./scripts/publish.sh "post: 标题"` |
| **本地看效果** | 本机装好 Hugo 后跑 `./scripts/preview.sh`，浏览器开 http://localhost:1313/ |
| **改站名/导航/作者** | 只改 `hugo.toml`，详见下面的「常用配置位置」 |
| **改主题样式** | 改 `themes/PaperMod/` 里的文件；升级主题见「主题升级」 |
| **搜索** | 导航栏那个框，或按 `Ctrl/Cmd + K`、`/` |
| **在站内编辑文章** | 输 `123456` 回车开启创造模式 → 点右上角「+」→「编辑本文」 |

---

## 站内增强功能

这三样都是自己加的，**没有改主题任何文件**（靠 `layouts/_partials/extend_*.html` 覆盖主题的空壳 partial），
所以 `themes/PaperMod` 仍然可以整体替换升级。

代码在 `assets/css/custom.css` + `assets/js/blog-custom.js`。

### 1. 导航栏搜索

标题 + **正文全文**检索（PaperMod 的搜索索引 `index.json` 本来就含 `content` 字段，
线上索引约 50KB）。支持 `↑` `↓` 选、`Enter` 进、`Esc` 关；结果里关键词高亮，
点进文章后正文里的命中词还会闪一下。

**性能取舍**：Fuse.js（15KB）和索引**都不在首屏加载**，而是首次聚焦/输入时才拉，
另外在页面空闲时预热一次。所以普通浏览不多花一分带宽。

### 2. 创造模式（是个隐藏入口）

在**任意页面**盲打 `123456` 然后回车（不是在输入框里打字时），或者在搜索框里输入
`123456` 回车，就会开启：

- 右上角渐进式弹出一个「+」按钮（缩放 + 旋转 + 波纹）
- 点它打开设置面板：
  - **换壁纸**：拖图进来 / 点选本地文件（存 IndexedDB，支持几 MB 大图）/ 或粘贴图片 URL
  - **亮度**：0.3–1.6，只作用于背景图
  - **磨砂**：0–24px，作用于导航栏和正文卡片（磨砂调到 0 时卡片会自动加深，
    否则文字会糊在图上）
- 面板里还有「退出创造模式」

**设置保存在本机浏览器**（localStorage + IndexedDB），不影响其他访客。

> ⚠️ `123456` **不是安全边界**，它只是个隐藏入口。之所以敢这么设计，是因为
> 这里所有改动都只落在你自己的浏览器里，改不到服务器。**不要**把任何凭据
> 加到这个入口后面当"仅作者可用"。

### 3. 站内编辑器

在**文章页**开启创造模式后，正文下方会出现「编辑本文」按钮（设置面板里也有）。

- 左边编辑、右边是**原文对照**（只读）
- **保存草稿**（`Ctrl/Cmd + S`）：存本机浏览器，刷新不丢
- **复制** / **下载 .md**
- **去 GitHub 发布**：新标签页打开 GitHub 的网页编辑器，改完提交，Actions 自动重建

原文从哪来：构建时 Hugo 会把每篇文章的源文件**逐字节**输出成
`/posts/<slug>/index.md`（`hugo.toml` 里的 `outputFormats.Raw` + `layouts/_default/raw.md`，
用 `os.ReadFile` 读原文件，**连 frontmatter 一起**，所以标题和标签也能改）。
自己托管而不是去 GitHub 拿：`raw.githubusercontent.com` 国内不通，jsDelivr 有缓存延迟。

> 为什么不做 Markdown 实时预览：写个半吊子渲染器会给出**错误的排版暗示**，
> 不如直接显示原文。要预览就本地 `./scripts/preview.sh`，或推送后看线上。

### 想关掉这些功能

删掉 `layouts/_partials/extend_head.html` 和 `extend_footer.html` 即可，
主题本身没被动过，站点会回到原样。

---

## 目录结构

```
.
├── hugo.toml                      # ★ 全站配置：站名、作者、导航、主题参数
├── content/
│   ├── posts/                     # ★ 文章都放这里（文件名=网址，用英文短横线）
│   │   ├── _index.md              #   文章列表页的标题
│   │   └── my-post-slug.md        #   → 网址 /posts/my-post-slug/
│   ├── about.md                   # 关于页
│   ├── archives.md                # 归档页（layout: archives）
│   ├── search.md                  # 搜索页（layout: search）
│   ├── categories/_index.md
│   └── tags/_index.md
├── archetypes/
│   ├── default.md                 # 通用文章模板
│   └── research.md                # 论文复现模板
├── i18n/zh-cn.yaml                # 中文界面文案（见下方「为什么有这个文件」）
├── static/                        # 图片等静态文件，正文里用 /images/xxx.png 引用
├── themes/PaperMod/               # 主题源码，直接放进仓库（不用 submodule）
├── scripts/
│   ├── new-post.sh                # 新建文章
│   ├── publish.sh                 # 提交并推送
│   └── preview.sh                 # 本地预览
├── docs/写作规范.md                # ★ 写文章前先看这个
└── .github/workflows/hugo.yml     # 自动构建发布
```

---

## 写作流程

**先读 [`docs/写作规范.md`](docs/写作规范.md)**，里面规定了文件命名、frontmatter 字段、标签体系、
文献引用要求和几类"不确定的事情怎么写"。

### 新建一篇

```bash
./scripts/new-post.sh "文章标题"                # 通用模板
./scripts/new-post.sh "论文复现：XXX" research  # 论文复现模板（带环境/结果对比/卡点小节）
```

生成的 frontmatter 里 `draft: true`，写完改成 `false` 才会发布。

### 发布

```bash
./scripts/publish.sh "post: 文章标题"
```

脚本会：先 `git pull --rebase`（防止覆盖你在网页上的改动）→ 提交 → 推送 → 触发 Actions。

---

## 常用配置位置（都在 `hugo.toml`）

| 想改什么 | 找哪一行 |
|---|---|
| 站名 | `title` |
| 作者署名 | `author` |
| 站点描述（首页 SEO 用） | `description` |
| 首页那段自我介绍 | `[params.homeInfoParams]` 的 `Title` / `Content` |
| 导航栏 | `[[menu.main]]` 那几段 |
| 日期显示格式 | `[params] DateFormat` |
| 默认明暗主题 | `[params] defaultTheme`，可选 `auto` / `light` / `dark` |
| 首页文章数 | `paginate` |

改完直接 commit 推送即可。

---

## 为什么有 `i18n/zh-cn.yaml` 这个文件

PaperMod 主题自带 `i18n/zh.yaml`，但**没有** `zh-cn.yaml`。

而主题的 `<html lang="{{ site.Language }}">` 取的是**语言键**。要让 `<html lang="zh-cn">`
（对 SEO 和无障碍更好），就得把 Hugo 语言设成 `zh-cn`；可 i18n 是按语言键找文件的，
找不到 `zh-cn.yaml` 就会退回英文界面——日期变成 `September 15, 2026`，阅读时间变成 `2 min`。

**Hugo 会把项目目录的 `i18n/` 与主题的合并**，所以在项目里补一份同名的 `zh-cn.yaml`
就能两头兼顾。改界面文案（比如把「复制」改成「复制代码」）改这个文件即可。

---

## 主题升级

主题是 **vendored** 进仓库的，不是 submodule。升级步骤：

```bash
# 1. 下载新版源码
curl -sL -o /tmp/pm.tar.gz \
  https://codeload.github.com/adityatelange/hugo-PaperMod/tar.gz/refs/heads/master

# 2. 解包，替换整个目录
tar xzf /tmp/pm.tar.gz -C /tmp
rm -rf themes/PaperMod
cp -r /tmp/hugo-PaperMod-master themes/PaperMod
rm -rf themes/PaperMod/.github themes/PaperMod/images

# 3. 本地构建确认没问题，再提交
./scripts/publish.sh "site: 升级 PaperMod 主题"
```

**为什么要 vendored 而不是 submodule**：submodule 要求 clone 时记得 `--recurse-submodules`，
CI 里要写 `submodules: recursive`，而且主题仓库一旦 force push 或改名，构建直接挂。
vendored 是"构建时不联网、结果可复现"的做法。代价是升级要手动替换目录——
但正好留下一条 `site: 升级主题` 的 commit，出问题一眼能看出来。

---

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| push 了但页面没变 | 去仓库 **Actions** 页看构建状态；构建失败会在那报错 |
| 页面 404 | 仓库 **Settings → Pages → Source** 必须选 **GitHub Actions** |
| 部署步骤报认证失败 | 工作流少了 `id-token: write` 权限（三件套：`contents` / `pages` / `id-token`） |
| 文章写好了但没出现 | frontmatter 里 `draft` 还是 `true`；或 `date` 写成了未来时间（`buildFuture = false` 会过滤掉） |
| 界面里有英文 | i18n 没匹配上，检查 `defaultContentLanguage` 与 `i18n/<语言键>.yaml` 是否同名 |
| 图片不显示 | 图片放 `static/images/`，正文写 `/images/xxx.png`（**开头的斜杠不能少**） |
| 代码块没着色 | 代码块忘了标语言，` ```python ` 这样写 |
| 本地预览 CSS 没了 | 用 `./scripts/preview.sh`（它会设好 baseURL），别直接开 `public/index.html` |
| 搜索框搜不出东西 | 索引是构建产物，新文章要等 Actions 跑完才有；也可能是浏览器拦了 `index.json` 的 fetch |
| 搜索框根本不出现 | 检查控制台有没有 `blog-custom.js` 的报错；主题升级后确认 `layouts/_partials/` 下的两个 extend 文件还在 |
| 创造模式没反应 | 输入 `123456` 时**不要在输入框里**打字；浏览器禁用 localStorage（隐私模式）时也开不了 |
| 换壁纸没反应 | 粘贴的图片地址必须是 `https://`；https 站点加载 http 图片会被浏览器按混合内容拦掉 |
| 「编辑本文」读不到原文 | 确认 `/posts/<slug>/index.md` 存在；不存在说明 `hugo.toml` 的 `outputFormats.Raw` 或被 `outputs.page` 掉了 |

---

## 构建信息

- **Hugo** 0.166.0 extended（`theme.toml` 要求 ≥ 0.146，Ubuntu apt 里的 0.92 太老）
- **主题** PaperMod（MIT）
- **发布** GitHub Actions → GitHub Pages
- 构建耗时约 300ms，整条流水线约 40 秒
