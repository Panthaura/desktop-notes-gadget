/// <reference types="vite/client" />

import type { Board, Note, Settings } from "./types";

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
  }): Promise<Note | null>;
  deleteNote(id: string): Promise<void>;
  getNote(id: string): Promise<Note | null>;
  createGroup(name: string): Promise<{ id: string; name: string }>;
  renameGroup(id: string, name: string): Promise<void>;
  deleteGroup(id: string): Promise<boolean>;
  reorderGroups(ids: string[]): Promise<void>;
  moveNote(id: string, groupId: string | null, index: number): Promise<void>;
  openEditor(id: string): Promise<void>;
  hideOverlay(): Promise<void>;
  raiseOverlay(): Promise<void>;
  copyNote(id: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  openLink(url: string): Promise<boolean>;
  getSettings(): Promise<Settings>;
  setOpenAtLogin(enabled: boolean): Promise<Settings>;
  setAutoSave(enabled: boolean): Promise<Settings>;
  setOpacity(value: number): Promise<Settings>;
  setAlwaysOnTop(enabled: boolean): Promise<Settings>;
  setPreviewSplit(value: number): Promise<Settings>;
  setLocale(locale: "de" | "en"): Promise<Settings>;
  chooseJsonPath(): Promise<Settings>;
  confirm(payload: { title?: string; message: string; ok?: string }): Promise<boolean>;
  onBoardChanged(cb: () => void): () => void;
  onLocaleChanged(cb: (locale: "de" | "en") => void): () => void;
};

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}

export {};
