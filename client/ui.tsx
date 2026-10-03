import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import {
  kinds,
  regions,
  statuses,
  reportStatuses,
  type Event,
  type Report,
} from "./types";
import { time } from "./time";
export function Field({
  label,
  name,
  error,
  children,
  hint,
}: {
  label: string;
  name: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </div>
  );
}
export function Pagination({
  data,
  onPage,
}: {
  data: { page: number; pageSize: number; total: number };
  onPage: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="pagination">
      <span>
        共 {data.total} 条 · 第 {data.page} / {pages} 页
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={data.page >= pages}
          onClick={() => onPage(data.page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Compass size={36} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function EventCard({ item }: { item: Event }) {
  return (
    <article className="event-card">
      <div className="card-top">
        <span className={`tag ${item.kind}`}>{kinds[item.kind]}</span>
        <span className={`status ${item.status}`}>
          <i />
          {statuses[item.status]}
        </span>
      </div>
      <h3>{item.pokemon}</h3>
      <div className="place">
        <MapPin size={16} />
        <span>
          {regions[item.region]} · {item.location}
        </span>
      </div>
      {item.note && <p className="note">{item.note}</p>}
      {item.correctionReason && (
        <p className="correction">纠错说明：{item.correctionReason}</p>
      )}
      <div className="card-times">
        <span>
          观察时间<strong>{time(item.observedAt)}</strong>
        </span>
        <span>
          最后确认<strong>{time(item.lastConfirmedAt)}</strong>
        </span>
        <span>
          展示截止<strong>{time(item.expiresAt)}</strong>
        </span>
      </div>
      <div className="card-bottom">
        <span>
          <ShieldCheck size={14} />
          平台已审核
        </span>
        <span>
          {item.source === "player"
            ? "本站玩家"
            : item.source === "demo"
              ? "示例"
              : "外部来源"}
        </span>
      </div>
      <div className="contributors">
        贡献者：
        {item.contributors.map((c) => c.nickname).join("、") || "外部来源"}
        {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            查看来源 ↗
          </a>
        )}
      </div>
    </article>
  );
}

export function ReportCard({
  item,
  actions,
}: {
  item: Report;
  actions?: ReactNode;
}) {
  return (
    <article className="report-card">
      <div>
        <div className="card-top">
          <span className={`tag ${item.kind}`}>{kinds[item.kind]}</span>
          <span className={`status ${item.status}`}>
            <i />
            {reportStatuses[item.status]}
          </span>
        </div>
        <h3>{item.pokemon}</h3>
        <div className="place">
          <MapPin size={15} />
          <span>
            {regions[item.region]} · <span>{item.location}</span>
          </span>
        </div>
        {item.note && <p className="note">{item.note}</p>}
        <p className="report-meta">
          观察 {time(item.observedAt)} · 上报 {time(item.createdAt)} ·{" "}
          {item.reporter.nickname} ·{" "}
          {item.source === "player"
            ? "本站玩家"
            : item.source === "demo"
              ? "示例"
              : "外部来源"}
        </p>
        {item.reason && <p className="correction">驳回原因：{item.reason}</p>}
      </div>
      {actions}
    </article>
  );
}
