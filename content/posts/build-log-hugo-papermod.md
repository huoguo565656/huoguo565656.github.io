---
title: "建站日志：Hugo + PaperMod + GitHub Pages，全流程与踩坑"
date: 2026-09-15T09:30:00+08:00
draft: false
author: "huoguo565656"
tags: ["Hugo", "PaperMod", "GitHub Pages", "GitHub Actions", "建站"]
categories: ["工程"]
description: "从零搭一个 Hugo 博客并自动发布到 GitHub Pages 的完整过程，含主题 vendoring、Actions 工作流和几个真实的坑。"
summary: "结论先行：Hugo + PaperMod + GitHub Actions + Pages，源码在 GitHub，push 即自动构建发布，不需要自己的服务器参与。踩到的坑：主题别用 submodule（要 vendored）、PaperMod 硬要求 Hugo ≥ 0.146（apt 里只有 0.92）、Actions 部署 Pages 缺 id-token: write 会报很晦涩的错。"
showToc: true
TocOpen: true
comments: false
---

把站搭起来了，记录一下完整过程。结论先行：**Hugo + PaperMod + GitHub Actions + Pages**，源码在 GitHub，每次 push 自动构建发布，不需要自己的服务器参与。

## 为什么这么选

| 方案 | 判断 |
|---|---|
| Hexo / Astro / Next.js | 都要 Node 构建链，依赖多、升级烦 |
| **Hugo** | **单个二进制，构建百毫秒级，无运行时依赖** ✅ |
| 手写静态站 | 外观能仿，但搜索、目录、RSS、SEO 要自己写，性价比低 |
| 动态博客（WordPress） | 要维护数据库和 PHP，为写几篇文章不值得 |

PaperMod 是 Hugo 生态里完成度最高的个人博客主题之一：暗色模式、站内搜索、目录、标签、归档、RSS、SEO、代码复制全都自带。

## 目录结构

```
blog/
├── hugo.toml                  # 全站配置（站名/作者/菜单都在这里）
├── content/
│   ├── posts/                 # ← 文章都放这儿
│   ├── about.md               # 关于页
│   ├── archives.md            # 归档页
│   └── search.md              # 搜索页（依赖首页输出的 index.json）
├── themes/PaperMod/           # 主题源码，直接放进仓库
├── archetypes/                # 新建文章的模板
├── scripts/                   # 新建/预览/发布脚本
└── .github/workflows/hugo.yml # 自动构建发布
```

## 坑一：主题不要用 git submodule

网上多数教程让你这样：

```bash
git submodule add https://github.com/adityatelange/hugo-PaperMod themes/PaperMod
```

**能用，但埋雷**：clone 的人必须记得 `--recurse-submodules`，CI 里要写 `submodules: recursive`，主题仓库一旦 force push 或改名，你的构建直接挂。

我改成**把主题源码直接放进仓库**（vendored）：711KB 的主题，去掉 `.github` 和示例图后 526KB。

```bash
curl -sL -o pm.tar.gz \
  https://codeload.github.com/adityatelange/hugo-PaperMod/tar.gz/refs/heads/master
tar xzf pm.tar.gz
cp -r hugo-PaperMod-master blog/themes/PaperMod
```

好处：构建时不联网取主题，**构建结果可复现**，升级时显式替换目录并留一条 commit，出了问题一眼能看出是哪次换的。

## 坑二：PaperMod 要求 Hugo ≥ 0.146

`theme.toml` 里写着 `min_version = "0.146.0"`。

Ubuntu 22.04 的 apt 源里是 **0.92.2**，差了 50 多个小版本，直接用会报一堆模板错误。

装新版（注意要 **extended**，虽然 PaperMod 本身不含 SCSS，但保不齐以后要加）：

```bash
V=0.166.0
curl -sL -o hugo.tar.gz \
  "https://github.com/gohugoio/hugo/releases/download/v$V/hugo_extended_${V}_linux-amd64.tar.gz"
tar xzf hugo.tar.gz && install -m 755 hugo /usr/local/bin/hugo
hugo version
```

在 GitHub Actions 里则用官方 deb 包安装，比第三方 action 少一层依赖：

```yaml
- name: 安装 Hugo
  run: |
    wget -O ${{ runner.temp }}/hugo.deb \
      https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.deb
    sudo dpkg -i ${{ runner.temp }}/hugo.deb
```

## 坑三：Actions 部署 Pages 要的三样权限

Pages 部署失败最常见的原因是权限没给够。工作流里必须有：

```yaml
permissions:
  contents: read   # 读仓库
  pages: write     # 写 Pages
  id-token: write  # OIDC 令牌，deploy-pages 要靠它
```

少 `id-token: write` 会在 deploy 那一步报认证失败，而且错误信息很不直观。

另外仓库的 **Settings → Pages → Source 必须选 "GitHub Actions"**，选错了会一直部署到默认分支的根目录，页面 404。

## 可选：拿仓库里实际的提交时间

Hugo 默认用 frontmatter 的 `date`。想让文章的更新时间自动跟 git 提交走，可以在配置里开：

```toml
enableGitInfo = true
```

然后在 frontmatter 用 `lastmod`。**注意**：Actions 里 checkout 必须带 `fetch-depth: 0`，浅克隆拿不到完整历史，`enableGitInfo` 会失效。

## 发布流程

写完之后：

```bash
git add -A
git commit -m "post: 文章标题"
git push
```

推送后 Actions 自动构建，约 40 秒后 Pages 生效。**不需要本地装 Hugo**——构建完全在云端做。这也是我选 Actions 而不是本地构建推送 `public/` 的原因：少一个"我本地环境和线上不一致"的故障源。

## 小结

- 主题 **vendored**，不用 submodule
- Hugo 版本要 **≥ 0.146**，用 extended
- Actions 权限三件套 `contents/pages/id-token`
- Pages 的 Source 选 **GitHub Actions**
- 构建放云端，本地只写 Markdown

---

*本文的所有命令都在一台国内云服务器（Ubuntu 22.04）上实际执行过。*
