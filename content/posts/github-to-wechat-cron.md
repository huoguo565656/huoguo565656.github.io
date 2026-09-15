---
title: "用国内服务器定时抓取 GitHub 更新，推送到微信"
date: 2026-09-15T16:30:00+08:00
draft: false
author: "huoguo565656"
tags: ["GitHub", "Server酱", "cron", "微信推送", "运维", "Python", "实测"]
categories: ["工程"]
description: "在国内服务器上定时监控 GitHub 仓库的新内容并推送到微信：三个坑（raw 不通、判定逻辑慢 90 倍、接口成功但收不到）与完整脚本。"
summary: "在国内服务器上每天定时检查 GitHub 仓库有没有新文件，有就推送到微信。三个不踩不知道的坑：① raw.githubusercontent.com 从国内服务器根本连不上，要改走 api.github.com 的 contents 接口；② 判定逻辑写成「所有镜像都问一遍」，会让「还没发布」这个最常见的情况慢 90 倍（60 秒 vs 0.66 秒）；③ Server酱 在没关注服务号时会静默失败 —— 接口返回成功但消息不送达。文末附完整可运行脚本与幂等 crontab。"
showToc: true
TocOpen: true
comments: false
---

> 起因：我订阅了阮一峰的《科技爱好者周刊》，但它只在 GitHub 上更新。每次都要主动去翻，经常漏掉。
> 于是想在服务器上加个定时任务：**每周五一出新一期，自动把全文推到微信**。
>
> 整个过程踩了三个坑，其中两个不踩根本不知道。记下来。

---

## 最终效果

服务器上跑一个每天一次的任务，发现新一期就推微信：

```
[2026-09-15 14:04:27] [INFO ]   第 412 期正文取自 api.github.com（17246 字节）
[2026-09-15 14:04:27] [INFO ] 第 412 期《科技爱好者周刊（第 412 期）：禁止 issue，只用 PR》准备推送（标题 31 字 / 正文 17356 字节）
[2026-09-15 14:04:29] [INFO ] 第 412 期推送成功 ✔
```

环境：一台国内云服务器，Ubuntu 22.04，Python 3.10（**只用标准库，不装任何包**）。

---

## 坑一：国内服务器连不上 GitHub

第一反应当然是直接取 raw 文件：

```bash
curl https://raw.githubusercontent.com/ruanyf/weekly/master/docs/issue-412.md
```

在这台服务器上，**不通**。实测一遍所有候选入口：

| 入口 | 结果 |
|---|---|
| `raw.githubusercontent.com` | ❌ 连不上 |
| `github.com` | ❌ 连不上 |
| `api.github.com` | ✅ 200，且 404 语义正确 |
| `ghfast.top`（代理镜像） | ✅ 200 / 404 |
| `ghproxy.net`（代理镜像） | ✅ 200 / 404 |
| `gh-proxy.com`（代理镜像） | ✅ 200 |
| `cdn.jsdelivr.net` | ✅ 200 / 404，但**经常超时**（25 秒级），且缓存陈旧 |
| `raw.gitmirror.com` | ❌ 连不上 |

`raw` 不通但 `api.github.com` 通——这个组合其实挺常见，因为两者走的是完全不同的基础设施。

### 解法：用 contents API 直接拿原文

很多人以为必须走 contents API 拿 base64 再解码。其实加一个 Accept 头就直接返回原始内容：

```bash
curl -H "Accept: application/vnd.github.raw" \
     -H "User-Agent: your-app" \
     "https://api.github.com/repos/ruanyf/weekly/contents/docs/issue-412.md"
```

- 文件存在 → `200` + 原始字节（和 raw 一模一样）
- 文件不存在 → `404`
- 未认证限额 60 次/小时（每天取一个文件，绰绰有余）

两个注意点：
1. **必须带 `User-Agent`**，否则 GitHub API 会直接拒掉。
2. `404` 语义准确这件事很关键——它是我判断"这一期还没发布"的唯一依据（下面会讲为什么）。

### 兜底：镜像 + positive wins

虽然 `api.github.com` 现在是通的，但不能只有一条路。我保留了三个代理镜像做降级。规则是 **positive wins**：

> 任一镜像返回 200 就算文件存在。

因为镜像可能因为缓存或故障误报 404，但很难把不存在的文件"变"出来。

---

## 坑二：判定逻辑写错，慢 90 倍

这是最值得记的一条。

我最初的判定逻辑是"稳"字优先：

```
所有入口都问一遍 → 任一返回 200 就认定存在
→ 都没有 200，且至少一个明确 404，才判定"还没发布"
```

