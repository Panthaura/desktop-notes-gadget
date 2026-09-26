/// <reference types="vite/client" />

import type { BackupInfo, Board, Note, Settings } from "./types";

export type NotesApi = {
  getBoard(): Promise<Board>;
  createNote(groupId: string | null): Promise<Note>;
  updateNote(patch: {
    id: string;
    title?: string;
    body?: string;
    groupId?: string | null;
    sortOrder?: number;
    titleIsManual?: boolean;
    color?: string | null;
    icon?: string | null;
    highlight?: boolean;
    remindAt?: number | null;
  }): Promise<Note | null>;
  deleteNote(id: string): Promise<void>;
  listArchivedNotes(): Promise<Note[]>;
  restoreNote(id: string): Promise<Note | null>;
  purgeNote(id: string): Promise<boolean>;
  getNote(id: string): Promise<Note | null>;
  createGroup(name: string): Promise<{ id: string; name: string }>;
  renameGroup(id: string, name: string): Promise<void>;
  deleteGroup(id: string): Promise<boolean>;
  reorderGroups(ids: string[]): Promise<void>;
  moveNote(id: string, groupId: string | null, index: number): Promise<void>;
  openEditor(id: string): Promise<void>;
  hideOverlay(): Promise<void>;
  raiseOverlay(): Promise<void>;
  setCompact(
    enabled: boolean,
    locked?: boolean,
    size?: { width: number; height: number; minHeight?: number; forceHeight?: boolean },
  ): Promise<Settings>;
  clearCompact(): Promise<Settings>;
  expandChrome(): Promise<Settings>;
  fitMenuSpace(payload: {
    menuLeft: number;
    menuTop: number;
    menuWidth: number;
    menuHeight: number;
  }): Promise<{ x: number; y: number; width: number; height: number } | null>;
  restoreMenuSpace(): Promise<void>;
  openCtxMenu(payload: {
    kind: "note" | "shell";
    noteId?: string;
    note?: Note;
    x: number;
    y: number;
  }): Promise<void>;
  closeCtxMenu(): Promise<void>;
  resizeCtxMenu(size: { width: number; height: number }): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
  ctxMenuReady(size: { width: number; height: number }): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
  takeCtxPresent(): Promise<{
    kind: "note" | "shell";
    note: Note | null;
    colors: { colorBg: string; colorAccent: string; colorBlink: string };
    locale: "de" | "en";
    x?: number;
    y?: number;
  } | null>;
  openOverlaySettings(): Promise<void>;
  copyNote(id: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  openLink(url: string): Promise<boolean>;
  getSettings(): Promise<Settings>;
  setOpenAtLogin(enabled: boolean): Promise<Settings>;
  setOpacity(value: number): Promise<Settings>;
  setAlwaysOnTop(enabled: boolean): Promise<Settings>;
  setPreviewSplit(value: number): Promise<Settings>;
  setLocale(locale: "de" | "en"): Promise<Settings>;
  setColors(patch: {
    colorBg?: string;
    colorAccent?: string;
    colorBlink?: string;
  }): Promise<Settings>;
  chooseJsonPath(): Promise<Settings>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(id: string): Promise<{ ok: boolean; date?: number }>;
  createBackup(): Promise<{ created: boolean; skipped?: string; id?: string }>;
  setBackupSchedule(patch: {
    backupIntervalDays?: number;
    backupKeepCount?: number;
  }): Promise<Settings>;
  confirm(payload: { title?: string; message: string; ok?: string }): Promise<boolean>;
  onBoardChanged(cb: () => void): () => void;
  onRemindersFired(cb: (payload: { count: number; title: string }) => void): () => void;
  onLocaleChanged(cb: (locale: "de" | "en") => void): () => void;
  onThemeChanged(
    cb: (payload: { colorBg: string; colorAccent: string; colorBlink: string }) => void,
  ): () => void;
  onOpenSettings(cb: () => void): () => void;
  onOverlayResized(cb: () => void): () => void;
  onOpacityChanged(cb: (opacity: number) => void): () => void;
  onCtxMenuPresent(
    cb: (payload: {
      kind: "note" | "shell";
      note: Note | null;
      colors: { colorBg: string; colorAccent: string; colorBlink: string };
      locale: "de" | "en";
      x?: number;
      y?: number;
    }) => void,
  ): () => void;
};

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}

export {};
