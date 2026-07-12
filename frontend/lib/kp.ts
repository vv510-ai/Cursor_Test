/** 课程知识点 id → 中文名(与 backend/app/data/knowledge_graph.json 对齐)。
 *  全站唯一来源:画像、资料、路线共用,避免各处散装映射。 */
export const KPS: [string, string][] = [
  ["complexity", "复杂度"],
  ["array", "数组"],
  ["linked_list", "链表"],
  ["stack", "栈"],
  ["queue", "队列"],
  ["recursion", "递归"],
  ["sorting_basic", "基础排序"],
  ["sorting_adv", "高级排序"],
  ["binary_tree", "二叉树"],
  ["bst", "BST"],
  ["heap", "堆"],
  ["hash", "哈希"],
  ["graph_basic", "图基础"],
  ["graph_traverse", "图遍历"],
  ["shortest_path", "最短路"],
  ["dp", "动态规划"],
];

export const KP_NAME: Record<string, string> = Object.fromEntries(KPS);

export function kpName(id: string): string {
  return KP_NAME[id] || id;
}

export function isKnownKp(id: string): boolean {
  return id in KP_NAME;
}