听起来很稳妥。**结果每次判定"这一期还没发布"要花 60 秒。**

原因是：文件不存在时，主路返回 404 很快，但 jsDelivr 每次要超时 25 秒，我还给它写了重试——25 × 2 + 等待 ≈ 60 秒。

而这个任务**绝大多数时候都在判定"还没发布"**（一周只有一次是真的有新内容）。等于每天白等一分钟。

### 改法：权威源短路

```python
# 1) 只问权威源 api.github.com
#    200 → 存在，取正文，结束
#    404 → 明确不存在，立刻结束
#    连不上 → 才退到 2)
# 2) 依次试镜像，positive wins
```

**0.66 秒**。而且每天正常只发 **1 次请求**。

为什么可以信任单个源的 404？因为 `api.github.com` 是权威源，**不存在 CDN 缓存陈旧的问题**。而镜像会——所以"多个源交叉验证"这套只该用在镜像之间，不该用在权威源上。

> 一句话总结：**交叉验证要用在不可靠的源上；对权威源应该短路，不要为了"稳"把可靠的东西也拉进来一起等。**

### 顺带一个必须区分的点

**网络错误 ≠ 404。**

如果把网络错误也当成"不存在"，会导致这一期永远不被推送（程序认为已经处理过了）。所以三种状态必须分开：

| 状态 | 含义 | 动作 |
|---|---|---|
| `ok` | 拿到了 | 推送，推进进度 |
| `notfound` | 权威源明确 404 | 不推送，**不推进进度** |
| `error` | 网络/镜像全挂 | 不推送，**不推进进度**，下次重试 |

---

## 坑三："接口返回成功但手机没收到"

