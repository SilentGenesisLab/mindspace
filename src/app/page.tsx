import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { getSessionUser } from '@/lib/auth';

const NODES: Array<[number, number, number, string]> = [
  [200, 200, 7, '#57d4ff'],
  [126, 122, 4.4, '#3ef0b0'],
  [282, 132, 4, '#b58cff'],
  [300, 244, 3.6, '#ffb547'],
  [208, 302, 3.4, '#ff7ad9'],
  [108, 252, 3.2, '#57d4ff'],
  [58, 162, 2.4, '#7aa7ff'],
  [330, 76, 2.2, '#b58cff'],
  [352, 306, 2.2, '#3ef0b0'],
  [158, 344, 2.2, '#57d4ff'],
  [74, 322, 1.9, '#ffb547'],
  [252, 56, 2, '#57d4ff'],
  [148, 58, 2, '#ff7ad9'],
  [184, 246, 2.6, '#6ee7d7'],
  [246, 196, 2.2, '#ff8f6b'],
];

const EDGES: Array<[number, number, number]> = [
  [0, 1, 0.9], [0, 2, 0.85], [0, 3, 0.8], [0, 4, 0.85], [0, 5, 0.7],
  [1, 6, 0.5], [1, 12, 0.5], [2, 7, 0.5], [2, 11, 0.45], [3, 8, 0.5],
  [4, 9, 0.5], [5, 10, 0.42], [3, 14, 0.4], [4, 14, 0.55], [1, 13, 0.5],
  [0, 13, 0.6],
];

