import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite embutido no Node (node:sqlite): zero dependência nativa para instalar,
 * arquivo único em ./data e sobrevive a reinícios — atende ao requisito de
 * persistência sem pedir Docker/Postgres para rodar o desafio.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS employees (
      email TEXT PRIMARY KEY,
      data  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id              TEXT PRIMARY KEY,
      requester_email TEXT NOT NULL,
      data            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_email);

    CREATE TABLE IF NOT EXISTS kb_articles (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sequences (
      name  TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency (
      key        TEXT PRIMARY KEY,
      response   TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
