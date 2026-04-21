import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = process.env.DATABASE_URL ?? "./anton.db";
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

console.log(`[migrate] applying migrations to ${dbPath}`);
migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log("[migrate] done");
sqlite.close();
