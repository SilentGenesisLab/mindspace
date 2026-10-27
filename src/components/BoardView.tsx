'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from './Brand';

type Header = { need: string; proposition: string; principles: string; kpi: string; model: string };
type Section = { id: string; parent_id: string | null; title: string; description: string; position: number };
type Check = { criterion: string; pass: boolean; note: string };
type Attempt = {
  taskId: string;
  n: number;
  status: 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
  executor: string | null;
  score: number | null;
  reasons: string[];
  missing: string[];
  checks: Check[];
  error: string | null;
  manual: boolean;
  chars: number;
  updated_at: string;
};
type ItemState = 'todo' | 'queued' | 'running' | 'reviewing' | 'passed' | 'failed';
type Item = {
  id: string;
  section_id: string;
  raw: string;
  rewrite: string;
  urgency: string;
  acceptance: string;
  feedback: string;
  node_id: string | null;
  created_by: string | null;
  author: string | null;
  attempts: Attempt[];
  state: ItemState;
};
type Automation = {
  enabled: boolean;
  interval_minutes: number;
  max_attempts: number;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
  updated_at: string | null;
};
type Board = {
  header: Header;
  sections: Section[];
  items: Item[];
  stats: { items: number; passed: number; failed: number; running: number; todo: number };
  automation: Automation;
  canManage: boolean;
};
type DetailAttempt = Attempt & {
  result: string | null;
  prompt: string;
  assignee: string | null;
  events: Array<{ id: number; actor_type: string; actor_name: string; type: string; message: string; created_at: string }>;
};

const STATE: Record<ItemState, { label: string; cls: string }> = {
  todo: { label: '未开始', cls: 'st-todo' },
  queued: { label: '排队中', cls: 'st-run' },
  running: { label: 'AI 执行中', cls: 'st-run' },
  reviewing: { label: '验收中', cls: 'st-review' },
  passed: { label: '已通过', cls: 'st-pass' },
  failed: { label: '未通过', cls: 'st-fail' },
};

const HEADER_FIELDS: Array<{ key: 'need' | 'proposition' | 'principles' | 'kpi'; label: string; hint: string }> = [
  { key: 'need', label: '核心需求', hint: '这一轮到底要解决谁的什么问题' },
  { key: 'proposition', label: '当前核心命题', hint: '一句话写清楚要回答的命题' },
  { key: 'principles', label: '提问和验收原则', hint: '例如：问题要能落到动作；验收看能不能直接用' },
  { key: 'kpi', label: '核心 KPI', hint: '怎样算这一轮做成了' },
];

// 只列已经在这套部署里验证过的模型；其它模型填自定义 ID 即可
const MODELS = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash · 快' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash · 推理' },
];

function modelLabel(id: string) {
  if (!id) return '默认模型';
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

function automationSummary(a: Automation) {
  if (!a.last_run_at) return '还没自动跑过';
  let extra = '';
  const result = a.last_result ?? {};
  if (typeof result.started === 'number') {
    extra = result.started ? ` · 起 ${result.started} 条` : ' · 没有可跑的条目';
  }
  return `上次 ${new Date(a.last_run_at).toLocaleString('zh-CN')}${extra}`;
}

function attemptLabel(a: Attempt) {
  if (a.status === 'approved') return `✓ ${a.score ?? ''}`;
  if (a.status === 'rejected') return a.score !== null ? `✗ ${a.score}` : '✗ 失败';
  if (a.status === 'submitted') return '验收中';
  return '执行中';
}

function attemptCls(a: Attempt) {
  if (a.status === 'approved') return 'st-pass';
  if (a.status === 'rejected') return 'st-fail';
  if (a.status === 'submitted') return 'st-review';
  return 'st-run';
}

function criteriaLines(text: string) {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, '').trim())
    .filter(Boolean);
}

