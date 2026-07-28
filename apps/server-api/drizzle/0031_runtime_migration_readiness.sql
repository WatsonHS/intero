DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_app') THEN
    GRANT USAGE ON SCHEMA drizzle TO intero_app;
    GRANT SELECT ON drizzle.__drizzle_migrations TO intero_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intero_worker') THEN
    GRANT USAGE ON SCHEMA drizzle TO intero_worker;
    GRANT SELECT ON drizzle.__drizzle_migrations TO intero_worker;
  END IF;
END
$$;
