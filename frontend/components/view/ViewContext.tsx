"use client";
/** 三类使用视角(学生 / 老师 / 教研负责人):
 *  只切换前端文案、提示与默认展示重点,不改任何请求参数与数据流,
 *  当前版本使用固定学习档案。选择持久化到 localStorage。 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ViewKey = "student" | "teacher" | "judge";

export interface ViewMeta {
  key: ViewKey;
  label: string;
  /** 一句话:这个视角进来先看什么 */
  intro: string;
  /** 首页提示:三条"看这里" */
  homeTips: [string, string, string];
  /** 各页副标题(结论导向文案) */
  resourcesDesc: string;
  evalDesc: string;
  pathDesc: string;
}

export const VIEW_META: Record<ViewKey, ViewMeta> = {
  student: {
    key: "student",
    label: "学生",
    intro: "把目标整理成行动",
    homeTips: [
      "先看今天最该处理的知识点",
      "资料、脑图和练习围绕同一个目标展开",
      "练习提交后,路线会随掌握度更新",
    ],
    resourcesDesc: "选一个知识点,获得一套带出处的讲义、脑图与练习。",
    evalDesc: "先看掌握度变化,再看错因和后续安排。",
    pathDesc: "学习顺序由掌握度和先修关系共同决定,点节点可看依据。",
  },
  teacher: {
    key: "teacher",
    label: "老师",
    intro: "把学情变化讲清楚",
    homeTips: [
      "画像展示掌握度、错因和变化",
      "掌握度来自真实答题记录",
      "每份资料都能展开来源",
    ],
    resourcesDesc: "每份资料都能回到引用证据:展开卡片查看 [^n] 脚注与教材来源。",
    evalDesc: "完成练习后,系统会自动更新掌握度和错因标签。",
    pathDesc: "掌握度驱动路径重排:先修达标解锁,薄弱点优先级自动上浮。",
  },
  judge: {
    key: "judge",
    label: "教研负责人",
    intro: "看成效,也看依据",
    homeTips: [
      "先看系统是否给出清晰行动",
      "资源正文脚注 [^n] 与底部来源对应",
      "练习结果会驱动掌握度和路线变化",
    ],
    resourcesDesc: "内容生成必须有出处:每份资料都能展开来源、引用和过程记录。",
    evalDesc: "看真实学习效果:正确率、掌握度升降、错因标签都来自真实提交。",
    pathDesc: "推荐不是固定目录:练习结果变化后,路线排序也会变化。",
  },
};

const ORDER: ViewKey[] = ["student", "teacher", "judge"];
const STORAGE_KEY = "sparklearn.view";

const ViewContext = createContext<{ view: ViewKey; setView: (v: ViewKey) => void }>({
  view: "student",
  setView: () => {},
});

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewKey>("student");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as ViewKey | null;
      if (saved && saved in VIEW_META) setViewState(saved);
    } catch {
      /* localStorage 不可用时保持默认 */
    }
  }, []);

  const setView = (v: ViewKey) => {
    setViewState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* 忽略持久化失败 */
    }
  };

  return <ViewContext.Provider value={{ view, setView }}>{children}</ViewContext.Provider>;
}

export function useView() {
  const { view, setView } = useContext(ViewContext);
  return { view, setView, meta: VIEW_META[view] };
}

/** 顶栏视角切换器:紧凑三段式,不做任何后端请求。 */
export function ViewSwitcher({ className = "" }: { className?: string }) {
  const { view, setView } = useView();
  return (
    <div
      role="radiogroup"
      aria-label="使用视角"
      className={`inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 ${className}`}
    >
      {ORDER.map((k) => {
        const active = view === k;
        return (
          <button
            key={k}
            role="radio"
            aria-checked={active}
            onClick={() => setView(k)}
            title={`${VIEW_META[k].label}视角:${VIEW_META[k].intro}`}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              active ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {VIEW_META[k].label}
          </button>
        );
      })}
    </div>
  );
}

