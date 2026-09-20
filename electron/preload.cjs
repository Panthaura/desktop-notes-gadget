const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesApi", {
  getBoard: () => ipcRenderer.invoke("board:get"),
  createNote: (groupId) => ipcRenderer.invoke("notes:create", groupId),
  updateNote: (patch) => ipcRenderer.invoke("notes:update", patch),
  deleteNote: (id) => ipcRenderer.invoke("notes:delete", id),
  getNote: (id) => ipcRenderer.invoke("notes:get", id),
  createGroup: (name) => ipcRenderer.invoke("groups:create", name),
  renameGroup: (id, name) => ipcRenderer.invoke("groups:rename", { id, name }),
  deleteGroup: (id) => ipcRenderer.invoke("groups:delete", id),
  reorderGroups: (ids) => ipcRenderer.invoke("groups:reorder", ids),
  moveNote: (id, groupId, index) =>
    ipcRenderer.invoke("notes:move", { id, groupId, index }),
  openEditor: (id) => ipcRenderer.invoke("editor:open", id),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  raiseOverlay: () => ipcRenderer.invoke("overlay:raise"),
  copyNote: (id) => ipcRenderer.invoke("notes:copy", id),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  openLink: (url) => ipcRenderer.invoke("shell:open", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("settings:setOpenAtLogin", enabled),
  setAutoSave: (enabled) => ipcRenderer.invoke("settings:setAutoSave", enabled),
  setOpacity: (value) => ipcRenderer.invoke("settings:setOpacity", value),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("settings:setAlwaysOnTop", enabled),
  setPreviewSplit: (value) => ipcRenderer.invoke("settings:setPreviewSplit", value),
  chooseJsonPath: (createNew) => ipcRenderer.invoke("settings:chooseJsonPath", createNew),
  setLocale: (locale) => ipcRenderer.invoke("settings:setLocale", locale),
  confirm: (payload) => ipcRenderer.invoke("dialog:confirm", payload),
  onBoardChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("board:changed", handler);
    return () => ipcRenderer.removeListener("board:changed", handler);
  },
  onLocaleChanged: (cb) => {
    const handler = (_e, locale) => cb(locale);
    ipcRenderer.on("locale:changed", handler);
    return () => ipcRenderer.removeListener("locale:changed", handler);
  },
});
