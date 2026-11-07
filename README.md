<div align="center">
  <img src="./app-icon.png" width="160" height="160" alt="Arknights Gacha Logo" />

  <h1>Arknights Gacha</h1>

  <p>
    <strong>“博士，寻访记录已归档。”</strong><br>
    一个《明日方舟》寻访记录同步与统计工具<br>
    本地优先 · 数据不出本机 · Windows
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/WinterChocolates/Arknights-Gacha?style=flat-square&label=Release&color=%23383838&labelColor=%2322c55e" />
    <img src="https://img.shields.io/github/downloads/WinterChocolates/Arknights-Gacha/total?style=flat-square&label=Downloads&color=%23383838&labelColor=%2322c55e" />
    <img src="https://img.shields.io/github/last-commit/WinterChocolates/Arknights-Gacha/main?style=flat-square&color=%23383838&labelColor=%2322c55e" />
    <img src="https://img.shields.io/github/license/WinterChocolates/Arknights-Gacha?style=flat-square&color=%23383838&labelColor=%2322c55e" />
  </p>
</div>

---

## 功能特性

### 账号与服务器

- **多账号管理**：支持多个账号，并可在顶部下拉框快速切换查看。
- **官服 / B 服支持**：按绑定信息识别官服（`arknights`）与 B 服（`arknights_bilibili`），同一 token 下的多个角色分别存档。
- **账号信息本地保存**：账号身份凭证（Token）、统计数据与同步状态均保存在本地 `userData/`，不依赖第三方云服务。

### 寻访记录同步

- **添加账号同步**：粘贴 Token 添加账号，自动拉取绑定角色列表，选择角色后立即开始首次同步。
- **增量同步**：逐卡池翻页，遇到本地已有记录即停止（后续页只会更旧），秒级拿到最新记录。
- **全量同步**：一直翻到 `hasMore = false`，用于补齐本地缺失的历史记录。**(全量同步在顶栏「⋯」菜单里)**
- **重复记录自动去重**：以 `gachaTs|pos|charId` 为键合并，已存在记录保留本地 `isNew`（不会回退），并接受官方对干员名 / 卡池名 / 星级的修正。
- **同步进度可视化**：同步过程中显示阶段、当前卡池（第 N / 共 M）、页码与新增条数，可随时取消。
- **会话隔离**：每轮同步前重置 reqwest 的 cookie jar，避免沿用上一个账号的角色会话。
- **错误分级**：Token 失效 / 401 / 403 / 用户取消会中断整轮同步；单个卡池失败只让该轮记为「部分成功」。

### 统计与展示

- **总览看板**：总抽数、6★ 数量、6★ 出率、平均出 6★、当前垫抽、新干员数、卡池数。
- **稀有度分布图表**：ECharts 环形图，按 1★ ~ 6★ 展示数量与占比。
- **历史出货统计**：最近的 6★ 最多 12 条，附「这发出货垫了多少抽」与所属卡池，并标记首次获得的「New」。
- **卡池明细**：按卡池聚合抽数、6★ 数量、6★ 率与最近一抽时间（最多 15 行）。
- **分类视图**：统计页与记录页都支持按官方卡池分类（限定 / 常驻 / 中坚…）筛选；选中分类后所有指标按该分类重算。

### 数据与导出

- **本地数据存储**：账号配置、同步设置与寻访记录均保存在本地 `userData/` 目录。
- **Excel 导出**：导出 CSV（UTF-8 BOM + CRLF，Excel 双击不乱码），列为时间 / 卡池 / 分类 / 干员 / 星级 / 首次获得 / 记录键。
- **JSON 备份**：导出 `arknights-gacha/v1` 格式的原始记录（含 `uid`、`exportedAt`、`settings`），便于自行迁移或分析。
- **导出位置**：统一写入系统「下载」目录，完成后提示真实路径。

## 技术栈

- **前端**：Nuxt 4 + Vue 3 + TypeScript
- **UI**：@nuxt/ui
- **图表**：ECharts
- **桌面端**：Tauri 2

