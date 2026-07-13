"use client";

import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ChartNoAxesColumn,
  FolderOpen,
  GraduationCap,
  Route,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import AgentTrace, { applyTraceEvent, emptyTrace, type TraceState } from "@/components/agent/AgentTrace";
import Chat from "@/components/chat/Chat";
import PathDag from "@/components/path/PathDag";
import ProfileRadar from "@/components/profile/ProfileRadar";
import ResourceCard from "@/components/resource/ResourceCard";
import CinematicBackground from "@/components/ui/CinematicBackground";
import { useView, type ViewKey } from "@/components/view/ViewContext";
import { apiGet, apiUpload, USER_ID } from "@/lib/api";
import type { PathPlan, ResourceItem, SparkEvent, StudentProfile } from "@/lib/types";

type TaskKey = "full" | "quiz" | "path";
type PanelKey = "chat" | "profile" | "path" | "resources";
type ResourceFilter = "all" | "doc" | "mindmap" | "quiz" | "video";
type QuickEntry = {
  title: string;
  desc: string;
  panel: PanelKey;
  action?: TaskKey;
  generate?: {
    goal: string;
    kinds: string[];
  };
};
type ChatRequest = { path: string; body: Record<string, unknown>; display: string };
type EvalReportSummary = { path?: PathPlan; profile_version?: number };
type FlowStatus = "idle" | "running" | "done" | "error";
type UploadResult = {
  source: { id: string; title: string; source_type: string; chunk_count: number };
  sample?: { text: string; citation: string }[];
};

const ROLE_ORDER: ViewKey[] = ["student", "teacher", "judge"];

const RESOURCE_FILTERS: { key: ResourceFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "doc", label: "讲解" },
  { key: "mindmap", label: "导图" },
  { key: "quiz", label: "练习" },
  { key: "video", label: "讲稿" },
];

const ROLE_PROFILE: Record<
  ViewKey,
  {
    image: string;
    name: string;
    who: string;
    title: string;
    line: string;
    tasks: [string, string, string];
    accent: string;
    tint: string;
  }
> = {
  student: {
    image: "/roles/student-v2.png",
    name: "学生",
    who: "个人学习视角",
    title: "SparkLearn，学习的左膀右臂。",
    line: "讲解、练习、路径，一句话就能开始。",
    tasks: ["给我讲透二叉树遍历", "按我的薄弱点出 3 道题", "安排本周学习顺序"],
    accent: "#0F6B50",
    tint: "#E3F0E9",
  },
  teacher: {
    image: "/roles/teacher-v2.png",
    name: "老师",
    who: "教学组织视角",
    title: "备课更轻，依据更清。",
    line: "你定教学目标，系统整理讲解、练习和班级易错点。",
    tasks: ["为下周排序算法备课", "给班级出分层练习", "查看全班本周易错点"],
    accent: "#9C4A21",
    tint: "#F6EAE1",
  },
  judge: {
    image: "/roles/manager-v2.png",
    name: "教研负责人",
    who: "质量管理视角",
    title: "先看效果，再看依据。",
    line: "学习效果、来源、风险和覆盖缺口，一屏看清。",
    tasks: ["生成本周学习效果周报", "复核昨日生成内容", "检查知识库覆盖缺口"],
    accent: "#3D5A73",
    tint: "#E7EEF4",
  },
};

const ROLE_FLOW: Record<ViewKey, { eyebrow: string; result: string; steps: [string, string, string, string] }> = {
  student: {
    eyebrow: "从一个问题，到真正会做",
    result: "讲解、练习与下一步彼此衔接",
    steps: ["说出目标", "讲清概念", "针对练习", "调整路线"],
  },
  teacher: {
    eyebrow: "从教学目标，到一套可用内容",
    result: "备课内容与班级易错点放在一起",
    steps: ["确定目标", "整理讲义", "生成练习", "汇总易错"],
  },
  judge: {
    eyebrow: "从学习结果，到可追溯依据",
    result: "效果、来源与风险保持同一口径",
    steps: ["查看效果", "追溯来源", "识别风险", "检查覆盖"],
  },
};

const TRACE_FLOW: { label: string; ids: string[] }[] = [
  { label: "理解目标", ids: ["profile", "orchestrator"] },
  { label: "规划路线", ids: ["planner", "path"] },
  { label: "整理内容", ids: ["doc", "mindmap", "quiz", "media", "tutor"] },
  { label: "检查结果", ids: ["eval"] },
];

const TASKS: Record<
  TaskKey,
  {
    k: string;
    title: string;
    sub: string;
    seed: string;
  }
