-- Migration 004: Add twitter_username for Twitter lead deduplication
-- Run in Supabase SQL editor: Dashboard → SQL Editor → paste & run

alter table leads
  add column if not exists twitter_username text;

create index if not exists leads_twitter_username_idx on leads (twitter_username)
  where twitter_username is not null;

create index if not exists leads_linkedin_url_idx on leads (linkedin_url)
  where linkedin_url is not null;
