/**
 * Marketing workspace panel — structural types for the tool outputs the panel
 * renders (W3-4). The server validates every payload with the canonical zod
 * records from @zcode/marketing; the panel only reads these shapes, it never
 * re-validates or invents data. Kept in its own module to stay under the
 * repo's per-file line budget (architecture:check max-file-lines).
 */

export interface Brief {
  product: string;
  audience: string;
  country: string;
  platform: string;
  offer: string;
  objective: string;
  landingUrl?: string;
  constraints?: string[];
}

export interface Competitor {
  displayName: string;
  identityConfidence: number;
  relevanceReason: string;
  userConfirmed: boolean;
  aliases?: string[];
}

export interface MissionEntry {
  missionId: string;
  brief: Brief;
  researchMode: "live" | "demo";
  createdAt: string;
  competitors: Competitor[];
}

/** W4: persisted creative state (marketing_list_artifacts output). */
export interface CreativeArtifact {
  id: string;
  missionId: string;
  hypothesisId: string;
  kindOf: "promptPack" | "script" | "storyboard" | "uploadedAsset";
  status: "draft" | "review" | "approved" | "rejected" | "published";
  approvedBy?: string;
  brief: {
    intent?: { angle?: string; objective?: string; audience?: string; hypothesisId?: string };
    blueprint?: { hook?: string; format?: string; demonstration?: string; cta?: string; pacing?: string };
    script?: Array<{ startSec: number; endSec: number; line: string; visual: string; onScreenText?: string }>;
    storyboard?: Array<{ beat: string; visual: string; onScreenText?: string }>;
    generatorPromptPacks?: {
      videoGen?: { prompt?: string; negativeConstraints?: string[]; durationSec?: number; aspectRatio?: string };
      thumbnail?: { prompt?: string; textOverlay?: string };
      copy?: { titleVariants?: string[]; ctaLine?: string };
    };
    experimentSpec?: { metric?: string; windowDays?: number; changedVariables?: string[] };
    draftedBy?: string;
    declaration?: {
      format: string;
      durationSec?: number;
      aspectRatio?: string;
      hookText: string;
      proofText: string;
      ctaText: string;
      transcriptOrCopy: string;
      file?: { name: string; bytes: number; path: string };
    };
    rubric?: {
      rubricVersion: string;
      verdict: string;
      score: number;
      assessedBy: string;
      checks: Array<{ id: string; severity: string; message: string; suggestion?: string }>;
    };
    review?: { decision: string; reviewedBy: string; at: string; notes?: string };
    producedFrom?: string;
  };
  promptPack?: Record<string, unknown>;
}

export interface CreativeState {
  hypotheses: Array<{ id: string; pattern: { message: string; hook: string; format: string }; confidence: number }>;
  artifacts: CreativeArtifact[];
}

export interface CoverageSlice {
  slice: string;
  state: "ok" | "partial" | "gap";
  sourceId: string;
  connectorVersion: string;
  note: string;
}

export interface Coverage {
  slices: CoverageSlice[];
  supportsConclusion: string;
}

export interface Signal {
  subjectRef: string;
  velocity?: number;
  total?: number;
  note: string;
}

export interface EvidenceRef {
  ref: string;
  supports: string;
}

export interface Opportunity {
  hypothesis: {
    id: string;
    pattern: {
      problem: string;
      message: string;
      hook: string;
      format: string;
      demonstration: string;
      cta: string;
    };
    supportedBy: EvidenceRef[];
    contradictedBy: EvidenceRef[];
    predictedOutcome: { low: number; expected: number; high: number; metricKey: string };
    confidence: number;
  };
  observed: number;
  crossSourceSupport: number;
  predicted: number;
  confidence: number;
  explanation: string;
}

export interface Report {
  missionId: string;
  brief: Brief;
  competitors: Competitor[];
  coverage?: Coverage;
  signals: Signal[];
  opportunities: Opportunity[];
}

/** W5: token-free connected publishing account view (marketing_list_connections). */
export interface ConnectionView {
  connectionId: string;
  label: string;
  platform: string;
  environment: "production" | "sandbox";
  accountRef: string;
  connectedAt: string;
  connectedBy: string;
}

