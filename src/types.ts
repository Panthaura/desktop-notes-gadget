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
  deletedAt?: number | null;
  color: string | null;
  icon: string | null;
  highlight: boolean;
  remindAt: number | null;
};

export type Board = {
  groups: Group[];
  notes: Note[];
  defaultGroupId: string | null;
};

export type Settings = {
  openAtLogin: boolean;
  jsonPath: string;
  opacity: number;
  alwaysOnTop: boolean;
  previewSplit: number;
  compact?: boolean;
  compactLocked?: boolean;
  locale: "de" | "en";
  appVersion?: string;
  colorBg?: string;
  colorAccent?: string;
  colorBlink?: string;
  backupIntervalDays?: number;
  backupKeepCount?: number;
  cancelled?: boolean;
  imported?: boolean;
  conflicts?: number;
};

export type BackupInfo = {
  id: string;
  date: number;
  kind: "weekly" | "monthly" | "archive" | "scheduled";
};
