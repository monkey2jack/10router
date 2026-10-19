/**
 * 更新窗 preload(update-window.html 专用,sandbox + contextIsolation 安全)
 *
 * 只通过 contextBridge 暴露一个白名单 API;页面拿不到 require/ipcRenderer 本体:
 *  - bootstrap():一次性拉取静态文案(tr() 已在主进程渲染好)与当前状态;
 *  - onState(cb):订阅主进程推送的状态机状态(checking/available/downloading/…);
 *  - action(name):页面按钮意图(close/cancel/download/install/retry/open-releases),
 *    主进程校验 sender 确为更新窗后才受理;
 *  - fitHeight(h):内容高度回报,主进程据此贴合窗口(各状态高度不同)。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateApi', {
    bootstrap: () => ipcRenderer.invoke('update:bootstrap'),
    action: (action) => ipcRenderer.send('update:action', { action: String(action || '') }),
    fitHeight: (height) => ipcRenderer.send('update:fit', Number(height) || 0),
    onState: (cb) => {
        const listener = (_e, payload) => cb(payload);
        ipcRenderer.on('update:state', listener);
        return () => ipcRenderer.removeListener('update:state', listener);
    },
});
