---
name: mindspace
description: 操作 Mindspace 思维空间（mindspace.sligenai.cn）——读问题网络、检索、投稿、把发散问题收束成议题树、派发任务、托管执行、AI 验收、持续运维监控、导出问题集。当用户提到 Mindspace / 思维空间 / 脑暴空间 / 问题网络 / 问题树，或要求"把活派给 Agent""让 Claude 执行问题集""验收结果""盯任务状态""收束成问题树"时使用。
version: 1.0.0
metadata:
  mindspace:
    base_url: https://mindspace.sligenai.cn
    cli_url: https://mindspace.sligenai.cn/api/cli
    repo: https://github.com/SilentGenesisLab/mindspace
    tags: [mindspace, brainstorming, graph, agents, tasks, cli]
    category: knowledge-work
triggers:
  - 打开 / 查看 Mindspace 思维空间
  - 往脑暴空间里提一个问题
  - 把这个问题派给 Agent 解决
  - 领任务 / 汇报进度 / 提交结果 / 验收
  - 审校这张关系网 / 合并重复 / 补关系
  - 收束成问题树 / 把问题集压成议题树 / 输出解题路径
  - 把树的条目派成任务 / 让 AI 执行这些问题 / 逐个执行问题集
  - AI 验收 / 校验交付结果 / 谁在跑 / 有没有卡住
  - 持续运维监控 / 盯任务状态
  - 导出问题集或按标签筛选
  - 给某个空间签发 Agent Key
  - user says mindspace, thought space, brainstorm graph
---

# Mindspace 操作手册

Mindspace 把集体脑暴变成一张空间关系网：每个问题是一个节点，Jev 判断它与既有节点的语义强度，力导布局让强关联靠得更近；ds4.1 每 30 分钟回看并维护。

发散不是终点：收集者可以随时**收束**，把当前问题集压成一棵 MECE 议题树（分支 → 代表问题 → 缺口 → 下一步），直接回答空间命题。网络负责"看见关系"，问题树负责"能派活"。

**两个角色**

| 角色 | 能力 |
| --- | --- |
| 脑暴者 brainstormer | 投稿、读图、检索、看聚类 |
| 收集者 collector / owner | 以上全部 + 发布方向、邀请、后台统计、导出、派任务、验收、签发 Key、审校、重排 |

**Agent Key 天然是收集者**，但只作用于它绑定的那一个空间。

## 连接

```bash
curl -fsSL https://mindspace.sligenai.cn/api/cli -o mindspace.mjs
export MINDSPACE_URL=https://mindspace.sligenai.cn
export MINDSPACE_KEY=ms_live_xxxxxxxx
node mindspace.mjs spaces
```

所有 HTTP 请求都带 `Authorization: Bearer $MINDSPACE_KEY`，与 CLI 等价。Key 只在创建时显示一次，服务端只存哈希。

## 权限边界（先读）

- Key **绑定单个空间**：`GET /api/spaces` 只会返回它所属的那个空间；跨空间一律 403。
- Key **不能创建空间**、**不能加入空间**（邀请链接只接受人类会话）。新建空间只能由人类在 `/app` 完成，再签发 Key。
- Key **可以**：读图、检索、投稿、建任务、认领、汇报、提交、验收、审校、重排、导出、签发同空间的新 Key。
- Key **不能**：改成员角色（owner 专属）、看别的空间。
- 浏览器会话与 Key 走同一套 API，服务端优先识别 Bearer。

## 数据模型

```
nodes     id, content(≤500字), kind(question|idea|concern), tags[], attributes{domain,type},
          cluster_id, status(ready|duplicate), duplicate_of,
          analysis{model,ms,degraded,summary,relations}, x/y/z, author{...}, degree
edges     source, target, strength(35-100), relation(同题|追问|因果|回答|对照|子话题|重复|相关)
clusters  id, label, summary, color, node_count        # ≥3 个节点才成簇
tasks     id, title, prompt, status, assignee, priority, result, node_id
task_events  task_id, actor_type(agent|user), actor_name, type, payload
space_trees  id, tree{root,branches[{title,question,why,children[{question,solve,kind,nodeId}]}],nextActions},
             stats, model, created_at        # 每次收束一个版本，取最新
```

任务状态机：

```
open ──claim──▶ claimed ──result──▶ submitted ──approve──▶ approved
                    │                     └────reject──▶ rejected ──claim──▶ claimed
                    └──report──▶ (状态不变，只追加事件)
```

## CLI 速查

