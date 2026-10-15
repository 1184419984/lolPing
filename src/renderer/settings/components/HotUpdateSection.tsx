import { Button, Input, ProgressBar, Select, Slider, Switch } from '@fluentui/react-components';
import { ArrowDownload24Regular, ArrowUpload24Regular, ArrowUndo24Regular, Code24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { HotState } from '../../../shared/hotUpdate';
import type { ModuleResult, ModuleSetting, ModuleValue } from '../../../shared/modules';
import { moduleText } from '../../../shared/modules';
import { api } from '../api';
import { useText } from '../text';
import { SettingRow, SwitchRow } from './rows';

function FeatureControl({ definition: d, value, save }: { definition: ModuleSetting; value: ModuleValue; save(value: ModuleValue): void }) {
  const t = useText();
  if (d.type === 'boolean') return <Switch checked={value === true} onChange={(_, data) => save(data.checked)} />;
  if (d.type === 'number') return <><Slider min={d.min} max={d.max} step={d.step} value={Number(value)} style={{ width: 180 }}
    onChange={(_, data) => save(data.value)} /><span className="value">{String(value)}</span></>;
  if (d.type === 'select') return <Select value={String(value)} onChange={(_, data) => save(data.value)}>
    {d.options?.map((o) => <option key={o.value} value={o.value}>{moduleText(o.label, t.lang)}</option>)}
  </Select>;
  if (d.type === 'color') return <input type="color" value={String(value)} aria-label={moduleText(d.label, t.lang)}
    onChange={(event) => save(event.target.value)} />;
  return <Input type="text" value={String(value)} maxLength={256}
    onChange={(_, data) => save(data.value)} />;
}

export function HotUpdateSection({ inRoom, peers }: { inRoom: boolean; peers: number }) {
  const t = useText();
  const [state, setState] = useState<HotState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const off = api.onHot((s) => { if (active) setState(s); });
    void api.getHot().then((s) => { if (active && s) setState(s); });
    return () => { active = false; off(); };
  }, []);
  const run = async (action: () => Promise<ModuleResult>, success?: string) => {
    setBusy(true); setNote(null);
    try { const result = await action(); setNote(result.ok ? success ?? null : t.hotErrors[result.error]); }
    catch { setNote(t.hotErrors.runtime); }
    finally { setBusy(false); }
  };
  if (!state) return null;
  const changing = busy || ['checking', 'downloading', 'activating'].includes(state.phase);
  return <section className="hotSection">
    <SettingRow icon={<Code24Regular />} title={t.hotTitle}
      description={`${t.hotCommit}: ${state.commit.slice(0, 12)} · ${t.hotPhase[state.phase]}`}>
      <Button icon={<ArrowUpload24Regular />} disabled={changing || !inRoom || peers < 1}
        onClick={() => void run(() => api.pushHot(), t.hotSent)}>{t.hotPush}</Button>
      <Button icon={<ArrowUndo24Regular />} disabled={changing || !state.canRollback}
        onClick={() => void run(() => api.rollbackHot())}>{t.hotRollback}</Button>
    </SettingRow>
    {changing ? <ProgressBar value={state.progress ? state.progress / 100 : undefined} /> : null}
    {note || state.error ? <p className="desc" role="status">{note ?? (state.error ? t.hotErrors[state.error] : '')}</p> : null}
    {state.invitation ? <SettingRow icon={<ArrowDownload24Regular />}
      title={t.hotReceived(state.invitation.name, state.invitation.commit.slice(0, 12))}>
      <Button appearance="primary" icon={<ArrowDownload24Regular />} disabled={changing || !inRoom}
        onClick={() => void run(() => api.acceptHot())}>{t.hotAccept}</Button>
      <Button disabled={changing} onClick={() => void api.dismissHot()}>{t.hotDismiss}</Button>
    </SettingRow> : null}
    {state.modules.map((m) => <div key={m.manifest.id} className="featureSettings">
      {m.manifest.id !== 'hydration' ? <SwitchRow icon={<Code24Regular />} title={moduleText(m.manifest.name, t.lang)} checked={m.enabled}
        onChange={(on) => void run(() => api.configureModule(m.manifest.id, { moduleEnabled: on }))} /> : null}
      {m.manifest.settings.filter((d) => m.manifest.id !== 'hydration'
        || !['enabled', 'intervalMin', 'durationS'].includes(d.key)).map((d) => <SettingRow key={d.key} icon={<Code24Regular />} title={moduleText(d.label, t.lang)}>
        <FeatureControl definition={d} value={m.settings[d.key]} save={(value) => void run(() => api.configureModule(m.manifest.id, { [d.key]: value }))} />
      </SettingRow>)}
      {m.manifest.actions.filter((a) => m.manifest.id !== 'hydration' || a.key !== 'preview').map((a) => <Button key={a.key} icon={<Code24Regular />} disabled={changing || !m.enabled}
        onClick={() => void run(() => api.moduleAction(m.manifest.id, a.key))}>{moduleText(a.label, t.lang)}</Button>)}
    </div>)}
  </section>;
}
