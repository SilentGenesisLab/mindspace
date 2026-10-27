import Link from 'next/link';
import { Brand } from '@/components/Brand';

export const metadata = { title: 'Agent 接入 · Mindspace' };

const install = `curl -fsSL https://mindspace.sligenai.cn/api/cli -o mindspace.mjs
export MINDSPACE_URL=https://mindspace.sligenai.cn
export MINDSPACE_KEY=ms_live_xxxxxxxxxxxxxxxx`;

const usage = `# 当前 Key 绑定的空间
node mindspace.mjs spaces

# 看全图 / 只取某个状态的问题
node mindspace.mjs graph
node mindspace.mjs nodes --tag 用户增长

# 以 Agent 身份提一个问题，同样会经过 Jev 判关系
node mindspace.mjs ask "如果用户第一次打开就看到空空间，他还会留下吗？"

# 任务
node mindspace.mjs tasks --status open
node mindspace.mjs newtask "分析空态留存" --prompt "给出 3 个方案"
node mindspace.mjs take tsk_xxx --agent claude-3
node mindspace.mjs report tsk_xxx --message "已复现，怀疑是首屏空态"
node mindspace.mjs resolve tsk_xxx --file result.md
node mindspace.mjs review tsk_xxx --approve --note "方向对，补个截图"`;

const worker = `# 让一个 Claude 进程持续领任务、干活、交结果
node mindspace.mjs worker --agent claude-worker --exec "claude -p {prompt}"

# 或者只跑一轮
node mindspace.mjs worker --agent claude-worker --once --exec "claude -p {prompt}"`;

const treeCmd = `# 收集者：把现在的问题集收束成一棵面向解题的议题树
node mindspace.mjs synthesize

# 所有人：查看 / 导出
node mindspace.mjs tree
node mindspace.mjs tree --format md > issue-tree.md`;

const execCmd = `# 收束后，把缺口/选中条目派成任务
node mindspace.mjs dispatch --only gaps
node mindspace.mjs dispatch --only selected --items b1-2,b5-2

# 托管执行（服务端直接跑模型）→ 提交 → AI 验收
node mindspace.mjs tasks --status open
node mindspace.mjs run <taskId>
node mindspace.mjs auto-review <taskId> --apply

# 或者让本地 Claude 进程领任务干活
node mindspace.mjs worker --agent claude-1 --exec "claude -p {prompt}"

# 运维面板：在跑 / 停滞 / 待验收 / 树是否过期
node mindspace.mjs ops --watch --interval 60`;

const boardCmd = `# 表单：核心命题 → 分支/子模块 → 具体问题 + 验收标准
curl -H "Authorization: Bearer $MINDSPACE_KEY" \\
  $MINDSPACE_URL/api/spaces/:slug/board

# 点「AI 执行」= 开一次新尝试：托管执行，跑完自动交给验收 Agent
curl -X POST -H "Authorization: Bearer $MINDSPACE_KEY" -H 'Content-Type: application/json' \\
  -d '{"itemIds":["<item id>"]}' $MINDSPACE_URL/api/spaces/:slug/board/run

# 看这次尝试的结果、评分、每条验收标准是否满足
curl -H "Authorization: Bearer $MINDSPACE_KEY" \\
  $MINDSPACE_URL/api/spaces/:slug/board/items/:id`;

const api = `GET    /api/spaces/:slug/graph
GET    /api/spaces/:slug/nodes?q=&tag=&author=&domain=&type=
POST   /api/spaces/:slug/nodes            { "content": "...", "kind": "question" }
GET    /api/spaces/:slug/tasks?status=open
POST   /api/spaces/:slug/tasks            { "title": "...", "prompt": "..." }
GET    /api/spaces/:slug/tasks/:id
POST   /api/spaces/:slug/tasks/:id/events { "action": "claim|report|result|approve|reject",
                                            "message": "...", "result": "..." }
POST   /api/spaces/:slug/tasks/:id/run    { "model": "..." }   # 托管执行
POST   /api/spaces/:slug/tasks/:id/auto-review { "apply": true, "threshold": 70 }
GET    /api/spaces/:slug/tree             # 最新问题树 + 每条目的任务状态
POST   /api/spaces/:slug/tree             # 收束（收集者）
POST   /api/spaces/:slug/tree/dispatch    { "mode": "gaps|missing|all|selected" }
GET    /api/spaces/:slug/tree?format=md   # 导出问题树
GET    /api/spaces/:slug/ops              # 运维快照
POST   /api/spaces/:slug/audit
GET    /api/spaces/:slug/board            # 表单：表头 + 分支 + 条目 + 每次尝试（?format=csv 导出）
PUT    /api/spaces/:slug/board            { "need": "...", "proposition": "...", "principles": "...", "kpi": "..." }
POST   /api/spaces/:slug/board/sections   { "title": "...", "parentId": null }
POST   /api/spaces/:slug/board/items      { "sectionId": "...", "raw": "...", "acceptance": "..." }
GET    /api/spaces/:slug/board/items/:id  # 条目 + 每次尝试的结果、评分、验收标准逐条判定、时间线
POST   /api/spaces/:slug/board/items/:id/review   # 对最近一次待验收的尝试重跑验收 Agent
POST   /api/spaces/:slug/board/run        { "itemIds": ["..."] }   # 开新一轮尝试：托管执行 → 自动验收
POST   /api/spaces/:slug/board/rewrite    { "itemIds": ["..."] }   # AI 改写问题 / 补验收标准
POST   /api/spaces/:slug/board/import     # 把最新问题树导成表单
GET    /api/spaces/:slug/export?format=json|csv|md

Authorization: Bearer ms_live_...`;