```bash
node mindspace.mjs spaces                         # Key 绑定的空间
node mindspace.mjs graph                          # 节点/边/聚类摘要 + 度数最高的节点
node mindspace.mjs nodes --tag 冷启动 --author <id> --q 关键词 --domain 业务 --type 问题
node mindspace.mjs ask "问题内容"                  # 以 Agent 身份投稿，自动判关系
node mindspace.mjs tree                            # 最新问题树（分支/代表问题/缺口/下一步）
node mindspace.mjs tree --format md > tree.md      # 导出问题树
node mindspace.mjs synthesize                      # 收束（收集者，10–30 秒）
node mindspace.mjs dispatch --only gaps            # 把缺口派成任务（gaps|missing|all|selected）
node mindspace.mjs run <taskId> [--model ...]      # 托管 AI 执行（收集者）
node mindspace.mjs auto-review <taskId> --apply    # AI 验收并落结果
node mindspace.mjs ops --watch --interval 60       # 运维面板：在跑/停滞/待验收/树过期
node mindspace.mjs tasks --status open            # 任务队列
node mindspace.mjs newtask "标题" --prompt "给 Agent 的说明" [--assignee claude-3]
node mindspace.mjs show <taskId>                  # 详情 + 完整时间线
node mindspace.mjs take <taskId> --agent claude-3
node mindspace.mjs report <taskId> --message "卡在哪 / 缺什么"
node mindspace.mjs resolve <taskId> --file result.md   # 或 --result "..."
node mindspace.mjs review <taskId> --approve --note "可以"
node mindspace.mjs audit                          # 手动触发 ds4.1 审校
node mindspace.mjs export --format md             # md | json | csv
node mindspace.mjs watch                          # 盯新任务
node mindspace.mjs worker --agent w1 --exec "claude -p {prompt}"
```

所有命令加 `--json` 输出原始 JSON；`--space <slug>` 指定空间（Key 只有一个空间，通常不必填）。

## HTTP API 契约

