---
title: "实测：国内不同网络环境下，GitHub 到底哪些入口通"
date: 2026-09-15T10:00:00+08:00
draft: false
author: "huoguo565656"
tags: ["GitHub", "网络", "运维", "实测"]
categories: ["工程"]
description: "同一时间在两个国内网络环境实测 GitHub 各域名与端口的连通性，并给出取数、推送、下载的可选路径。"
summary: "同一时间测了两个国内网络环境，差异是互补的：`github.com` HTTPS 在家庭宽带通、在服务器不通；而服务器上 `github.com:22` 和 `ssh.github.com:443` 都是通的（报 Permission denied (publickey) 就意味着链路没问题，只差登记公钥）。唯一两边都不通的是 `raw.githubusercontent.com`。取单个文件请改走 api.github.com 加 Accept 头。"
showToc: true
TocOpen: true
comments: false
---

结论先行：**`github.com` 通不通，取决于你在哪个网络；但 `raw.githubusercontent.com` 在两边都不通。**

这件事值得单独记一篇，因为网上的结论大多含糊，而它直接决定你的脚本该走哪条路。

## 一、说明测法

以下全部是 **一次性实测**，不是转述：

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

# HTTPS 探测
curl -s -o /tmp/out.bin -m 12 -A "$UA" -w '%{http_code}\n' -L "$URL"

# 端口探测
timeout 8 bash -c 'exec 3<>/dev/tcp/HOST/PORT' && echo 可连 || echo 不通
```

⚠️ **一个方法论提醒**：测之前先确认有没有走代理。

```bash
env | grep -i proxy          # 看环境变量
curl -v "$URL" 2>&1 | grep -i "trying\|connected"
```

我一开始就栽在这上面——环境里配了一个代理，`github.com` 经代理返回 `000`，看起来像"被墙"，**直连却是 200**。差点得出完全相反的结论。要么显式 `--noproxy '*'`，要么显式指定代理，**不要让它随机**。

## 二、环境 A：国内云服务器（Ubuntu 22.04，华东节点）

| 入口 | 结果 | 用途 |
|---|---|---|
| `api.github.com` | ✅ 200，**404 语义正确** | 读仓库、看文件是否存在 |
| `codeload.github.com` | ✅ 301（可达） | 下载仓库源码包 |
| `objects.githubusercontent.com` | ✅ 404（域名可达） | Releases 资源 |
| **`github.com:22`（SSH）** | ✅ **可连** | **git push / pull** |
| **`ssh.github.com:443`** | ✅ **可连** | **git over 443，更稳** |
| `github.com` (HTTPS) | ❌ 不通 | 网页、`git clone https://` |
| `raw.githubusercontent.com` | ❌ 不通 | 取单个原始文件 |
| `raw.gitmirror.com` | ❌ 不通 | — |
| `ghfast.top`（代理） | ✅ 200 / 404 | 取文件、**代理 Releases 下载** |
| `ghproxy.net`（代理） | ✅ 200 / 404 | 同上 |
| `gh-proxy.com`（代理） | ✅ 200 | 同上 |
| `cdn.jsdelivr.net` | ⚠️ 200 但**经常超时**（25s 级） | 兜底，且缓存陈旧 |

### 这一栏最有价值的两条

**① `github.com` 的 HTTPS 不通，但 SSH 通。**

这是最反直觉的一点。很多人看到"连不上 GitHub"就放弃在服务器上做 git 操作了，其实：

```bash
# 这两条虽然连不上
git clone https://github.com/user/repo      # ✗

# 但这条可以，只差登记公钥
git clone git@github.com:user/repo          # ✓
```

判断链路是否真的通，看这个报错：

```bash
ssh -T git@github.com
# Permission denied (publickey)   ← 链路通！只是没登记公钥
# Connection timed out            ← 这才是真连不上
```

**"Permission denied (publickey)" 是好消息**，它意味着 TCP、TLS、认证握手全都走通了，只差把你的公钥加到 GitHub。反之如果看到的是 `Permission denied` 就以为被墙然后放弃，那就亏了。

嫌 22 端口不稳，可以让 git 走 443：

```bash
# ~/.ssh/config
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/github_deploy
    IdentitiesOnly yes
```

**② 取单个文件：优先 `api.github.com`，不是 `raw`。**

`raw.githubusercontent.com` 不通，但 GitHub 的 contents API 有个约定俗成的用法——**加一个 Accept 头就直接返回原始内容**，免掉 base64 解码：

```bash
curl -H "Accept: application/vnd.github.raw" \
     -H "User-Agent: your-app" \
     "https://api.github.com/repos/OWNER/REPO/contents/PATH"
```

- 文件存在 → `200` + 原始字节
- 不存在 → `404`
- 未认证限额 60 次/小时

注意 **必须带 `User-Agent`**，否则 GitHub API 直接拒绝。

## 三、环境 B：国内家庭宽带（同一时段）

| 入口 | 结果 |
|---|---|
| `github.com` (HTTPS) | ✅ 200，1.14s |
| `codeload.github.com` | ✅ 200，1.08s |
| `api.github.com` | ✅ 200 |
| `raw.githubusercontent.com` | ❌ 不通（典型 DNS 污染） |
| `*.github.io`（Pages） | ✅ 200，约 3.1s |

所以两个环境的差异是**互补的**：

```
                服务器        家庭宽带
github.com HTTPS   ✗             ✓
raw.githubcontent  ✗             ✗
api.github.com     ✓             ✓
SSH (22 / 443)     ✓             ✓
```

**`raw.githubusercontent.com` 是唯一两边都不通的。** 如果你只想记一条，记这条。

## 四、按场景选路径

| 你要做的事 | 走哪条 |
|---|---|
| 在服务器上 clone / push 仓库 | **SSH**（22 或 443），先登记部署公钥 |
| 脚本里读仓库里的单个文件 | `api.github.com/.../contents/PATH` + `Accept: application/vnd.github.raw` |
| 下载整个仓库 / 主题源码包 | `codeload.github.com/OWNER/REPO/tar.gz/refs/heads/BRANCH` |
| 下载 GitHub Releases 里的二进制 | 走 `ghfast.top` / `ghproxy.net` 代理前缀 |
| 浏览器里看仓库、提 issue、改文件 | 家庭宽带直连 `github.com` 即可 |

代理前缀的写法就是拼接：

```
https://ghfast.top/https://github.com/OWNER/REPO/releases/download/v1.0/file.tar.gz
```

## 五、几条工程上的注意

1. **别把代理当主路。** 这类公益代理随时可能失效，而且故障模式不透明。让主路走官方域名（`api.github.com` / SSH），代理只做降级。
2. **单文件的判定要"权威源短路"。** 探测文件是否存在时，不要把所有入口都问一遍——权威源回 404 就直接收工，否则每次"文件还没发布"都要把所有镜像（包括会超时的）等完。实测这一条能差 **90 倍**耗时（60 秒 vs 0.66 秒）。
3. **`git clone` 时留意子模块。** 主题之类的依赖如果用了 submodule，clone 时必须 `--recurse-submodules`，且构建时会二次联网。**宁可 vendored。**
4. **网络结论有保质期。** 以上是 2026 年 9 月的单次实测，会变。动手前用第一节的命令复测一遍，两分钟的事。

---

*两个测试环境：一台国内云服务器（Ubuntu 22.04，华东节点）与国内家庭宽带。测于 2026-09-15。*
