---
title: "在 WSL2 里安装 DeepSeek Harness：完整步骤与排错清单"
date: 2026-09-16T09:30:00+08:00
draft: false
author: "huoguo565656"
tags: ["WSL2", "DeepSeek", "Node.js", "nvm", "Windows", "排错"]
categories: ["工程"]
description: "在 Windows 的 WSL2 Ubuntu 里用 npx 跑起 DeepSeek Harness Web UI 的完整流程，含国内网络下载 Node 的坑、端口冲突、localhost 打不开的排查，以及官方安全边界说明。"
summary: "在 Windows 的 WSL2 里跑 DeepSeek Harness（dsh）Web UI：装 WSL2 + Ubuntu 24.04、装 Node 22、配编译环境、启动、浏览器访问与首次配置，最后是一份排错清单。两个最常卡住的地方：① nvm 的安装脚本托管在 raw.githubusercontent.com，国内直连不通，得换源；② dsh 默认端口是 3080，而 3080 很容易落进 Windows 的 WinNAT 保留端口段，所以要换端口。另外官方明确标了 developer preview 且未做安全审计，文末按官方原文说明安全边界。"
showToc: true
TocOpen: true
comments: false
---

> 目标：在 Windows 的 WSL2 Ubuntu 里，用 `npx` 跑起 **DeepSeek Harness（`dsh`）** 的 Web UI，然后从 Windows 浏览器访问。
>
> 命令里的 `<你的Linux用户名>`、`<启动时输出的token>` 需要按实际替换。**token 和 API Key 都不要保存进文件、不要分享。**

---

## 0. 先说三条前提，不然容易白折腾

在动手之前值得知道这三件事，它们决定了你该把它装在哪：

**① 它是 developer preview。** 官方 README 里有一句全大写的警告：

> DeepSeek Harness is in *developer preview* and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

配置格式、命令参数、插件接口都可能在小版本之间改掉。**别把它当长期稳定的基础设施。**

**② 官方没有对它做过安全审计。** `SAFETY.md` 原文：

> DeepSeek Harness is experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.

**③ 它会执行模型生成的代码和命令。** 同一份文档里：

> The project can execute model-generated code and commands, load third-party plugins, and access the network, processes, credentials, and files made available to it.

所以官方给的使用建议是：

> - Run the project with the least privileges and access required.
> - **Prefer a disposable virtual machine, container, or dedicated environment.**
> - Keep backups of files that the project can access.
> - Do not expose sensitive credentials or data unless you accept the risk.

**结论**：WSL2 这个用法是合适的——它本身就是个和 Windows 宿主机有边界的环境。但仍要注意两点：

- **工作区别选 `/mnt/c/...`**（等于把整个 Windows 盘交给它），选 WSL2 内部的目录；
- **不要往里塞重要凭据**，别让它可以访问你的 SSH 私钥、云平台密钥之类的目录。

---

## 1. 前置条件

| 项 | 要求 |
|---|---|
| Windows | Windows 10 版本 1903（内部版本 18362）以上，或 Windows 11 |
| 虚拟化 | BIOS/UEFI 里开启 Intel VT-x / AMD-V |
| 权限 | 管理员 PowerShell（装 WSL 需要） |
| 建议版本 | 从 **Microsoft Store** 装 WSL，能持续收到更新 |

先确认虚拟化开没开。任务管理器 → 性能 → CPU，右下角看「虚拟化」是否为「已启用」。

---

## 2. 安装 WSL2 与 Ubuntu 24.04

### 2.1 只装 WSL2 本体，先不装发行版

管理员 PowerShell：

```powershell
wsl --install --no-distribution
```

`--no-distribution` 的作用是**只装 WSL 组件、不自动装 Ubuntu**。这样你能控制接下来装哪个版本、装到哪里。

装完**重启电脑**。

重启后回到管理员 PowerShell，确认状态：

```powershell
wsl --set-default-version 2
wsl --list --online
```

第二条会列出所有可安装的发行版名。**把这个列表里 Ubuntu 那一行的准确名称记下来**——后面 `-d` 参数要用它，写错了会报 "no distribution found"。

### 2.2 装 Ubuntu 到指定目录（可选）

想装到 D 盘而不是 C 盘，用 `--location`：

```powershell
wsl --install -d Ubuntu-24.04 --location "D:\WSL\Ubuntu2404"
```

> `--location` 需要较新的 WSL。如果你的版本不认这个参数，走下面的导出/导入迁移。
> 顺带一提 `--no-launch` 也有用：`wsl --install -d Ubuntu-24.04 --no-launch` 会装但不启动。

**旧版本 WSL 的迁移办法**：

