-- Migration 003: Add external_url (bio link) to leads for SF website matching
-- Run in Supabase SQL editor: Dashboard → SQL Editor → paste & run

alter table leads
  add column if not exists external_url text;
