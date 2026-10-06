import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  Archive,
  BookOpen,
  ArrowRight,
  Clock,
  FileText,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { ApiError, request, setCsrfToken } from "./api";
import {
  regions,
  statuses,
  reportStatuses,
  type Event,
  type Report,
  type Session,
  type List,
} from "./types";
import { Pagination, Empty, EventCard, ReportCard } from "./ui";
import { AuthDialog, LoginPrompt } from "./auth";
import { ReportForm } from "./reports";
import { AdminPanel } from "./admin";
import { Catalog } from "./catalog";
import { time } from "./time";
type View = "live" | "history" | "catalog" | "report" | "mine" | "admin";
type Filters = {
  q: string;
  kind: string;
  region: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};
const emptyList = <T,>(): List<T> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
});
function filtersFromUrl(): Filters {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get("q") ?? "",
    kind: p.get("kind") ?? "",
    region: p.get("region") ?? "",
    status: p.get("status") ?? "",
    dateFrom: p.get("from") ?? "",
    dateTo: p.get("to") ?? "",
  };
}
function query(filters: Filters, page: number, history = false) {
  const p = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (history) p.set("view", "history");
  Object.entries(filters).forEach(([key, value]) => {
    if (value && (history || !["status", "dateFrom", "dateTo"].includes(key)))
      p.set(key, value);
  });
  return p.toString();
}
export default function App() {
  const [view, setView] = useState<View>(() => {
    const initial = new URLSearchParams(location.search).get("view");
    return initial === "history" || initial === "catalog" ? initial : "live";
  });
  const [session, setSession] = useState<Session>({
    user: null,
    csrfToken: "",
  });
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [filters, setFilters] = useState<Filters>(filtersFromUrl);
  const [applied, setApplied] = useState(filtersFromUrl);
  const [page, setPage] = useState(() =>
    Math.max(1, Number(new URLSearchParams(location.search).get("page")) || 1),
  );
  const [events, setEvents] = useState<List<Event>>(emptyList);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [external, setExternal] = useState(false);
  const [toast, setToast] = useState("");
  const [mine, setMine] = useState<List<Report>>(emptyList);
  const [minePage, setMinePage] = useState(1);
  const [mineStatus, setMineStatus] = useState("");
  const [mineLoading, setMineLoading] = useState(false);
  const sequence = useRef(0);
  const mineGeneration = useRef(0);
  const user = session.user;
  const userId = useRef<number | null>(null);
  userId.current = user?.id ?? null;
  const acceptSession = (s: Session) => {
    mineGeneration.current++;
    setMine(emptyList());
    setMinePage(1);
    setMineStatus("");
    setCsrfToken(s.csrfToken);
    setSession(s);
  };
  const handleError = useCallback((e: unknown) => {
    const err = e instanceof Error ? e.message : "请求失败，请重试。";
    setError(err);
    if (e instanceof ApiError && e.status === 401) {
      mineGeneration.current++;
      setMine(emptyList());
      setCsrfToken("");
      setSession({ user: null, csrfToken: "" });
      setAuthMode("login");
    }
    return err;
  }, []);
  useEffect(() => {
    request<Session>("/auth/me")
      .then((s) => {
        setSession(s);
        setCsrfToken(s.csrfToken);
      })
      .catch(handleError)
      .finally(() => setAuthReady(true));
    request<{ externalSourcesEnabled: boolean }>("/status")
      .then((s) => setExternal(s.externalSourcesEnabled))
      .catch(() => {});
  }, [handleError]);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true);
    try {
      const result = await request<List<Event>>(
        `/events?${query(applied, page, view === "history")}`,
      );
      if (id === sequence.current) {
        setEvents(result);
        setUpdated(new Date().toISOString());
        setError("");
      }
    } catch (e) {
      if (id === sequence.current) handleError(e);
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, [applied, page, view, handleError]);
  useEffect(() => {
    if (view !== "live" && view !== "history") return;
    void refresh();
    const interval = setInterval(() => void refresh(), 60000);
    return () => {
      clearInterval(interval);
      sequence.current++;
    };
  }, [view, refresh]);
  const loadMine = useCallback(async () => {
    const accountId = user?.id;
    if (!accountId) return;
    const id = ++mineGeneration.current;
    setMineLoading(true);
    try {
      const p = new URLSearchParams({ page: String(minePage), pageSize: "20" });
      if (mineStatus) p.set("status", mineStatus);
      const result = await request<List<Report>>(`/reports/mine?${p}`);
      if (id === mineGeneration.current && userId.current === accountId) {
        setMine(result);
        setError("");
      }
    } catch (e) {
      if (id === mineGeneration.current && userId.current === accountId)
        handleError(e);
    } finally {
      if (id === mineGeneration.current && userId.current === accountId)
        setMineLoading(false);
    }
  }, [minePage, mineStatus, handleError, user?.id]);
  useEffect(() => {
    if (view === "mine" && user) void loadMine();
  }, [view, user, loadMine]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  const navigate = (next: View) => {
    setView(next);
    setError("");
    setPage(1);
    const p = new URLSearchParams();
    if (next === "history" || next === "catalog") p.set("view", next);
    history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
    if (next === "live") {
      setFilters({
        q: "",
        kind: "",
        region: "",
        status: "",
        dateFrom: "",
        dateTo: "",
      });
      setApplied({
        q: "",
        kind: "",
        region: "",
        status: "",
        dateFrom: "",
        dateTo: "",
      });
    }
  };
  const applyFilters = (values = filters, nextPage = 1) => {
    setApplied(values);
    setPage(nextPage);
    const p = new URLSearchParams();
    if (view === "history") p.set("view", "history");
    Object.entries(values).forEach(([key, value]) => {
      if (value)
        p.set(
          key === "dateFrom" ? "from" : key === "dateTo" ? "to" : key,
          value,
        );
    });
    if (nextPage > 1) p.set("page", String(nextPage));
    history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
  };
  const navs: { view: View; label: string; icon: typeof Activity }[] = [
    { view: "live", label: "实时情报", icon: Radio },
    { view: "history", label: "历史查询", icon: Archive },
    { view: "catalog", label: "刷新资料库", icon: BookOpen },
    { view: "report", label: "玩家上报", icon: Plus },
    { view: "mine", label: "我的上报", icon: FileText },
    ...(user?.role === "admin"
      ? [{ view: "admin" as View, label: "管理后台", icon: ShieldCheck }]
      : []),
  ];
  const logout = async () => {
    try {
      await request("/auth/logout", { method: "POST" });
      acceptSession({ user: null, csrfToken: "" });
      setToast("已退出登录。");
      navigate("live");
    } catch (e) {
      handleError(e);
    }
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Poke 情报站首页">
          <span className="brand-icon">
            <span />
          </span>
          <div>
            Poke 情报站<small>POKÉMMO INTELLIGENCE</small>
          </div>
        </a>
        <div className="nav-label">探索情报</div>
        <nav aria-label="主导航">
          {navs.map((n) => (
            <button
              key={n.view}
              className={`nav-item ${view === n.view ? "selected" : ""}`}
              onClick={() => navigate(n.view)}
              aria-current={view === n.view ? "page" : undefined}
            >
              <n.icon size={19} />
              {n.label}
              {n.view === "live" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">由玩家共同发现</span>
          <p>
            每一份可靠情报，
            <br />
            都来自训练家的分享。
          </p>
          <span className="sidebar-pokeball" />
        </div>
        <div className="sidebar-footer">
          PokeMMO 玩家社区工具
          <br />
          <span>独立社区项目 · 非官方站点</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            情报中心 <span>/</span> {navs.find((n) => n.view === view)?.label}
          </div>
          <div className="top-actions">
            <span className="timezone">
              <Clock size={14} />
              北京时间
            </span>
            {user ? (
              <>
                <span className="user-name">
                  <span className="avatar">{user.nickname.slice(0, 1)}</span>
                  {user.nickname}
                </span>
                <button
                  className="icon-button logout"
                  aria-label="退出登录"
                  title="退出登录"
                  onClick={() => void logout()}
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button
                className="button primary compact"
                disabled={!authReady}
                onClick={() => setAuthMode("login")}
              >
                登录 / 注册
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "live"
                  ? "KEEP EXPLORING"
                  : view === "history"
                    ? "EXPLORE THE ARCHIVE"
                    : view === "catalog"
                      ? "ALPHAPEDIA REFERENCE"
                    : view === "report"
                      ? "SHARE YOUR DISCOVERY"
                      : view === "mine"
                        ? "YOUR CONTRIBUTIONS"
                        : "COMMUNITY MANAGEMENT"}
              </div>
              <h1>{navs.find((n) => n.view === view)?.label}</h1>
              <p>
                {view === "live"
                  ? "掌握最新动态，让每一次冒险都有方向。"
                  : view === "history"
                    ? "回看玩家的发现，查询已审核的情报记录。"
                    : view === "catalog"
                      ? "查询头目与群聚的可能刷新地点，规划探索路线。"
                    : view === "report"
                      ? "分享你在游戏中的发现，帮助更多训练家。"
                      : view === "mine"
                        ? "跟踪你的上报进度，查看审核结果。"
                        : "审核玩家报告，维护公开情报与账号。"}
              </p>
            </div>
            {(view === "live" || view === "history") && (
              <button
                className="button secondary"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? "spinning" : ""} />
                刷新情报
              </button>
            )}
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button aria-label="关闭错误提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}
          {(view === "live" || view === "history") && (
            <>
              <div className="overview">
                <div className="overview-intro">
                  <div className="signal">
                    <Activity size={19} />
                  </div>
                  <div>
                    <strong>
                      {view === "live"
                        ? "正在关注，随时出发"
                        : "每一次发现，都有迹可循"}
                    </strong>
                    <p>
                      {view === "live"
                        ? "本站玩家上报，经平台审核后展示"
                        : "保留有效、已结束与已纠错的公开记录"}
                    </p>
                  </div>
                </div>
                <div className="overview-status">
                  <span className="subtle-badge">
                    <i />
                    {external ? "外部来源已配置" : "外部情报尚未接入"}
                  </span>
                  <span>
                    {updated
                      ? `最近成功更新 ${time(updated)}`
                      : "正在连接情报站…"}
                    <span className="refresh-note"> · 每 60 秒检查</span>
                  </span>
                </div>
              </div>
              <section className="filters" aria-label="情报筛选">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyFilters();
                  }}
                >
                  <div className="filter-main">
                    <div className="search-box">
                      <Search size={18} />
                      <input
                        aria-label="搜索宝可梦或地点"
                        placeholder="搜索宝可梦、地点…"
                        value={filters.q}
                        onChange={(e) =>
                          setFilters({ ...filters, q: e.target.value })
                        }
                        maxLength={100}
                      />
                    </div>
                    <select
                      aria-label="地区筛选"
                      value={filters.region}
                      onChange={(e) => {
                        const f = { ...filters, region: e.target.value };
                        setFilters(f);
                        if (view === "live") applyFilters(f);
                      }}
                    >
                      <option value="">全部地区</option>
                      {Object.entries(regions).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {view === "history" && (
                      <select
                        aria-label="情报状态"
                        value={filters.status}
                        onChange={(e) =>
                          setFilters({ ...filters, status: e.target.value })
                        }
                      >
                        <option value="">全部状态</option>
                        {Object.entries(statuses).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    <button className="button primary" type="submit">
                      {view === "history" ? "查询历史" : "搜索"}
                    </button>
                  </div>
                  <div className="filter-bottom">
                    <div className="kind-tabs" aria-label="类型筛选">
                      {[
                        ["", "全部情报"],
                        ["boss", "头目"],
                        ["swarm", "群聚"],
                        ["pheno", "奇遇"],
                      ].map(([id, label]) => (
                        <button
                          type="button"
                          className={filters.kind === id ? "active" : ""}
                          key={id}
                          onClick={() => {
                            const f = { ...filters, kind: id };
                            setFilters(f);
                            applyFilters(f);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {view === "history" ? (
                      <div className="date-range">
                        <label htmlFor="date-from">开始日期</label>
                        <input
                          id="date-from"
                          type="date"
                          value={filters.dateFrom}
                          onChange={(e) =>
                            setFilters({ ...filters, dateFrom: e.target.value })
                          }
                        />
                        <span>至</span>
                        <label className="sr-only" htmlFor="date-to">
                          结束日期
                        </label>
                        <input
                          id="date-to"
                          type="date"
                          min={filters.dateFrom || undefined}
                          value={filters.dateTo}
                          onChange={(e) =>
                            setFilters({ ...filters, dateTo: e.target.value })
                          }
                        />
                      </div>
                    ) : (
                      <span className="filter-help">
                        <ShieldCheck size={14} />
                        仅展示已审核且有效的情报
                      </span>
                    )}
                  </div>
                </form>
              </section>
              <div className="section-label">
                <h2>
                  {view === "live" ? "最新发现" : "查询结果"}{" "}
                  <span>{events.total}</span>
                </h2>
                <span>{loading ? "正在更新…" : "按观察时间排序"}</span>
              </div>
              <section className="event-grid" aria-busy={loading}>
                {loading && !updated ? (
                  <div className="loading-state" role="status">
                    <RefreshCw size={22} className="spinning" />
                    正在获取情报…
                  </div>
                ) : events.items.length ? (
                  events.items.map((item) => (
                    <EventCard key={item.id} item={item} />
                  ))
                ) : (
                  <Empty
                    title={view === "live" ? "暂无有效情报" : "未找到相关历史"}
                    description={
                      view === "live"
                        ? "新的发现正在路上。你可以成为第一个分享情报的训练家。"
                        : "试试其他宝可梦、地区或日期范围。"
                    }
                    action={
                      view === "live" ? (
                        <button
                          className="button primary"
                          onClick={() => navigate("report")}
                        >
                          <Plus size={16} />
                          分享我的发现
                          <ArrowRight size={15} />
                        </button>
                      ) : (
                        <button
                          className="button secondary"
                          onClick={() => {
                            const f = {
                              q: "",
                              kind: "",
                              region: "",
                              status: "",
                              dateFrom: "",
                              dateTo: "",
                            };
                            setFilters(f);
                            applyFilters(f);
                          }}
                        >
                          清除筛选
                        </button>
                      )
                    }
                  />
                )}
              </section>
              <Pagination
                data={events}
                onPage={(n) => applyFilters(applied, n)}
              />
              <div className="disclaimer">
                <ShieldCheck size={15} />
                <p>
                  “已审核”表示通过平台审核。情报来自玩家观察，请以游戏内实际情况为准。有效截止时间为本站展示规则。
                </p>
              </div>
            </>
          )}
          {view === "report" &&
            (user ? (
              <ReportForm
                onSuccess={() => {
                  setToast("上报已提交，等待管理员审核。");
                  setError("");
                }}
                onError={handleError}
              />
            ) : (
              <LoginPrompt onLogin={() => setAuthMode("login")} />
            ))}
          {view === "catalog" && <Catalog onError={handleError} />}
          {view === "mine" &&
            (user ? (
              <>
                <div className="panel-toolbar">
                  <span>我的发现与审核进度</span>
                  <select
                    aria-label="上报状态筛选"
                    value={mineStatus}
                    onChange={(e) => {
                      setMineStatus(e.target.value);
                      setMinePage(1);
                    }}
                  >
                    <option value="">全部状态</option>
                    {Object.entries(reportStatuses).map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary"
                    disabled={mineLoading}
                    onClick={() => void loadMine()}
                  >
                    <RefreshCw size={16} />
                    刷新记录
                  </button>
                </div>
                <div className="report-list" aria-busy={mineLoading}>
                  {mine.items.map((item) => (
                    <ReportCard key={item.id} item={item} />
                  ))}
                  {!mine.items.length && (
                    <Empty
                      title={mineLoading ? "正在获取上报…" : "还没有上报记录"}
                      description="把你的发现分享给社区，审核进度将在这里显示。"
                      action={
                        <button
                          className="button primary"
                          onClick={() => navigate("report")}
                        >
                          去上报
                        </button>
                      }
                    />
                  )}
                </div>
                <Pagination data={mine} onPage={setMinePage} />
              </>
            ) : (
              <LoginPrompt onLogin={() => setAuthMode("login")} />
            ))}
          {view === "admin" && user?.role === "admin" && (
            <AdminPanel
              onError={handleError}
              onSuccess={(message) => {
                setToast(message);
                setError("");
              }}
              currentUser={user}
            />
          )}
          <footer className="main-footer">
            <span>Poke 情报站</span>
            {import.meta.env.VITE_ICP_NUMBER && (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {import.meta.env.VITE_ICP_NUMBER}
              </a>
            )}
            <span>连接发现 · 共享冒险</span>
          </footer>
        </main>
      </div>
      {authMode && (
        <AuthDialog
          mode={authMode}
          setMode={setAuthMode}
          onClose={() => setAuthMode(null)}
          onSuccess={(s) => {
            acceptSession(s);
            setAuthMode(null);
            setError("");
            setToast("欢迎回来，训练家。");
          }}
        />
      )}
    </div>
  );
}