```powershell
wsl --shutdown
wsl --export Ubuntu-24.04 D:\wsl-backup.tar
wsl --unregister Ubuntu-24.04
wsl --import Ubuntu-24.04 D:\WSL\Ubuntu2404 D:\wsl-backup.tar --version 2
```

⚠️ **`wsl --unregister` 是破坏性操作**，微软文档的原话是「与该分发关联的所有数据、设置和软件都将永久丢失」。所以顺序必须是**先 `--export` 再 `--unregister`**，别把这两行拆开执行。

### 2.3 导入后恢复默认用户（这一步有坑）

用 `--import` 导入的分发版，默认用户会变成 `root`。这时候**不能**用常见的那条命令改：

```powershell
# ✗ 对导入的分发版无效
ubuntu2404.exe config --default-user <你的Linux用户名>
```

微软文档明确说了：**此命令不适用于导入的分发版，因为这些分发版没有可执行启动器**。正确做法是改 `/etc/wsl.conf`：

```powershell
wsl -d Ubuntu-24.04 -e bash -c "echo '[user]' > /etc/wsl.conf && echo 'default=<你的Linux用户名>' >> /etc/wsl.conf"
wsl --terminate Ubuntu-24.04
```

**验证**：重新进入后 `whoami`，应该输出你的用户名而不是 `root`。

> 如果是正常 `wsl --install` 装的（没走导入），首次启动时会提示你创建 Linux 用户名和密码，不需要这一步。

---

## 3. 进入 WSL2 终端

三种方式，任选：

- 开始菜单搜 **Ubuntu** 打开
- Windows Terminal 下拉菜单里选 Ubuntu
- 或在任意 PowerShell 里直接 `wsl`

进去后建议先回主目录，避免在 `/mnt/c/...` 下操作：

```bash
cd ~
```

**检查点**：`pwd` 应该输出 `/home/<你的Linux用户名>`。如果输出 `/mnt/c/...`，说明你还在 Windows 盘上，后面装东西会很慢且权限容易出问题。

---

## 4. 安装 Node.js 22

### ⚠️ 先看这一条：nvm 的安装脚本国内直连不通

常见教程给的这一行：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
```

**`raw.githubusercontent.com` 在国内直连是不通的**（实测返回超时/连接失败，不是慢，是根本连不上）。直接跑会卡住或者拿到空文件，`bash` 读到空输入什么也不做，你会以为"装好了"其实没有。

**两个可行办法：**

**办法一，走代理**（如果你本机有可用代理）：

```bash
export https_proxy=http://127.0.0.1:你的代理端口
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
unset https_proxy
```

**办法二，改用国内镜像的 Node 源，绕开 nvm**：

```bash
# 直接从国内镜像拿 Node 22 二进制
curl -fsSL https://npmmirror.com/mirrors/node/v22.23.2/node-v22.23.2-linux-x64.tar.xz \
  -o /tmp/node.tar.xz
sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
echo 'export PATH=/usr/local/lib/nodejs/node-v22.23.2-linux-x64/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

> `raw.githubusercontent.com` 被墙这一点，也会影响后面 `npx` 拉包时某些依赖的构建脚本。
> 如果遇到卡在下载，可以先设 `npm config set registry https://registry.npmmirror.com`。

### 装完确认

```bash
node --version    # 期望 v22.x
npm --version
```

**要 Node.js 22 以上。** 版本过低时 `npx` 会在解依赖阶段就报错。

> 用到的是 nvm 最新版 **v0.40.7**（2026-08-18 发布）。老教程里的 v0.40.1 仍能用，但既然要装就装新的。

---

## 5. 安装编译依赖

DSH 的依赖里有原生模块，需要本地编译工具链：

```bash
sudo apt update
sudo apt install -y build-essential
```

**检查点**：

```bash
gcc --version
g++ --version
```

如果 Ubuntu 自带的 g++ 版本太老导致编译失败，可以指定更新的版本：

```bash
sudo apt install -y g++-11
```

---

## 6. 启动 DeepSeek Harness

官方推荐用法是：

```bash
npx @deepseek-ai/dsh web
```

**但建议改成这样跑**（两个参数都有实际用处）：

```bash
cd ~
npx --yes @deepseek-ai/dsh web --port 13080 --no-open
```

- `--yes`：不弹「是否安装这个包」的交互提示。第一次用 `npx` 拉包时必问，加上它可以非交互运行。
- `--no-open`：不在 WSL2 里尝试打开浏览器（那里没有图形浏览器，开了也没用）。
- `--port 13080`：**换端口，原因见下**。

### 为什么要换掉默认端口

**`dsh web` 的默认端口是 3080**（官方 README：*starts the Web UI at `http://127.0.0.1:3080` by default*）。

而 **3080 很容易落在 Windows 的 WinNAT/Hyper-V 保留端口段里**，表现是服务明明起来了、浏览器却「连接被拒绝」。

