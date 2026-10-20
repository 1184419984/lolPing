<h1 align="center"><img src="assets/textures/generic_ping.png" width="56" alt=""><br>lolPing</h1>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<p align="center">
  把英雄联盟的信号和表情搬到整个桌面，支持 Windows 和 macOS。<br>
  按住 <b>Alt</b>（Mac 上是 <b>⌥ Option</b>）拖动，在想要的信号上松开：动画弹出、音效响起，任何程序之上、任何显示器上都可以。<br>
  按住 <b>Ctrl</b>（Mac 上是 <b>⌃ Control</b>）拖动打开表情轮盘：英雄联盟的表情，或你自己的图片。
</p>

<p align="center">
  <a href="https://github.com/1184419984/lolPing/releases/latest"><b>下载 Windows 版</b></a> ·
  <a href="https://github.com/1184419984/lolPing/releases/latest"><b>下载 Mac 版</b></a>（Apple 芯片，实验性）
</p>

<p align="center">
  <a href="https://github.com/1184419984/lolPing/actions/workflows/ci.yml"><img src="https://github.com/1184419984/lolPing/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/1184419984/lolPing/releases/latest"><img src="https://img.shields.io/github/v/release/1184419984/lolPing" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/1184419984/lolPing" alt="MIT 许可证"></a>
</p>

<p align="center"><img src="docs/media/demo.zh-CN.gif" width="880" alt="一个程序卡死弹出“未响应”对话框，信号轮盘在上面连发三个“敌人消失”信号"></p>

信号和表情会出现在全屏录制/共享画面里，所以在 Discord 或 OBS 上看你直播的朋友也能看到。lolPing 只是一个桌面小玩具：它不会读取、修改或注入英雄联盟本身。

## 安装

### Windows