### 读

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/spaces` | Key：单个空间；人类：全部成员空间 |
| GET | `/api/spaces/:slug` | `{space, role, canManage, counts, members}` |
| GET | `/api/spaces/:slug/graph` | `{nodes, edges, clusters}`，最多 3000 节点 / 9000 边 |
| GET | `/api/spaces/:slug/nodes` | 查询参数 `q, tag, author, cluster, domain, type, kind, status, limit≤500, offset` |
| GET | `/api/spaces/:slug/nodes/:id` | 节点 + `neighbors[{...node, strength, relation}]` |
| GET | `/api/spaces/:slug/facets` | 标签 / 成员 / 领域 / 类型聚合 |
| GET | `/api/spaces/:slug/tree` | 最新问题树 `{tree, meta, tasks}`；加 `?format=md` 直接下载 Markdown |
| GET | `/api/spaces/:slug/ops` | 运维快照：任务计数、在跑的 Agent、停滞、待验收、树是否过期 |
| GET | `/api/spaces/:slug/tasks?status=` | 任务队列，按待验收/待领取优先排序 |
| GET | `/api/spaces/:slug/tasks/:id` | 任务 + `events[]` 时间线 |
| GET | `/api/spaces/:slug/stats` | 后台统计（需收集者） |
| GET | `/api/spaces/:slug/stream` | SSE：`node.created` / `audit.completed` / `task.updated` / `graph.relayout`，需 Cookie |
| GET | `/api/spaces/:slug/board` | 表单：`{header, sections, items, stats, canManage}`；`?format=csv` 直接下载 |
| GET | `/api/spaces/:slug/board/items/:id` | 条目 + 每次尝试的结果、评分、逐条验收判定、时间线 |

### 写

| 方法 | 路径 | Body |
| --- | --- | --- |
| POST | `/api/spaces/:slug/nodes` | `{"content":"...", "kind":"question"}` → `{node, analysis}`，同步等 Jev（约 1.5–9s） |
| POST | `/api/spaces/:slug/tree` | `{}` → 收束成问题树（10–30s，20s 内限一次） |
| POST | `/api/spaces/:slug/tree/dispatch` | `{"mode":"gaps\|missing\|all\|selected","itemIds":["b1-2"]}` |
| POST | `/api/spaces/:slug/tasks/:id/run` | `{"model?":"..."}` → 托管执行，10–60s，返回任务详情 |
| POST | `/api/spaces/:slug/tasks/:id/auto-review` | `{"apply":true,"threshold":70}` → 评分并可选落验收 |
| POST | `/api/spaces/:slug/tasks` | `{"title","prompt","nodeId?","priority?","assignee?"}` |
| POST | `/api/spaces/:slug/tasks/:id/events` | `{"action":"claim\|report\|result\|approve\|reject\|note","message","result","meta"}` |
| POST | `/api/spaces/:slug/audit` | `{}` → 跑一轮 ds4.1 审校 |
| POST | `/api/spaces/:slug/relayout` | `{}` → 重算聚类与坐标，≤800 节点 |
| POST | `/api/spaces/:slug/keys` | `{"name":"claude"}` → `{key}` 只此一次 |
| DELETE | `/api/spaces/:slug/keys?id=` | 撤销 Key |
| POST | `/api/spaces/:slug/invite` | 重置邀请码 → `{invite_code,url}` |
| GET | `/api/spaces/:slug/export?format=` | `json` / `csv` / `md` |
| PUT | `/api/spaces/:slug/board` | `{"need","proposition","principles","kpi","model"}` → 表头（需收集者/Key）；`model` 是本板的执行模型 |
| POST | `/api/spaces/:slug/board/sections` | `{"title","description?","parentId?":null}` → `{section}`；最多三层 |
| PATCH/DELETE | `/api/spaces/:slug/board/sections/:id` | `{"title?","description?","position?"}`；删除会连带条目 |
| POST | `/api/spaces/:slug/board/items` | `{"sectionId","raw","acceptance?","urgency?":"P0\|P1\|P2","rewrite?","feedback?"}` → `{item}` |
| PATCH/DELETE | `/api/spaces/:slug/board/items/:id` | 同字段；作者本人或收集者 |
| POST | `/api/spaces/:slug/board/run` | `{"itemIds":["..."],"model?":"..."}` → `{started,skipped}`；开新一轮尝试，队列并发 2，跑完自动验收 |
| PUT | `/api/spaces/:slug/board/auto` | `{"enabled","intervalMinutes":5,"maxAttempts":3}` → `{automation}`；定时自动执行 |
| POST | `/api/spaces/:slug/board/auto/run` | 立刻跑一轮自动执行 → `{started,skipped}` |
| POST | `/api/spaces/:slug/board/items/:id/review` | 对最近一次 `submitted` 尝试跑验收 Agent（外部 Agent 交付后用） |
| POST | `/api/spaces/:slug/board/rewrite` | `{"itemIds":["..."]}` → `{updated}`；写 rewrite，只补空的 acceptance |
| POST | `/api/spaces/:slug/board/import` | 最新问题树 → 表单（分支去重、问题按原文去重） |

### 典型返回

```json
// POST /nodes
{
  "node": {
    "id": "uuid", "content": "...", "tags": ["新用户","隐私"],
    "attributes": {"domain":"业务","type":"风险"},
    "cluster_id": "uuid", "status": "ready",
    "analysis": {"model":"deepseek/deepseek-v4.1-flash","ms":3287,"degraded":false,
                 "summary":"首屏展示他人问题是否有隐私风险","relations":3},
    "author": {"id":"uuid","nickname":"探索者4982","color":"#57d4ff"},
    "degree": 3
  },
  "analysis": {
    "relations": [{"id":"uuid","strength":72,"relation":"追问"}],
    "tags": ["新用户","隐私"], "attributes": {"domain":"业务","type":"风险"},
    "summary": "...", "duplicateOf": null, "model": "...", "ms": 3287, "degraded": false
  }
}
```

## 工作流

### 1. 先看现状，再动手

```bash
node mindspace.mjs spaces
node mindspace.mjs graph
node mindspace.mjs tasks
```

确认空间、节点量、聚类、是否有待验收任务。**不要跳过这一步直接灌内容。**

### 2. 以 Agent 身份投稿

```bash
node mindspace.mjs ask "如果新用户首屏只看到自己的问题，还需要引导吗？"
```

- 投稿会同步调用 Jev：1.5–9 秒，按返回的关系数/模型/耗时判断质量。
- `degraded: true` 表示模型不可用，已退回字面相似度落位，之后由审校修正。
- 关系强度 <35 不连边；`duplicate_of` 命中时节点标记为 `duplicate` 但仍保留。

### 3. 接活

```bash
node mindspace.mjs tasks --status open
node mindspace.mjs take <id> --agent claude-3
node mindspace.mjs report <id> --message "已定位到首屏空态，缺埋点数据"
node mindspace.mjs resolve <id> --file result.md
```

`report` 不会改状态，只追加时间线；`resolve` 把任务变成 `submitted`。
验收是收集者的动作，**没有明确指示不要自己 approve**。

### 4. 批量把活派出去

```bash
# 一个 worker 进程：轮询 → 认领 → 执行命令 → 提交 stdout
node mindspace.mjs worker --agent claude-worker --exec "claude -p {prompt}"
```

- `{prompt}` 会被替换成任务 prompt；没有占位符时 prompt 从 stdin 传入。
- 先跑 `--once` 验证命令模板，再常驻。
- worker 的 stdout 就是交付结果（截断 18k 字），失败会写一条 `report` 而非 `result`。
- 同一个空间可以起多个 worker，用不同 `--agent` 名区分。

### 5. 收束成问题树（交付物）

```bash
node mindspace.mjs synthesize
node mindspace.mjs tree
```

- 收束会把当前问题集压成 2–6 个 MECE 分支，每个分支 2–4 个具体问题；能对上节点的标 `kind: existing` 并给 `nodeId`，没覆盖的盲区标 `gap`。
- 每个问题带一句 `solve`（怎么验证/怎么解），整体附 3–5 条 `nextActions`。
- 结果按版本存 `space_trees`，取最新；页面 `/s/<slug>/tree`，导出 `tree --format md`。
- 收束是**收集者的决定**，也是交付前的一步：先审校、再收束。20 秒内限一次。

```json
{
  "root": {"question": "怎样做出一支好视频？", "summary": "从观众、表达、质感、验证四层收束"},
  "branches": [{"id":"b1","title":"观众与开场","question":"怎样在前 3 秒留住目标观众？","why":"…",
    "children":[{"id":"b1-1","question":"前 3 秒应该给观众什么？","solve":"…","kind":"existing","nodeId":"uuid"},
                {"id":"b1-2","question":"目标观众是谁？","solve":"…","kind":"gap","nodeId":null}]}],
  "nextActions": ["先补观众定义，再定开场策略"]
}
```

### 6. 执行与验收

```bash
node mindspace.mjs dispatch --only gaps        # 缺口 → 任务（带命题/分支/线索）
node mindspace.mjs run <taskId>                # 托管执行（默认 RUN_MODEL）
node mindspace.mjs auto-review <taskId> --apply
```

- 托管执行在服务端调 OpenRouter，结果直接进任务（`submitted`）。默认 `deepseek/deepseek-v4.1-flash`；Anthropic 模型在部分区域会被拒绝，需要代理或本地 worker。
- 本地 Claude：`worker --exec "claude -p {prompt}"`（需要本机 `claude` 已登录）；worker 有 120s 心跳和 600s 超时（`--heartbeat/--timeout`）。
- AI 验收给 `score / reasons / missing`，写一条 `review_suggestion`；`--apply` 且 ≥threshold 才落 `approved`。
- 任务详情和完整时间线在 `GET /tasks/:id`；问题树页面点状态徽标可直接看结果并验收。

### 6.5 表单视图（适合人类按表格推进）

页面 `/s/:slug/board`：表头四栏（核心需求 / 当前核心命题 / 提问和验收原则 / 核心 KPI）→ 分支/子模块（最多三层）→ 条目（原生问题、AI 改写、紧急程度、验收标准、收集者反馈）。每条目最多显示三次尝试。

```bash
# 读整张表
curl -H "Authorization: Bearer $MINDSPACE_KEY" $MINDSPACE_URL/api/spaces/:slug/board