> = {
  full: {
    k: "任务一",
    title: "给我讲透一个知识点",
    sub: "讲解、导图、练习与讲解稿，一次整理好",
    seed: "请围绕二叉树遍历生成一套学习资料：图文讲义、思维导图、练习题和讲解脚本。",
  },
  quiz: {
    k: "任务二",
    title: "按薄弱点练几题",
    sub: "做完后更新掌握情况，知道下一步该补哪里",
    seed: "我想针对二叉树递归边界做一组练习题，做完后帮我更新掌握情况。",
  },
  path: {
    k: "任务三",
    title: "排好下一步学习",
    sub: "根据当前掌握情况，安排更合适的学习顺序",
    seed: "请根据我的掌握度安排本周数据结构学习顺序，优先攻克二叉树并衔接到二叉搜索树。",
  },
};

const TASK_ICONS = {
  full: BookOpen,
  quiz: GraduationCap,
  path: Route,
} satisfies Record<TaskKey, typeof BookOpen>;

const QUICK_ENTRIES: QuickEntry[] = [
  {
    title: "我的学习情况",
    desc: "掌握度、错因和最近变化",
    panel: "profile",
  },
  {
    title: "知识导图",
    desc: "把知识点展开成一张图",
    panel: "chat",
    generate: {
      goal: "请为当前知识点生成一张基于教材依据的知识导图。",
      kinds: ["mindmap"],
    },
  },
  {
    title: "巩固练习",
    desc: "按薄弱点出题并更新掌握",
    panel: "chat",
    action: "quiz",
  },
  {
    title: "下一步安排",
    desc: "按掌握情况排学习顺序",
    panel: "path",
    action: "path",
  },
];

function SparkMark({ running = false, light = false }: { running?: boolean; light?: boolean }) {
  return (
    <span className={`inline-grid h-6 w-6 place-items-center ${running ? "animate-pulse" : ""}`} aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 1.8c.9 4.8 4.6 8.5 9.4 9.4-4.8.9-8.5 4.6-9.4 9.4-.9-4.8-4.6-8.5-9.4-9.4 4.8-.9 8.5-4.6 9.4-9.4z"
          fill={running ? "#F4A261" : light ? "#E7FFF2" : "#0F6B50"}
        />
      </svg>
    </span>
  );
}

function RoleAvatar({ role, size = "large" }: { role: ViewKey; size?: "small" | "medium" | "large" }) {
  const meta = ROLE_PROFILE[role];
  const cls =
    size === "small"
      ? "h-8 w-8 rounded-full"
      : size === "medium"
        ? "h-20 w-20 rounded-[18px]"
        : "h-[176px] w-full rounded-[14px]";
  return (
    <span className={`relative block overflow-hidden border border-black/[0.06] bg-[#EEF1EC] ${cls}`}>
      <Image
        src={meta.image}
        alt={`${meta.name}角色形象`}
        fill
        sizes={size === "small" ? "32px" : size === "medium" ? "80px" : "(max-width: 1024px) 100vw, 360px"}
        className={size === "large" ? "object-cover object-[center_24%] transition duration-500 group-hover:scale-[1.025]" : "object-cover object-top"}
        priority={role === "student"}
      />
    </span>
  );
}

