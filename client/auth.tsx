import { useState, useEffect, useRef, type FormEvent } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { ApiError, request } from "./api";
import type { Session } from "./types";
import { Field, Empty } from "./ui";
export function LoginPrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="panel">
      <Empty
        title="登录后，分享你的发现"
        description="创建账号即可上报，并在这里追踪审核进度。"
        action={
          <button className="button primary" onClick={onLogin}>
            登录 / 注册
            <ArrowRight size={16} />
          </button>
        }
      />
    </div>
  );
}
export function AuthDialog({
  mode,
  setMode,
  onClose,
  onSuccess,
}: {
  mode: "login" | "register";
  setMode: (mode: "login" | "register") => void;
  onClose: () => void;
  onSuccess: (s: Session) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list =
          modal.current?.querySelectorAll<HTMLElement>("button,input,a");
        if (!list?.length) return;
        const a = list[0],
          b = list[list.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setFields({});
    try {
      onSuccess(
        await request<Session>(`/auth/${mode}`, {
          method: "POST",
          body: Object.fromEntries(form),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      if (e instanceof ApiError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        ref={modal}
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭登录窗口"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="auth-mark">
          <Sparkles size={26} />
        </span>
        <h2 id="auth-title">
          {mode === "login" ? "欢迎回来，训练家" : "开启你的分享旅程"}
        </h2>
        <p>每一个发现，都让冒险更精彩。</p>
        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
              setFields({});
            }}
          >
            登录账号
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
              setFields({});
            }}
          >
            注册账号
          </button>
        </div>
        <form onSubmit={submit}>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <Field label="用户名" name="username" error={fields.username}>
            <input
              id="username"
              name="username"
              type="text"
              ref={first}
              autoComplete="username"
              required
              minLength={3}
              maxLength={30}
              placeholder="英文字母、数字、下划线或短横线"
            />
          </Field>
          {mode === "register" && (
            <Field
              label="昵称"
              name="nickname"
              error={fields.nickname}
              hint="公开情报只展示昵称。"
            >
              <input
                id="nickname"
                name="nickname"
                required
                maxLength={30}
                autoComplete="nickname"
                placeholder="训练家如何称呼你？"
              />
            </Field>
          )}
          <Field
            label="密码"
            name="password"
            error={fields.password}
            hint={mode === "register" ? "至少 10 位，最多 128 位。" : ""}
          >
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder="输入密码"
            />
          </Field>
          <button className="button primary full" disabled={busy} type="submit">
            {busy ? "正在处理…" : mode === "login" ? "登录" : "创建账号"}
            <ArrowRight size={16} />
          </button>
        </form>
        <small className="auth-note">
          请记住用户名和密码；目前没有自动找回密码功能。
        </small>
      </div>
    </div>
  );
}