export default function BoardView({ slug, title, meId }: { slug: string; title: string; meId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [header, setHeader] = useState<Header>({ need: '', proposition: '', principles: '', kpi: '', model: '' });
  const [filter, setFilter] = useState<'all' | ItemState | 'active'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ sectionId: string; raw: string; acceptance: string; urgency: string } | null>(null);
  const [newSection, setNewSection] = useState<{ parentId: string | null; title: string } | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [modelCustom, setModelCustom] = useState(false);
  const [auto, setAuto] = useState<Automation>({
    enabled: false,
    interval_minutes: 5,
    max_attempts: 3,
    last_run_at: null,
    last_result: null,
    updated_at: null,
  });
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 正在编辑表头时，实时刷新不能把输入框冲掉
  const headerDirty = useRef(false);
  const autoDirty = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/spaces/${slug}/board`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as Board;
    setBoard(data);
    setHeader((prev) => (headerDirty.current ? prev : data.header));
    if (data.automation) setAuto((prev) => (autoDirty.current ? prev : data.automation));
  }, [slug]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 400);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const source = new EventSource(`/api/spaces/${slug}/stream`);
    source.addEventListener('board.updated', scheduleReload);
    source.addEventListener('task.updated', scheduleReload);
    return () => source.close();
  }, [slug, scheduleReload]);

  // SSE 断了也别卡住：有条目在跑就每 5 秒拉一次
  const live = board?.items.some((i) => ['queued', 'running', 'reviewing'].includes(i.state)) ?? false;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [live, load]);

  function flash(ok: boolean, text: string) {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 4500);
  }

  async function call(path: string, method: string, body?: unknown) {
    const res = await fetch(`/api/spaces/${slug}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  }

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      flash(false, err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy('');
    }
  }

  const canManage = board?.canManage ?? false;
  const showCustomModel = modelCustom || (header.model !== '' && !MODELS.some((m) => m.id === header.model));

  // 分支按层级展开成有序列表
  const ordered = useMemo(() => {
    const sections = board?.sections ?? [];
    const out: Array<Section & { depth: number; path: string }> = [];
    const walk = (parent: string | null, depth: number, prefix: string) => {
      sections
        .filter((s) => s.parent_id === parent)
        .forEach((s, i) => {
          const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
          out.push({ ...s, depth, path });
          walk(s.id, depth + 1, path);
        });
    };
    walk(null, 0, '');
    return out;
  }, [board?.sections]);

  const hiddenSections = useMemo(() => {
    const hidden = new Set<string>();
    for (const s of ordered) {
      if (s.parent_id && (collapsed.has(s.parent_id) || hidden.has(s.parent_id))) hidden.add(s.id);
    }
    return hidden;
  }, [ordered, collapsed]);

  const visibleItems = useCallback(
    (sectionId: string) =>
      (board?.items ?? []).filter((item) => {
        if (item.section_id !== sectionId) return false;
        if (filter === 'all') return true;
        if (filter === 'active') return ['queued', 'running', 'reviewing'].includes(item.state);
        return item.state === filter;
      }),
    [board?.items, filter],
  );

  const countUnder = useCallback(
    (sectionId: string) => {
      const ids = new Set([sectionId]);
      for (const s of ordered) if (s.parent_id && ids.has(s.parent_id)) ids.add(s.id);
      const items = (board?.items ?? []).filter((i) => ids.has(i.section_id));
      return { total: items.length, passed: items.filter((i) => i.state === 'passed').length };
    },
    [ordered, board?.items],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveHeader() {
    if (!headerDirty.current) return;
    await act('header', async () => {
      await call('/board', 'PUT', header);
      headerDirty.current = false;
      flash(true, '表头已保存');
    });
  }

  async function saveModel(next: string) {
    const payload = { ...header, model: next };
    setHeader(payload);
    headerDirty.current = false;
    await act('model', async () => {
      await call('/board', 'PUT', payload);
      flash(true, next ? `执行模型：${modelLabel(next)}` : '执行模型已恢复默认');
    });
  }

  async function saveAuto(patch: { enabled?: boolean; intervalMinutes?: number; maxAttempts?: number }, note: string) {
    await act('auto', async () => {
      const data = await call('/board/auto', 'PUT', patch);
      autoDirty.current = false;
      setAuto(data.automation as Automation);
      flash(true, note);
    });
  }

  async function runAutoNow() {
    await act('auto-run', async () => {
      const data = await call('/board/auto/run', 'POST');
      flash(
        true,
        data.started
          ? `已排 ${data.started} 条，执行完自动验收${data.skipped ? `；跳过 ${data.skipped} 条` : ''}`
          : data.reason || '没有可执行的条目',
      );
      await load();
    });
  }

  async function runIds(ids: string[]) {
    await act('run', async () => {
      const data = await call('/board/run', 'POST', { itemIds: ids });
      const started = data.started?.length ?? 0;
      const skipped = data.skipped?.length ?? 0;
      flash(
        started > 0,
        started
          ? `已开始 ${started} 条，执行完会自动交给验收 Agent${skipped ? `；跳过 ${skipped} 条（已通过或进行中）` : ''}`
          : `没有可执行的条目：${data.skipped?.[0]?.reason ?? '都在进行中或已通过'}`,
      );
      setSelected(new Set());
      await load();
    });
  }

  async function rewriteIds(ids: string[]) {
    await act('rewrite', async () => {
      const data = await call('/board/rewrite', 'POST', { itemIds: ids });
      flash(true, `AI 改写了 ${data.updated} 条（只补空着的验收标准，不覆盖你写的）`);
      await load();
    });
  }

  async function addSection() {
    if (!newSection?.title.trim()) return;
    await act('section', async () => {
      await call('/board/sections', 'POST', { title: newSection.title, parentId: newSection.parentId });
      setNewSection(null);
      await load();
    });
  }

  async function renameSection(section: Section) {
    const next = window.prompt('分支名', section.title);
    if (next === null || !next.trim() || next === section.title) return;
    await act('section', async () => {
      await call(`/board/sections/${section.id}`, 'PATCH', { title: next });
      await load();
    });
  }

  async function removeSection(section: Section) {
    const count = countUnder(section.id).total;
    if (!window.confirm(`删除「${section.title}」${count ? `和下面的 ${count} 个条目` : ''}？执行记录会保留在任务里。`)) return;
    await act('section', async () => {
      await call(`/board/sections/${section.id}`, 'DELETE');
      await load();
    });
  }

  async function addItem() {
    if (!adding || adding.raw.trim().length < 2) return;
    await act('item', async () => {
      await call('/board/items', 'POST', {
        sectionId: adding.sectionId,
        raw: adding.raw,
        acceptance: adding.acceptance,
        urgency: adding.urgency,
      });
      setAdding({ ...adding, raw: '', acceptance: '' });
      await load();
    });
  }

  async function importTree() {
    await act('import', async () => {
      const data = await call('/board/import', 'POST');
      flash(true, data.items || data.sections ? `导入了 ${data.sections} 个分支、${data.items} 个问题` : '问题树里的内容都已经在表里了');
      headerDirty.current = false;
      await load();
    });
  }

  const stats = board?.stats;
  const filters: Array<{ key: 'all' | ItemState | 'active'; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'todo', label: '未开始' },
    { key: 'active', label: '进行中' },
    { key: 'failed', label: '未通过' },
    { key: 'passed', label: '已通过' },
  ];
  const selectedIds = [...selected];
  const totalUnder = (sectionId: string) => countUnder(sectionId);
  const showEmpty = board !== null && ordered.length === 0;

  return (
    <div className="shell shell-wide">
      <nav className="topnav">
        <Brand href="/app" />
        <div className="nav-links">
          <Link href={`/s/${slug}`} className="btn btn-sm">
            网络视图
          </Link>
          <Link href={`/s/${slug}/tree`} className="btn btn-sm">
            问题树
          </Link>
          <Link href={`/s/${slug}/list`} className="btn btn-sm">
            问题集
          </Link>
          {canManage && (
            <Link href={`/s/${slug}/admin`} className="btn btn-sm">
              后台
            </Link>
          )}
        </div>
      </nav>

      <div className="page-head">
        <div>
          <h1>{title} · 表单</h1>
          <p>表头定方向，分支拆模块，每一行都是一个能被 AI 执行、被验收 Agent 判定的具体问题。</p>
        </div>
        <div className="board-head-actions">
          <a className="btn btn-sm" href={`/api/spaces/${slug}/board?format=csv`}>
            导出 CSV
          </a>
          {canManage && (
            <button className="btn btn-sm" onClick={() => void importTree()} disabled={busy === 'import'}>
              {busy === 'import' ? '导入中…' : '导入问题树'}
            </button>
          )}
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={() => setNewSection({ parentId: null, title: '' })}>
              + 新建分支
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={notice.ok ? 'auth-ok' : 'auth-error'} style={{ marginBottom: 16 }}>
          {notice.text}
        </div>
      )}

      <section className="card pad board-header">
        <div className="board-header-grid">
          {HEADER_FIELDS.map((field) => (
            <label key={field.key} className="board-field">
              <span className="field-label">{field.label}</span>
              {canManage ? (
                <textarea
                  className="input"
                  rows={3}
                  value={header[field.key]}
                  placeholder={field.hint}
                  onChange={(e) => {
                    headerDirty.current = true;
                    setHeader((prev) => ({ ...prev, [field.key]: e.target.value }));
                  }}
                  onBlur={() => void saveHeader()}
                />
              ) : (
                <div className={`board-field-static${header[field.key] ? '' : ' dim'}`}>
                  {header[field.key] || field.hint}
                </div>
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="card pad board-exec">
        <div className="board-exec-row">
          <label className="board-exec-field">
            <span className="field-label">执行模型</span>
            {canManage ? (
              <div className="board-inline" style={{ marginTop: 0 }}>
                <select
                  className="input"
                  value={showCustomModel ? '__custom' : header.model}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__custom') {
                      setModelCustom(true);
                      return;
                    }
                    setModelCustom(false);
                    void saveModel(value);
                  }}
                  disabled={busy === 'model'}
                >
                  <option value="">默认（{modelLabel('')}）</option>
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  <option value="__custom">自定义模型 ID…</option>
                </select>
                {showCustomModel && (
                  <input
                    className="input"
                    style={{ minWidth: 220 }}
                    value={header.model}
                    placeholder="例如 openrouter 上的 model id"
                    onChange={(e) => {
                      headerDirty.current = true;
                      setHeader((prev) => ({ ...prev, model: e.target.value }));
                    }}
                    onBlur={() => void saveHeader()}
                  />
                )}
              </div>
            ) : (
              <div className="board-field-static">{modelLabel(header.model)}</div>
            )}
          </label>

          <div className="board-exec-field">
            <span className="field-label">自动执行</span>
            {canManage ? (
              <div className="board-inline" style={{ marginTop: 0 }}>
                <button
                  className={`chip${auto.enabled ? ' on' : ''}`}
                  onClick={() => void saveAuto({ enabled: !auto.enabled }, auto.enabled ? '已暂停自动执行' : '自动执行已开启')}
                  disabled={busy === 'auto'}
                >
                  {auto.enabled ? '已开启' : '已关闭'}
                </button>
                <span className="dim">每</span>
                <input
                  className="input board-num"
                  type="number"
                  min={1}
                  max={1440}
                  value={auto.interval_minutes}
                  onChange={(e) => {
                    autoDirty.current = true;
                    setAuto((prev) => ({ ...prev, interval_minutes: Number(e.target.value) }));
                  }}
                  onBlur={() => void saveAuto({ intervalMinutes: auto.interval_minutes }, '间隔已保存')}
                />
                <span className="dim">分钟</span>
                <span className="dim">· 每条最多试</span>
                <input
                  className="input board-num"
                  type="number"
                  min={1}
                  max={10}
                  value={auto.max_attempts}
                  onChange={(e) => {
                    autoDirty.current = true;
                    setAuto((prev) => ({ ...prev, max_attempts: Number(e.target.value) }));
                  }}
                  onBlur={() => void saveAuto({ maxAttempts: auto.max_attempts }, '次数上限已保存')}
                />
                <span className="dim">次</span>
                <button className="btn btn-sm" onClick={() => void runAutoNow()} disabled={busy === 'auto-run'}>
                  {busy === 'auto-run' ? '排队中…' : '立即跑一轮'}
                </button>
              </div>
            ) : (
              <div className="board-field-static">
                {auto.enabled ? `每 ${auto.interval_minutes} 分钟自动执行` : '未开启'}
              </div>
            )}
            <span className="board-exec-hint">
              自动执行只挑「未开始」和「未通过且没试满 {auto.max_attempts} 次」的条目，最多 10 条一轮；
              执行完照常交给验收 Agent。{automationSummary(auto)}
            </span>
          </div>
        </div>
      </section>

      {stats && (
        <div className="board-stats mono">
          共 {stats.items} 条 · 已通过 {stats.passed} · 进行中 {stats.running} · 未通过 {stats.failed} · 未开始{' '}
          {stats.todo}
        </div>
      )}

      <div className="board-toolbar">
        <div className="board-filters">
          {filters.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="board-toolbar-actions">
          {selectedIds.length > 0 && <span className="dim">已选 {selectedIds.length} 条</span>}
          {canManage && selectedIds.length > 0 && (
            <>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy === 'run'}
                onClick={() => void runIds(selectedIds)}
              >
                {busy === 'run' ? '派发中…' : 'AI 执行'}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy === 'rewrite'}
                onClick={() => void rewriteIds(selectedIds)}
              >
                {busy === 'rewrite' ? '改写中…' : 'AI 改写'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                取消
              </button>
            </>
          )}
        </div>
      </div>

      {newSection && (
        <div className="card pad board-new-section">
          <span className="field-label">
            新建{newSection.parentId ? '子模块' : '分支'}
            {newSection.parentId && ordered.find((s) => s.id === newSection.parentId)
              ? `（挂在「${ordered.find((s) => s.id === newSection.parentId)?.title}」下）`
              : ''}
          </span>
          <div className="board-inline">
            <input
              className="input"
              autoFocus
              value={newSection.title}
              placeholder="例如：内容生产 / 投放 / 转化"
              onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addSection();
                if (e.key === 'Escape') setNewSection(null);
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={() => void addSection()} disabled={busy === 'section'}>
              创建
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setNewSection(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="empty">
          这个空间还没有表单结构。可以先「导入问题树」把已有分支和问题搬过来，或者手动新建第一个分支。
        </div>
      )}

      {ordered
        .filter((section) => !hiddenSections.has(section.id))
        .map((section) => {
          const under = totalUnder(section.id);
          const items = visibleItems(section.id);
          const isCollapsed = collapsed.has(section.id);
          return (
            <section key={section.id} className="board-section" style={{ marginLeft: section.depth * 18 }}>
              <header className="board-section-head">
                <button
                  className="board-fold"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    })
                  }
                  aria-label={isCollapsed ? '展开' : '收起'}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="board-path mono">{section.path}</span>
                <span className="board-section-title">{section.title}</span>
                {section.description && <span className="board-section-desc">{section.description}</span>}
                <span className="board-section-count mono">
                  {under.passed}/{under.total}
                </span>
                <span className="board-section-actions">
                  {canManage && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setAdding({ sectionId: section.id, raw: '', acceptance: '', urgency: 'P1' })}>
                      + 问题
                    </button>
                  )}
                  {canManage && section.depth < 2 && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setNewSection({ parentId: section.id, title: '' })}>
                      + 子模块
                    </button>
                  )}
                  {canManage && (
                    <button className="btn btn-sm btn-ghost" onClick={() => void renameSection(section)}>
                      重命名
                    </button>
                  )}
                  {canManage && (
                    <button className="btn btn-sm btn-ghost danger" onClick={() => void removeSection(section)}>
                      删除
                    </button>
                  )}
                </span>
              </header>

              {!isCollapsed && (
                <div className="board-table-wrap">
                  <table className="table board-table">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }} />
                        <th>原生问题 / AI 改写</th>
                        <th style={{ width: 64 }}>紧急</th>
                        <th style={{ width: 110 }}>第一次尝试</th>
                        <th style={{ width: 110 }}>第二次尝试</th>
                        <th style={{ width: 110 }}>第三次尝试</th>
                        <th>验收标准</th>
                        <th style={{ width: 92 }}>进行状态</th>
                        <th style={{ width: 150 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className={item.state === 'passed' ? 'row-pass' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggle(item.id)}
                              aria-label="选择"
                            />
                          </td>
                          <td>
                            <button className="board-item-title" onClick={() => setOpenItem(item.id)}>
                              {item.raw}
                            </button>
                            {item.rewrite && <div className="board-item-rewrite">{item.rewrite}</div>}
                            {item.feedback && <div className="board-item-feedback">↳ {item.feedback}</div>}
                          </td>
                          <td>
                            <span className={`urgency urgency-${item.urgency.toLowerCase()}`}>{item.urgency}</span>
                          </td>
                          {[0, 1, 2].map((i) => {
                            const attempt = item.attempts[i];
                            return (
                              <td key={i}>
                                {attempt ? (
                                  <button
                                    className={`pill ${attemptCls(attempt)}`}
                                    onClick={() => setOpenItem(item.id)}
                                    title={attempt.error || attempt.missing[0] || ''}
                                  >
                                    {attemptLabel(attempt)}
                                  </button>
                                ) : (
                                  <span className="dim">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td>
                            {criteriaLines(item.acceptance).length ? (
                              <ul className="board-criteria">
                                {criteriaLines(item.acceptance).map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="dim">未设</span>
                            )}
                          </td>
                          <td>
                            <span className={`pill ${STATE[item.state].cls}`}>{STATE[item.state].label}</span>
                          </td>
                          <td>
                            <div className="board-row-actions">
                              {canManage && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  disabled={busy === 'run'}
                                  onClick={() => void runIds([item.id])}
                                >
                                  AI 执行
                                </button>
                              )}
                              <button className="btn btn-sm btn-ghost" onClick={() => setOpenItem(item.id)}>
                                详情
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {items.length === 0 && adding?.sectionId !== section.id && (
                        <tr>
                          <td colSpan={9}>
                            <span className="dim">这一层还没有问题。</span>
                          </td>
                        </tr>
                      )}

                      {adding?.sectionId === section.id && (
                        <tr className="board-add-row">
                          <td />
                          <td>
                            <textarea
                              className="input"
                              rows={2}
                              autoFocus
                              value={adding.raw}
                              placeholder="写一个具体问题 / 需求"
                              onChange={(e) => setAdding({ ...adding, raw: e.target.value })}
                            />
                            <textarea
                              className="input"
                              rows={2}
                              style={{ marginTop: 6 }}
                              value={adding.acceptance}
                              placeholder="验收标准，一行一条（AI 会逐条判定）"
                              onChange={(e) => setAdding({ ...adding, acceptance: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              className="input"
                              value={adding.urgency}
                              onChange={(e) => setAdding({ ...adding, urgency: e.target.value })}
                            >
                              <option value="P0">P0</option>
                              <option value="P1">P1</option>
                              <option value="P2">P2</option>
                            </select>
                          </td>
                          <td colSpan={5} />
                          <td>
                            <div className="board-row-actions">
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={busy === 'item'}
                                onClick={() => void addItem()}
                              >
                                添加
                              </button>
                              <button className="btn btn-sm btn-ghost" onClick={() => setAdding(null)}>
                                取消
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

      {openItem && (
        <ItemDrawer
          slug={slug}
          itemId={openItem}
          canManage={canManage}
          onClose={() => setOpenItem(null)}
          onRun={() => runIds([openItem])}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

type ItemDetail = {
  item: Pick<Item, 'id' | 'raw' | 'rewrite' | 'urgency' | 'acceptance' | 'feedback'> & { path: string; state: ItemState };
  attempts: DetailAttempt[];
};

function ItemDrawer({
  slug,
  itemId,
  canManage,
  onClose,
  onRun,
  onChanged,
}: {
  slug: string;
  itemId: string;
  canManage: boolean;
  onClose: () => void;
  onRun: () => Promise<void>;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [draft, setDraft] = useState({ raw: '', rewrite: '', urgency: 'P1', acceptance: '', feedback: '' });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/spaces/${slug}/board/items/${itemId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as ItemDetail;
    setDetail(data);
    if (!dirtyRef.current) {
      setDraft({
        raw: data.item.raw,
        rewrite: data.item.rewrite,
        urgency: data.item.urgency,
        acceptance: data.item.acceptance,
        feedback: data.item.feedback,
      });
    }
  }, [slug, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === 'Escape' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(path: string, method: string, body?: unknown) {
    const res = await fetch(`/api/spaces/${slug}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  }

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy('');
    }
  }

  function touch(patch: Partial<typeof draft>) {
    dirtyRef.current = true;
    setDirty(true);
    setDraft({ ...draft, ...patch });
  }

  async function save() {
    await act('save', async () => {
      await send(`/board/items/${itemId}`, 'PATCH', draft);
      dirtyRef.current = false;
      setDirty(false);
      await load();
    });
  }

  async function run() {
    await act('run', async () => {
      await onRun();
      await load();
    });
  }

  async function reReview() {
    await act('review', async () => {
      await send(`/board/items/${itemId}/review`, 'POST');
      await load();
      onChanged();
    });
  }

  async function remove() {
    if (!window.confirm('删除这条问题和它的记录？已产生的任务会保留在后台。')) return;
    await act('delete', async () => {
      await send(`/board/items/${itemId}`, 'DELETE');
      onChanged();
      onClose();
    });
  }

  const attempts = detail?.attempts ?? [];
  const current = attempts[Math.min(tab, Math.max(attempts.length - 1, 0))];
  const last = attempts[attempts.length - 1];
  const canReReview = canManage && last?.status === 'submitted';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal board-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="board-drawer-head">
          <div>
            <span className="mono dim">问题详情 · {detail?.item.path ?? '…'}</span>
            {detail && <span className={`pill ${STATE[detail.item.state].cls}`} style={{ marginLeft: 8 }}>{STATE[detail.item.state].label}</span>}
            <h2>{detail?.item.raw ?? '加载中…'}</h2>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="board-drawer-grid">
          <div className="board-drawer-fields">
            <label className="board-field">
              <span className="field-label">原生问题 / 需求</span>
              <textarea
                className="input"
                rows={3}
                disabled={!canManage}
                value={draft.raw}
                onChange={(e) => touch({ raw: e.target.value })}
              />
            </label>
            <label className="board-field">
              <span className="field-label">AI 改写</span>
              <textarea
                className="input"
                rows={3}
                disabled={!canManage}
                value={draft.rewrite}
                placeholder="点「AI 改写」把口语问题改成可验收的问题"
                onChange={(e) => touch({ rewrite: e.target.value })}
              />
            </label>
            <label className="board-field">
              <span className="field-label">紧急程度</span>
              <select
                className="input"
                disabled={!canManage}
                value={draft.urgency}
                onChange={(e) => touch({ urgency: e.target.value })}
              >
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </label>
            <label className="board-field">
              <span className="field-label">验收标准（一行一条）</span>
              <textarea
                className="input"
                rows={5}
                disabled={!canManage}
                value={draft.acceptance}
                onChange={(e) => touch({ acceptance: e.target.value })}
              />
            </label>
            <label className="board-field">
              <span className="field-label">收集者反馈（会写入下一轮执行上下文）</span>
              <textarea
                className="input"
                rows={3}
                disabled={!canManage}
                value={draft.feedback}
                onChange={(e) => touch({ feedback: e.target.value })}
              />
            </label>

            <div className="board-inline">
              {canManage && (
                <button className="btn btn-sm" onClick={() => void save()} disabled={busy === 'save' || !dirty}>
                  {busy === 'save' ? '保存中…' : '保存修改'}
                </button>
              )}
              {canManage && (
                <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={busy === 'run'}>
                  {busy === 'run' ? '派发中…' : `AI 执行（第 ${attempts.length + 1} 次）`}
                </button>
              )}
              {canReReview && (
                <button className="btn btn-sm" onClick={() => void reReview()} disabled={busy === 'review'}>
                  {busy === 'review' ? '验收中…' : '重新验收'}
                </button>
              )}
              {canManage && (
                <button className="btn btn-sm btn-ghost danger" onClick={() => void remove()} disabled={busy === 'delete'}>
                  删除
                </button>
              )}
            </div>
          </div>

          <div className="board-drawer-attempts">
            {attempts.length === 0 && <div className="empty">还没有执行过。点「AI 执行」派给执行 Agent，结果会回到这里。</div>}
            {attempts.length > 0 && (
              <>
                <div className="board-attempt-tabs">
                  {attempts.map((a, i) => (
                    <button
                      key={a.taskId}
                      className={`chip${i === Math.min(tab, attempts.length - 1) ? ' on' : ''}`}
                      onClick={() => setTab(i)}
                    >
                      第 {a.n} 次 · {attemptLabel(a)}
                    </button>
                  ))}
                </div>

                {current && (
                  <div className="board-attempt">
                    <div className="board-attempt-meta mono">
                      {current.executor || '—'} · {current.assignee || '未指派'}
                      {current.score !== null ? ` · ${current.score} 分` : ''}
                      {current.chars ? ` · ${current.chars} 字` : ''}
                      {current.updated_at ? ` · ${new Date(current.updated_at).toLocaleString('zh-CN')}` : ''}
                    </div>

                    {current.checks.length > 0 && (
                      <ul className="board-checks">
                        {current.checks.map((c, i) => (
                          <li key={i} className={c.pass ? 'ok' : 'bad'}>
                            <span>{c.pass ? '✓' : '✗'}</span>
                            <span>{c.criterion}</span>
                            {c.note && <em>{c.note}</em>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {(current.reasons.length > 0 || current.missing.length > 0 || current.error) && (
                      <div className="board-review-note">
                        {current.error && <div className="bad">执行失败：{current.error}</div>}
                        {current.reasons.map((r, i) => (
                          <div key={`r${i}`}>· {r}</div>
                        ))}
                        {current.missing.map((m, i) => (
                          <div key={`m${i}`} className="warn">
                            还缺：{m}
                          </div>
                        ))}
                      </div>
                    )}

                    {current.result && <pre className="board-result">{current.result}</pre>}

                    {current.events.length > 0 && (
                      <div className="timeline">
                        {current.events.map((e) => (
                          <div
                            key={e.id}
                            className={`timeline-item${e.actor_type === 'agent' ? ' agent' : ''}${
                              e.type === 'result' ? ' result' : ''
                            }`}
                          >
                            <div className="timeline-dot" />
                            <div className="timeline-body">
                              <div className="timeline-head">
                                <span className="timeline-actor">{e.actor_name}</span>
                                <span className="timeline-type mono">{e.type}</span>
                                <span className="timeline-time mono">
                                  {new Date(e.created_at).toLocaleTimeString('zh-CN')}
                                </span>
                              </div>
                              <div className="timeline-msg">{e.message}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
