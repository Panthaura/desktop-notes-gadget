export type Group = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type Note = {
  id: string;
  groupId: string | null;
  title: string;
  titleIsManual: boolean;
  body: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type Board = {
  groups: Group[];
  notes: Note[];
};

export type Settings = {
  openAtLogin: boolean;
  jsonPath: string;
  autoSave: boolean;
  opacity: number;
  alwaysOnTop: boolean;
  previewSplit: number;
  locale: "de" | "en";
  cancelled?: boolean;
  imported?: boolean;
  conflicts?: number;
};
