import type { RoomUpdateResult } from '../shared/room';
import type { RoomManager } from './roomManager';
import type { Updater } from './updater';

export interface RoomUpdateDeps {
  room: Pick<RoomManager, 'self' | 'state' | 'sendUpdate'>;
  updater: Pick<Updater, 'state' | 'check'> | null;
  currentVersion: string;
  isQuitting(): boolean;
}

/** A sender checks its own release feed before announcing a version to the current room session. */
export async function pushRoomUpdate(d: RoomUpdateDeps): Promise<RoomUpdateResult> {
  if (!d.updater) return { ok: false, error: 'unavailable' };
  const before = d.room.state();
  const self = d.room.self;
  if (before.phase !== 'active') return { ok: false, error: 'notInRoom' };
  const member = before.members.find((m) => m.self);
  if (member?.status === 'paused') return { ok: false, error: 'paused' };
  if (before.members.length < 2) return { ok: false, error: 'noPeers' };
  await d.updater.check(true);
  const after = d.room.state();
  if (d.isQuitting() || after.code !== before.code || d.room.self !== self) return { ok: false, error: 'notInRoom' };
  const update = d.updater.state;
  if (update.phase === 'available') return d.room.sendUpdate(update.version);
  if (update.phase === 'idle' && update.lastCheck !== null) return d.room.sendUpdate(d.currentVersion);
  return { ok: false, error: 'unavailable' };
}
