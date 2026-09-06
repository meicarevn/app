-- V4_011B controlled rollback.
-- Use only if post-deployment acceptance fails or Founder A authorizes rollback.
-- This removes only the additive V4_011 read model; it does not mutate inventory truth.

drop view if exists public.inventory_intelligence_multi_axis_v4_011;
