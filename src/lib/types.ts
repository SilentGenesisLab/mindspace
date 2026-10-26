export type GraphNodeDTO = {
  id: string;
  content: string;
  kind: string;
  tags: string[];
  attributes: Record<string, string>;
  cluster_id: string | null;
  status: string;
  duplicate_of: string | null;
  analysis: Record<string, unknown>;
  x: number;
  y: number;
  z: number;
  created_at: string;
  author: { id: string; nickname: string; color: string };
  degree: number;
};

export type GraphEdgeDTO = { source: string; target: string; strength: number; relation: string };

export type ClusterDTO = { id: string; label: string; summary: string; color: string; node_count: number };

export type GraphDTO = { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[]; clusters: ClusterDTO[] };

export type AnalysisDTO = {
  relations: Array<{ id: string; strength: number; relation: string }>;
  tags: string[];
  attributes: Record<string, string>;
  summary: string;
  duplicateOf: string | null;
  model: string;
  ms: number;
  degraded: boolean;
};

export type TaskDTO = {
  id: string;
  title: string;
  prompt: string;
  status: 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
  assignee: string | null;
  priority: number;
  result: string | null;
  node_id: string | null;
  node_content?: string | null;
  created_at: string;
  updated_at: string;
  event_count?: number;
};

export type TaskEventDTO = {
  id: number;
  actor_type: string;
  actor_name: string;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type IssueTreeNode = {
  id: string;
  question: string;
  solve: string;
  kind: 'existing' | 'gap';
  nodeId: string | null;
};

export type IssueTreeBranch = {
  id: string;
  title: string;
  question: string;
  why: string;
  children: IssueTreeNode[];
};

export type IssueTree = {
  root: { question: string; summary: string };
  branches: IssueTreeBranch[];
  nextActions: string[];
};