确认是不是这个原因：

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

看输出里有没有覆盖 3080 的区间。有的话，换个靠后且不常见的端口就行——**13080** 是个不错的选择（避开常见的 3000/3080/8080 等）。

### 关于 `--host 0.0.0.0`

**不要**把它加到 `--host 0.0.0.0` 去暴露服务。

一是官方安全说明要求「以所需的最小权限和最小访问范围运行」；二是**没有这个必要**——WSL2 有 localhost 转发，Windows 侧的浏览器本来就能直接访问 `localhost`，不需要把服务暴露到所有网卡。

### 如果 `node-pty` 之类的原生模块编译失败

指定编译器再试：

```bash
CC=gcc-11 CXX=g++-11 npx --yes @deepseek-ai/dsh web --port 13080 --no-open
```

---

## 7. 浏览器访问与首次配置

终端会打印访问地址，形如：

```text
dsh web: http://127.0.0.1:13080/?token=<启动时输出的token>
```

在 **Windows 的浏览器**里打开（注意把端口换成你实际用的）：

```text
http://localhost:13080/?token=<启动时输出的token>
```

> 🔒 链接里那个 `token` 是访问凭据。**不要**把它贴进截图、聊天、issue 或者任何会公开的地方。

首次进入后按顺序做三件事：

**① 配置模型** —— 设置 → 模型，填入 DeepSeek API Key（在 https://platform.deepseek.com/ 获取）。

按官方说明，**模型配置立即生效、不需要重启服务**。

**② 选择工作区** —— 点「选择工作区」，添加一个目录并选中它。

⚠️ 两点注意：

- **未选中工作区之前，会话输入框是不可用的**。所以这步不做，你会以为界面坏了。
- **工作区选 WSL2 内部的路径**，比如 `/home/<你的Linux用户名>/projects`。**不要选 `/mnt/c/...`**：
  - 性能差（跨文件系统 I/O）
  - 权限语义容易出问题（Windows 侧权限模型和 Linux 不一样）
  - 更重要的是，选中 `/mnt/c` 等于把它对整个 Windows 盘的读写权限交出去了

`dsh` 进程会把**启动时所在的目录**作为默认文件系统位置，所以启动前先 `cd` 到你想让它工作的目录。

**③ 开始用** —— 新建会话，发个简单的任务验证一下，比如：

> Summarize this repository and identify its main packages.

按官方描述，Agent 可以读改工作区文件、执行命令、委派工作、维护计划；**如果某个操作需要审批，Web UI 会先问你**。

---

## 8. 设置快捷启动别名

每次敲一长串太麻烦，加个别名：

```bash
nano ~/.bashrc
```

末尾加一行：

```bash
alias dsh='cd ~ && npx --yes @deepseek-ai/dsh web --port 13080 --no-open'
```

生效：

```bash
source ~/.bashrc
```

以后直接：

```bash
dsh
```

> 如果你希望工作目录固定在自己的项目目录，把 `cd ~` 换成 `cd ~/projects`。

---

## 9. 关闭与再次启动

| 想做什么 | 怎么做 |
|---|---|
| 停掉 DSH 服务 | 在跑它的那个终端按 `Ctrl+C`（或直接关掉终端） |
| 彻底释放 WSL2 占的内存 | Windows PowerShell 里 `wsl --shutdown` |
| 只停某个发行版 | `wsl --terminate Ubuntu-24.04` |
| 再次使用 | 打开 Ubuntu 终端，运行 `dsh` |

WSL2 的虚拟机会常驻占一部分内存，`wsl --shutdown` 才会真正释放。改过 `.wslconfig` 或端口配置后，也需要它来让新配置生效。

---

## 10. 排错

### 浏览器打不开 localhost

按可能性从高到低排：

**① 先确认服务真的在监听。** 在 WSL2 里：

```bash
ss -tlnp | grep 13080
```

没有输出说明进程根本没起来，去看终端里的报错，而不是折腾浏览器。

**② 换端口，避开保留段**（见第 6 节）：

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

