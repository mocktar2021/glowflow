-- GLOW-18: keep extension objects outside the exposed public schema.

create schema if not exists extensions;

alter extension btree_gist set schema extensions;
