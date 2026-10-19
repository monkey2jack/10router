/**
 * 关于窗 preload(about-window.html 专用,sandbox + contextIsolation 安全)
 *
 * 只通过 contextBridge 暴露一个白名单 API;页面拿不到 require/ipcRenderer 本体:
 *  - bootstrap():一次性拉取静态文案(tr() 已在主进程渲染好)与版本信息;
 *  - action(name):页面按钮意图(close/github),主进程校验 sender 确为关于窗后才受理;
 *  - fitHeight(h):内容高度回报,主进程据此贴合窗口。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aboutApi', {
    bootstrap: () => ipcRenderer.invoke('about:bootstrap'),
    action: (action) => ipcRenderer.send('about:action', { action: String(action || '') }),
    fitHeight: (height) => ipcRenderer.send('about:fit', Number(height) || 0),
});