/** W5: publication record (marketing_list_publications). */
export interface Publication {
  id: string;
  artifactId: string;
  platform: string;
  idempotencyKey: string;
  externalPostId?: string;
  url?: string;
  approvedBy: string;
  publishedAt: string;
  status: "pending" | "published" | "verified" | "failed";
  assistedHandoff: boolean;
  connectionId?: string;
  environment: "production" | "sandbox";
  verification?: { method: string; verifiedAt: string; detail: string };
}

/** W6: experiment with its preserved forecast and recorded result. */
export interface Experiment {
  id: string;
  hypothesisId: string;
  artifactId: string;
  publicationId: string;
  goalMetricKey: string;
  changedVariables: string[];
  measurementWindowDays: number;
  startedAt: string;
  result?: {
    forecastPreserved: boolean;
    observedMetricKey: string;
    observedValue: number;
    supported: string[];
    contradicted: string[];
    completedAt: string;
  };
}

export interface SimulationRun {
  id: string;
  hypothesisId: string;
  modelRef: string;
  projectedRange: { low: number; expected: number; high: number };
  calibrationHistory: Array<{ evaluatedAt: string; forecastError: number; note: string }>;
}

export interface NextAction {
  id: string;
  experimentId: string;
  keep: string[];
  change: string[];
  recommendation: string;
  evidence: EvidenceRef[];
}

/** W5/W6 loop state (marketing_list_publications output). */
export interface LoopState {
  publications: Publication[];
  experiments: Experiment[];
  simulations: SimulationRun[];
  nextActions: NextAction[];
}

export interface AdRow {
  id: string;
  advertiserId?: string;
  format: string;
  firstShownAt?: string;
  lastShownAt?: string;
  source: { sourceId: string; connectorVersion: string };
  availableMetadata?: Record<string, unknown>;
}

export interface OrganicRow {
  id: string;
  publishedAt: string;
  format: string;
  title?: string;
  source: { sourceId: string; connectorVersion: string };
}

export interface MetricRow {
  subjectRef: string;
  metricKey: string;
  value: number;
  observedAt: string;
  source: { sourceId: string };
}

export interface Evidence {
  ads: AdRow[];
  organic: OrganicRow[];
  metrics: MetricRow[];
}

// ---------------------------------------------------------------------------
// i18n — en / zh-CN string tables. Locale follows the host context when it
// provides one; English is the fallback.
// ---------------------------------------------------------------------------
export type Strings = typeof en;

export const en = {
  brand: "Marketing Intelligence",
  brandSub: "evidence-backed missions",
  newMission: "New mission",
  missions: "Missions",
  refresh: "Refresh",
  heroTitle: "Research your market with evidence, not guesses",
  heroBody:
    "Describe a product, pick the verified platform, and get competitor research with explicit data gaps, performance signals and explainable creative opportunities.",
  startTitle: "Start a mission",
  product: "Product",
  audience: "Audience",
  country: "Market (ISO code)",
  platform: "Platform",
  offer: "Offer",
  objective: "Objective",
  mode: "Research mode",
  modeLive: "live — verified public sources only",
  modeDemo: "demo — labeled synthetic fixtures",
  landingUrl: "Landing URL (optional)",
  create: "Start mission",
  creating: "Starting…",
  platformHint: "Only platforms with a verified connector can be researched (youtube is verified).",
  brief: "Product brief",
  competitors: "Competitors",
  competitorsEmpty: "No competitors yet — ask the agent to discover them, or add hints below.",
  discoverTitle: "Discover competitors",
  discoverHint: "Names the user mentioned — the mission proposes candidates you can confirm.",
  discover: "Discover",
  confirmAll: "Confirm shown",
  confirmed: "confirmed",
  identity: "identity",
  research: "Run platform research",
  researching: "Researching…",
  coverage: "Data coverage",
  coverageEmpty: "No research run recorded yet.",
  conclusion: "Conclusion",
  signals: "Performance signals",
  signalsEmpty: "No performance signals yet.",
  opportunities: "Creative opportunities",
  opportunitiesEmpty:
    "No ranked opportunities — the paid×organic intersection needs ad evidence; check coverage above.",
  evidence: "Evidence",
  audit: "Ingest audit",
  ads: "Ads",
  organic: "Organic content",
  metrics: "Metric observations",
  provenance: "Provenance",
  observedAt: "observed",
  demoNotice:
    "Demo mode: fixture ads and entries come from the labeled synthetic connector; public YouTube entries (yt:…) are real. Every record carries its source id.",
  liveNotice: "Live mode: verified public sources only — gaps are gaps.",
  loading: "Loading…",
  emptyMissions: "No missions yet",
  error: "Error",
  gap: "gap",
  missing: "—",
  scoreObserved: "observed",
  scoreCrossSource: "cross-source",
  scorePredicted: "predicted",
  scoreConfidence: "confidence",
  contrary: "contrary",
  evidenceRefs: "evidence",
  forecast: "forecast",
  nextSteps: "Next steps",
  nextDiscover: "Discover competitors (agent or the form above).",
  nextResearch: "Run platform research to ingest evidence.",
  nextAnalyze: "Ask the agent to analyze creatives and rank opportunities.",
  constraintList: "Constraints",
};

