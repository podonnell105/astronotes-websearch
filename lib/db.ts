import fs from "node:fs";
import path from "node:path";
import type { RuntimeMode } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "astronotes.json");

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  credits: number;
  created_at: number;
};

export type AuthSessionRow = {
  id: string;
  user_id: string;
  expires_at: number;
};

export type ResearchSessionRow = {
  id: string;
  user_id: string;
  query: string;
  status: "running" | "complete" | "error";
  mode: RuntimeMode;
  jev_status: "jev" | "mock";
  created_at: number;
  frozen_at: number | null;
  sources: number;
  entities: number;
  relationships: number;
  validations: number;
  payload: string;
};

export type ShareRow = {
  token: string;
  session_id: string;
  user_id: string;
  created_at: number;
  payload: string;
};

export type LedgerRow = {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  session_id: string | null;
  created_at: number;
};

type StoreFile = {
  users: UserRow[];
  auth_sessions: AuthSessionRow[];
  research_sessions: ResearchSessionRow[];
  shares: ShareRow[];
  credit_ledger: LedgerRow[];
};

function emptyStore(): StoreFile {
  return {
    users: [],
    auth_sessions: [],
    research_sessions: [],
    shares: [],
    credit_ledger: [],
  };
}

function load(): StoreFile {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      ...emptyStore(),
      ...parsed,
      users: parsed.users ?? [],
      auth_sessions: parsed.auth_sessions ?? [],
      research_sessions: parsed.research_sessions ?? [],
      shares: parsed.shares ?? [],
      credit_ledger: parsed.credit_ledger ?? [],
    };
  } catch {
    return emptyStore();
  }
}

function save(store: StoreFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, DB_PATH);
}

export function mutate<T>(fn: (store: StoreFile) => T): T {
  const store = load();
  const result = fn(store);
  save(store);
  return result;
}

export function read<T>(fn: (store: StoreFile) => T): T {
  return fn(load());
}
