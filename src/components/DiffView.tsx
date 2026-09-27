import { diffWordsWithSpace } from "diff";

interface DiffViewProps {
  original: string;
  optimized: string;
}

export function DiffView({ original, optimized }: DiffViewProps) {
  const changes = diffWordsWithSpace(original, optimized);

  return (
    <div className="diff-shell">
      <div className="diff-legend" aria-hidden="true">
        <span className="added">＋ 新增</span>
        <span className="removed">− 删除</span>
      </div>
      <div className="diff-view" aria-label="优化差异">
        {changes.map((change, index) => {
          const className = change.added
            ? "diff-added"
            : change.removed
              ? "diff-removed"
              : "diff-same";
          return (
            <span className={className} key={`${index}-${change.value.slice(0, 8)}`}>
              {change.added && <span className="sr-only">新增：</span>}
              {change.removed && <span className="sr-only">删除：</span>}
              {change.value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