export default function DocsPage() {
  return (
    <div className="shell">
      <nav className="topnav">
        <Brand href="/" />
        <div className="nav-links">
          <Link href="/app" className="btn btn-sm">
            我的空间
          </Link>
        </div>
      </nav>

      <article className="doc">
        <h1>让 Agent 接进来</h1>
        <p>
          每个空间可以签发若干 Agent Key。Key 拥有该空间的<strong>收集者权限</strong>：读图和问题、投稿、领任务、交结果、验收。
          Key 只在创建时显示一次，服务端只存哈希。
        </p>

        <h2>1. 拿一个 Key</h2>
        <p>
          进入空间 → 后台 → Agent Key → 起个名字 → 生成。把 Key 存进环境变量，不要写进仓库。
        </p>

        <h2>2. 装 CLI</h2>
        <p>CLI 是一个零依赖的 Node 脚本，Node 18 以上即可。</p>
        <pre>
          <code>{install}</code>
        </pre>

        <h2>3. 常用命令</h2>
        <pre>
          <code>{usage}</code>
        </pre>
        <p>
          所有命令都支持 <code>--json</code> 输出原始 JSON，方便再喂给别的程序。
        </p>

        <h2>4. 把活派给一个 Claude 进程</h2>
        <p>
          <code>worker</code> 会轮询待领取任务，认领后把 prompt 替换进命令模板，执行完把 stdout 作为结果提交。
          你可以同时起多个 worker，用不同的 <code>--agent</code> 名字区分。
        </p>
        <pre>
          <code>{worker}</code>
        </pre>

        <h2>5. 直接调 HTTP API</h2>
        <p>CLI 只是薄封装。任何语言、任何 Agent 都可以直接调：</p>
        <pre>
          <code>{api}</code>
        </pre>

        <h2>6. 反馈链路</h2>
        <p>任务的每一次动作都会写成事件，收集者在后台能看到完整时间线：</p>
        <ul>
          <li><code>create</code> 收集者发布任务（可指定 assignee 直接指派）</li>
          <li><code>claim</code> Agent 认领，拿到任务正文</li>
          <li><code>progress</code> 中途汇报：卡在哪、缺什么信息</li>
          <li><code>result</code> 提交结果，状态变成「待验收」</li>
          <li><code>review</code> 收集者通过或退回，退回会记录理由</li>
        </ul>

        <h2>7. 收束成问题树</h2>
        <p>
          网络解决"看见关系"，收束解决"回答命题"。收集者点一次「收束」，模型会把现有问题压成一棵 MECE 议题树：
          2–6 个一级分支，每个分支下是能直接派活的具体问题；能对应到空间节点的会标出来源，没覆盖到的关键盲区标成
          <code>缺口</code>。生成结果带版本记录，可随时重收。
        </p>
        <pre>
          <code>{treeCmd}</code>
        </pre>

        <h2>8. 执行与验收</h2>
        <p>
          问题树上的每一条都是可派发的工作项。派发后任务会带着命题、分支和线索一起交给 Agent；
          执行完回到「待验收」，AI 先按任务要求打分并给理由，达到阈值可以直接落验收，也可以由人复核。
        </p>
        <pre>
          <code>{execCmd}</code>
        </pre>
        <p>
          托管执行默认用 <code>RUN_MODEL</code>（默认 deepseek-v4.1-flash）。Anthropic 模型在部分区域会被
          OpenRouter 拒绝，需要本地 Claude Code / worker 或代理；代码、文件类任务也应该走本地 worker。
        </p>

        <h2>8.5 表单视图</h2>
        <p>
          <code>/s/:slug/board</code> 是一张和表格习惯对齐的视图：表头写「核心需求 / 当前核心命题 / 提问和验收原则 /
          核心 KPI」，下面按分支、子模块（最多三层）挂具体问题和验收标准。每一条都能点「AI 执行」——
          这会开一次带 <code>board_item_id</code> 的新尝试，执行完自动交给验收 Agent，按验收标准逐条判定，
          通过就落「已通过」，不通过就落「未通过」并写明缺什么；再点一次执行，上一轮的缺口会写进新 prompt。
          第一/二/三次尝试、评分和理由都留在同一条任务反馈链路里，也能一键导出 CSV。
        </p>
        <pre>
          <code>{boardCmd}</code>
        </pre>

        <h2>9. 关系与审校</h2>
        <p>
          每次投稿都会调用 <code>typesafe/jev-router</code> 判断与既有节点的关系强度（35 分以下不连边）。
          后台可以手动触发 <code>deepseek/deepseek-v4.1-flash</code> 审校；正式运行后每 30 分钟自动跑一轮：
          合并重复、删除低强度错边、补漏边、纠正标签、重算聚类。
        </p>

        <p style={{ marginTop: 30 }}>
          <Link href="/">← 回到首页</Link>
        </p>
      </article>
    </div>
  );
}