export const zh: Strings = {
  brand: "营销情报",
  brandSub: "证据支撑的任务",
  newMission: "新建任务",
  missions: "任务",
  refresh: "刷新",
  heroTitle: "用证据而非猜测做市场调研",
  heroBody:
    "描述产品、选择已验证的平台，获得带显式数据空缺的竞品调研、表现信号与可解释的创意机会。",
  startTitle: "开始任务",
  product: "产品",
  audience: "受众",
  country: "市场（ISO 代码）",
  platform: "平台",
  offer: "主推卖点",
  objective: "目标",
  mode: "调研模式",
  modeLive: "live — 仅已验证的公开来源",
  modeDemo: "demo — 明确标注的合成样本",
  landingUrl: "落地页 URL（可选）",
  create: "开始任务",
  creating: "创建中…",
  platformHint: "仅可调研已验证连接器的平台（youtube 已验证）。",
  brief: "产品简报",
  competitors: "竞品",
  competitorsEmpty: "还没有竞品 — 让 Agent 发现，或在下方填入线索。",
  discoverTitle: "发现竞品",
  discoverHint: "用户提到过的名字 — 任务会给出可确认的候选。",
  discover: "发现",
  confirmAll: "全部确认",
  confirmed: "已确认",
  identity: "身份",
  research: "运行平台调研",
  researching: "调研中…",
  coverage: "数据覆盖",
  coverageEmpty: "尚未记录调研结果。",
  conclusion: "结论",
  signals: "表现信号",
  signalsEmpty: "暂无表现信号。",
  opportunities: "创意机会",
  opportunitiesEmpty: "暂无排序机会 — 付费×自然交叉需要广告证据；见上方覆盖报告。",
  evidence: "证据",
  audit: "摄取审计",
  ads: "广告",
  organic: "自然内容",
  metrics: "指标观测",
  provenance: "来源",
  observedAt: "观测时间",
  demoNotice:
    "Demo 模式：样本广告与条目来自明确标注的合成连接器；公开 YouTube 条目（yt:…）为真实数据。每条记录都带来源 id。",
  liveNotice: "Live 模式：仅已验证的公开来源 — 空缺就是空缺。",
  loading: "加载中…",
  emptyMissions: "暂无任务",
  error: "错误",
  gap: "空缺",
  missing: "—",
  scoreObserved: "观测",
  scoreCrossSource: "跨源",
  scorePredicted: "预测",
  scoreConfidence: "置信",
  contrary: "反例",
  evidenceRefs: "证据",
  forecast: "预测",
  nextSteps: "下一步",
  nextDiscover: "发现竞品（Agent 或上方表单）。",
  nextResearch: "运行平台调研以摄取证据。",
  nextAnalyze: "让 Agent 分析创意并排序机会。",
  constraintList: "约束",
};

export const OBJECTIVES: Array<{ value: string; en: string; zh: string }> = [
  { value: "awareness", en: "awareness — views", zh: "认知 — 观看" },
  { value: "engagement", en: "engagement — engagement rate", zh: "互动 — 互动率" },
  { value: "traffic", en: "traffic — outbound clicks", zh: "流量 — 外链点击" },
  { value: "leads", en: "leads — qualified leads", zh: "线索 — 合格线索" },
  { value: "sales", en: "sales — attributed conversions", zh: "销售 — 归因转化" },
  { value: "retention", en: "retention — repeat purchases", zh: "留存 — 复购" },
];
