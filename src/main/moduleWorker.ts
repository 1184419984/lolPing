import { parentPort } from 'node:worker_threads';
import { moduleObject, modulePayload, type ModuleContext } from '../shared/modules';
import { ModuleVm } from './moduleVm';

const port = parentPort;
let vm: ModuleVm | null = null;
let queue = Promise.resolve();
port?.on('message', (raw: unknown) => {
  queue = queue.then(async () => {
    if (!moduleObject(raw) || !Number.isSafeInteger(raw.id)) return;
    try {
      if (raw.op === 'load') {
        const payload = modulePayload(raw.payload);
        if (!payload || vm) throw new Error('Invalid load');
        vm = await ModuleVm.create(payload);
        port.postMessage({ id: raw.id, ok: true });
      } else if (raw.op === 'event' && vm && typeof raw.event === 'string' && moduleObject(raw.context)
        && typeof raw.context.now === 'number' && Number.isFinite(raw.context.now)
        && (raw.context.lang === 'en' || raw.context.lang === 'zh-CN') && moduleObject(raw.context.settings)
        && typeof raw.context.paused === 'boolean' && typeof raw.context.busy === 'boolean'
        && typeof raw.context.room === 'boolean' && moduleObject(raw.context.texts)) {
        const reply = vm.handle(raw.event, raw.data, raw.context as unknown as ModuleContext, raw.state);
        port.postMessage({ id: raw.id, ok: true, reply });
      } else throw new Error('Invalid request');
    } catch {
      port.postMessage({ id: raw.id, ok: false });
    }
  });
});
