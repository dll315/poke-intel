import { useState, useRef, type FormEvent } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { ApiError, request } from "./api";
import { regions } from "./types";
import { Field } from "./ui";
import { localInput, utc } from "./time";
export function ReportForm({
  onSuccess,
  onError,
}: {
  onSuccess: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [observed, setObserved] = useState(localInput());
  const formRef = useRef<HTMLFormElement>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setFields({});
    try {
      await request("/reports", {
        method: "POST",
        body: { ...Object.fromEntries(f), observedAt: utc(observed) },
      });
      formRef.current?.reset();
      setObserved(localInput());
      onSuccess();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="report-layout">
      <section className="panel form-panel">
        <h2>填写发现</h2>
        <p className="panel-description">
          请填写你实际观察到的信息，提交后进入审核队列。
        </p>
        <form onSubmit={submit} ref={formRef}>
          <div className="form-row">
            <Field label="情报类型" name="kind" error={fields.kind}>
              <select id="kind" name="kind">
                <option value="boss">头目</option>
                <option value="swarm">群聚</option>
              </select>
            </Field>
            <Field label="地区" name="region" error={fields.region}>
              <select id="region" name="region">
                {Object.entries(regions).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="宝可梦名称" name="pokemon" error={fields.pokemon}>
            <input
              id="pokemon"
              name="pokemon"
              required
              maxLength={50}
              placeholder="例如：皮卡丘"
            />
          </Field>
          <Field label="地点" name="location" error={fields.location}>
            <input
              id="location"
              name="location"
              required
              maxLength={100}
              placeholder="填写具体道路、洞窟或区域"
            />
          </Field>
          <Field
            label="观察时间（北京时间）"
            name="observedAt"
            error={fields.observedAt}
            hint="仅接受过去 24 小时内的观察，不可填写未来时间。"
          >
            <input
              id="observedAt"
              name="observedAt"
              type="datetime-local"
              required
              max={localInput()}
              min={localInput(
                new Date(Date.now() - 24 * 3600_000).toISOString(),
              )}
              value={observed}
              onChange={(e) => setObserved(e.target.value)}
            />
          </Field>
          <Field label="补充说明（可选）" name="note" error={fields.note}>
            <textarea
              id="note"
              name="note"
              rows={4}
              maxLength={1000}
              placeholder="补充线路、特征或其他有帮助的信息…"
            />
          </Field>
          <div className="form-submit">
            <span>提交后不会立即公开展示</span>
            <button className="button primary" disabled={busy} type="submit">
              <Plus size={16} />
              {busy ? "正在提交…" : "提交上报"}
            </button>
          </div>
        </form>
      </section>
      <aside className="report-guide">
        <ShieldCheck size={25} />
        <h3>让每份情报更可靠</h3>
        <p>真实观察，准确地点。审核通过后，你的昵称将作为贡献者公开展示。</p>
        <ol>
          <li>
            <strong>记录发现</strong>
            <span>填写宝可梦与具体地点</span>
          </li>
          <li>
            <strong>等待审核</strong>
            <span>管理员检查内容与重复上报</span>
          </li>
          <li>
            <strong>分享给大家</strong>
            <span>通过后出现在公开情报中</span>
          </li>
        </ol>
        <small>
          每分钟最多 3 次，每天最多 50 次。
          <br />
          如被驳回，可在“我的上报”查看原因。
        </small>
      </aside>
    </div>
  );
}
