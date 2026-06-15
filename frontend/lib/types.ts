/** SparkLearn 前后端事件协议(与 backend/app/agents/emitter.py 对齐)。 */
export type AgentId =
  | "profile" | "orchestrator" | "planner" | "path"
  | "doc" | "mindmap" | "quiz" | "media" | "tutor" | "eval";

export interface SparkEvent {
  type:
    | "agent_start" | "agent_end" | "agent_token"
    | "token" | "resource" | "profile" | "path"
    | "progress" | "citations" | "safety" | "summary"
    | "error" | "done";
  ts?: string;
  agent?: AgentId | string;
  label?: string;
  detail?: string;
  summary?: string;
  delta?: string;
  resource?: ResourceItem;
  profile?: StudentProfile;
  path?: PathPlan;
  items?: string[];
  text?: string;
  percent?: number;
  stage?: string;
  level?: string;
  output?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface QuizQuestion {
  id: string;
  type: "single" | "fill" | "judge" | "design" | "complexity";
  stem: string;
  options: string[];
  answer: string;
  explain?: string;
  kp: string;
  difficulty: number;
  error_tags: string[];
}

export interface ResourceItem {
  id: string;
  kind: "doc" | "code" | "reading" | "mindmap" | "quiz" | "video" | string;
  kp: string;
  title: string;
  payload: {
    markdown?: string;
    markmap?: string;
    questions?: QuizQuestion[];
    difficulty?: number;
    script?: { title?: string; narration?: string; scenes?: { t: string; visual: string; caption?: string }[]; video_prompt?: string };
    video?: { status?: string; url?: string; task_id?: string };
    manim_code?: string;
    audio_url?: string;
    cover_url?: string;
    grounded?: boolean;
  };
  citations: string[];
  created_at?: string;
}

export interface StudentProfile {
  knowledge_mastery: Record<string, number>;
  cognitive_style: string;
  error_prone: string[];
  goal: string;
  pace: string;
  difficulty_pref: string;
  resource_pref: Record<string, number>;
  metacognition: number | string;
  version?: number;
}

export interface PathNode {
  id: string;
  name: string;
  mastery: number;
  status: "done" | "ready" | "locked";
  difficulty: number;
  score: number;
  reason: string;
  order?: number;
}

export interface PathPlan {
  nodes: PathNode[];
  edges: { from: string; to: string }[];
  next_kp: string | null;
  generated_by?: string;
  updated_at?: string;
}