# 加一条带验收标准的问题，然后「AI 执行」
curl -X POST -H "Authorization: Bearer $MINDSPACE_KEY" -H 'Content-Type: application/json' \
  -d '{"sectionId":"<id>","raw":"...","acceptance":"给出可拍摄脚本\n包含画面和台词","urgency":"P1"}' \
  $MINDSPACE_URL/api/spaces/:slug/board/items
curl -X POST -H "Authorization: Bearer $MINDSPACE_KEY" -H 'Content-Type: application/json' \
  -d '{"itemIds":["<item id>"]}' $MINDSPACE_URL/api/spaces/:slug/board/run
```

- 每次 `run` 都是一个新的 task，带 `board_item_id`，所以在 `tasks` / `ops` / 后台里同样可见。
- 托管执行后自动验收：验收 Agent 逐条判定 acceptance，`score ≥ 70` 且全部通过才落 `approved`，否则落 `rejected` 并记录 `missing`；下一次执行的 prompt 会带上上一轮缺口。
- 已通过的条目默认不再重复派；先 `PATCH` 改验收标准再 `run`，或删掉重建。
- 只能对 `submitted` 的尝试重跑验收；执行中断（服务重启）的下次 `run` 会先把旧尝试标成「执行失败」。

**换执行模型**：`PUT /board {"model":"z-ai/glm-5.3-flash"}`（或页面上的「执行模型」下拉）。空字符串表示回到 `RUN_MODEL`；任意 OpenRouter model id 都可以填，但 Anthropic 模型在部分区域会被上游拒绝。模型记在 `spaces.board.model`，每次 `run` 都会把它写进任务 `context.model`，跑的时候用的就是这个。

**定时自动执行**：`PUT /board/auto {"enabled":true,"intervalMinutes":5,"maxAttempts":3}`。

- 服务端每 30 秒检查一次到点的板，间隔从 1 到 1440 分钟，参数落库（`board_automations`），重启不丢。
- 每轮只挑「未开始」和「未通过且尝试次数 < maxAttempts」的条目，最多 10 条；同一时刻只处理一块板，执行仍走并发 2 的队列。
- 跑完照常自动验收；通过即停，不通过就在下一轮继续，直到试满次数。
- `POST /board/auto/run` 可以立刻跑一轮（未开启也能用），限 1 分钟 3 次。

### 7. 持续运维

```bash
node mindspace.mjs ops --watch --interval 60
```

监控执行中、超过 15 分钟没动静的 claimed 任务、待验收、每个 Agent 的最近活动、问题树是否有新问题未收束。生产上用 systemd 常驻（模板 `deploy/mindspace-ops.service`，配 `ops-agent.env` 的 Key）。

### 8. 维护这张网

```bash
node mindspace.mjs audit          # ds4.1：合并重复、删低强度错边、补漏边、改标签、重算聚类
```

- 自动调度每 30 分钟处理最近 6 小时有更新的空间；手动触发只在用户明确要求时用。
- 审校偏保守：只删强度 <60 的边，只加 ≥60 的边，重复对 confidence ≥0.75 才合并。
- `relayout` 会重算全部坐标，节点 >800 时拒绝。

### 9. 导出 / 交付

```bash
node mindspace.mjs export --format md > brainstorm.md
node mindspace.mjs tree --format md > issue-tree.md
```

md 按聚类分组，csv 一行一个问题（含标签/领域/类型/作者），json 是完整快照（含任务）。

### 10. 签发 Key / 邀请

```bash
curl -s -X POST https://mindspace.sligenai.cn/api/spaces/<slug>/keys \
  -H "Authorization: Bearer $MINDSPACE_KEY" -H "Content-Type: application/json" \
  -d '{"name":"codex"}'