推送用的是 [Server酱](https://sct.ftqq.com/)。它的 API 简单到离谱：

```bash
curl -X POST "https://sctapi.ftqq.com/<你的SENDKEY>.send" \
  -d "title=标题" \
  -d "desp=**正文**，支持 Markdown"
```

返回 `{"code":0,...}` 就是成功。

### Server酱有两代，域名规则不同

它的 SendKey 有两种形态，**推送地址不一样**，写死一个会有一半用户用不了：

| 产品 | SendKey 形态 | 推送地址 |
|---|---|---|
| Turbo（SCT） | `SCTxxxx...` | `https://sctapi.ftqq.com/<key>.send` |
| Server酱³（SC3） | `sctp<uid>tXXXX` | `https://<uid>.push.ft07.com/send/<key>.send` |

按 key 形态自动判断：

```python
m = re.match(r"^sctp(\d+)t", key)
url = (f"https://{m.group(1)}.push.ft07.com/send/{key}.send" if m
       else f"https://sctapi.ftqq.com/{key}.send")
```

### 限制（免费额度下必须知道的）

| 项 | 免费 | 订阅 |
|---|---|---|
| 每天发送条数 | **5 条** | 1000 条 |
| 卡片内容显示 | **仅显示标题** | 标题 + 内容 |
| 正文保留时间 | **1 天** | 3 天 |

- 每分钟最多 50 条（防程序刷屏）
- `title` **不能包含换行符**，上限 32 字符
- `desp` 上限 32KB，**只能引用公网图片 URL**，不支持 base64
- 新用户有 7 天全功能试用——**试用期过了卡片就只剩标题了**，这点要有心理准备

### "接口成功但收不到"的排查顺序

这是官方给的顺序，我照着用过，很好使：

1. 看 API 返回值，`code` 非 0 时 `message` 会说明原因
2. 检查当天免费额度（5 条）是否用完
3. 检查是否触发每分钟 50 条限制
4. **微信端确认没有取消关注 / 屏蔽服务号**
5. 到控制台看推送日志确认真实投递状态

**第 4 条是头号杀手**：没关注它提示的那个微信服务号时，API 依然返回成功，但消息不会送达。所以"返回成功"不等于"用户收到了"。

另外微信新版本把服务号消息折叠在「服务号」入口里，不在聊天列表最上面,很容易以为没收到。

---

## 完整脚本

下面是一个可以直接跑的精简版（约 150 行）。生产用的完整版还额外有 CLI 参数、状态文件、日志滚动、并发锁，逻辑是一样的。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""监控 GitHub 仓库的新文件并推送到微信"""

import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

REPO, BRANCH = "ruanyf/weekly", "master"
UA = "Mozilla/5.0 (compatible; weekly-push/1.0)"
TIMEOUT = 15
BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "state.json")

# 取数入口：第一个是权威源，后面是镜像
SOURCES = [
    {"name": "api.github.com",
     "url": "https://api.github.com/repos/{repo}/contents/docs/issue-{n}.md",
     "headers": {"Accept": "application/vnd.github.raw"}},
    {"name": "ghfast.top",
     "url": "https://ghfast.top/https://raw.githubusercontent.com/{repo}/{branch}/docs/issue-{n}.md"},
    {"name": "ghproxy.net",
     "url": "https://ghproxy.net/https://raw.githubusercontent.com/{repo}/{branch}/docs/issue-{n}.md"},
]
PRIMARY, FALLBACKS = SOURCES[0], SOURCES[1:]


def log(msg):
    print("[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg), flush=True)


def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=dict({
        "User-Agent": UA,
        "Accept-Encoding": "identity",     # 不要压缩，省掉解压
    }, **(headers or {})))
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status, r.read()


def try_source(src, n):
    """返回 ('ok', 正文) / ('404', None) / ('err', 原因)"""
    url = src["url"].format(repo=REPO, branch=BRANCH, n=n)
    try:
        code, body = http_get(url, src.get("headers"))
    except urllib.error.HTTPError as e:
        return ("404", None) if e.code == 404 else ("err", "HTTP %s" % e.code)
    except Exception as e:
        return "err", type(e).__name__
    if code == 404:
        return "404", None
    if code != 200:
        return "err", "HTTP %s" % code
    if not body:
        return "err", "空响应"
    text = body.decode("utf-8", "replace")
    # 有些镜像对缺失路径会回 HTML 页而不是 404，做个样式校验
    if not text.lstrip().startswith("#"):
        return "err", "内容不像正文"
    return "ok", text


def fetch(n):
    """
    权威源短路：api.github.com 回 404 就直接判定"还没发布"，
    不为了"稳"把所有镜像都等一遍 —— 那会把 0.6 秒变成 60 秒。
    """
    st, val = try_source(PRIMARY, n)
    if st == "ok":
        return "ok", val, PRIMARY["name"]
    if st == "404":
        return "notfound", None, "%s 返回 404" % PRIMARY["name"]

    errs, saw404 = ["%s %s" % (PRIMARY["name"], val)], False
    for src in FALLBACKS:                   # 主路挂了才启用镜像
        st, val = try_source(src, n)
        if st == "ok":
            log("改从镜像 %s 取到" % src["name"])
            return "ok", val, src["name"]
        if st == "404":
            saw404 = True
        else:
            errs.append("%s %s" % (src["name"], val))
    return ("notfound", None, "；".join(errs)) if saw404 else ("error", None, "；".join(errs))


def build(text, n):
    """把正文拆成 (标题, 正文)"""
    title, skip = "第 %d 期" % n, 0
    for i, line in enumerate(text.splitlines()[:6]):
        if line.startswith("# "):
            title, skip = line[2:].strip(), i + 1
            break
    body = "\n".join(text.splitlines()[skip:]).strip()
    body += ("\n\n---\n\n原文：https://github.com/%s/blob/%s/docs/issue-%d.md"
             % (REPO, BRANCH, n))
    # 按字节截断（Server酱 desp 上限 32KB）
    raw = body.encode("utf-8")
    if len(raw) > 30000:
        body = raw[:30000].decode("utf-8", "ignore") + "\n\n> 内容过长已截断"
    return title[:32].replace("\n", " "), body


def push(title, desp, key):
    m = re.match(r"^sctp(\d+)t", key)
    url = (f"https://{m.group(1)}.push.ft07.com/send/{key}.send" if m
           else f"https://sctapi.ftqq.com/{key}.send")
    data = urllib.parse.urlencode({"title": title, "desp": desp}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                headers={"User-Agent": UA,
                                         "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            j = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:          # 非 2xx 时正文在异常对象里
        j = json.loads(e.read().decode("utf-8", "replace"))
    if j.get("code") == 0:
        return True, ""
    return False, "code=%s msg=%s" % (j.get("code"), j.get("message") or j.get("info"))


def main():
    key = os.environ.get("SERVERCHAN_KEY", "").strip()
    if not key:
        log("缺少 SERVERCHAN_KEY"); return 2

    st = {"last_pushed": 412}
    if os.path.exists(STATE):
        st = json.load(open(STATE, encoding="utf-8"))

    n = st["last_pushed"] + 1
    status, text, detail = fetch(n)
    if status == "notfound":
        log("第 %d 期还没发布（%s）" % (n, detail)); return 0
    if status == "error":
        log("第 %d 期取数失败：%s" % (n, detail)); return 1

    title, body = build(text, n)
    ok, msg = push(title, body, key)
    if not ok:
        log("推送失败：%s" % msg); return 1

    st["last_pushed"] = n
    tmp = STATE + ".tmp"
    json.dump(st, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, STATE)          # 原子写，避免中断后状态文件损坏
    log("第 %d 期已推送：%s" % (n, title))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 部署

```bash
mkdir -p /root/weekly-push && cd /root/weekly-push
# 放入 weekly_push.py
echo 'SERVERCHAN_KEY=SCT你的key' > config.env
chmod 600 config.env                # 里面有凭据
```

> 🔒 **关于凭据的三条纪律**（我踩过第一条）：
> 1. **不要在调试/状态输出里打印完整密钥。** 我最初写的 `--status` 会把它拼进推送地址一起打出来，
>    这份输出一旦被贴到博客、issue 或聊天里就等于泄露。**任何要展示 URL / 配置的地方都要先打码。**
> 2. 不要把密钥写进 crontab 命令行——`ps aux` 对所有人可见。
> 3. 确认它只存在于那一个 `chmod 600` 的文件里。随手一验：
>    ```bash
>    grep -rl "你的key开头几位" /你的目录/
>    ```
>    应该**只有一个文件**命中。

### 注册 crontab（幂等）

不要用 `crontab -l | ... | crontab -` 直接追加——重复执行会产生重复条目。用替换式：

```bash
CRON_LINE="0 20 * * * /usr/bin/python3 /root/weekly-push/weekly_push.py >> /root/weekly-push/logs/cron.log 2>&1"

TMP=$(mktemp)
crontab -l 2>/dev/null | grep -vF "weekly_push.py" > "$TMP" || true
echo "$CRON_LINE" >> "$TMP"
crontab "$TMP" && rm -f "$TMP"
systemctl is-active cron >/dev/null || systemctl enable --now cron
```

**幂等的关键**是先 `grep -v` 删掉同名旧条目再追加，重复执行不会堆叠。

> ⚠️ **别把密钥写进 crontab 行。** cron 不继承你的 shell 环境，直接把 key 塞进命令行虽然能跑，
> 但任何用户 `ps aux` 都能看到。上面示例脚本从环境变量读 key，实际部署时改成
> **让脚本自己读同目录的 `config.env`**（`chmod 600`），既安全也不会泄露到进程列表。

**选 20:00 不是拍脑袋**，先查目标仓库的提交时间分布：

```bash
curl -s -H "User-Agent: x" \
  "https://api.github.com/repos/ruanyf/weekly/commits?path=docs/issue-412.md&per_page=1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['commit']['committer']['date'])"
```

实测在 UTC 01:41–08:30 之间落地，即**北京时间 10:00–16:30**。
所以 20:00 跑能在发布**当天**就接住，比早上跑少等一天。

---

## 几个设计取舍

**1. 只推 Markdown 原文，不做摘要。**
周刊本身就有信息密度，摘要会丢东西。代价是消息长（17KB），但 `desp` 上限 32KB 够用。

**2. 单次最多推 3 期。**
服务器可能停机很久，一次涌出 10 期消息既没意义也会撞免费额度（5 条/天）。宁可分几天慢慢补。

**3. 正文按字节截断，不按字符。**
中英混排时字符数骗人。`title` 32 字符、`desp` 32KB 都是硬限，按字节算才准。

**4. 只用标准库。**
服务器上 `python3` 自带，不用 `pip install` 任何东西。少一层依赖就少一类"重启后跑不起来"。

**5. 网络错误和 404 严格区分。**
见坑二。搞混会导致永久漏推。

---

## 顺便记一下：可复用的经验

- 国内服务器取 GitHub 单文件，优先试 `api.github.com` + `Accept: application/vnd.github.raw`，
  比 `raw.githubusercontent.com` 靠谱得多。
- 多源降级别写成"每个源都问一遍"。**权威源短路，镜像才做交叉验证**。
- 定时任务的进度状态要**原子写**（`os.replace`），并且**失败时绝不推进**。
- `crontab` 注册要幂等，否则反复部署会堆出一串重复任务。
- 任何"第三方推送服务"，都要先搞清楚**失败是静默的还是可见的**。
  Server酱 的坑就在于：**没关注服务号时 API 依然返回成功**。

---

*文中接口实测数据来自 2026 年 9 月的国内云服务器（华东节点），网络环境会变，动手前建议自己复测一遍。*