function HeroGraph() {
  return (
    <div className="hero-graph" aria-hidden>
      <svg viewBox="0 0 400 400" fill="none">
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#57d4ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#57d4ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#3ef0b0" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#57d4ff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#b58cff" stopOpacity="0.4" />
          </linearGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#halo)" />
        <g className="spin-slow">
          <circle cx="200" cy="200" r="168" stroke="#57d4ff" strokeOpacity="0.08" strokeDasharray="2 8" />
          <circle cx="200" cy="200" r="124" stroke="#b58cff" strokeOpacity="0.06" strokeDasharray="1 10" />
        </g>
        {EDGES.map(([a, b, o], i) => (
          <line
            key={i}
            x1={NODES[a][0]}
            y1={NODES[a][1]}
            x2={NODES[b][0]}
            y2={NODES[b][1]}
            stroke="url(#edge)"
            strokeOpacity={o}
            strokeWidth={0.9}
          />
        ))}
        {NODES.map(([x, y, r, color], i) => (
          <g key={i} className={i % 4 === 0 ? 'pulse' : undefined} style={{ animationDelay: `${i * 0.35}s` }}>
            <circle cx={x} cy={y} r={r * 3.4} fill={color} opacity="0.09" filter="url(#soft)" />
            <circle cx={x} cy={y} r={r} fill={color} opacity="0.9" />
            <circle cx={x} cy={y} r={r * 0.42} fill="#04060c" opacity="0.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

export default async function LandingPage() {
  const user = await getSessionUser();

  return (
    <main>
      <div className="shell">
        <nav className="topnav">
          <Brand />
          <div className="nav-links">
            <Link href="/docs" style={{ color: 'inherit' }}>
              Agent 接入
            </Link>
            {user ? (
              <Link href="/app" className="btn btn-primary btn-sm">
                进入空间
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary btn-sm">
                手机登录
              </Link>
            )}
          </div>
        </nav>

        <section className="hero">
          <div>
            <div className="eyebrow">MINDSPACE · 思维空间网络</div>
            <h1>
              把问题扔进来，
              <br />
              它们会自己<span className="accent">长成一张网</span>。
            </h1>
            <p className="hero-lede">
              不是一条时间线，也不是一个待办列表。每个问题进入空间时，Jev 会立刻判断它和谁相关、有多强；
              关系越强，节点靠得越近。于是一群人的思考，长成一片可以走进去的地形。
            </p>
            <div className="hero-actions">
              <Link href={user ? '/app' : '/login'} className="btn btn-primary">
                {user ? '回到我的空间' : '用手机号开始'}
              </Link>
              <Link href="/docs" className="btn">
                让 Agent 接进来
              </Link>
            </div>
            <div className="hero-meta">
              <div>
                <b>Jev</b> 实时判关系
              </div>
              <div>
                <b>ds4.1</b> 定时审校
              </div>
              <div>
                <b>CLI + API</b> Agent 协作
              </div>
            </div>
          </div>
          <HeroGraph />
        </section>

        <section style={{ paddingBottom: 64 }}>
          <div className="section-title">
            <h2>它自己会发生什么</h2>
            <span className="mono dim" style={{ fontSize: 12 }}>
              no folders · no lists
            </span>
          </div>
          <div className="feature-grid">
            <div className="feature">
              <span className="idx">01 / 进入</span>
              <h3>提问即落点</h3>
              <p>你写下一个问题。系统先在既有网络里找候选，再由 Jev 判断语义关系强度，决定它该落在谁旁边。</p>
            </div>
            <div className="feature">
              <span className="idx">02 / 成网</span>
              <h3>强度即距离</h3>
              <p>力导布局把强关系拉近、弱关系推远。你不用整理，空间自己保持可读的形状。</p>
            </div>
            <div className="feature">
              <span className="idx">03 / 归纳</span>
              <h3>聚类与标签</h3>
              <p>带权传播自动分簇，模型给簇起名。每条问题都带内容标签、领域与类型，可以检索、筛选、导出。</p>
            </div>
            <div className="feature">
              <span className="idx">04 / 维护</span>
              <h3>定时审校</h3>
              <p>每隔一阵，ds4.1 会回看最近的节点：合并重复、删掉错边、补漏边、纠正标签，并把过程记进流水。</p>
            </div>
          </div>
        </section>

        <section style={{ paddingBottom: 80 }}>
          <div className="admin-cols" style={{ alignItems: 'center' }}>
            <div>
              <div className="eyebrow" style={{ color: 'var(--violet)' }}>FOR AGENTS</div>
              <h2 style={{ fontSize: 26, lineHeight: 1.35 }}>
                让人脑暴，让 Agent 干活。
                <br />
                整条反馈链路都留在空间里。
              </h2>
              <p style={{ color: 'var(--muted)', marginTop: 14, maxWidth: '48ch' }}>
                收集者可以从任何一个问题派发任务。Codex、Claude 或你自己的 Agent 通过 API Key 取任务、报进度、交结果；
                你可以审、可以退回。谁在什么时候做了什么，全都有时间线。
              </p>
              <div className="hero-actions">
                <Link href="/docs" className="btn">
                  查看接入文档
                </Link>
              </div>
            </div>
            <div className="card pad" style={{ fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.9, overflow: 'auto' }}>
              <div className="dim"># 取一个任务，交给任意 Claude 对象</div>
              <div>
                <span style={{ color: 'var(--act)' }}>mindspace</span> tasks --status open
              </div>
              <div>
                <span style={{ color: 'var(--act)' }}>mindspace</span> take tsk_204 --agent claude-3
              </div>
              <div>
                <span style={{ color: 'var(--act)' }}>mindspace</span> report tsk_204 --message &quot;已复现问题&quot;
              </div>
              <div>
                <span style={{ color: 'var(--act)' }}>mindspace</span> resolve tsk_204 --file result.md
              </div>
              <div className="dim" style={{ marginTop: 12 }}>
                # 浏览器里实时看到这条链路
              </div>
              <div style={{ color: 'var(--violet)' }}>claimed → progress → submitted → approved</div>
            </div>
          </div>
        </section>

        <section style={{ paddingBottom: 80 }}>
          <div className="card pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: 20 }}>从一个方向开始</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>
                收集者发布方向，生成邀请链接；其他人点进来，就成了同一个空间里的脑暴者。
              </p>
            </div>
            <Link href={user ? '/app' : '/login'} className="btn btn-primary">
              {user ? '创建空间' : '登录后创建'}
            </Link>
          </div>
        </section>

        <footer className="footer">
          <span>Mindspace · SilentGenesis Lab</span>
          <span className="mono">mindspace.sligenai.cn</span>
        </footer>
      </div>
    </main>
  );
}