整体架构参考了 [endfield-gacha](https://github.com/bhaoo/endfield-gacha)，接口链路按明日方舟官方寻访页适配。

## 下载与安装

本工具支持 **Windows**

1. 前往 [Releases](https://github.com/WinterChocolates/Arknights-Gacha/releases) 页面。
2. 下载最新版本中的安装包或便携版：
   - 安装版：`Arknights.Gacha_x.y.z_x64-setup.exe`（当前用户安装，无需管理员权限）
   - 便携版：`Arknights.Gacha_x.y.z_x64-portable.exe`（双击直接运行）
3. 运行即可（便携版请确保应用所在目录具备写入权限，以便创建 / 写入 `userData/`）。

覆盖升级会保留原 `userData/`（账号、设置、寻访记录）。

## 数据存储位置

**exe 同级目录下的 `userData/`**；该目录不可写时（例如装在受保护路径）退回 `%LOCALAPPDATA%\com.winterchocolates.arknightsgacha`。

```
userData/
├─ config.json           账号与同步设置（含 token，不要提交到仓库）
├─ config.json.bak       上一版备份
└─ gachaData/
   ├─ <uid>.json         寻访记录（{ version, uid, updatedAt, records }）
   └─ <uid>.json.bak     上一版备份
```

- 写入采用「临时文件 + rename」的原子替换，并保留上一版 `.bak`；主文件损坏或为空时读取自动回退到备份。
- 设置页会显示当前实际使用的数据目录。
- 开发态是 `src-tauri/target/debug/userData/`，安装后是「安装目录\userData\」（默认 `%LOCALAPPDATA%\Programs\Arknights Gacha`）。
- 浏览器内核（WebView2）的数据目录 `EBWebView/` 同样放在 exe 同级目录，不写入 AppData；目录不可写时退回系统默认。旧版本在 `%LOCALAPPDATA%\com.winterchocolates.arknightsgacha` 留下的 `EBWebView` 升级后可手动删除。

## 使用说明

### 获取 Token

1. 浏览器登录 <https://web-api.hypergryph.com/account/info/hg>。
2. 页面返回的 JSON 里 `content` 字段就是需要的 Token（一长串字母数字）。
3. 确认鹰角账号已绑定明日方舟角色：<https://user.hypergryph.com/bindCharacters>。

### 添加账号同步

点击右上角「添加账号」：

1. 粘贴 Token，点「验证并获取角色」。
2. 从角色列表中选择要同步的角色（默认角色已预选）。
3. 点「添加并同步」，本地没有记录时会立刻跑一次增量同步。

添加成功后，可在顶部账号下拉框切换角色进行同步与查看。Token 只写入本机 `config.json`，返回给页面时会剥掉凭证字段。

> [!CAUTION]
> Bilibili 渠道服 ⚠ 注意
>
> 使用 `添加账号同步` 前，请先前往鹰角网络用户中心 [角色绑定](https://user.hypergryph.com/bindCharacters) 处绑定 Bilibili 服帐号哦~

### 同步寻访数据

1. 先在顶部选择需要查看的角色账号。
2. 点击 **增量同步**，仅拉取新的寻访记录（秒级完成）。
3. 如果怀疑本地记录缺失，点击顶栏「⋯」→ **全量同步（重抓全部历史）**。
4. 同步完成后，可在抽卡统计 / 寻访记录页面查看结果。

同步链路：Token → 账号 app token → 绑定角色列表 → `u8_token_by_uid` → 角色登录（`X-Role-Token`）→ `gacha/cate` 卡池分类 → 每个分类按 `gachaTs + pos` 游标翻页 `gacha/history`。

### 同步设置

设置页可调整同步参数，写入前会做范围钳制（输入框的键盘范围更窄，直接填数也仍会被钳制）：

| 设置 | 默认 | 输入框范围 | 写入钳制范围 | 说明 |
| --- | --- | --- | --- | --- |
| `pageSize` | 50 | 10 ~ 50（步长 10） | 1 ~ 50 | 每页条数，官方接口上限 50 |
| `delayMinMs` / `delayMaxMs` | 400 / 900 | 0 ~ 10 000 / 0 ~ 20 000 | 0 ~ 10 000 / ≥ 下限 ~ 20 000 | 翻页之间的随机延迟，防风控 |
| `maxRetries` | 3 | 0 ~ 6 | 0 ~ 10 | 单页失败重试次数（仅 0 / 408 / 425 / 429 / 5xx 重试） |
| `requestTimeoutMs` | 15 000 | 3 000 ~ 60 000 | 1 000 ~ 120 000 | 单次请求超时（毫秒） |
| `maxPagesPerCategory` | 400 | 10 ~ 2 000 | 1 ~ 5 000 | 单卡池翻页上限，防止异常响应死循环 |

重试退避为 `400ms × 2^(n-1) + 抖动`（上限 8s）；响应带 `Retry-After` 时优先采用（上限 10s）。

### 导出数据

首页 / 记录页 / 设置页都有「导出 CSV」与「JSON 备份」，导出的是当前账号的全部记录，写入系统「下载」目录：

- CSV：`arknights-gacha-<uid>-<时间戳>.csv`
- JSON：`arknights-gacha-<uid>.json`

## 注意事项

- 为了防止频繁请求触发 API 风控，同步过程中连续的请求之间会设置一定的延迟，因此若所需拉取页数较多，拉取时间会稍长一些，请耐心等待 ❤。
- Token 会过期：提示「Token 可能已失效」时，重新登录 <https://ak.hypergryph.com> 复制最新 Token 再添加一次即可（同名角色按 uid 覆盖凭证，记录不丢）。
- 同步按卡池串行执行，取消会立刻中断后续请求，已写入的记录保留。

## 免责声明

本项目为非官方工具，与 **鹰角网络 (Hypergryph)** 及其旗下组织/团体/工作室没有任何关联。游戏图片与数据版权归各自权利人所有。

- 本软件按“现状”提供，不保证可用性、稳定性或数据准确性；使用过程中造成的任何数据损失、功能异常或经济损失均由用户自行承担。
- 本软件仅供个人学习与研究使用，禁止商业化使用、再分发或提供任何增值服务；因违反上述限制产生的责任由使用者自行承担。
- 使用本软件需遵守所在地法律法规、游戏/平台服务条款及知识产权要求；如有合规/安全疑虑，请立即停止使用并卸载。
- 本项目不会采集或上传任何个人隐私，所有用户数据与登录凭据仅存储在本地；涉及的游戏数据均由用户自行选择导入/导出。

## 最后

如有建议或者问题，可以在 [Issues](https://github.com/WinterChocolates/Arknights-Gacha/issues) 提出。

Copyright &copy; 2026 [WinterChocolates](https://github.com/WinterChocolates), under MIT License.
