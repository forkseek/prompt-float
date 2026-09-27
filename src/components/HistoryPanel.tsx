import { useEffect, useMemo, useState } from "react";
import type { PromptHistoryRecord } from "../../shared/types";
import { AlertIcon, ArrowUpRightIcon, HistoryIcon } from "./Icons";

interface HistoryPanelProps {
  onOpenRecord: (recordId: string) => void;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function HistoryPanel({ onOpenRecord }: HistoryPanelProps) {
  const [records, setRecords] = useState<PromptHistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.promptFloat.listHistory().then((items) => {
      if (cancelled) return;
      setRecords(items);
      setError(false);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError(true);
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
      ].some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [query, records]);

  return (
    <section
      aria-label="操作面板历史记录"
      className="history-panel"
      role="region"
    >
      <div className="history-panel-toolbar">
        <label className="field-label history-panel-search">
          <span>查找历史记录</span>
          <input
            maxLength={200}
            placeholder="搜索原文、结果、路由或时间"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span aria-live="polite" className="history-panel-count">
          {loading ? "读取中…" : `${filtered.length} / 50`}
        </span>
      </div>
      <div className="history-panel-list">
        {loading && <p className="history-panel-message">正在读取本机历史记录…</p>}
        {!loading && error && (
          <div className="history-panel-message">
            <p className="inline-error" role="alert">
              <AlertIcon />
              历史记录读取失败，原有数据未被清空。
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
          <div className="history-panel-message">
            <HistoryIcon />
            <span>
              {records.length === 0
                ? "还没有历史记录。完成一次优化后会自动保存。"
                : "没有匹配的记录，请换个关键词。"}
            </span>
          </div>
        )}
        {!loading && !error && filtered.map((record) => (
          <button
            className="history-panel-item"
            data-jelly
            key={record.id}
            type="button"
            onClick={() => onOpenRecord(record.id)}
          >
            <span className="history-panel-item-main">
              <strong>{record.originalPrompt.replace(/\s+/g, " ").trim()}</strong>
              <small>{record.routeName} · {record.model}</small>
            </span>
            <span className="history-panel-item-meta">
              <time dateTime={new Date(record.optimizedAt).toISOString()}>
                {dateFormatter.format(record.optimizedAt)}
              </time>
              <ArrowUpRightIcon />
            </span>
          </button>
        ))}
      </div>
      <p className="history-panel-note">
        仅保存在本机 · 点开查看详情；底部复制/应用仍针对当前优化结果
      </p>
    </section>
  );
}
