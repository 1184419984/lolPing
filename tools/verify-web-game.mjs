import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';

// Optional live smoke check. Never joins a supplied room or uses the user's browser session.
app.setPath('userData', resolve('out/verification/foony-smoke-profile'));
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => { console.error('Foony load timed out'); app.exit(1); }, 45_000);
app.whenReady().then(async () => {
  let game;
  try {
    await mkdir('out/verification', { recursive: true });
    await build({ entryPoints: ['src/main/webGameWindow.ts'], outfile: 'out/verification/web-game-host.mjs',
      platform: 'node', format: 'esm', bundle: true, external: ['electron'] });
    const { WebGameWindow } = await import(pathToFileURL(resolve('out/verification/web-game-host.mjs')).href);
    game = new WebGameWindow({ title: () => 'Foony Chinese smoke check', onFocus: () => {}, onError: () => {} });
    const result = await game.open('https://foony.com/zh/games/paintjob');
    assert.equal(result.ok, true);
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    const page = await win.webContents.executeJavaScript(`new Promise(resolve=>{
      const start=Date.now();const check=()=>{const text=document.body.innerText;
      if((text.includes('你画我猜在线版') && text.includes('创建房间')) || Date.now()-start>25000)
        return resolve({url:location.href,lang:document.documentElement.lang,text:text.slice(0,1500),
          node:typeof require,bridge:typeof gameApi,settings:typeof settingsApi});
      requestAnimationFrame(check);};check();})`);
    const image = await win.webContents.capturePage();
    await writeFile('out/verification/foony-live.png', image.toPNG());
    await writeFile('out/verification/foony-live.json', JSON.stringify(page, null, 2));
    assert.equal(page.lang, 'zh'); assert.equal(page.node, 'undefined'); assert.equal(page.bridge, 'undefined');
    assert.match(page.text, /你画我猜在线版/); assert.match(page.text, /创建房间/);
    assert.equal(page.settings, 'undefined');
    console.log(JSON.stringify(page, null, 2));
    console.log('Live Chinese page loaded in the actual sandboxed web-game host. No multiplayer round was played.');
    game.destroy(); clearTimeout(watchdog); app.exit(0);
  } catch (error) { console.error(error); game?.destroy(); clearTimeout(watchdog); app.exit(1); }
});
