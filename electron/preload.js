"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("pdftool", {
  pickFiles: opts => ipcRenderer.invoke("dialog:openFiles", opts),
  saveFile: opts => ipcRenderer.invoke("dialog:saveFile", opts),
  pickSavePath: opts => ipcRenderer.invoke("dialog:pickSavePath", opts),
  openPath: filePath => ipcRenderer.invoke("shell:openPath", filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke("fs:writeFile", filePath, data),
  readFile: filePath => ipcRenderer.invoke("fs:readFile", filePath),
  pickFolder: opts => ipcRenderer.invoke("dialog:pickFolder", opts),
  writeToFolder: (folder, files) => ipcRenderer.invoke("fs:writeToFolder", folder, files),
  showInFolder: filePath => ipcRenderer.invoke("shell:showInFolder", filePath),

  // Returns the on-disk path of a dropped File and grants the app access to it.
  pathForDroppedFile: file => {
    const filePath = webUtils.getPathForFile(file);
    if (filePath) ipcRenderer.send("fs:allowPath", filePath);
    return filePath || null;
  },

  recent: {
    get: () => ipcRenderer.invoke("recent:get"),
    add: filePath => ipcRenderer.invoke("recent:add", filePath),
    remove: filePath => ipcRenderer.invoke("recent:remove", filePath),
    clear: () => ipcRenderer.invoke("recent:clear"),
  },

  getLaunchFile: () => ipcRenderer.invoke("win:getLaunchFile"),
  setDocState: (dirty, name) => ipcRenderer.send("win:setDirty", dirty, name),
  forceClose: () => ipcRenderer.send("win:forceClose"),
  newWindow: () => ipcRenderer.send("win:new"),
  setTitleBarTheme: dark => ipcRenderer.send("win:setTitleBar", dark),
  setLanguage: code => ipcRenderer.send("app:setLanguage", code),
  appInfo: () => ipcRenderer.invoke("app:info"),

  onOpenFile: callback => ipcRenderer.on("app:openFile", (_event, filePath) => callback(filePath)),
  onCommand: callback => ipcRenderer.on("app:command", (_event, command) => callback(command)),
});
