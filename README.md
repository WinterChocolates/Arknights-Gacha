<div align="center">
  <img src="./app-icon.png" width="160" height="160" alt="Arknights Gacha Logo" />

  <h1>Arknights Gacha · 明日方舟寻访记录</h1>

  <p>
    一个《明日方舟》寻访记录同步与统计工具<br>
    本地优先 · 数据不出本机 · Windows
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-1.0.0-383838?style=flat-square&labelColor=green" />
    <img src="https://img.shields.io/badge/platform-Windows-383838?style=flat-square&labelColor=green" />
    <img src="https://img.shields.io/badge/license-MIT-383838?style=flat-square&labelColor=green" />
  </p>
</div>

---

> [!NOTE]
> 本工具为本地优先的查询/统计工具：不联网上报、不依赖第三方云服务，账号凭证与寻访记录全部保存在本机 `userData/` 目录。

## 功能特性

### 账号与服务器

- **多账号管理**：支持多个账号，可随时切换查看。
- **官服 / B 服支持**：支持官服（`arknights`）与 B 服（`arknights_bilibili`），多角色分别存档。
- **账号信息本地保存**：账号身份凭证（Token）、统计数据与同步状态均保存在本地。

### 寻访记录同步

- **添加账号同步**：手动粘贴 Token 添加账号，自动拉取绑定角色列表。
- **增量同步**：翻页遇到本地已有记录即停止（秒级完成），仅获取新的寻访记录。
- **全量同步**：支持全量拉取寻访记录，用于补齐本地缺失的历史记录。
- **重复记录自动去重**：以 `gachaTs|pos|charId` 去重合并落盘，已存在的记录保留本地版本（`isNew` 不会回退）。
- **同步进度可视化**：同步过程中会显示当前卡池与分页进度，可随时取消。
- **会话隔离**：每轮同步前自动重置 cookie，避免沿用上一个账号的会话。

### 统计与展示

- **总览统计**：总抽数、6★ 数量与出率、平均出 6★、垫抽数、平均间隔。
- **稀有度分布图表**：通过环形图展示不同稀有度的数量与占比。
- **卡池 Top 榜**：按卡池聚合抽数排行。
- **最近 6★ 列表**：快速查看最近的 6★ 出货记录。

### 记录浏览与导出

- **筛选与搜索**：按卡池 / 星级筛选，按干员或卡池名搜索，分页浏览。
- **Excel 导出**：导出 CSV（带 BOM，Excel 双击不乱码）。
- **JSON 备份**：导出原始寻访记录 JSON，直接写入系统「下载」目录。

## 技术栈

- **前端**：Nuxt 4 + Vue 3 + TypeScript
- **UI**：@nuxt/ui
- **图表**：ECharts
- **桌面端**：Tauri 2