1. 从[最新版本](https://github.com/1184419984/lolPing/releases/latest)下载 `lolPing-Setup-<版本号>.exe`。
2. 运行安装程序。安装程序没有代码签名，Windows SmartScreen 可能会提示“Windows 已保护你的电脑”：点击**更多信息**，再点**仍要运行**。
3. lolPing 会打开设置窗口并常驻系统托盘。按住 Alt 在任意位置拖动即可发信号。

lolPing 面向 64 位 Windows 11。Windows 10 也许可以用，但没有测试过。

### macOS（实验性）

Mac 版需要 Apple 芯片（M1 或更新）的 Mac 和 macOS 12 或更新版本。它会自动构建和测试，但还没在真实的 Mac 上用过多少。遇到问题请[反馈](https://github.com/1184419984/lolPing/issues)。

1. 从[最新版本](https://github.com/1184419984/lolPing/releases/latest)下载 `lolPing-<版本号>-arm64.dmg`，打开后把 lolPing 拖进“应用程序”。
2. 打开 lolPing。它没有经过注册 Apple 开发者的签名，macOS 会提示无法检查其是否包含恶意软件：点“完成”，打开**系统设置 → 隐私与安全性**，向下滚动，在 lolPing 的提示旁点**仍要打开**并确认。
   如果 macOS 提示 lolPing“已损坏”，请在“终端”中运行 `xattr -dr com.apple.quarantine /Applications/lolPing.app`，然后再次打开。
3. lolPing 会请求**辅助功能**权限，用来读取鼠标和键盘。点“打开系统设置”并打开 lolPing。授权后立即可以发信号。
4. lolPing 常驻菜单栏。按住 ⌥ Option 在任意位置拖动即可发信号。

**每次更新后**，macOS 都会忘记辅助功能权限，因为应用没有固定的开发者签名。在**隐私与安全性 → 辅助功能**中选中 lolPing，点 **–** 移除，再重新打开。设置窗口会一步步提示你。

### 升级旧版本

从 v0.4 或更早的版本更新：请手动下载一次新版本。从 v0.5 起，lolPing 会自己更新（见[更新](#更新)）。

## 使用

| 想要 | 操作 |
| --- | --- |
| 发信号 | 按住 **Alt** 拖动，在某个扇区上松开 |
| 发表情 | 按住 **Ctrl** 拖动，在某个表情上松开 |
| 取消 | 在中心松开、点右键，或按 **Esc** |
| 暂停 / 恢复 | **Ctrl + Alt + P** |
| 打开设置 | 单击托盘图标 |
| 退出，或重启输入助手 | 右键托盘图标 |

在 Mac 上：用 **⌥ Option** 代替 Alt，用 **⌃ Control** 代替 Ctrl 发表情，用 **⌃⌥P** 暂停，用菜单栏中的信号图标代替托盘图标。

轮盘从正上方开始顺时针依次是：危险（撤退）、推进、正在赶来、全力进攻（All In）、请求协助、需要视野、敌人消失、敌方视野。可以在设置中重新排列，或换上诱饵、视野已清除。表情轮盘同样有 8 个扇区，要放哪些表情在设置中选择。

## 设置

<img src="docs/media/settings.zh-CN.png" width="760" alt="lolPing 设置窗口，包含触发、开关、信号与声音、轮盘、表情、房间和应用几个部分">

- **触发键：** Alt、Ctrl、Shift、Win、Caps Lock、鼠标侧键 4/5，或任意其他按键（Mac 上：Option、Control、Shift、Command、鼠标侧键 4/5，或任意其他按键）。自定义按键单按时仍会输入字符，但字符在松开按键时才出现，单独按住也不会连续输入。
- **Alt + 单击发送信号：** 默认关闭，这样平时的 Alt + 单击快捷操作不受影响。发送的是轮盘编辑器中心的信号（默认是普通信号）。
- **全屏程序中暂停：** 默认开启。全屏游戏独占所有点击——触发键 + 单击原样交给程序——回到桌面或在其他显示器上手势恢复正常。窗口化游戏检测不到；任务栏自动隐藏时只识别无边框全屏。目前仅限 Windows。
- **开关快捷键：** 必须包含 Ctrl、Alt 或 Win（Mac 上为 ⌃、⌥ 或 ⌘）。
- **信号与声音：** 大小、持续时间、音量、静音、轮盘提示音。
- **轮盘：** 把任意信号（包括诱饵和视野已清除）拖到任意扇区，或拖到中心设为 Alt + 单击发送的信号。单击信号可预览。**恢复默认**会还原英雄联盟的布局。
- **表情：** 表情键（默认 Ctrl，也可以关闭）、**Ctrl + 单击发送表情**（默认关闭）、表情大小、表情音效，以及表情轮盘（编辑方式和信号轮盘相同）。点**添加图片…**，或把文件拖到列表上，可以加入自己的图片：PNG、JPG、GIF 或 WebP，最多 24 张。动图只在你自己的屏幕上播放。
- **开机启动**（Mac 上为**登录时打开**）：启动后隐藏在托盘或菜单栏中。
- **语言：** 默认跟随系统显示语言，也可以手动选择 English 或简体中文。

设置在 Windows 上保存在 `%APPDATA%\lolPing\settings.json`，在 Mac 上保存在 `~/Library/Application Support/lolPing/settings.json`。

## 提醒喝水

打开**设置 → 健康提醒 → 提醒喝水**，默认关闭。提醒间隔可选 5–180 分钟，默认 30 分钟；
显示时长可选 3–30 秒，默认 8 秒。点击**预览提醒**可以立即查看效果。

你提供的 `drink_water_akali.png` 会铺满每个显示器，并显示本地化文字。桌面仍然可以点击穿透，也不会抢焦点。
声音沿用信号的音量和静音设置，只在主显示器播放一次。暂停、锁屏或休眠时停止提醒，恢复后重新计时，不补发错过的提醒。
正在操作轮盘或输入房间聊天时，提醒会等操作结束再出现。提醒只在本机显示，不发送给房间成员，也不会采集或发送健康数据。

## 游戏中心

打开**设置 → 游戏中心**可选择游戏天赋挑战、你画我猜、井字棋、四子连珠和国际象棋。
天赋挑战可单人练习或邀请房间成员。反应力、瞄准、点击速度和顺序记忆仍作为挑战内的四项测试，不再单独列出。
朋友可接受或拒绝邀请，不会被抢走焦点。至少一位朋友加入后，发起者可以开始。
房间连接完成后即可邀请，也可从本地游戏中发起邀请进入等待大厅。
成员列表会显示需要更新安装包、已暂停、已静音、游戏内容不同或已接受的状态，不再无提示地禁用邀请。
所有玩家都需要包含游戏中心的版本；旧版仍可正常收发信号，只会忽略游戏消息。

挑战包含五次随机亮灯反应、二十个 FPS 点击目标、五秒点击速度和最多八步的顺序记忆。
同一局使用相同的瞄准目标布局和记忆顺序。切换窗口会中断当前测试，重新开始后不计入离开窗口的时间。
仅在游戏窗口聚焦时暂停输入钩子；桌面信号层仍保持点击穿透。

结算包含 0–100 的娱乐性综合表现分、完整参赛者排名、每位玩家的分项数据和颁奖动画。
反应取中位数并扣除抢跑分，瞄准综合速度和准确率，点击速度与记忆均有分数上限。
这不是科学天赋测定、真实人群百分位或防作弊排行榜。硬件、练习和客户端自报成绩都会影响比较；未完成者不参与正式排名。

邀请、大厅控制和汇总成绩沿用已有加密局域网及中继连接，不访问新主机，天赋测试鼠标轨迹只留在本地，成绩不写入磁盘。
关闭游戏窗口或离开房间会结束参与。

四个房间游戏均在本地运行，不再打开 Foony 网页。你画我猜提供中文词库、三选一、80 秒绘画回合、
画笔、颜色、橡皮擦、撤销、清空、猜词聊天和积分排名，每人轮流画两次。
棋类由前两位加入的成员对战，其余已接受邀请的成员观战。国际象棋通过 chess.js 校验合法走棋、
王车易位、吃过路兵、升变、将杀和和棋。棋类还支持本地双人、认输和双方同意后再来一局。
发起人离开会结束对局，目前不支持迁移主持人。

隐私说明：笔画、猜测和棋步通过已有加密房间传输，不需要 Foony 连接或账号。
仅用局域网时不需要中继。操作有大小限制，由发起人排序校验，丢包后补发。
共享房间密钥和确定性词库不提供防作弊保密性：普通猜词界面会隐藏答案，但修改客户端仍能查看。
不要用这些游戏传输秘密信息或开展有奖竞技。

四个游戏图标复制自已获授权的本地 Foony 快照。这些本地玩法不是 Foony 原始工程及服务端的一比一迁移。
素材保留原有权利，不纳入 lolPing 的 MIT 授权，详见[导入说明](docs/foony-import.md)和[素材来源](docs/tabletop-assets.md)。
完整下载快照仍放在被 Git 忽略的 `vendor/foony/`，应用不会执行其中的远程客户端包。
为兼容旧数据保留网页描述符的读取能力，但当前游戏目录不包含网页游戏。

游戏目录、双语名称、关卡配置、声明式界面和隔离规则脚本都随现有 Git 热更包发布。
先安装一次支持游戏脚本的底座，之后兼容的游戏变更无需重启或重连房间即可生效。
参与同一局需要一致的游戏包内容哈希。更新、回滚或禁用游戏包会结束使用已变更内容的未完成对局；已结算成绩仍可查看。
新增原生接口、渲染组件或 Electron 功能仍需要更新安装包。开发约定见[游戏脚本接口](docs/hot-updates.md#game-scripts)。

## 更新

lolPing 在启动 10 秒后向 GitHub 检查一次新版本，之后每 6 小时检查一次。有新版本时，屏幕上会出现提示，托盘菜单和**设置 → 应用 → 关于**里也会出现**更新**。更新前会先询问：在你点击之前不会下载任何内容。

- **Windows：** 点一下即可下载安装程序、校验、静默安装到原来的文件夹，并重启 lolPing。重启后会打开设置窗口。
- **Mac：** lolPing 把磁盘映像下载到“下载”文件夹，校验后先说明接下来的步骤，再打开它，然后退出。请把 lolPing 拖进“应用程序”，选择**替换**，打开它，并再次允许辅助功能。
- 托盘菜单或**设置 → 应用 → 关于**中的**检查更新**会立即检查。从托盘菜单检查时，结果（已是最新版本，或出错的原因）会以屏幕通知的形式显示。
- **自动检查更新**（设置 → 应用，默认开启）控制安装包的定时检查。关闭后，只有点击更新操作时才会联系 GitHub，包括**推送最新提交**、**接受更新**和**检查此更新**。
- **隐私：** 每次检查都会让 GitHub 知道你的 IP 地址和 lolPing 的版本号，别的都不会发送。

### 向房间推送更新

点击**设置 → 房间 → 推送最新提交**，邀请成员进行 Git 功能热更。对方明确接受或拒绝；接受后在线替换兼容脚本功能，
不重启程序。详见 [Git 在线热更](#git-在线热更)。原生和底座变动仍使用应用页面中的安装包更新。
旧客户端发送的安装包更新通知仍可检查，但不会在线替换底座。单纯收到通知不会下载、抢焦点或重启。
尚无热更底座的客户端需要先安装一次。

本分支的更新源是 `1184419984/lolPing`，统一配置在 `package.json` 的 `build.publish` 中。
Windows 更新元数据、Mac API、发布链接和房间通知都使用它。原作者的安装版仍会检查原作者的仓库，
需要手动安装一次本分支才能切换更新源。房间通知沿用已有的局域网和中继连接，不增加新的主机。

## 和朋友一起发信号（房间）

加入房间后，房间里的每个人都会在自己的屏幕上看到你的信号：位置相同（按各自的分辨率换算），下面带着你的名字。他们的信号也会出现在你的屏幕上。Windows 和 Mac 之间可以互通。

1. 一个人打开**设置 → 房间**（或托盘菜单 → **房间**），点击**创建房间**。
2. 复制房间码（例如 `PING-7KQ4M-2HXTR`）发给朋友。
3. 朋友复制房间码后，在托盘菜单中点击**从剪贴板加入**，或粘贴到房间页面后点击**加入**。

- **同一网络：** 第一次使用时，Windows 会询问是否允许 lolPing 使用网络：请允许，并把 Wi‑Fi 设置为**专用网络**（公用网络会被 Windows 阻止）。Mac 会询问是否允许查找本地网络中的设备。
- **不同网络：** 打开**允许互联网连接**（默认开启）后，任何地方的朋友都能用同一个房间码加入。信号通过免费的公共 [Nostr](https://nostr.com) 中继传输，比局域网稍慢一点；能走局域网时仍会优先使用局域网。ZeroTier、Radmin VPN 等虚拟局域网同样可用，Tailscale 用户则会直接通过互联网连接。
- 信号会显示在编号相同的显示器上（1 号是主显示器），没有则显示在 1 号上。
- **表情**和信号一样发给房间：朋友会在自己的屏幕上看到，下面带着你的名字。你自己的图片会以一张小的静态图发给朋友，动图只留在你的电脑上。朋友的图片保存在你电脑上的一个小缓存里。关闭设置 → 房间里的**显示好友的自定义表情**后，两边都停止：不发送也不获取，朋友的图片显示为“?”。还在用 v0.4 或更早版本的朋友看不到表情，房间页面会在他们的名字下面提示。
- **房间静音**、单独静音某个人，以及**接收信号和表情上限**（可选不限，两者合并计算）可以控制刷屏。用快捷键暂停 lolPing 时，房间里的信号和表情也会一起暂停。
- 一个房间最多 8 人。想踢掉某人，就离开并创建一个新房间。
- **房间聊天：** 加入房间且 lolPing 已启用时，按 **Ctrl + Alt + Enter** 聚焦聊天框。也可以点击**设置 → 房间**或托盘的**房间**菜单中的**打开聊天**，其他程序占用了快捷键时同样可用。左下角采用《英雄联盟》局内聊天的样式：彩色文字直接叠在桌面上，输入时在下方显示一条细长的矩形输入框。聊天框高度随内容变化，始终贴着桌面底部，避免空白透明区域拦截点击。按 **Enter** 发送并收起输入框，按 **Esc** 或点击其他位置收起。朋友发来的消息和自己发送的消息会被动显示约 10 秒，不会抢焦点。聊天框打开时会暂停输入助手；聊天遵循现有的暂停与静音规则。旧版程序会忽略聊天消息。
- 当前房间会话最多保留 100 条记录，其中包括本机和远程信号：沿用现有的信号图标和本地化名称，与聊天文字显示在同一历史中。预览信号不会计入，也不会因为记录信号而额外发送网络数据包。每行使用本地 24 小时制 `[HH:mm]` 时间。离开或切换房间时清空记录。每条消息最多 256 个 Unicode 码点、800 个 UTF-8 JSON 编码字节；非 ASCII 文本可能因字节上限而更早达到限制。聊天使用独立的发送速率桶。
- **隐私：** 信号、表情、表情图片、聊天文字和名字使用由房间码生成的密钥进行端到端加密。聊天沿用现有的局域网和中继连接，不增加新的主机。同一网络中的人可以看到你的本地 IP 地址。开启互联网连接后，公共中继可以看到你的 IP 地址、匿名房间 ID 和发送时间，但永远看不到你的信号、表情、图片、聊天文字和名字。关闭**允许互联网连接**即可只在局域网中使用。

## Git 在线热更

设置 → 房间显示当前 Git 提交，并可接受或拒绝更新邀请。运行远端最新已发布提交的任何成员都可以推送邀请。
收到邀请不会自动下载或执行。接受后从固定的 `1184419984/lolPing` 远端校验提交、构建和 SHA-256，再在线替换脚本功能，
不重启 Electron，也不退出房间。目标必须是 `main` 上当前提交的后续提交，可以跨多个提交；不会按哈希字符串大小排序。

不用另行维护功能版本号。提交并推送到 `main`，Hot Features 工作流在测试通过后自动发布 `hot-<完整提交哈希>` 产物。
这些预发布产物不会覆盖安装包的更新源。源码构建推送邀请前还会检查工作区干净、`origin` 正确、`HEAD` 与远端最新提交一致。
`node tools/hot-publish.mjs` 可在本地检查这些条件并构建产物，不会替你推送 Git。

所有成员需要先安装一次包含此底座的安装包。脚本逻辑、声明式显示层、定时任务、模块设置、限量本地状态、图片音效和房间功能消息可以热更。
Electron、原生输入钩子和底层接口仍需要更新安装包；不兼容的底座会拒绝热更。
新脚本先在 QuickJS 隔离线程中试运行，并限制 CPU、内存和输出。激活失败保留原版本，后续运行失败时可自动恢复上一提交，
也可点击回滚。

隐私：邀请和功能消息沿用现有加密房间连接。接受更新或推送邀请时会连接 GitHub API 和 Release/CDN 基础设施，
GitHub 可看到你的 IP 以及请求的仓库和提交。不会向房间发送本地源码、Git 凭据或发布者指纹。
脚本接口与发布步骤见 [docs/hot-updates.md](docs/hot-updates.md)（英文）。

## 已知限制

- 在以管理员身份运行的窗口（例如任务管理器）上无法打开轮盘，因为 Windows 不会把这些窗口的输入交给普通程序。
- 独占全屏的游戏会盖住信号层。
- 只共享单个窗口时看不到信号，请改为共享整个屏幕。
- 开启 lolPing 后，Ctrl + 拖动会打开表情轮盘，而不是复制文件或文字。可以在**设置 → 表情**中换一个表情键，或者把它关掉。
- 在 Mac 上，登录窗口或密码提示等安全界面出现时无法打开轮盘；每次更新后需要重新允许辅助功能权限。

## 从源码构建

需要 Node 22.12 或更新版本，以及：

- **Windows：** Windows 11，以及安装了“使用 C++ 的桌面开发”工作负载的 Visual Studio 2022 或更新版本。
- **macOS：** 装有 Xcode 命令行工具（`xcode-select --install`）的 Apple 芯片 Mac。请为运行 `npm run dev` 的程序（例如“终端”）开启辅助功能权限，输入助手才能读取输入。

```bash
npm install
npx install-electron
npm run build:helper
npm run dev
```

`npx install-electron` 会下载 `npm run dev` 所需的 Electron 程序。

| 命令 | 作用 |
| --- | --- |
| `npm test` | TypeScript 测试，包括以 `--simulate` 模式运行真实输入助手的协议测试 |
| `npm run test:helper` | 构建输入助手并运行 C++ 测试 |
| `npm run typecheck` | 全量类型检查 |
| `npm run dist` | 在 `release/` 中生成 Windows 安装程序 |
| `npm run dist:mac` | 在 `release/` 中生成 Mac 磁盘映像（需在 Mac 上运行） |
| `npm run dev:site` | 启动轮盘的浏览器演示页（`site/`） |
| `npm run media` | 用演示页重新录制 `docs/media/demo.gif` 和 `docs/media/og.png`（需要 ffmpeg） |
| `node tools/room-peer/run.mjs <房间码>` | 以假成员身份加入房间并随机发信号，一台电脑也能试用房间功能；加 `--relay` 则通过中继加入，加 `--emotes` 则同时发表情（见 [`tools/room-peer`](tools/room-peer)） |
| `node tools/relay-probe/run.mjs` | 测试哪些公共 Nostr 中继适合传输房间信号，`src/main/relays.ts` 中的列表就是由它选出的（见 [`tools/relay-probe`](tools/relay-probe)） |

### 发布新版本

修改 `package.json` 中的 `version` 并提交，然后推送对应的标签，例如 `v0.2.0`。Release 工作流会先把 GitHub Release 创建为草稿。Windows 任务附加安装程序、`latest.yml` 和安装程序的 `.blockmap`，Mac 任务附加磁盘映像。electron-updater 需要 `latest.yml` 和 `.blockmap` 两者才能更新已安装的程序。全部附加完成后，最后一个任务会发布这个 Release。

发布本分支时，在 `1184419984/lolPing` 中启用 GitHub Actions，保持仓库公开，并允许工作流写入 Release。
打标签前运行 `npm run typecheck`、`npm run test:helper` 和 `npm test`，再选择一个更高的版本号。
Windows 和 Mac 两个任务都成功后草稿才会发布。只在本机提交代码，房间成员还无法下载这个功能。

## 工作原理

- **输入：** [`native/hook-helper`](native/hook-helper) 是一个小型 C++ 进程，在 Windows 上负责底层鼠标和键盘钩子，在 macOS 上使用事件监听（event tap）。它会吞掉 Alt + 拖动，使下面的程序完全收不到，并通过 stdin/stdout 以 JSON 行与 Electron 通信。
- **显示：** Electron 在每个显示器上用一个透明、可点击穿透、始终置顶的窗口绘制轮盘和信号（[`src/renderer/overlay`](src/renderer/overlay)），并用 Web Audio 播放音效。
- **房间：** [`src/main/roomManager.ts`](src/main/roomManager.ts) 管理房间成员，并加密每条消息（AES-256-GCM，密钥由房间码经 scrypt 生成）。[`src/main/lanTransport.ts`](src/main/lanTransport.ts) 通过局域网 UDP 传输加密后的数据包，[`src/main/relayTransport.ts`](src/main/relayTransport.ts) 则以临时事件的形式通过公共 Nostr 中继传输。
- **更新：** [`src/main/updater.ts`](src/main/updater.ts) 负责定时检查，以及托盘和设置里显示的状态。[`src/main/updateWin.ts`](src/main/updateWin.ts) 通过 electron-updater 和 Release 上的 `latest.yml` 更新，[`src/main/updateMac.ts`](src/main/updateMac.ts) 读取 GitHub 的 releases API，并用 SHA-256 校验磁盘映像。
- **设置：** Fluent UI 窗口（[`src/renderer/settings`](src/renderer/settings)），在 Windows 上使用 Mica 材质，在 macOS 上采用“系统设置”风格。
- **演示页：** [`site`](site) 在浏览器中运行同一套信号层代码，用一个小的输入适配层代替输入助手。README 里的 GIF 就是用它录制的。
- **设计文档：** [docs/design.md](docs/design.md)（英文）介绍了通信协议、输入状态机和多显示器坐标换算；[docs/design-macos.md](docs/design-macos.md)（英文）介绍了 Mac 版的移植。

## 参与开发

欢迎提交 PR 和想法。开始之前：

- 阅读 [AGENTS.md](AGENTS.md)（英文）：项目结构、每个改动都要保持的行为，以及代码、测试和提交信息的约定。如果你用 AI 工具，也让它读取这个文件。Claude Code 通过 `CLAUDE.md` 读取它，其他大多数 AI 工具会自动读取 `AGENTS.md`。
- PR 标题使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式，例如 `fix(helper): keep clicks in order after a cancelled wheel`。PR 以 squash 方式合并，标题就是 `main` 上的提交信息。
- 一个 PR 只做一件事，并填写模板。CI 在 Windows 和 macOS 上都通过后才能合并。
- 较大的想法请先开 issue 或 [discussion](https://github.com/1184419984/lolPing/discussions)，先商量好做法再动手。

## 信号素材

`assets/textures` 中的图标和 `assets/sounds` 中的音效提取自本地安装的英雄联盟。游戏更新后如何重新提取，请见 [`tools/extract-assets`](tools/extract-assets)。`assets/emotes` 中的表情动画、图标和音效同样归 Riot Games 所有，由 `tools/extract-assets --emotes` 从同一份安装中烘焙生成。

## 许可证

代码采用 [MIT 许可证](LICENSE)。信号和表情的图标、动画与音效版权归 Riot Games 所有，不在该许可证范围内。如果你代表 Riot Games 并希望移除相关内容，请提交 issue。

lolPing isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
