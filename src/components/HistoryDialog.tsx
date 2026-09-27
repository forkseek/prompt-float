import { useEffect, useMemo, useState } from "react";
import type { PromptHistoryRecord } from "../../shared/types";
import { useModalFocus } from "../hooks/useModalFocus";
import { DiffView } from "./DiffView";
import { AlertIcon, CloseIcon, CopyIcon, HistoryIcon } from "./Icons";

interface HistoryDialogProps {
  initialRecordId?: string;
  onClose: () => void;
}

const MODE_LABELS = {
  user: "用户提示词",
  system: "系统提示词",
  iterate: "迭代优化",
} as const;
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function summary(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function HistoryDialog({ initialRecordId, onClose }: HistoryDialogProps) {
  const dialogRef = useModalFocus<HTMLElement>(onClose, 'input[type="search"]');
  const [records, setRecords] = useState<PromptHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRecordId || null,
  );
  const [detailView, setDetailView] = useState<"comparison" | "diff">(
    "comparison",
  );
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.promptFloat
      .listHistory()
      .then((items) => {
        if (cancelled) return;
        setRecords(items);
        setError("");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("无法读取历史记录。原有数据未被清空，请检查本机存储。");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [retryCount]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [
        record.originalPrompt,
        record.optimizedPrompt,
        record.requirements || "",
        record.routeName,
        record.model,
        dateFormatter.format(record.optimizedAt),
      ].some((field) => field.toLocaleLowerCase().includes(needle)),
    );
  }, [query, records]);
  const selected =
    filtered.find((record) => record.id === selectedId) || filtered[0];

  const copyOptimized = async () => {
    if (!selected) return;
    try {
      await window.promptFloat.writeClipboard(selected.optimizedPrompt);
      setCopyStatus("已复制优化结果");
    } catch {
      setCopyStatus("复制失败，请重试");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="history-dialog-title"
        aria-modal="true"
        className="settings-dialog history-dialog"
        ref={dialogRef}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">LOCAL HISTORY</p>
            <h2 id="history-dialog-title">历史记录</h2>
            <p className="dialog-description">
              仅保存在这台电脑，按时间倒序保留最近 50 次成功优化。
            </p>
          </div>
          <button
            aria-label="关闭历史记录"
            className="icon-button"
            data-jelly
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="history-body">
          <aside className="history-sidebar">
            <label className="field-label history-search">
              <span>查找历史记录</span>
              <input
                type="search"
                maxLength={200}
                placeholder="搜索原文、结果、路由或时间"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <p aria-live="polite" className="history-count">
              {loading ? "正在读取…" : `找到 ${filtered.length} 条 · 最多 50 条`}
            </p>
            <div aria-label="历史记录列表" className="history-list">
              {loading && <p className="history-empty">正在加载历史记录…</p>}
              {!loading && error && (
                <div className="history-empty">
                  <p className="inline-error" role="alert">
                    <AlertIcon />{error}
                  </p>
                  <button
                    className="secondary-button"
                    data-jelly
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setRetryCount((current) => current + 1);
                    }}
                  >
                    重试
                  </button>
                </div>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="history-empty">
                  {records.length === 0
                    ? "还没有历史记录。完成一次提示词优化后会自动保存。"
                    : "没有匹配的记录，请尝试其他关键词。"}
                </p>
              )}
              {!loading && !error && filtered.map((record) => (
                <button
                  aria-pressed={selected?.id === record.id}
                  className={selected?.id === record.id ? "history-item is-selected" : "history-item"}
                  data-jelly
                  key={record.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(record.id);
                    setDetailView("comparison");
                    setCopyStatus("");
                  }}
                >
                  <span className="history-item-time">
                    {dateFormatter.format(record.optimizedAt)}
                  </span>
                  <strong>{summary(record.originalPrompt)}</strong>
                  <small>{record.routeName} · {MODE_LABELS[record.mode]}</small>
                </button>
              ))}
            </div>
          </aside>

          <div className="history-detail">
            {selected && !loading && !error ? (
              <>
                <div className="history-detail-heading">
                  <div>
                    <h3>优化详情</h3>
                    <p>
                      <time dateTime={new Date(selected.optimizedAt).toISOString()}>
                        {dateFormatter.format(selected.optimizedAt)}
                      </time>
                      {" · "}{selected.routeName} / {selected.model}
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    data-jelly
                    type="button"
                    onClick={() => void copyOptimized()}
                  >
                    <CopyIcon />复制结果
                  </button>
                </div>
                <div aria-label="历史详情视图" className="view-switch history-view-switch">
                  <button
                    aria-pressed={detailView === "comparison"}
                    className={detailView === "comparison" ? "active" : ""}
                    data-jelly
                    type="button"
                    onClick={() => setDetailView("comparison")}
                  >
                    原文 / 结果
                  </button>
                  <button
                    aria-pressed={detailView === "diff"}
                    className={detailView === "diff" ? "active" : ""}
                    data-jelly
                    type="button"
                    onClick={() => setDetailView("diff")}
                  >
                    差异
                  </button>
                </div>
                {copyStatus && <p className="history-copy-status" role="status">{copyStatus}</p>}
                {detailView === "comparison" ? (
                  <div className="history-detail-scroll">
                    {selected.requirements && (
                      <div className="history-requirements">
                        <strong>本轮改进要求</strong>
                        <p>{selected.requirements}</p>
                      </div>
                    )}
                    <div className="history-comparison">
                      <section>
                        <h4>原始提示词</h4>
                        <pre>{selected.originalPrompt}</pre>
                      </section>
                      <section>
                        <h4>优化后提示词</h4>
                        <pre>{selected.optimizedPrompt}</pre>
                      </section>
                    </div>
                  </div>
                ) : (
                  <DiffView
                    original={selected.originalPrompt}
                    optimized={selected.optimizedPrompt}
                  />
                )}
              </>
            ) : (
              <div className="history-detail-empty">
                <HistoryIcon />
                <span>选择一条记录，查看完整优化内容与差异</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
