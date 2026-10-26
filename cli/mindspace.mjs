#!/usr/bin/env node
/**
 * Mindspace CLI —— 零依赖，Node 18+。
 *
 *   export MINDSPACE_URL=https://mindspace.sligenai.cn
 *   export MINDSPACE_KEY=ms_live_...
 *   node mindspace.mjs tasks --status open
 *
 * 设计原则：所有命令都是对 HTTP API 的薄封装，Agent 可以直接照着 src/app/api 的契约实现。
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const BASE = (process.env.MINDSPACE_URL || 'https://mindspace.sligenai.cn').replace(/\/$/, '');
const KEY = process.env.MINDSPACE_KEY || '';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--')) {
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) flags[name] = true;
    else {
      flags[name] = next;
      i++;
    }
  } else {
    positional.push(arg);
  }
}

const command = positional.shift();
const raw = Boolean(flags.json);

function die(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

async function api(path, method = 'GET', body) {
  if (!KEY) die('需要 MINDSPACE_KEY 环境变量');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) die(`${res.status} ${data.error || text.slice(0, 300)}`);
  return data;
}

async function spaceSlug() {
  if (flags.space) return String(flags.space);
  const data = await api('/api/spaces');
  const first = (data.spaces || [])[0];
  if (!first) die('这个 Key 还没有绑定空间');
  return first.slug;
}

function out(value) {
  if (raw) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function table(rows, columns) {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? '').length)));
  console.log(columns.map((c, i) => c.label.padEnd(widths[i])).join('  '));
  console.log(columns.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    console.log(columns.map((c, i) => String(c.get(row) ?? '').padEnd(widths[i])).join('  '));
  }
}

function short(text, n = 42) {
  const clean = String(text ?? '').replace(/\s+/g, ' ');
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  switch (command) {
    case 'spaces': {
      const data = await api('/api/spaces');
      if (raw) return out(data);
      table(data.spaces || [], [
        { label: 'slug', get: (s) => s.slug },
        { label: 'title', get: (s) => s.title },
        { label: 'nodes', get: (s) => s.node_count },
        { label: 'members', get: (s) => s.member_count },
      ]);
      return;
    }

    case 'graph': {
      const slug = await spaceSlug();
      const data = await api(`/api/spaces/${slug}/graph`);
      if (raw) return out(data);
      console.log(`${slug}: ${data.nodes.length} nodes, ${data.edges.length} edges, ${data.clusters.length} clusters`);
      console.log('\nclusters:');
      for (const cluster of data.clusters) console.log(`  ${String(cluster.node_count).padStart(3)}  ${cluster.label}`);
      const top = [...data.nodes].sort((a, b) => b.degree - a.degree).slice(0, 10);
      console.log('\ntop connected:');
      for (const node of top) console.log(`  [${String(node.degree).padStart(2)}] ${short(node.content, 60)}`);
      return;
    }

    case 'nodes': {
      const slug = await spaceSlug();
      const params = new URLSearchParams({ limit: flags.limit || '60' });
      for (const key of ['tag', 'author', 'q', 'domain', 'type', 'cluster']) if (flags[key]) params.set(key, flags[key]);
      const data = await api(`/api/spaces/${slug}/nodes?${params}`);
      if (raw) return out(data);
      table(data.nodes, [
        { label: 'id', get: (n) => n.id.slice(0, 8) },
        { label: 'rel', get: (n) => n.degree },
        { label: 'author', get: (n) => n.author.nickname },
        { label: 'tags', get: (n) => (n.tags || []).join('/') },
        { label: 'content', get: (n) => short(n.content, 50) },
      ]);
      console.log(`\n${data.total} total`);
      return;
    }

    case 'ask': {
      const slug = await spaceSlug();
      const content = positional.join(' ').trim();
      if (content.length < 2) die('用法: mindspace ask "你的问题"');
      const data = await api(`/api/spaces/${slug}/nodes`, 'POST', { content, kind: flags.kind || 'question' });
      const a = data.analysis || {};
      if (raw) return out(data);
      console.log(`✔ 已进入空间 ${data.node.id}`);
      console.log(`  tags: ${(a.tags || []).join(' / ')}`);
      console.log(`  relations: ${(a.relations || []).length}  (model ${a.model}, ${a.ms}ms)`);
      for (const rel of a.relations || []) console.log(`   ${String(rel.strength).padStart(3)}  ${rel.relation}`);
      return;
    }

    case 'tree': {
      const slug = await spaceSlug();
      if (flags.format === 'md') {
        const res = await fetch(`${BASE}/api/spaces/${slug}/tree?format=md`, {
          headers: { Authorization: `Bearer ${KEY}` },
        });
        if (!res.ok) die(await res.text());
        process.stdout.write(await res.text());
        return;
      }
      const data = await api(`/api/spaces/${slug}/tree`);
      if (raw) return out(data);
      if (!data.tree) {
        console.log('还没有问题树。收集者可以运行: mindspace synthesize');
        return;
      }
      const s = data.meta?.stats || {};
      console.log(`${data.tree.root.question}`);
      if (data.tree.root.summary) console.log(`  ${data.tree.root.summary}`);
      console.log(`  ${s.branches ?? 0} 分支 / ${s.questions ?? 0} 问题 / ${s.gaps ?? 0} 缺口 · ${data.meta?.model}`);
      data.tree.branches.forEach((b, i) => {
        console.log(`\n${i + 1}. ${b.title} — ${b.question}`);
        for (const c of b.children) {
          console.log(`   ${c.kind === 'gap' ? '◌' : '•'} ${c.question}${c.solve ? `  ｜ ${c.solve}` : ''}`);
        }
      });
      if (data.tree.nextActions?.length) {
        console.log('\n下一步:');
        data.tree.nextActions.forEach((a, i) => console.log(`  ${i + 1}) ${a}`));
      }
      return;
    }

    case 'synthesize': {
      const slug = await spaceSlug();
      console.log('收束中…（约 10–30 秒）');
      const data = await api(`/api/spaces/${slug}/tree`, 'POST');
      out(
        raw
          ? data
          : `✔ 已生成问题树：${data.stats.branches} 分支 / ${data.stats.questions} 问题 / ${data.stats.gaps} 缺口 (${data.stats.model}, ${data.stats.ms}ms)`,
      );
      return;
    }

    case 'dispatch': {
      const slug = await spaceSlug();
      const mode = String(flags.only || 'missing');
      const body = { mode };
      if (flags.tree) body.treeId = String(flags.tree);
      if (flags.items) body.itemIds = String(flags.items).split(',').map((s) => s.trim()).filter(Boolean);
      if (mode === 'selected' && !body.itemIds) die('selected 模式需要 --items b1-1,b1-2');
      const data = await api(`/api/spaces/${slug}/tree/dispatch`, 'POST', body);
      if (raw) return out(data);
      console.log(`✔ 派发 ${data.created} 个任务`);
      for (const task of data.tasks) console.log(`  ${task.treeItemId}  ${short(task.title, 60)}`);
      return;
    }

    case 'run': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace run <taskId> [--model anthropic/claude-sonnet-5.5]');
      console.log('托管执行中…（约 10–60 秒）');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/run`, 'POST', { model: flags.model });
      if (raw) return out(data);
      console.log(`✔ ${data.task.status} · ${data.task.assignee}`);
      console.log('');
      console.log(data.task.result);
      return;
    }

    case 'auto-review': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace auto-review <taskId> [--apply] [--threshold 70]');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/auto-review`, 'POST', {
        apply: Boolean(flags.apply),
        threshold: Number(flags.threshold) || 70,
      });
      if (raw) return out(data);
      console.log(`评分 ${data.score} · ${data.decision === 'approve' ? '建议通过' : '建议退回'}${data.applied ? ' · 已落验收' : ''}`);
      for (const reason of data.reasons) console.log(`  · ${reason}`);
      if (data.missing?.length) console.log(`  缺：${data.missing.join('；')}`);
      return;
    }

    case 'ops': {
      const slug = await spaceSlug();
      const interval = Math.max(5, Number(flags.interval) || 30) * 1000;
      for (;;) {
        const data = await api(`/api/spaces/${slug}/ops`);
        if (raw) out(data);
        else {
          if (process.stdout.isTTY && flags.watch) process.stdout.write('\x1b[2J\x1b[H');
          const c = data.counts;
          console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${slug} · 空间 ${data.nodes} 个问题`);
          console.log(`任务  open ${c.open} · claimed ${c.claimed} · submitted ${c.submitted} · approved ${c.approved} · rejected ${c.rejected}`);
          if (data.agents.length) {
            console.log('Agent');
            for (const agent of data.agents) {
              console.log(`  ${agent.assignee.padEnd(28)} ${String(agent.count).padStart(2)} 个 · 最近 ${new Date(agent.last_at).toLocaleString('zh-CN')}`);
            }
          }
          if (data.active.length) {
            console.log('在跑 / 待验收');
            for (const task of data.active) {
              const flag = task.status === 'claimed' && task.minutes >= 15 ? ' ⚠ 停滞' : '';
              console.log(`  [${task.status}] ${task.id.slice(0, 8)} ${String(task.minutes).padStart(4)}m ${task.assignee || '-'} · ${short(task.title, 40)}${flag}`);
            }
          }
          if (data.tree) {
            console.log(
              `问题树  ${new Date(data.tree.created_at).toLocaleString('zh-CN')} · 已派 ${data.tree.dispatched} · 已验收 ${data.tree.approved}${data.tree.stale ? ' · ⚠ 有新问题，建议重新收束' : ''}`,
            );
          } else {
            console.log('问题树  还没有收束');
          }
          if (data.last_audit) console.log(`最近审校  ${new Date(data.last_audit.started_at).toLocaleString('zh-CN')}`);
          if (data.stale.length) console.log(`⚠ ${data.stale.length} 个任务超过 15 分钟没有动静`);
        }
        if (!flags.watch) return;
        await sleep(interval);
      }
    }

    case 'newtask': {
      const slug = await spaceSlug();
      const title = positional.join(' ').trim() || flags.title;
      if (!title || String(title).length < 2) die('用法: mindspace newtask "任务标题" --prompt "给 Agent 的说明"');
      const data = await api(`/api/spaces/${slug}/tasks`, 'POST', {
        title: String(title),
        prompt: String(flags.prompt || title),
        assignee: flags.assignee || null,
        nodeId: flags.node || null,
      });
      out(raw ? data : `✔ 已创建任务 ${data.task.id}\n  ${data.task.title}`);
      return;
    }

    case 'tasks': {
      const slug = await spaceSlug();
      const params = new URLSearchParams();
      if (flags.status) params.set('status', String(flags.status));
      const data = await api(`/api/spaces/${slug}/tasks?${params}`);
      if (raw) return out(data);
      table(data.tasks, [
        { label: 'id', get: (t) => t.id.slice(0, 8) },
        { label: 'status', get: (t) => t.status },
        { label: 'assignee', get: (t) => t.assignee || '-' },
        { label: 'title', get: (t) => short(t.title, 54) },
      ]);
      return;
    }

    case 'show': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace show <taskId>');
      const data = await api(`/api/spaces/${slug}/tasks/${id}`);
      if (raw) return out(data);
      console.log(`${data.task.title}\n[${data.task.status}] ${data.task.assignee || '未指派'}\n`);
      if (data.task.prompt) console.log(`${data.task.prompt}\n`);
      for (const event of data.events) console.log(`  ${event.created_at}  ${event.actor_name} · ${event.type}  ${event.message}`);
      if (data.task.result) console.log(`\nresult:\n${data.task.result}`);
      return;
    }

    case 'take': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace take <taskId> --agent name');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/events`, 'POST', {
        action: 'claim',
        message: flags.message || `CLI 认领 (${flags.agent || 'agent'})`,
      });
      if (raw) return out(data);
      console.log(`✔ 已认领 ${id} · ${data.task.status}`);
      if (data.task.prompt) console.log(`\n${data.task.prompt}`);
      return;
    }

    case 'report': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id || !flags.message) die('用法: mindspace report <taskId> --message "进度"');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/events`, 'POST', {
        action: 'report',
        message: String(flags.message),
      });
      out(raw ? data : `✔ 已记录进度 (${data.events.length} 条事件)`);
      return;
    }

    case 'resolve': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace resolve <taskId> --file result.md | --result "..."');
      let result = flags.result ? String(flags.result) : '';
      if (flags.file) result = await readFile(String(flags.file), 'utf8');
      if (!result) result = await readStdin();
      if (!result.trim()) die('结果为空');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/events`, 'POST', {
        action: 'result',
        result,
        message: flags.message ? String(flags.message) : '提交结果',
      });
      out(raw ? data : `✔ 已提交，等待验收 (${id})`);
      return;
    }

    case 'review': {
      const slug = await spaceSlug();
      const id = positional[0];
      if (!id) die('用法: mindspace review <taskId> --approve|--reject --note "..."');
      const action = flags.approve ? 'approve' : flags.reject ? 'reject' : '';
      if (!action) die('需要 --approve 或 --reject');
      const data = await api(`/api/spaces/${slug}/tasks/${id}/events`, 'POST', {
        action,
        message: flags.note ? String(flags.note) : '',
      });
      out(raw ? data : `✔ 已${action === 'approve' ? '通过' : '退回'} ${id}`);
      return;
    }

    case 'audit': {
      const slug = await spaceSlug();
      const data = await api(`/api/spaces/${slug}/audit`, 'POST');
      out(raw ? data : `✔ 审校完成 ${JSON.stringify(data.stats)}`);
      return;
    }

    case 'export': {
      const slug = await spaceSlug();
      const format = String(flags.format || 'md');
      const res = await fetch(`${BASE}/api/spaces/${slug}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      if (!res.ok) die(await res.text());
      process.stdout.write(await res.text());
      return;
    }

    case 'watch': {
      const slug = await spaceSlug();
      let seen = new Set();
      console.log(`watch ${slug}; Ctrl-C 退出`);
      for (;;) {
        const data = await api(`/api/spaces/${slug}/tasks?status=open`);
        for (const task of data.tasks) {
          if (seen.has(task.id)) continue;
          seen.add(task.id);
          console.log(`[open] ${task.id.slice(0, 8)}  ${short(task.title, 60)}`);
        }
        await sleep(Number(flags.interval || 15) * 1000);
      }
    }

    case 'worker': {
      const slug = await spaceSlug();
      const agent = String(flags.agent || 'claude-worker');
      const template = String(flags.exec || 'claude -p {prompt}');
      const once = Boolean(flags.once);
      console.log(`worker "${agent}" 在 ${slug} 上轮询；命令模板: ${template}`);
      for (;;) {
        const data = await api(`/api/spaces/${slug}/tasks?status=open`);
        const task = (data.tasks || []).find((t) => !t.assignee);
        if (!task) {
          if (once) {
            console.log('没有待领取任务');
            return;
          }
          await sleep(Number(flags.interval || 20) * 1000);
          continue;
        }
        console.log(`→ 领取 ${task.id.slice(0, 8)}: ${task.title}`);
        await api(`/api/spaces/${slug}/tasks/${task.id}/events`, 'POST', {
          action: 'claim',
          message: `worker:${agent} 领取`,
        });
        const prompt = task.prompt || task.title;
        const cmd = template.includes('{prompt}') ? template.replaceAll('{prompt}', JSON.stringify(prompt)) : template;
        const ok = await new Promise((resolve) => {
          const child = spawn(cmd, { shell: true, stdio: template.includes('{prompt}') ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => (stdout += chunk));
          child.stderr.on('data', (chunk) => (stderr += chunk));
          if (!template.includes('{prompt}')) child.stdin.end(prompt);

          const startedAt = Date.now();
          const heartbeatMs = Math.max(30, Number(flags.heartbeat || 120)) * 1000;
          const beat = setInterval(() => {
            fetch(`${BASE}/api/spaces/${slug}/tasks/${task.id}/events`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'report',
                message: `运行中 · ${Math.round((Date.now() - startedAt) / 1000)}s`,
              }),
            }).catch(() => {});
          }, heartbeatMs);
          const killer = setTimeout(() => {
            child.kill('SIGKILL');
          }, Math.max(30, Number(flags.timeout || 600)) * 1000);

          child.on('close', async (code) => {
            clearInterval(beat);
            clearTimeout(killer);
            if (code === 0 && stdout.trim()) {
              await api(`/api/spaces/${slug}/tasks/${task.id}/events`, 'POST', {
                action: 'result',
                result: stdout.slice(0, 18000),
                message: `worker:${agent} 完成`,
              });
              console.log(`✔ 提交 ${task.id.slice(0, 8)}`);
              resolve(true);
            } else {
              await api(`/api/spaces/${slug}/tasks/${task.id}/events`, 'POST', {
                action: 'report',
                message: `执行失败 (exit ${code}) ${stderr.slice(0, 500)}`,
              }).catch(() => {});
              console.error(`✘ 失败 ${task.id.slice(0, 8)}: ${stderr.slice(0, 200)}`);
              resolve(false);
            }
          });
        });
        if (once) return ok ? 0 : 1;
      }
    }

    default:
      console.log(`Mindspace CLI

用法:
  mindspace spaces                         列出 Key 绑定的空间
  mindspace graph [--space slug]           看全图摘要
  mindspace nodes [--tag x] [--author id]  取问题
  mindspace ask "问题内容"                  以 Agent 身份投稿
  mindspace tree [--format md]             查看收束后的问题树
  mindspace synthesize                     把当前问题集收束成议题树（收集者）
  mindspace dispatch [--only gaps|missing|all]  把树条目派成任务（收集者）
  mindspace run <taskId> [--model ...]     用托管 Claude 执行任务（收集者）
  mindspace auto-review <taskId> [--apply] Agent 验收并给分（收集者）
  mindspace ops [--watch] [--interval 30]  运维面板：在跑/卡住/待验收/树是否过期
  mindspace newtask "标题" --prompt "..."    创建任务（可 --assignee 指派）
  mindspace tasks [--status open]          任务队列
  mindspace show <taskId>                  任务详情与时间线
  mindspace take <taskId> --agent name     认领
  mindspace report <taskId> --message ".." 汇报进度
  mindspace resolve <taskId> --file r.md   提交结果
  mindspace review <taskId> --approve      验收（收集者）
  mindspace audit                          手动触发 ds4.1 审校
  mindspace export --format md|json|csv    导出
  mindspace watch                          盯新任务
  mindspace worker --agent w --exec "claude -p {prompt}"
  mindspace help                           这份说明

环境变量: MINDSPACE_URL, MINDSPACE_KEY
通用参数: --json 输出原始 JSON, --space 指定空间`);
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
