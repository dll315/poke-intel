import { useEffect, useState, useRef, type FormEvent } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { ApiError, request } from "./api";
import { regions } from "./types";
import { Field } from "./ui";
import { localInput, utc } from "./time";
type PhenoLocation={area:string;areaZh:string;type:string;detail:string;detailZh:string;mapUrl:string|null};
type PhenoLocationList={enabled:boolean;sourceUrl:string;lastSyncedAt:string|null;lastError:string;items:PhenoLocation[]};
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
  const [reportKind,setReportKind]=useState('boss');
  const [reportRegion,setReportRegion]=useState('kanto');
  const [phenomenonType,setPhenomenonType]=useState('');
  const [reportLocation,setReportLocation]=useState('');
  const [specificPoint,setSpecificPoint]=useState('');
  const [phenoLocations,setPhenoLocations]=useState<PhenoLocationList|null>(null);
  useEffect(()=>{if(reportKind!=='pheno'||phenoLocations)return;let active=true;void request<PhenoLocationList>('/pheno-locations').then(value=>{if(active)setPhenoLocations(value);}).catch(()=>{if(active)setPhenoLocations({enabled:false,sourceUrl:'https://alpha.pokemmotools.org/pheno-list',lastSyncedAt:null,lastError:'地点资料暂时不可用',items:[]});});return()=>{active=false;};},[reportKind,phenoLocations]);
  const formRef = useRef<HTMLFormElement>(null);
  const matching=phenoLocations?.items.filter(item=>item.type===phenomenonType)||[];
  const areas=[...new Map(matching.map(item=>[item.area,item.areaZh])).entries()];
  const points=matching.filter(item=>[item.area,item.areaZh].some(area=>area.toLowerCase()===reportLocation.trim().toLowerCase()));
  const mapUrl=points.find(item=>item.detail===specificPoint)?.mapUrl;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const area=reportKind==='pheno'?(points[0]?.areaZh||reportLocation.trim()):reportLocation.trim();
    const point=points.find(item=>item.detail===specificPoint)?.detailZh||specificPoint;
    const location=reportKind==='pheno'&&specificPoint?`${area} · ${point}`:area;
    if(location.length>100){setFields({location:'区域和具体点位合计不能超过 100 个字符'});return;}
    setBusy(true);
    setFields({});
    try {
      await request("/reports", {
        method: "POST",
        body: { ...Object.fromEntries(f),location, observedAt: utc(observed) },
      });
      formRef.current?.reset();
      setObserved(localInput());
      setReportKind('boss');
      setReportRegion('kanto');
      setPhenomenonType('');
      setReportLocation('');
      setSpecificPoint('');
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
              <select id="kind" name="kind" value={reportKind} onChange={event=>{setReportKind(event.target.value);setReportLocation('');setSpecificPoint('');setPhenomenonType('');if(event.target.value==='pheno')setReportRegion('unova');}}>
                <option value="boss">头目</option>
                <option value="swarm">群聚</option>
                <option value="pheno">奇遇（合众）</option>
              </select>
            </Field>
            <Field label="地区" name="region" error={fields.region}>
              <select id="region" name="region" value={reportRegion} onChange={event=>setReportRegion(event.target.value)}>
                {(reportKind==='pheno'?[['unova','合众']]:Object.entries(regions)).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {reportKind==='pheno'&&<Field label="奇遇形式" name="phenomenonType" error={fields.phenomenonType} hint="合众奇遇有草丛摇动、尘土、水面波纹和飞行阴影四种。"><select id="phenomenonType" name="phenomenonType" required value={phenomenonType} onChange={event=>{setPhenomenonType(event.target.value);setReportLocation('');setSpecificPoint('');}}><option value="" disabled>请选择奇遇形式</option><option value="grass">草丛摇动</option><option value="dust">尘土</option><option value="water">水面波纹</option><option value="shadow">飞行阴影</option></select></Field>}
          <Field label={reportKind==='pheno'?'宝可梦名称（可选）':'宝可梦名称'} name="pokemon" error={fields.pokemon}>
            <input
              id="pokemon"
              name="pokemon"
              required={reportKind!=='pheno'}
              maxLength={50}
              placeholder={reportKind==='pheno'?'不确定时可以留空':'例如：皮卡丘'}
            />
          </Field>
          {reportKind==='pheno'&&<Field label="奇遇区域（可选）" name="pheno-area-choice" hint="仅显示所选奇遇形式对应的区域；选后仍可编辑地点。"><select id="pheno-area-choice" value={areas.find(([area,areaZh])=>[area,areaZh].some(name=>name.toLowerCase()===reportLocation.trim().toLowerCase()))?.[1]||''} onChange={event=>{setReportLocation(event.target.value);setSpecificPoint('');}} disabled={!phenomenonType||areas.length===0}><option value="">{areas.length?'请选择或在下方手动填写':'暂无可选区域'}</option>{areas.map(([area,areaZh])=><option value={areaZh} key={area}>{areaZh}</option>)}</select></Field>}
          <Field label="地点" name="location" error={fields.location}>
            <input
              id="location"
              name="location"
              list={reportKind==='pheno'?'pheno-location-options':undefined}
              value={reportLocation}
              onChange={event=>{setReportLocation(event.target.value);setSpecificPoint('');}}
              required
              maxLength={100}
              placeholder={reportKind==='pheno'?'选择或输入合众地区中文地点':'填写具体道路、洞窟或区域'}
            />
          </Field>
          {reportKind==='pheno'&&<><datalist id="pheno-location-options">{areas.map(([area,areaZh])=><option value={areaZh} key={area}/>)}</datalist>{points.length>0&&<Field label="具体点位" name="pheno-detail" hint="同一区域可能有多个点位；不确定时可留空，在补充说明写清路线。"><select id="pheno-detail" value={specificPoint} onChange={event=>setSpecificPoint(event.target.value)}><option value="">不确定具体点位</option>{points.map(point=><option value={point.detail} key={point.detail}>{point.detailZh}</option>)}</select></Field>}{mapUrl&&<a href={mapUrl} target="_blank" rel="noopener noreferrer">查看来源站点位图</a>}<p className="pheno-location-help">{phenoLocations?.lastSyncedAt?`已载入 ${areas.length} 个对应区域，点位来自 Alphapedia；可手动填写新地点。`:phenoLocations?.lastError||'正在读取奇遇地点资料；也可以手动填写。'} <a href="https://alpha.pokemmotools.org/pheno-list" target="_blank" rel="noopener noreferrer">核对来源</a></p></>}
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