function RoleLearningFlow({ role }: { role: ViewKey }) {
  const flow = ROLE_FLOW[role];
  return (
    <div key={role} className="learning-ribbon animate-flow-swap" aria-live="polite">
      <div className="learning-ribbon-copy">
        <span>{flow.eyebrow}</span>
        <strong>{flow.result}</strong>
      </div>
      <div className="learning-ribbon-steps" aria-label={`${ROLE_PROFILE[role].name}使用流程`}>
        {flow.steps.map((step, index) => (
          <div key={step} className="learning-ribbon-step">
            <span className="learning-ribbon-node">{index + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function traceStageStatus(trace: TraceState, ids: string[]): FlowStatus {
  const nodes = ids.map((id) => trace[id]).filter(Boolean);
  if (nodes.some((node) => node.status === "error")) return "error";
  if (nodes.some((node) => node.status === "running")) return "running";
  if (nodes.some((node) => node.status === "done")) return "done";
  return "idle";
}

function WorkflowRail({ trace }: { trace: TraceState }) {
  const stages = TRACE_FLOW.map((stage) => ({ ...stage, status: traceStageStatus(trace, stage.ids) }));
  const hasError = stages.some((stage) => stage.status === "error");
  const isRunning = stages.some((stage) => stage.status === "running");
  const isDone = stages.some((stage) => stage.status === "done") && !isRunning;
  const stateLabel = hasError ? "部分内容需要重试" : isRunning ? "星火正在整理" : isDone ? "本轮已经整理好" : "准备就绪";

  return (
    <div className="workflow-rail" aria-label="学习任务处理进度" aria-live="polite">
      <div className="workflow-rail-state">
        <span className={`workflow-live-dot ${isRunning ? "is-running" : isDone ? "is-done" : hasError ? "is-error" : ""}`} />
        <span>{stateLabel}</span>
      </div>
      <div className="workflow-rail-steps">
        {stages.map((stage, index) => (
          <div key={stage.label} className={`workflow-stage is-${stage.status}`}>
            <span className="workflow-stage-node">{stage.status === "done" ? "✓" : index + 1}</span>
            <span>{stage.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleGate({ onEnter }: { onEnter: (role: ViewKey, goal?: string) => void }) {
  const [previewRole, setPreviewRole] = useState<ViewKey>("student");
  return (
    <main className="role-gate-shell relative min-h-dvh overflow-hidden text-white">
      <CinematicBackground />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 py-5 sm:px-8 sm:py-6">
        <nav className="liquid-glass glass-readable flex items-center justify-between rounded-full px-5 py-3 sm:px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <SparkMark light />
              <span className="text-xl text-white" style={{ fontFamily: "var(--font-display)" }}>SparkLearn<sup className="ml-0.5 text-[9px]">®</sup></span>
            </div>
            <div className="hidden items-center gap-6 text-sm font-medium text-white/70 md:flex">
              <a href="#roles" className="text-white transition-colors">首页</a>
              <a href="#roles" className="transition-colors hover:text-white">学习方式</a>
              <a href="#roles" className="transition-colors hover:text-white">个性路线</a>
              <a href="#roles" className="transition-colors hover:text-white">依据溯源</a>
            </div>
          </div>
          <button onClick={() => onEnter("student")} className="liquid-glass flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-[1.03]">
            开始学习 <ArrowRight size={16} />
          </button>
        </nav>

        <section className="cinematic-copy relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-[72px] text-center lg:-translate-y-[5%]">
          <h1
            className="animate-fade-rise max-w-6xl text-[44px] font-normal leading-[0.98] text-white sm:text-7xl md:text-8xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <span className="block">SparkLearn，</span>
            <em className="mt-1 block whitespace-nowrap text-[38px] not-italic text-white/70 sm:text-7xl md:text-8xl">学习的左膀右臂。</em>
          </h1>
          <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
            面向学生、老师与教研人员的智能学习平台。把讲解、练习、学习路线与可追溯依据，整理成真正能继续行动的一页。
          </p>
          <RoleLearningFlow role={previewRole} />
          <button onClick={() => onEnter(previewRole)} className="liquid-glass animate-fade-rise-delay-2 mt-7 flex cursor-pointer items-center gap-3 rounded-full px-12 py-4 text-base font-medium text-white transition-transform hover:scale-[1.03]">
            选择身份进入 <ArrowRight size={18} />
          </button>
        </section>

        <section id="roles" className="grid gap-3 pb-2 md:grid-cols-3">
          {ROLE_ORDER.map((role) => {
            const item = ROLE_PROFILE[role];
            return (
              <button
                key={role}
                onClick={() => onEnter(role)}
                onMouseEnter={() => setPreviewRole(role)}
                onFocus={() => setPreviewRole(role)}
                aria-pressed={previewRole === role}
                className={`liquid-glass glass-readable group flex min-h-[88px] items-center gap-3 rounded-[16px] p-3 text-left transition-transform hover:-translate-y-1 ${previewRole === role ? "role-entry-active" : ""}`}
              >
                <RoleAvatar role={role} size="small" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-base font-black text-white">{item.name}</span>
                    <span className="truncate text-xs text-white/50">{item.who}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs leading-5 text-white/70">{item.line}</span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-white/50 transition group-hover:translate-x-1 group-hover:text-white" />
              </button>
            );
          })}
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  const { view, setView } = useView();
  const [entered, setEntered] = useState(false);
  const [trace, setTrace] = useState<TraceState>(emptyTrace());
  const [seed, setSeed] = useState<string | undefined>();
  const [request, setRequest] = useState<ChatRequest | undefined>();
  const [activeTask, setActiveTask] = useState<TaskKey | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKey>("chat");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [input, setInput] = useState("");
  const [chatStarted, setChatStarted] = useState(false);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [pathPlan, setPathPlan] = useState<PathPlan | null>(null);
  const [selectedPathNode, setSelectedPathNode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>("all");
  const [panelError, setPanelError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadError, setUploadError] = useState(false);
  const sourceInputRef = useRef<HTMLInputElement>(null);

  const roleMeta = ROLE_PROFILE[view];
  const running = useMemo(() => Object.values(trace).some((n) => n.status === "running"), [trace]);
  const finished = useMemo(() => Object.values(trace).some((n) => n.status === "done"), [trace]);
  const showHome = activePanel === "chat" && !chatStarted;
  const filteredResources = useMemo(() => {
    if (resourceFilter === "all") return resources;
    if (resourceFilter === "doc") return resources.filter((item) => ["doc", "code", "reading"].includes(item.kind));
    return resources.filter((item) => item.kind === resourceFilter);
  }, [resourceFilter, resources]);

  const enter = (role: ViewKey, goal?: string) => {
    setView(role);
    setEntered(true);
    if (goal) {
      setActivePanel("chat");
      setSeed(goal);
      setRequest(undefined);
      setChatStarted(true);
    }
  };

  const leave = () => {
    setEntered(false);
    setActiveTask(null);
    setSeed(undefined);
    setRequest(undefined);
    setChatStarted(false);
    setTrace(emptyTrace());
  };

  const goHome = () => {
    setActiveTask(null);
    setActivePanel("chat");
    setChatStarted(false);
    setSeed(undefined);
    setRequest(undefined);
    setPanelError("");
  };

  const loadProfile = useCallback(async () => {
    setPanelError("");
    try {
      const report = await apiGet<{ profile?: StudentProfile }>(`/eval/report?user_id=${USER_ID}`);
      if (report.profile) {
        setProfile(report.profile);
        return;
      }
      const next = await apiGet<StudentProfile>(`/profile/${USER_ID}`);
      setProfile(next);
    } catch (err) {
      setPanelError(`学习情况暂时无法读取：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const loadPath = useCallback(async () => {
    setPanelError("");
    try {
      const plan = await apiGet<PathPlan>(`/path?user_id=${USER_ID}`);
      setPathPlan(plan);
      setSelectedPathNode(plan.next_kp || plan.nodes[0]?.id || null);
    } catch (err) {
      setPanelError(`下一步安排暂时无法读取：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const refreshAfterEvaluation = useCallback((report?: EvalReportSummary) => {
    if (report?.path) {
      setPathPlan(report.path);
      setSelectedPathNode(report.path.next_kp || report.path.nodes[0]?.id || null);
    }
    void loadProfile();
  }, [loadProfile]);

  const loadResources = useCallback(async () => {
    setPanelError("");
    try {
      const data = await apiGet<{ items: ResourceItem[] }>(`/resources?user_id=${USER_ID}&limit=8`);
      setResources(data.items || []);
      setActivePanel("resources");
    } catch (err) {
      setPanelError(`最近资料暂时无法读取：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const startTask = (key: TaskKey) => {
    setActiveTask(key);
    setActivePanel(key === "path" ? "path" : "chat");
    setTrace(emptyTrace());
    setSeed(undefined);
    setPanelError("");
    if (key === "path") {
      void loadPath();
      return;
    }
    const kinds = key === "quiz" ? ["quiz"] : ["doc", "mindmap", "quiz", "video"];
    const display = TASKS[key].seed;
    setRequest({
      path: "/resources/generate",
      display,
      body: {
        user_id: USER_ID,
        goal: display,
        knowledge_points: [pathPlan?.next_kp || "binary_tree"],
        kinds,
        source_ids: selectedSourceIds,
      },
    });
    setChatStarted(true);
  };

  const startGenerate = (display: string, kinds: string[]) => {
    setActiveTask(null);
    setActivePanel("chat");
    setTrace(emptyTrace());
    setSeed(undefined);
    setPanelError("");
    setRequest({
      path: "/resources/generate",
      display,
      body: {
        user_id: USER_ID,
        goal: display,
        knowledge_points: [pathPlan?.next_kp || "binary_tree"],
        kinds,
        source_ids: selectedSourceIds,
      },
    });
    setChatStarted(true);
  };

  const runQuick = (entry: QuickEntry) => {
    if (entry.generate) {
      startGenerate(entry.generate.goal, entry.generate.kinds);
      return;
    }
    if (entry.action) {
      startTask(entry.action);
      return;
    }
    setActiveTask(null);
    setActivePanel(entry.panel);
    if (entry.panel === "profile") {
      void loadProfile();
    } else if (entry.panel === "path") {
      void loadPath();
    }
  };

  const ask = () => {
    const q = input.trim();
    if (!q) return;
    setActiveTask(null);
    setActivePanel("chat");
    setTrace(emptyTrace());
    setRequest(undefined);
    setSeed(q);
    setChatStarted(true);
    setInput("");
  };

  const uploadSource = async (file: File) => {
    setUploading(true);
    setUploadNote("");
    setUploadError(false);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", USER_ID);
      form.append("title", file.name.replace(/\.[^.]+$/, ""));
      const result = await apiUpload<UploadResult>("/knowledge/upload", form);
      setSelectedSourceIds((ids) => Array.from(new Set([...ids, result.source.id])));
      setUploadNote(`已加入「${result.source.title}」· ${result.source.chunk_count} 个可引用片段`);
    } catch (error) {
      setUploadError(true);
      setUploadNote(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const onEvent = useCallback((ev: SparkEvent) => {
    setTrace((t) => applyTraceEvent(t, ev));
    if (ev.type === "profile" && ev.profile) setProfile(ev.profile);
    if (ev.type === "path" && ev.path) {
      setPathPlan(ev.path);
      setSelectedPathNode(ev.path.next_kp || ev.path.nodes[0]?.id || null);
    }
    if (ev.type === "trace" && ev.session_id) setSessionId(String(ev.session_id));
    if (ev.type === "resource" && ev.resource) setResources((items) => [ev.resource!, ...items].slice(0, 8));
  }, []);

  if (!entered) return <RoleGate onEnter={enter} />;

  return (
    <main className="app-shell cinematic-theme relative flex h-dvh flex-col overflow-hidden text-[#182119]">
      <CinematicBackground subdued={!showHome || evidenceOpen} />
      <header className="topbar-premium relative z-20 flex h-16 shrink-0 items-center gap-4 px-4 text-white sm:px-5">
        <button onClick={goHome} className="flex items-center gap-3 text-left" title="返回学习台首页">
          <SparkMark running={running} light />
          <div className="text-lg font-black tracking-tight">SparkLearn</div>
          <div className="hidden border-l border-white/20 pl-4 text-sm font-semibold text-white/60 md:block">
            星火学伴 · 学习的左膀右臂
          </div>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span
            className={`hidden rounded-full border px-3 py-1.5 text-sm font-black sm:inline-flex ${
              running
                ? "border-[#EED4C2] bg-[#FBEAE0] text-[#C2410C]"
                : finished
                  ? "border-[#CBE3D6] bg-[#E3F0E9] text-[#0B5340]"
                  : "border-[#E5E9E3] bg-[#FBFCFA] text-[#57635A]"
            }`}
          >
            {running ? "执行中" : finished ? "已完成" : "待开始"}
          </span>

          <button
            onClick={leave}
            className="flex items-center gap-2 rounded-full border border-[#E5E9E3] bg-[#FBFCFA] px-2 py-1 text-sm font-black text-[#182119] transition hover:border-[#D2DAD2]"
            title="重新选择身份"
          >
            <RoleAvatar role={view} size="small" />
            <span>{roleMeta.name}</span>
            <span className="hidden font-normal text-[#8B958D] sm:inline">{roleMeta.who}</span>
            <span className="hidden rounded-full bg-[#E3F0E9] px-2 py-0.5 text-[11px] font-black text-[#0F6B50] md:inline">
              切换身份
            </span>
            <span className="text-[#8B958D]">⌄</span>
          </button>

          <button
            onClick={() => setEvidenceOpen((v) => !v)}
            className="liquid-glass glass-readable flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black text-white transition hover:bg-white/[0.08]"
          >
            <ShieldCheck size={16} />
            <span className="hidden sm:inline">依据 {evidenceOpen ? "收起" : "展开"}</span>
          </button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        <aside className="sidebar-premium relative z-10 hidden w-[296px] shrink-0 lg:flex lg:flex-col">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-6">
            <section>
              <h2 className="mb-3 text-xs font-black text-[#8B958D]">说一句话开始</h2>
              <div className="flex items-center gap-2 rounded-[16px] border border-[#D2DAD2] bg-white p-1.5 shadow-sm focus-within:border-[#0F6B50] focus-within:ring-4 focus-within:ring-[#E3F0E9]">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") ask();
                  }}
                  placeholder="例如：树的高度怎么算？"
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-[#8B958D]"
                />
                <button
                  onClick={ask}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#0F6B50] text-xl font-black text-white transition hover:bg-[#0B5340]"
                  aria-label="开始"
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-black text-[#8B958D]">今天先处理这三件事</h2>
              <div className="space-y-3">
                {(Object.entries(TASKS) as [TaskKey, (typeof TASKS)[TaskKey]][]).map(([key, task]) => {
                  const TaskIcon = TASK_ICONS[key];
                  return <button
                    key={key}
                    onClick={() => startTask(key)}
                    className={`flex w-full gap-3 rounded-[14px] border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
                      activeTask === key ? "border-[#0F6B50] bg-[#F0F6F2]" : "border-[#E5E9E3]"
                    }`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#E3F0E9] text-[#0F6B50]">
                      <TaskIcon size={15} />
                    </span>
                    <span>
                      <span className="block text-sm font-black leading-6">{task.title}</span>
                      <span className="mt-1 block text-sm leading-6 text-[#8B958D]">{task.sub}</span>
                    </span>
                  </button>;
                })}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-black text-[#8B958D]">正在处理</h2>
              <div className="rounded-[14px] border border-dashed border-[#D2DAD2] bg-white p-4 text-sm leading-7 text-[#8B958D]">
                {running
                  ? "系统正在整理讲解、练习和下一步安排。"
                  : finished
                    ? "已经整理好。内容在中间，依据在右上角。"
                  : "还没有任务在执行。点上面的任务，或直接说一句话。"}
              </div>
              <button
                onClick={() => void loadResources()}
                className="mt-3 flex w-full items-center gap-2 rounded-[12px] border border-[#E5E9E3] bg-white px-3 py-2.5 text-left text-sm font-black text-[#0F6B50] transition hover:border-[#0F6B50] hover:bg-[#F0F6F2]"
              >
                <FolderOpen size={16} /> 查看最近整理的资料 <ArrowRight size={14} className="ml-auto" />
              </button>
              <input
                ref={sourceInputRef}
                type="file"
                accept=".txt,.md,.pdf,.png,.jpg,.jpeg,text/plain,text/markdown,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadSource(file);
                }}
              />
              <button
                onClick={() => sourceInputRef.current?.click()}
                disabled={uploading}
                className="mt-2 flex w-full items-center gap-2 rounded-[12px] border border-[#E5E9E3] bg-white px-3 py-2.5 text-left text-sm font-black text-[#0F6B50] transition hover:border-[#0F6B50] hover:bg-[#F0F6F2] disabled:cursor-wait disabled:opacity-60"
              >
                <Upload size={16} /> {uploading ? "正在读取资料…" : "上传讲义或照片"} <ArrowRight size={14} className="ml-auto" />
              </button>
              {uploadNote && (
                <p className={`mt-2 text-xs leading-5 ${uploadError ? "text-[#C2410C]" : "text-[#0F6B50]"}`}>
                  {uploadNote}
                </p>
              )}
              {selectedSourceIds.length > 0 && (
                <p className="mt-1 text-[11px] leading-5 text-[#8B958D]">
                  后续生成将优先依据本次选中的 {selectedSourceIds.length} 份资料。
                </p>
              )}
            </section>

            <section className="mt-auto">
              <h2 className="mb-3 text-xs font-black text-[#8B958D]">快捷入口</h2>
              <div className="space-y-2">
                {QUICK_ENTRIES.map((entry, index) => (
                  (() => {
                    const QuickIcon = [ChartNoAxesColumn, BrainCircuit, GraduationCap, Route][index];
                    return <button
                      key={entry.title}
                      onClick={() => runQuick(entry)}
                      className={`group flex w-full items-start gap-3 rounded-[13px] border bg-white px-3 py-3 text-left transition hover:border-[#BFD0C5] hover:shadow-sm ${
                        activePanel === entry.panel ? "border-[#0F6B50] shadow-sm" : "border-[#E5E9E3]"
                      }`}
                    >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#E3F0E9] text-[#0F6B50]">
                      <QuickIcon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black leading-5 text-[#182119]">{entry.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#8B958D]">{entry.desc}</span>
                    </span>
                    <span className="ml-auto pt-0.5 text-[#8B958D] transition group-hover:translate-x-0.5 group-hover:text-[#0F6B50]">→</span>
                    </button>;
                  })()
                ))}
              </div>
            </section>
          </div>
        </aside>

        <section className="workspace-canvas min-w-0 flex-1 overflow-y-auto">
          <div className={`mx-auto max-w-[1040px] px-4 pb-24 sm:px-6 ${showHome ? "pt-12 lg:pt-16" : "pt-6 lg:pt-9"}`}>
            <nav className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="学习台导航">
              <button onClick={goHome} className={`shrink-0 rounded-[9px] px-3 py-2 text-xs font-black ${showHome ? "bg-[#0F6B50] text-white" : "border border-[#D8DED7] bg-white text-[#57635A]"}`}>首页</button>
              {QUICK_ENTRIES.map((entry) => (
                <button key={entry.title} onClick={() => runQuick(entry)} className="shrink-0 rounded-[9px] border border-[#D8DED7] bg-white px-3 py-2 text-xs font-black text-[#57635A]">
                  {entry.title}
                </button>
              ))}
              <button onClick={() => void loadResources()} className="shrink-0 rounded-[9px] border border-[#D8DED7] bg-white px-3 py-2 text-xs font-black text-[#57635A]">资料库</button>
            </nav>

            {showHome && (
              <section className="workspace-hero animate-rise">
                <div className="mb-5 flex items-center gap-3 text-sm font-black text-white/70">
                  <SparkMark light />
                  <span>{roleMeta.name}视角 · 今天从一件事开始</span>
                </div>
                <h1 className="cinematic-copy max-w-[980px] text-[clamp(38px,4.3vw,54px)] leading-[1.06] text-white sm:whitespace-nowrap" style={{ fontFamily: "var(--font-display)" }}>
                  SparkLearn，学习的左膀右臂。
                </h1>
                <p className="cinematic-copy mt-4 max-w-[720px] text-base leading-8 text-white/75 sm:text-lg">
                  {roleMeta.name === "学生"
                    ? "讲解、练习与学习路线围绕同一个目标展开。你看结论，也随时能查看出处。"
                    : roleMeta.name === "老师"
                      ? "给出教学目标，讲义、分层练习和学生易错点会被整理到同一工作区。"
                      : "学习效果先呈现，来源、风险与处理过程按需展开。"}
                </p>

                <div className="liquid-glass glass-readable mt-7 flex max-w-[680px] items-center gap-3 rounded-full py-2 pl-5 pr-2">
                  <BrainCircuit size={20} className="shrink-0 text-white/60" />
                  <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && ask()} placeholder="说出学习目标，例如：树的高度怎么算？" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50 sm:text-base" />
                  <button onClick={ask} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[#042435] transition hover:scale-[1.04]" aria-label="开始提问"><ArrowRight size={20} /></button>
                </div>

                <WorkflowRail trace={trace} />

                <div className="mt-9 grid gap-4 md:grid-cols-3">
                  {(Object.entries(TASKS) as [TaskKey, (typeof TASKS)[TaskKey]][]).map(([key, task]) => {
                    const TaskIcon = TASK_ICONS[key];
                    return <button key={key} onClick={() => startTask(key)} className="liquid-glass glass-readable task-card-premium group min-h-[172px] p-5 text-left text-white">
                      <div className="flex items-center justify-between">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-[#F6D98D]"><TaskIcon size={18} /></span>
                        <ArrowRight size={18} className="text-white/50 transition group-hover:translate-x-1 group-hover:text-white" />
                      </div>
                      <div className="mt-5 text-lg font-black leading-7">{task.title}</div>
                      <div className="mt-2 text-sm leading-6 text-white/70">{task.sub}</div>
                    </button>;
                  })}
                </div>
              </section>
            )}

            {panelError && (
              <div className="mb-5 rounded-[12px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-800">{panelError}</div>
            )}

            {activePanel === "profile" && (
              <section className="animate-rise">
                <div className="workspace-heading">
                  <div>
                    <div className="workspace-eyebrow">我的学习情况</div>
                    <h1 className="workspace-title">每次练习，都留下进步。</h1>
                    <p className="workspace-desc">掌握度、错因和最近变化来自真实作答记录。</p>
                  </div>
                  <button onClick={() => void loadProfile()} className="secondary-action">刷新数据</button>
                </div>
                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <ProfileRadar profile={profile} />
                  <div className="insight-panel p-5">
                    <div className="text-xs font-black text-[#0F6B50]">下一步怎么学</div>
                    <h2 className="mt-3 text-xl font-black">先看薄弱点，再安排练习。</h2>
                    <p className="mt-3 text-sm leading-7 text-[#6F7B72]">提交题组后，掌握度和错因会更新；学习路线也会随之调整。</p>
                    <button onClick={() => { setActivePanel("path"); void loadPath(); }} className="primary-action mt-6">查看学习路线</button>
                  </div>
                </div>
              </section>
            )}

            {activePanel === "path" && (
              <section className="animate-rise">
                <div className="workspace-heading">
                  <div>
                    <div className="workspace-eyebrow">下一步安排</div>
                    <h1 className="workspace-title">学习有顺序，进步有依据。</h1>
                    <p className="workspace-desc">掌握度和先修关系共同决定推荐顺序。</p>
                  </div>
                  <button onClick={() => void loadPath()} className="secondary-action">重新计算</button>
                </div>
                <div className="insight-panel mt-6 p-5">
                  {pathPlan ? (
                    <div className="overflow-x-auto">
                      <PathDag plan={pathPlan} selected={selectedPathNode} onSelect={setSelectedPathNode} />
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#D8DED7] bg-[#F7F8F5] p-4 text-sm text-[#57635A]">
                        <span>当前建议优先学习</span>
                        <span className="font-black text-[#0F6B50]">{pathPlan.nodes.find((node) => node.id === pathPlan.next_kp)?.name || pathPlan.next_kp || "等待生成"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[12px] border border-dashed border-[#D2DAD2] bg-[#F7F8F5] p-8 text-center text-sm text-[#8B958D]">正在读取你的最新学习路线。</div>
                  )}
                </div>
              </section>
            )}

            {activePanel === "resources" && (
              <section className="animate-rise">
                <div className="workspace-heading">
                  <div>
                    <div className="workspace-eyebrow">我的资料库</div>
                    <h1 className="workspace-title">学过的内容，随时接着看。</h1>
                    <p className="workspace-desc">讲解、导图、练习和讲稿按类型整理，出处随内容保留。</p>
                  </div>
                  <span className="rounded-[9px] border border-[#D8DED7] bg-white px-3 py-2 text-xs font-black text-[#57635A]">{resources.length} 份资料</span>
                </div>

                <div className="mt-5 flex gap-1 overflow-x-auto rounded-[12px] border border-[#D8DED7] bg-[#ECEFEA] p-1" role="tablist" aria-label="资料类型">
                  {RESOURCE_FILTERS.map((filter) => {
                    const count = filter.key === "all" ? resources.length : resources.filter((item) => filter.key === "doc" ? ["doc", "code", "reading"].includes(item.kind) : item.kind === filter.key).length;
                    return (
                      <button key={filter.key} onClick={() => setResourceFilter(filter.key)} role="tab" aria-selected={resourceFilter === filter.key} className={`min-w-[86px] flex-1 rounded-[9px] px-3 py-2.5 text-sm font-black transition ${resourceFilter === filter.key ? "bg-white text-[#182119] shadow-sm" : "text-[#6F7B72] hover:text-[#182119]"}`}>
                        {filter.label}<span className="ml-1.5 font-mono text-[11px] text-[#9AA39B]">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {filteredResources.length > 0 ? (
                  <div className="resource-shelf mt-4 space-y-3">
                    {filteredResources.map((item) => <ResourceCard key={item.id} r={item} onQuizEvaluated={refreshAfterEvaluation} />)}
                  </div>
                ) : (
                  <div className="insight-panel mt-4 p-10 text-center">
                    <div className="text-lg font-black">这里还没有这类资料</div>
                    <p className="mt-2 text-sm leading-7 text-[#6F7B72]">回到首页选择一个任务，生成结果会自动归档。</p>
                    <button onClick={goHome} className="primary-action mt-5">返回首页</button>
                  </div>
                )}
              </section>
            )}

            {activePanel === "chat" && chatStarted && (
              <section className="animate-rise overflow-hidden rounded-[16px] border border-[#D8DED7] bg-white shadow-[0_1px_2px_rgba(18,30,22,0.04),0_18px_48px_rgba(18,30,22,0.08)]">
                <Chat onEvent={onEvent} seed={seed} request={request} onSeedConsumed={() => { setSeed(undefined); setRequest(undefined); }} onQuizEvaluated={refreshAfterEvaluation} />
              </section>
            )}
          </div>
        </section>
      </div>

      <section
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#032838]/[0.97] text-[#DCE9EF] shadow-[0_-20px_60px_rgba(0,24,36,0.24)] backdrop-blur-xl transition-transform duration-300 ${
          evidenceOpen ? "translate-y-0" : "translate-y-[calc(100%-56px)]"
        }`}
      >
        <button onClick={() => setEvidenceOpen((v) => !v)} className="flex h-14 w-full items-center justify-between px-6 text-left">
          <span>
            <ShieldCheck size={16} className="mr-3 inline-block text-[#7ED9A6]" />
            <span className="font-black text-white">依据与过程</span>
            <span className="ml-3 hidden text-sm text-[#B9D2C2] md:inline">资料来源、处理过程和每一步依据都在这里</span>
          </span>
          <span className="text-sm font-black text-[#8DA18F]">{evidenceOpen ? "收起" : "展开"}</span>
        </button>
        <div className="max-h-[46vh] overflow-y-auto border-t border-[#26312A] p-4">
          <AgentTrace trace={trace} />
          {sessionId && (
            <div className="mt-3 rounded-[10px] border border-[#26312A] bg-[#151D18] px-3 py-2 font-mono text-[11px] text-[#8DA18F]">
              运行编号：{sessionId}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
