"""RAG source-grounding acceptance for the data-structures course.

Run from backend:
    .venv\\Scripts\\python.exe tests\\acceptance_rag_grounding.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.rag.ingest import ingest_corpus  # noqa: E402
from app.rag.retriever import COURSE_SOURCE, retrieve  # noqa: E402

QUESTIONS = [
    ("binary_tree", "二叉树的定义是什么，每个节点最多有几个孩子？"),
    ("binary_tree", "满二叉树和完全二叉树有什么区别？"),
    ("binary_tree", "完全二叉树为什么适合用数组存储？"),
    ("binary_tree", "n 个节点的二叉树高度最小和最大分别是什么量级？"),
    ("binary_tree", "二叉树前序遍历的访问顺序是什么？"),
    ("binary_tree", "二叉树中序遍历的访问顺序是什么？"),
    ("binary_tree", "二叉树后序遍历的访问顺序是什么？"),
    ("binary_tree", "层序遍历为什么需要队列？"),
    ("binary_tree", "哪些遍历序列组合可以唯一重建二叉树？"),
    ("bst", "二叉搜索树 BST 的核心性质是什么？"),
    ("bst", "为什么 BST 的中序遍历得到递增序列？"),
    ("bst", "BST 查找的平均和最坏时间复杂度是多少？"),
    ("bst", "BST 插入时如何选择左子树或右子树？"),
    ("bst", "BST 删除节点分哪三种情况？"),
    ("bst", "为什么按有序序列插入会让 BST 退化？"),
    ("bst", "验证一棵树是 BST 时为什么不能只比较父子节点？"),
    ("recursion", "递归算法必须具备哪三个要素？"),
    ("recursion", "递归调用栈如何工作，空间复杂度由什么决定？"),
    ("complexity", "遍历一棵有 n 个节点的二叉树时间复杂度是多少？"),
    ("complexity", "递归遍历二叉树的辅助空间与树高有什么关系？"),
    ("heap", "堆为什么既是完全二叉树又适合用数组存储？"),
    ("heap", "堆和二叉搜索树的有序性质有什么区别？"),
    ("heap", "数组表示的堆中父节点和孩子下标如何计算？"),
    ("array", "数组的随机访问复杂度是什么，它与树的顺序存储有什么联系？"),
]


def main() -> None:
    total_chunks = ingest_corpus()
    rows = []
    failures = []
    for index, (kp, question) in enumerate(QUESTIONS, start=1):
        hits = retrieve(question, top_k=20, final_k=5, kp=kp)
        accepted = bool(hits) and all(hit.get("source") == COURSE_SOURCE for hit in hits)
        item = {
            "index": index,
            "kp": kp,
            "question": question,
            "accepted": accepted,
            "hits": [
                {
                    "rank": rank,
                    "source": hit.get("source", ""),
                    "source_id": hit.get("source_id", ""),
                    "chapter": hit.get("chapter", ""),
                    "page": hit.get("page", 0),
                    "kp": hit.get("kp", ""),
                    "citation": hit.get("citation", ""),
                    "score": round(float(hit.get("score", 0)), 4),
                    "preview": str(hit.get("text", ""))[:160],
                }
                for rank, hit in enumerate(hits, start=1)
            ],
        }
        rows.append(item)
        if not accepted:
            failures.append(item)
        print(
            f"[{index:02d}] {'PASS' if accepted else 'FAIL'} "
            f"kp={kp} hits={len(hits)} sources="
            f"{sorted({str(hit.get('source', '')) for hit in hits})}"
        )

    report = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "course_source": COURSE_SOURCE,
        "index_chunks": total_chunks,
        "question_count": len(QUESTIONS),
        "passed": len(QUESTIONS) - len(failures),
        "failed": len(failures),
        "items": rows,
    }
    out_dir = BACKEND_DIR / "runs" / "rag-governance-20260625"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "retrieval_acceptance.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={out_path}")
    if failures:
        raise SystemExit(f"RAG acceptance failed: {len(failures)} questions")
    print(f"RAG acceptance passed: {len(QUESTIONS)}/{len(QUESTIONS)}")


if __name__ == "__main__":
    main()