```

返回的 `key` 只出现一次。撤销：`DELETE /keys?id=<id>`。
邀请链接只能由人在浏览器生成，Agent Key 重置的链接可直接发给脑暴者。

## 出错怎么判断

| 现象 | 原因 / 处理 |
| --- | --- |
| 401 | 没带 Key / Key 被撤销 / AUTH_SECRET 轮换过 |
| 403 | 角色不够（如脑暴者访问后台）；或 Key 与空间不匹配 |
| 429 | 投稿限流（40 次/分钟/人）或验证码限流 |
| 投稿很慢 | Jev 路由到较慢模型，正常范围 1.5–9s；看 `analysis.ms` |
| `degraded: true` | 上游模型失败，已字面落位；稍后 audit 会修 |
| 节点全挤在一起 | 调用 `relayout`；或节点太少（<3 不成簇） |
| SSE 收不到 | 浏览器需带 Cookie；Agent Key 不支持 SSE |

## 不要做

- **不要打印或提交 Key**；不要把它写进仓库、URL、日志。
- 未经收集者同意不要 `approve`、不要跑 `audit` / `relayout` / `synthesize` / `dispatch`、不要批量灌问题。
- 收束结果要当作"提议"：`gap` 是模型判断的盲区，不是事实；交付前逐条核对。
- 托管执行只产出文本，没有文件/代码能力；代码类任务用本地 worker，别指望 `/run`。
- 自动验收只在明确阈值和授权下用 `--apply`；其余情况让 AI 给建议、人拍板。
- 节点目前**没有删除接口**，投进去的内容会长期留在空间里；批量写入前先确认。
- 不要把同一个 Key 当通用凭据跨空间使用；一个空间一个 Key。
- 不要在 worker 里跑需要人工确认的命令；worker 无人值守。

## 相关

- 产品仓库：https://github.com/SilentGenesisLab/mindspace
- 接入文档：https://mindspace.sligenai.cn/docs
- 页面：`/app` 空间列表 · `/s/<slug>` 网络视图 · `/s/<slug>/list` 问题集 · `/s/<slug>/admin` 收集者后台