**③ 启用 WSL2 镜像网络模式。** 在 Windows 用户目录（`C:\Users\<你的Windows用户名>\`）新建 `.wslconfig`：

```ini
[wsl2]
networkingMode=mirrored
```

然后：

```powershell
wsl --shutdown
```

重新启动 WSL2 和 DSH。镜像网络模式下 WSL2 和 Windows 共用网络栈，localhost 转发更直接。

### `npx` 启动后无反应，或端口无监听

按顺序试：

1. **确认编译工具装好了**：
   ```bash
   sudo apt update && sudo apt install -y build-essential
   ```

2. **改用全局安装**，把下载和运行分开，报错更清楚：
   ```bash
   npm install -g @deepseek-ai/dsh
   dsh web --port 13080 --no-open
   ```

3. **看 Node 版本够不够**：`node --version` 要 v22 以上。

4. **卡在下载**：多半是网络。换 registry：
   ```bash
   npm config set registry https://registry.npmmirror.com
   ```

### 端口 3080 连接被拒绝

就是 WinNAT 保留了默认端口，换 `--port 13080` 即可（第 6 节）。

### 导入 Ubuntu 后登录变成 root

用了 `wsl --import` 之后默认用户会变 root，且**不能用 `config --default-user` 修**，要改 `/etc/wsl.conf`（见第 2.3 节）。

---

## 11. 安全边界（按官方原文）

这一节不是吓唬人，是官方 `SAFETY.md` 里写明的，值得在动手前读一遍。

**它是什么性质的软件：**

> DeepSeek Harness is experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.

**它能做什么：**

> The project can execute model-generated code and commands, load third-party plugins, and access the network, processes, credentials, and files made available to it. Incorrect model output, defects, misconfiguration, malicious input, or untrusted plugins may damage the host computer, modify or delete files, disclose data or credentials, or cause other unintended effects.

**关于沙箱，官方说得很直白：**

> Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation or prevent damage. […] Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.

也就是说：**审批提示和权限控制只是"降低风险"，不是"保证隔离"。**

**落到操作上：**

| 做 | 不做 |
|---|---|
| 工作区选 WSL2 内部目录 | 选 `/mnt/c/...` 把整个 Windows 盘交出去 |
| 用最小权限运行 | 用 root 跑、或给它 sudo 免密 |
| 定期备份它能访问的文件 | 把它指向唯一一份重要数据的目录 |
| 审查再放行它提议的命令 | 无脑点「允许」 |
| 用完 `wsl --shutdown` | 让它长期后台常驻 |

**几条具体的：**

- **不要加 `--host 0.0.0.0`** 把服务暴露到局域网/公网；
- **不要分享启动链接里的 token**；
- **不要把 DeepSeek API Key 写进脚本或仓库**，在 Web UI 里填就行；
- **更新要跟着走**——它是 developer preview，修 bug 的节奏很快，但也可能带来破坏性变更。

---

## 12. 速查表

```powershell
# ---- Windows 侧 ----
wsl --install --no-distribution              # 只装 WSL2 本体
wsl --list --online                           # 看可装哪些发行版
wsl --install -d Ubuntu-24.04 --location "D:\WSL\Ubuntu2404"
wsl --set-default-version 2
wsl --export Ubuntu-24.04 D:\wsl-backup.tar   # 导出（先备份再注销！）
wsl --unregister Ubuntu-24.04
wsl --import Ubuntu-24.04 D:\WSL\Ubuntu2404 D:\wsl-backup.tar --version 2
wsl --terminate Ubuntu-24.04                  # 停单个发行版
wsl --shutdown                                # 释放全部 WSL2 内存
netsh interface ipv4 show excludedportrange protocol=tcp   # 查保留端口
```

```bash
# ---- WSL2 / Ubuntu 侧 ----
cd ~
node --version && npm --version               # 需 22+
sudo apt update && sudo apt install -y build-essential

# 启动（默认端口是 3080，容易撞保留段，所以换 13080）
npx --yes @deepseek-ai/dsh web --port 13080 --no-open

# 原生模块编译失败时
CC=gcc-11 CXX=g++-11 npx --yes @deepseek-ai/dsh web --port 13080 --no-open

# 确认在监听
ss -tlnp | grep 13080

# 别名
echo "alias dsh='cd ~ && npx --yes @deepseek-ai/dsh web --port 13080 --no-open'" >> ~/.bashrc
source ~/.bashrc && dsh

# 下载卡住就换源
npm config set registry https://registry.npmmirror.com
```

```ini
# ---- C:\Users\<你的Windows用户名>\.wslconfig ----
[wsl2]
networkingMode=mirrored
```

---

## 参考

- 官方仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 官方文档站：<https://deepseek-harness.github.io/deepseek-harness/>
- 安全说明 `SAFETY.md`：<https://github.com/deepseek-ai/deepseek-harness/blob/main/SAFETY.md>
- WSL 基本命令（微软官方）：<https://learn.microsoft.com/zh-cn/windows/wsl/basic-commands>
- WSL 网络设置：<https://learn.microsoft.com/zh-cn/windows/wsl/networking>
- npm 包：<https://www.npmjs.com/package/@deepseek-ai/dsh>

---

*文中的 WSL 参数以微软官方文档为准；DSH 的命令与安全措辞引自其仓库 README 与 `SAFETY.md`（2026-09 时点）。它是 developer preview，参数可能随时变，动手前建议对一遍官方文档。*
