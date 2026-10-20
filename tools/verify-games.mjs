import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

// Exercise the real manager, isolated game worker, preload and renderer without the user's room or input hooks.
app.disableHardwareAcceleration();
app.setPath('userData', resolve('out/verification/electron-profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let win; let guestWin; let server; let harness;
  try {
    const compiled = await build({ stdin: { contents: `
      import { GameManager } from './src/main/gameManager';
      import { GameRuntime } from './src/main/gameRuntime';
      import { GameSession } from './src/main/gameSession';
      import { FEATURE_CATALOG } from './src/features/catalog';
      export function createHarness(script,tabletopScript,media,worker) {
        const payload={format:1,manifest:FEATURE_CATALOG[1],assets:[],script};
        const tabletop={format:1,manifest:FEATURE_CATALOG[2],assets:media,script:tabletopScript};
        const digest='f'.repeat(64);
        const catalog=[payload,tabletop].flatMap(p=>p.manifest.games.map(definition=>({module:p.manifest.id,game:definition.id,digest,definition,
          assets:Object.fromEntries(media.map(a=>[a.name,'/media/'+a.name]))})));
        let mode='offline';let sequence=0;let now=Date.now();const sent=[];const failures=[];
        const peers=['a'.repeat(16),'b'.repeat(16)];let game,guest;
        const room=index=>({phase:mode==='offline'?'idle':'active',code:mode==='offline'?null:'fixture',
          members:mode==='offline'?[]:peers.slice(0,mode==='alone'?1:2).map((peer,i)=>({peer,name:'Player '+(i?'B':'A'),
            self:i===index,color:i,path:'lan',status:mode==='muted'&&i===index?'muted':'on',muted:false,
            needsUpdate:false,noEmotes:false,...(mode==='legacy'&&i===1?{}:{game:1})})),
          lan:mode==='offline'?'off':'ok',internet:'off',lonely:false,clockSkew:false});
        const make=index=>new GameManager({catalog:()=>catalog,room:()=>room(index),self:()=>peers[index],name:()=>'Player '+(index?'B':'A'),
          lang:()=>'zh-CN',platform:'win',enabled:()=>true,id:()=>(++sequence).toString(16).padStart(16,'0'),now:()=>now,
          send:packet=>{sent.push(packet);if(mode==='online')queueMicrotask(()=>{(index?game:guest).receive({...packet,peer:peers[index],name:'Player '+(index?'B':'A')});});return {ok:true};}});
        game=make(0);guest=make(1);
        const runtime=new GameRuntime({payload:()=>payload,context:()=>({now:0,lang:'zh-CN',settings:{},texts:payload.manifest.texts,paused:false,busy:false,room:false}),
          runner:()=>GameRuntime.worker(worker),submit:r=>game.submit(r),failed:()=>{failures.push('Game worker failed');}});
        const session=new GameSession({payload:()=>tabletop,context:()=>({now:0,lang:'zh-CN',settings:{},texts:tabletop.manifest.texts,paused:false,busy:false,room:false}),
          runner:()=>GameRuntime.worker(worker),send:()=>true,now:Date.now,failed:()=>{failures.push('Session worker failed');}});
        let stage='';game.on('state',s=>{session.sync(s);const next=s.phase==='playing'?s.currentTest:'';if(next!==stage){stage=next;void runtime.stop();}});
        return {game,guest,runtime,session,sent,failures,setRoom:next=>{now+=16000;mode=next;game.refresh();guest.refresh();}};
      }
    `, loader: 'ts', resolveDir: process.cwd() }, platform: 'node', format: 'esm', bundle: true, write: false });
    await mkdir('out/verification', { recursive: true });
    await writeFile('out/verification/game-harness.mjs', compiled.outputFiles[0].contents);
    const { createHarness } = await import(pathToFileURL(resolve('out/verification/game-harness.mjs')).href);
    const renderer = await build({ entryPoints: ['src/renderer/game/main.ts'], platform: 'browser', format: 'iife', bundle: true, write: false });
    const script = await readFile('src/features/arcade.js', 'utf8');
    const tabletopScript = await readFile('src/features/tabletop.js', 'utf8');
    const media = [];
    for (const name of ['paintjob', 'tictactoe', 'connectfour', 'chess']) media.push({ name: name + '.webp', mime: 'image/webp',
      data: (await readFile('src/features/assets/tabletop/' + name + '.webp')).toString('base64') });
    const clock = `let now=1000,id=0;const pending=new Map();Object.defineProperty(performance,'now',{value:()=>now});
      window.setTimeout=(fn,ms=0)=>{const key=++id;pending.set(key,{fn,at:now+ms});return key;};
      window.clearTimeout=key=>pending.delete(key);
      globalThis.advance=ms=>{now+=ms;for(let i=0;i<1000;i++){const next=[...pending].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;pending.delete(next[0]);next[1].fn();}};
      gameApi.onState(s=>globalThis.testState=s);gameApi.get().then(s=>globalThis.testState=s);`;
    const resources = new Map([
      ['/game/index.html', ['text/html', '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/game.css"><main id="game"></main><script src="/clock.js"></script><script src="/main.js"></script>']],
      ['/game.css', ['text/css', await readFile('src/renderer/game/game.css')]],
      ['/clock.js', ['text/javascript', clock]],
      ['/main.js', ['text/javascript', renderer.outputFiles[0].contents]],
    ]);
    for (const name of ['basicping', 'target', 'caution', 'enemyvision', 'push', 'allin_01']) {
      const file = name === 'allin_01' ? 'pingwheel_allin_render_01' : `pingwheel_${name}render`;
      resources.set(`/textures/${file}.png`, ['image/png', await readFile(`assets/textures/${file}.png`)]);
    }
    for (const image of media) resources.set('/media/' + image.name, ['image/webp', Buffer.from(image.data, 'base64')]);
    server = createServer((req, res) => { const item = resources.get(new URL(req.url, 'http://localhost').pathname);
      if (!item) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': item[0] }).end(item[1]); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const manager = event => guestWin && event.sender === guestWin.webContents ? harness.guest : harness.game;
    ipcMain.handle('game:get', event => manager(event).state());
    ipcMain.handle('game:start', (event, ref, multi) => manager(event).start(ref, multi));
    ipcMain.handle('game:accept', event => manager(event).accept());
    ipcMain.handle('game:decline', event => manager(event).decline());
    ipcMain.handle('game:begin', event => manager(event).begin());
    ipcMain.handle('game:cancel', event => manager(event).cancel());
    ipcMain.handle('game:openStage', (_e, now) => { const s = harness.game.state(); return harness.runtime.open(s.selection, s.currentTest, s.seed, now); });
    ipcMain.handle('game:input', (_e, input) => harness.runtime.input(input));
    const webOpens = [];
    ipcMain.handle('game:openWeb', () => { webOpens.push(harness.game.state().webUrl); return { ok: true }; });
    ipcMain.handle('game:inviteWeb', () => harness.game.inviteWeb('https://foony.com/zh/games/paintjob#r=kessfvk5'));
    ipcMain.handle('game:stopStage', () => harness.runtime.stop());
    ipcMain.handle('game:session', event => manager(event) === harness.game ? harness.session.frame() : null);
    ipcMain.handle('game:sessionAction', (_e, action) => harness.session.action(action));
    await mkdir('out/verification', { recursive: true });
    const report = [];
    for (const [width, height] of [[1100, 800], [760, 600], [390, 844]]) {
      harness = createHarness(script, tabletopScript, media, resolve('out/main/moduleWorker.js'));
      win = new BrowserWindow({ width, height, useContentSize: true, show: false,
        webPreferences: { offscreen: true, backgroundThrottling: false, preload: resolve('out/preload/game.js') } });
      const errors = []; win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      harness.game.on('state', s => win?.webContents.send('game:changed', s));
      harness.guest.on('state', s => guestWin?.webContents.send('game:changed', s));
      harness.session.on('frame', frame => win?.webContents.send('game:sessionChanged', frame));
      await win.loadURL(`http://127.0.0.1:${server.address().port}/game/index.html`);
      const run = code => win.webContents.executeJavaScript(code);
      const wait = condition => run(`new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{if(${condition})return resolve(true);if(Date.now()-start>5000)return reject(Error('Condition timed out: '+${JSON.stringify(condition)}));requestAnimationFrame(check);};check();})`);
      const ready = () => wait(`testState.phase!=='playing'||document.querySelector('#board[aria-busy="false"]')`);
      const press = async selector => { await run(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}))`); await ready(); };
      const advance = async ms => { await run(`advance(${ms})`); await ready(); };
      const snapshot = async name => {
        await run(`Promise.all([...document.images].map(i=>i.decode())).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
        assert.equal(await run('document.documentElement.scrollWidth>innerWidth'), false);
        assert.equal(await run(`Array.from(document.querySelectorAll('button')).some(b=>b.getBoundingClientRect().right>innerWidth+1)`), false);
        const image = await win.webContents.capturePage();
        await writeFile(`out/verification/game-${name}-${width}x${height}.png`, image.toPNG());
      };
      await wait(`document.querySelectorAll('.game-card').length===5`); await snapshot('center');
      assert.equal(await run(`Array.from(document.querySelectorAll('[data-invite]')).every(b=>b.disabled)`), true);
      harness.setRoom('legacy');
      await wait(`document.querySelector('[data-invite="1"]').disabled===false&&document.querySelector('.invite-status.needsUpdate')`);
      await snapshot('invite-legacy');
      await run(`document.querySelector('[data-invite="1"]').click()`);
      await wait(`testState.phase==='lobby'&&document.querySelector('#begin').disabled`);
      assert.equal(harness.sent.at(-1).kind, 'invite');
      assert.equal(harness.guest.state().phase, 'idle');
      await snapshot('invite-waiting');
      await run(`document.querySelector('#leave').click()`); await wait(`testState.phase==='idle'`);
      harness.setRoom('online');
      await wait(`document.querySelector('.invite-status.available')`);
      await run(`document.querySelector('[data-solo="4"]').click()`);
      await wait(`document.querySelector('[data-cell="52"]')&&document.querySelector('#inviteCurrent')`);
      assert.equal(await run(`document.querySelector('#inviteCurrent').disabled`), false);
      await run(`document.querySelector('#inviteCurrent').click()`);
      await wait(`testState.phase==='lobby'&&document.querySelector('.invite-status.waiting')`);
      assert.equal(harness.guest.state().phase, 'invited');
      guestWin = new BrowserWindow({ width, height, useContentSize: true, show: false,
        webPreferences: { offscreen: true, backgroundThrottling: false, preload: resolve('out/preload/game.js') } });
      await guestWin.loadURL(`http://127.0.0.1:${server.address().port}/game/index.html`);
      await guestWin.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{if(document.querySelector('#accept'))return resolve(true);if(Date.now()-start>5000)return reject(Error('Guest did not receive invitation'));requestAnimationFrame(check);};check();})`);
      assert.equal(harness.game.state().participants.length, 1);
      await guestWin.webContents.executeJavaScript(`document.querySelector('#accept').click()`);
      await wait(`testState.participants.length===2&&document.querySelector('#begin').disabled===false`);
      assert.equal(harness.guest.state().phase, 'lobby');
      await snapshot('invite-accepted');
      await run(`document.querySelector('#begin').click()`);
      await wait(`testState.phase==='playing'&&document.querySelector('[data-cell="0"]')`);
      assert.equal(harness.guest.state().phase, 'playing');
      guestWin.destroy(); guestWin = null;
      await run(`document.querySelector('#quit').click()`); await wait(`testState.phase==='idle'`);
      harness.setRoom('muted');
      await wait(`document.querySelector('[data-invite="0"]').disabled&&document.querySelector('.invite-hint')`);
      harness.setRoom('offline');
      await wait(`document.querySelectorAll('.game-card').length===5`);
      for (let game = 0; game < 1; game++) {
        console.log('Checking', width, game);
        await run(`document.querySelector('[data-solo="${game}"]').click()`); await wait(`testState.phase==='playing'`); await ready();
        const stages = [...harness.game.state().tests];
        for (const stage of stages) {
          console.log('Stage', stage);
          await wait(`testState.currentTest===${JSON.stringify(stage)}`); await ready();
          if (stage === 'reaction') {
            if (game === 0) { await press('[data-node="pad"]'); await press('[data-node="pad"]'); assert.match(await run(`document.querySelector('[data-node="pad"]').textContent`), /抢跑/); }
            for (let i = 0; i < 5; i++) { await press('[data-node="pad"]'); await advance(2200); await advance(200); await press('[data-node="pad"]'); }
          } else {
            if (game === 0 && stage === 'aim') {
              await run(`window.dispatchEvent(new Event('blur'))`); await wait(`document.querySelector('#restartTest')`);
              await run(`document.querySelector('#restartTest').click()`); await ready();
            }
            await press('[data-node="start"]');
            if (stage === 'aim') {
              await snapshot('aim');
              for (let i = 0; i < 20; i++) { await advance(250); await press('[data-node="target"]'); }
            } else if (stage === 'clicks') {
              await run(`for(let i=0;i<30;i++){advance(100);document.querySelector('[data-node="pad"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));}`);
              await wait(`document.querySelector('[data-node="pad"]').textContent.endsWith('30')`); await ready();
              await advance(2500);
            } else if (stage === 'sequence') {
              for (let level = 1; level <= 8; level++) {
                const tiles = [];
                for (let step = 0; step < level; step++) {
                  tiles.push(await run(`document.querySelector('.surface-tile.tone-success').dataset.node`));
                  await advance(261); await advance(181);
                }
                for (const tile of tiles) { await advance(50); await press(`[data-node="${tile}"]`); }
              }
            }
          }
        }
        await wait(`testState.phase==='results'&&document.querySelector('.ceremony')`);
        assert.equal(harness.game.state().results[harness.game.state().self].length, stages.length);
        await snapshot(game === 0 ? 'results' : `result-${game}`);
        report.push({ width, height, game, results: harness.game.state().results });
        await run(`document.querySelector('#back').click()`); await wait(`document.querySelectorAll('.game-card').length===5`);
      }
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('.game-card h2')).map(n=>n.textContent)`), ['游戏天赋挑战', '你画我猜', '井字棋', '四子连珠', '国际象棋']);
      for (let index = 1; index < 5; index++) {
        await run(`document.querySelector('[data-solo="${index}"]').click()`);
        await wait(`document.querySelector('${index === 1 ? '[data-word="0"]' : '[data-cell="0"]'}')`);
        if (index === 1) {
          await run(`document.querySelector('[data-word="0"]').click()`);
          await wait(`document.querySelector('.draw-word').textContent!==''&&!document.querySelector('.drawing-tools').hidden`);
          await run(`{const c=document.querySelector('#drawing'),r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:r.left+30,clientY:r.top+30}));for(let i=0;i<8;i++)c.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:r.left+30+i*15,clientY:r.top+30+i*12}));c.dispatchEvent(new PointerEvent('pointerup',{pointerId:1}));}`);
          await harness.session.whenIdle();
          await wait(`document.querySelector('#drawing').getContext('2d').getImageData(60,60,1,1).data[3]===255`);
          assert.ok(harness.session.frame().view.strokes.length > 0);
          await snapshot('paintjob');
          const nonwhite = await run(`{const data=document.querySelector('#drawing').getContext('2d').getImageData(0,0,1024,768).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]<200)n++;n;}`);
          assert.ok(nonwhite > 100, 'Canvas must contain visible strokes');
        } else {
          const click = async cell => {
            await run(`document.querySelector('[data-cell="${cell}"]').click()`); await harness.session.whenIdle();
            await new Promise(resolve => win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(r))').then(resolve));
          };
          if (index === 2) for (const cell of [0, 3, 1, 4, 2]) await click(cell);
          if (index === 3) for (const cell of [0, 1, 0, 1, 0, 1, 0]) await click(cell);
          if (index === 4) { await click(52); await click(36); await wait(`document.querySelector('[data-cell="36"]').textContent.includes('♙')`); }
          if (index !== 4) await wait(`document.querySelector('#rematch').hidden===false`);
          await snapshot(['', '', 'tic', 'connect', 'chess'][index]);
        }
        await run(`document.querySelector('#quit').click()`); await wait(`document.querySelectorAll('.game-card').length===5`);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(harness.failures, []);
      await harness.runtime.stop(); await harness.session.stop(); win.destroy(); win = null;
    }
    await writeFile('out/verification/game-results.json', JSON.stringify(report, null, 2));
    console.log('Verified room invitations, legacy peer diagnostics, two-window acceptance, five local games and drawing pixels at three viewports.');
    server.close(); app.exit(0);
  } catch (error) { console.error(error); await harness?.runtime.stop(); await harness?.session.stop(); guestWin?.destroy(); win?.destroy(); server?.close(); app.exit(1); }
});
