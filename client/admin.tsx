import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
} from "react";
import { RefreshCw, Users, X } from "lucide-react";
import { ApiError, request } from "./api";
import {
  kinds,
  regions,
  statuses,
  type Event,
  type Report,
  type User,
  type List,
} from "./types";
import { Field, Pagination, Empty, EventCard, ReportCard } from "./ui";
import { localInput, utc } from "./time";
const emptyList = <T,>(): List<T> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
});
export function AdminPanel({
  onError,
  onSuccess,
  currentUser,
}: {
  onError: (e: unknown) => void;
  onSuccess: (s: string) => void;
  currentUser: User;
}) {
  const [tab, setTab] = useState<"reports" | "events" | "users">("reports");
  const [data, setData] = useState<List<Report | Event | User>>(emptyList);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Event | null>(null);
  const [mutationError, setMutationError] = useState<ApiError | null>(null);
  const [mutationTarget, setMutationTarget] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const result = await request<List<Report | Event | User>>(
        `/admin/${tab}?page=${page}&pageSize=20${tab === "users" ? `&q=${encodeURIComponent(appliedQuery)}` : ""}`,
      );
      if (id === generation.current) setData(result);
    } catch (e) {
      if (id === generation.current) onError(e);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [tab, page, appliedQuery, onError]);
  const currentLoad = useRef(load);
  currentLoad.current = load;
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const mutate = async (
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setMutationError(null);
    setMutationTarget(path);
    try {
      await request(path, { method, body });
      onSuccess(message);
      setEditing(null);
      await currentLoad.current();
    } catch (e) {
      setMutationError(
        e instanceof ApiError ? e : new ApiError("保存失败，请重试。", 0),
      );
      onError(e);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <div className="panel-toolbar">
        <div className="kind-tabs">
          {[
            ["reports", "待审队列"],
            ["events", "情报管理"],
            ["users", "账号管理"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              disabled={busy}
              onClick={() => {
                if (mutationInFlight.current || id === tab) return;
                generation.current++;
                setData(emptyList());
                setTab(id as typeof tab);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="button secondary"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <RefreshCw size={16} />
          刷新队列
        </button>
      </div>
      {tab === "users" && (
        <form
          className="admin-search"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQuery(userQuery);
            setPage(1);
          }}
        >
          <input
            aria-label="搜索账号"
            placeholder="搜索昵称或邮箱"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />
          <button className="button primary">查找账号</button>
        </form>
      )}
      <div className="report-list" aria-busy={loading}>
        {data.items.map((item) =>
          tab === "reports" ? (
            <ReviewCard
              key={item.id}
              item={item as Report}
              busy={busy}
              error={
                mutationTarget === `/admin/reports/${item.id}/review`
                  ? mutationError
                  : null
              }
              onReview={(action, reason, expiresAt) =>
                void mutate(
                  `/admin/reports/${item.id}/review`,
                  "POST",
                  {
                    action,
                    ...(reason ? { reason } : {}),
                    ...(expiresAt ? { expiresAt: utc(expiresAt) } : {}),
                  },
                  action === "approve"
                    ? "审核通过，情报已公开。"
                    : "报告已驳回。",
                )
              }
            />
          ) : tab === "events" ? (
            <div className="admin-event" key={item.id}>
              <EventCard item={item as Event} />
              <div className="admin-event-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setMutationError(null);
                    setEditing(item as Event);
                  }}
                >
                  编辑情报
                </button>
                <button
                  className="button secondary"
                  disabled={busy || (item as Event).status !== "active"}
                  onClick={() =>
                    void mutate(
                      `/admin/events/${item.id}`,
                      "PATCH",
                      { status: "ended" },
                      "情报已标记结束。",
                    )
                  }
                >
                  标记结束
                </button>
              </div>
            </div>
          ) : (
            <div className="user-card" key={item.id}>
              <span className="avatar">
                <Users size={18} />
              </span>
              <div>
                <strong>{(item as User).nickname}</strong>
                <span>{(item as User).email}</span>
                <small>
                  {(item as User).role === "admin" ? "管理员" : "普通用户"} ·{" "}
                  {(item as User).disabled ? "已停用" : "正常"}
                </small>
              </div>
              <button
                className={`button ${(item as User).disabled ? "secondary" : "danger"}`}
                disabled={busy || item.id === currentUser.id}
                onClick={() =>
                  void mutate(
                    `/admin/users/${item.id}`,
                    "PATCH",
                    { disabled: !(item as User).disabled },
                    (item as User).disabled
                      ? "账号已恢复。"
                      : "账号已停用，会话已撤销。",
                  )
                }
              >
                {(item as User).disabled
                  ? "恢复账号"
                  : item.id === currentUser.id
                    ? "当前账号"
                    : "停用账号"}
              </button>
            </div>
          ),
        )}
        {!data.items.length && (
          <Empty
            title={
              loading
                ? "正在加载…"
                : tab === "reports"
                  ? "没有待审报告"
                  : "暂无记录"
            }
            description={
              tab === "reports"
                ? "新的玩家上报会出现在这里。"
                : "尝试刷新或调整搜索条件。"
            }
          />
        )}
      </div>
      <Pagination data={data} onPage={setPage} />
      {editing && (
        <EditEvent
          item={editing}
          busy={busy}
          error={mutationError}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            void mutate(
              `/admin/events/${editing.id}`,
              "PATCH",
              body,
              "情报已更新。",
            )
          }
        />
      )}
    </>
  );
}
function ReviewCard({
  item,
  busy,
  error,
  onReview,
}: {
  item: Report;
  busy: boolean;
  error: ApiError | null;
  onReview: (
    action: "approve" | "reject",
    reason: string,
    expiresAt: string,
  ) => void;
}) {
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(
    localInput(
      new Date(new Date(item.observedAt).getTime() + 3600_000).toISOString(),
    ),
  );
  return (
    <ReportCard
      item={item}
      actions={
        <div className="review-controls">
          {error && (
            <div className="alert" role="alert">
              {error.message}
            </div>
          )}
          <Field
            label={`有效截止（北京时间） #${item.id}`}
            name={`expiry-${item.id}`}
            error={error?.fields.expiresAt}
            hint="默认观察时间后 60 分钟，为本站展示规则。"
          >
            <input
              id={`expiry-${item.id}`}
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              required
            />
          </Field>
          <Field
            label={`驳回理由 #${item.id}`}
            name={`reason-${item.id}`}
            error={error?.fields.reason}
          >
            <input
              id={`reason-${item.id}`}
              placeholder="驳回时必填"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="review-buttons">
            <button
              className="button danger"
              disabled={busy || !reason.trim()}
              onClick={() => onReview("reject", reason, "")}
            >
              驳回
            </button>
            <button
              className="button primary"
              disabled={busy || !expires}
              onClick={() => onReview("approve", "", expires)}
            >
              通过审核
            </button>
          </div>
        </div>
      }
    />
  );
}
function EditEvent({
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: Event;
  busy: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSave: (body: unknown) => void;
}) {
  const [status, setStatus] = useState(item.status);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form);
    if (!body.correctionReason) delete body.correctionReason;
    onSave({ ...body, expiresAt: utc(String(form.get("expiresAt"))) });
  };
  return (
    <div className="modal-backdrop">
      <section
        className="auth-dialog edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭编辑窗口"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2 id="edit-title">编辑情报</h2>
        <form onSubmit={submit}>
          {error && (
            <div className="alert" role="alert">
              {error.message}
            </div>
          )}
          <div className="form-row">
            <Field name="edit-kind" error={error?.fields.kind} label="类型">
              <select id="edit-kind" name="kind" defaultValue={item.kind}>
                {Object.entries(kinds).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="edit-region" error={error?.fields.region} label="地区">
              <select id="edit-region" name="region" defaultValue={item.region}>
                {Object.entries(regions).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            name="edit-pokemon"
            error={error?.fields.pokemon}
            label="宝可梦名称"
          >
            <input
              id="edit-pokemon"
              name="pokemon"
              defaultValue={item.pokemon}
              required
              maxLength={50}
            />
          </Field>
          <Field
            name="edit-location"
            error={error?.fields.location}
            label="地点"
          >
            <input
              id="edit-location"
              name="location"
              defaultValue={item.location}
              required
              maxLength={100}
            />
          </Field>
          <Field
            name="edit-expiry"
            error={error?.fields.expiresAt}
            label="展示截止（北京时间）"
          >
            <input
              id="edit-expiry"
              name="expiresAt"
              type="datetime-local"
              defaultValue={localInput(item.expiresAt)}
              required
            />
          </Field>
          <div className="form-row">
            <Field name="edit-status" error={error?.fields.status} label="状态">
              <select
                id="edit-status"
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Event["status"])}
              >
                {Object.entries(statuses).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              name="edit-reason"
              error={error?.fields.correctionReason}
              label="纠错说明"
            >
              <input
                id="edit-reason"
                name="correctionReason"
                defaultValue={item.correctionReason ?? ""}
                required={status === "corrected"}
                maxLength={500}
              />
            </Field>
          </div>
          <Field name="edit-note" error={error?.fields.note} label="补充说明">
            <textarea
              id="edit-note"
              name="note"
              defaultValue={item.note}
              rows={3}
              maxLength={1000}
            />
          </Field>
          <button type="submit" className="button primary full" disabled={busy}>
            {busy ? "正在保存…" : "保存修改"}
          </button>
        </form>
      </section>
    </div>
  );
}
