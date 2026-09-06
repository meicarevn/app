-- Applied to production Supabase as migration v4_009e_private_wrapper_schema_usage.
-- The private schema is not exposed through PostgREST; authenticated callers still
-- need schema USAGE so public SECURITY INVOKER wrappers can invoke explicitly
-- granted private implementations.

grant usage on schema private to authenticated, service_role;
