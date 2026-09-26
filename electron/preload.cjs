const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesApi", {
  getBoard: () => ipcRenderer.invoke("board:get"),
  createNote: (groupId) => ipcRenderer.invoke("notes:create", groupId),
  updateNote: (patch) => ipcRenderer.invoke("notes:update", patch),
  deleteNote: (id) => ipcRenderer.invoke("notes:delete", id),
  listArchivedNotes: () => ipcRenderer.invoke("notes:archived"),
  restoreNote: (id) => ipcRenderer.invoke("notes:restore", id),
  purgeNote: (id) => ipcRenderer.invoke("notes:purge", id),
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
  setCompact: (enabled, locked, size) =>
    ipcRenderer.invoke("overlay:setCompact", {
      enabled,
      locked: Boolean(locked),
      width: size?.width,
      height: size?.height,
      minHeight: size?.minHeight,
      forceHeight: Boolean(size?.forceHeight),
    }),
  clearCompact: () => ipcRenderer.invoke("overlay:clearCompact"),
  expandChrome: () => ipcRenderer.invoke("overlay:expandChrome"),
  fitMenuSpace: (payload) => ipcRenderer.invoke("overlay:fitMenuSpace", payload),
  restoreMenuSpace: () => ipcRenderer.invoke("overlay:restoreMenuSpace"),
  openCtxMenu: (payload) => ipcRenderer.invoke("ctxmenu:open", payload),
  closeCtxMenu: () => ipcRenderer.invoke("ctxmenu:close"),
  resizeCtxMenu: (size) => ipcRenderer.invoke("ctxmenu:resize", size),
  ctxMenuReady: (size) => ipcRenderer.invoke("ctxmenu:ready", size),
  takeCtxPresent: () => ipcRenderer.invoke("ctxmenu:takePresent"),
  openOverlaySettings: () => ipcRenderer.invoke("overlay:openSettings"),
  copyNote: (id) => ipcRenderer.invoke("notes:copy", id),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  openLink: (url) => ipcRenderer.invoke("shell:open", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("settings:setOpenAtLogin", enabled),
  setOpacity: (value) => ipcRenderer.invoke("settings:setOpacity", value),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("settings:setAlwaysOnTop", enabled),
  setPreviewSplit: (value) => ipcRenderer.invoke("settings:setPreviewSplit", value),
  chooseJsonPath: () => ipcRenderer.invoke("settings:chooseJsonPath"),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  restoreBackup: (id) => ipcRenderer.invoke("backups:restore", id),
  createBackup: () => ipcRenderer.invoke("backups:create"),
  setBackupSchedule: (patch) => ipcRenderer.invoke("backups:setSchedule", patch),
  setLocale: (locale) => ipcRenderer.invoke("settings:setLocale", locale),
  setColors: (patch) => ipcRenderer.invoke("settings:setColors", patch),
  confirm: (payload) => ipcRenderer.invoke("dialog:confirm", payload),
  onBoardChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("board:changed", handler);
    return () => ipcRenderer.removeListener("board:changed", handler);
  },
  onRemindersFired: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("reminders:fired", handler);
    return () => ipcRenderer.removeListener("reminders:fired", handler);
  },
  onLocaleChanged: (cb) => {
    const handler = (_e, locale) => cb(locale);
    ipcRenderer.on("locale:changed", handler);
    return () => ipcRenderer.removeListener("locale:changed", handler);
  },
  onThemeChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("theme:changed", handler);
    return () => ipcRenderer.removeListener("theme:changed", handler);
  },
  onOpenSettings: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("overlay:open-settings", handler);
    return () => ipcRenderer.removeListener("overlay:open-settings", handler);
  },
  onOverlayResized: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("overlay:resized", handler);
    return () => ipcRenderer.removeListener("overlay:resized", handler);
  },
  onOpacityChanged: (cb) => {
    const handler = (_e, opacity) => cb(opacity);
    ipcRenderer.on("opacity:changed", handler);
    return () => ipcRenderer.removeListener("opacity:changed", handler);
  },
  onCtxMenuPresent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("ctxmenu:present", handler);
    return () => ipcRenderer.removeListener("ctxmenu:present", handler);
  },
});