架构参考了 [endfield-gacha](https://github.com/WinterChocolates/endfield-gacha)（同为鹰角系游戏的本地抽卡记录工具），接口细节按明日方舟官方寻访页适配。

## 目录结构

```
app/                         Nuxt 4 前端（SPA，业务逻辑都在这里）
├─ app.vue / layouts/        根组件与外壳（账号选择、同步进度条）
├─ pages/                    概览 / 寻访记录 / 设置
├─ components/               侧栏、添加账号弹窗
├─ composables/
│  ├─ useGacha.ts            全局状态 + 页面动作（页面只用它）
│  ├─ useRecordExport.ts     导出 CSV / JSON 的 loading + toast 封装
│  └─ gacha/
│     ├─ api.ts              官方接口：登录链路、卡池分类、游标翻页
│     ├─ http.ts             请求封装（重试 / 超时 / 取消），经 Rust 代发
│     ├─ store.ts            本机 JSON 读写（invoke）+ 设置归一化
│     ├─ sync.ts             同步引擎 + 任务登记
│     └─ stats.ts            统计口径
├─ types/gacha.ts            数据契约（仅类型）
├─ utils/
│  ├─ gachaCalc.ts           去重合并 / 排序 / 筛选 / 归一化 / 延迟
│  ├─ gachaExport.ts         CSV / JSON 导出序列化
│  ├─ format.ts              时间 / 数字 / 百分比格式化
│  └─ theme.ts               星级配色与图表色板（JS 侧）
└─ assets/css/main.css       Tailwind + @nuxt/ui + 星级配色变量（CSS 侧）

src-tauri/                   Tauri 2 壳
├─ src/lib.rs                窗口 + 9 个 invoke 命令（存储 / 导出 / HTTP 转发）
├─ capabilities/             权限（只开放 core:default，无文件/网络插件）
└─ icons/                    应用图标

.github/workflows/build.yml  CI：前端检查 + Windows 安装包构建 / 发布
```

Rust 侧暴露的命令：`data_dir`、`read_config` / `save_config`、`read_records` / `save_records` / `delete_records`、`export_file`（写入下载目录）、`http_request`（reqwest + cookie jar）、`reset_cookies`。

## 下载与安装

本工具支持 **Windows**。

1. 前往 [Releases](https://github.com/WinterChocolates/Arknights-Gacha/releases) 页面。
2. 下载最新版本的 NSIS 安装包（`Arknights.Gacha_x.y.z_x64-setup.exe`）或免安装便携版（`Arknights.Gacha_x.y.z_x64-portable.exe`）。
3. 运行即可（便携版请确保应用所在目录具备写入权限，以便创建/写入 `userData/`）。

也可以自行构建，见下方[开发](#开发)一节。

## 使用说明

### 获取 Token

1. 浏览器登录 <https://web-api.hypergryph.com/account/info/hg>。
2. 页面返回的 JSON 里 `data.token` 就是需要的 Token（一长串字母数字）。
3. 确认鹰角账号已绑定明日方舟角色：<https://user.hypergryph.com/bindCharacters>。

### 添加账号同步

1. 点击「添加账号」，粘贴 Token。
2. 点击「验证并获取角色」，选择要添加的角色。
3. 点击「添加并同步」，自动开始首次同步。

Token 只写入本机 `config.json`，返回给页面时会剥掉凭证字段。

> [!CAUTION]
> Bilibili 渠道服 ⚠ 注意
>
> 使用 `添加账号同步` 前，请先前往鹰角网络用户中心 [角色绑定](https://user.hypergryph.com/bindCharacters) 处绑定 Bilibili 服帐号哦~

### 同步寻访数据

1. 先在顶部选择需要查看的角色账号。
2. 点击**增量同步**，仅拉取新的记录（秒级完成）。
3. 如果怀疑本地记录缺失，使用**全量同步**重新拉取全部记录。
4. 同步完成后，在概览 / 寻访记录页面查看统计结果。

同步链路：Token → 账号 app token → 绑定角色列表 → `u8_token_by_uid` → 角色登录（`X-Role-Token`）→ `gacha/cate` 卡池分类 → 按 `gachaTs + pos` 游标逐池翻页。

致命错误（401/403、Token 失效、用户取消）会中断整轮同步；单个卡池失败只记为该轮 `partial`，不影响其他卡池。

### 同步设置

设置页可调整同步参数（写入前会做范围钳制）：

| 设置 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `pageSize` | 50 | 1 ~ 50 | 每页条数，官方接口上限 50 |
| `delayMinMs` / `delayMaxMs` | 400 / 900 | 0 ~ 10 000 / 20 000 | 翻页之间的随机延迟，防风控 |
| `maxRetries` | 3 | 0 ~ 10 | 单页失败重试次数（0 / 408 / 425 / 429 / 5xx 才重试） |
| `requestTimeoutMs` | 15 000 | 1 000 ~ 120 000 | 单次请求超时 |
| `maxPagesPerCategory` | 400 | 1 ~ 5 000 | 单卡池翻页上限，防止异常响应导致死循环 |

## 统计口径

- 每条寻访记录计 1 抽（十连就是 10 条，共用同一 `gachaTs`）。
- 星级口径：官方接口的 `rarity` 从 **0** 开始编号（0 ~ 5），写入本地时统一 `+1` 成 1★ ~ 6★；旧版（v1）记录文件在首次读取时会自动迁移并回写。
- `6★ 出率` = 6★ 条数 / 总抽数（包含保底出货，不做概率推断）。
- `平均出 6★` = 总抽数 / 6★ 数量。
- `垫抽数` = 最近一次 6★ 之后的抽数；`平均间隔` 只统计本次数据内相邻 6★ 之间的间隔。

## 数据存储位置

**exe 同目录的 `userData/`**（便携式：整个文件夹拷走就换了机器；该目录不可写时退回 `%LOCALAPPDATA%\com.winterchocolates.arknightsgacha`）。

```
userData/
├─ config.json          账号与同步设置（含 Token，注意不要提交到仓库）
├─ config.json.bak      上一版备份
└─ gachaData/
   ├─ <uid>.json        寻访记录（{ version, uid, updatedAt, records }）
   └─ <uid>.json.bak
```

写入采用「临时文件 + rename」的原子替换，并保留上一版 `.bak`；文件损坏时读取会自动回退到备份。设置页「数据」区块会显示当前实际路径。

- 开发态是 `src-tauri/target/debug/userData/`。
- NSIS 安装包安装后是「安装目录\userData\」（`installMode: currentUser`，默认在 `%LOCALAPPDATA%\Programs\Arknights Gacha`）。

## 开发

要求 Node.js ≥ 20.11；桌面端还需要 Rust stable（`x86_64-pc-windows-msvc`）+ Visual Studio Build Tools（含 C++ 生成工具与 Windows SDK 10）。

```bash
npm install
npm run dev:desktop    # tauri dev：窗口加载 Nuxt dev server（热更新）
npm run dev            # 只调样式时用浏览器开 http://127.0.0.1:3000
```

> [!WARNING]
> 浏览器里没有 Tauri 的 `invoke`，看不到账号与记录，只有空界面；数据相关调试请用 `npm run dev:desktop`。

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 只起 Nuxt dev server |
| `npm run dev:desktop` | `tauri dev`，加载 dev server |
| `npm run build` | `nuxt generate` → `.output/public`（静态 SPA） |
| `npm run build:desktop` | `nuxt generate` + `tauri build` |
| `npm run typecheck` | `vue-tsc --noEmit` |

## 注意事项

- 为了防止频繁请求触发 API 风控，同步过程中连续的请求之间会设置一定的延迟，因此若所需拉取页数较多，拉取时间会稍长一些，请耐心等待 ❤。

## 免责声明

本项目为非官方工具，与 **鹰角网络 (Hypergryph)** 及其旗下组织/团体/工作室没有任何关联。游戏图片与数据版权归各自权利人所有。

- 本软件按"现状"提供，不保证可用性、稳定性或数据准确性；使用过程中造成的任何数据损失、功能异常或经济损失均由用户自行承担。
- 本软件仅供个人学习与研究使用，禁止商业化使用、再分发或提供任何增值服务；因违反上述限制产生的责任由使用者自行承担。
- 使用本软件需遵守所在地法律法规、游戏/平台服务条款及知识产权要求；如有合规/安全疑虑，请立即停止使用并卸载。
- 本项目不会采集或上传任何个人隐私，所有用户数据与登录凭据仅存储在本地；涉及的游戏数据均由用户自行选择导入/导出。

## 许可

MIT，见 [LICENSE](./LICENSE)。
