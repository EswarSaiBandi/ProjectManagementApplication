-- ============================================================================
-- projects.project_type: TEXT → TEXT[] (multi-valued)
--
-- Reason: user asked for the Project Type field to accept multiple options.
--
-- Conversion rule:
--   * NULL             → '{}'::text[]
--   * ''               → '{}'::text[]
--   * 'A'              → ARRAY['A']
--   * 'A, B'           → ARRAY['A','B']   (comma-separated stored values)
--
-- Idempotent: will skip if already text[].
-- ============================================================================

DO $$
DECLARE
  v_udt_name TEXT;
  v_data_type TEXT;
BEGIN
  SELECT data_type, udt_name INTO v_data_type, v_udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'projects'
    AND column_name  = 'project_type';

  IF v_data_type = 'ARRAY' THEN
    RAISE NOTICE 'projects.project_type is already an array (%) — skipping conversion', v_udt_name;
  ELSE
    -- Drop any existing DEFAULT first. Postgres cannot auto-cast a text
    -- default expression to text[] during the type change.
    ALTER TABLE public.projects
      ALTER COLUMN project_type DROP DEFAULT;

    -- Convert text/varchar → text[] by splitting on comma.
    -- ALTER TABLE ... USING cannot contain a subquery, so we use the scalar
    -- regexp_split_to_array + array_remove combo:
    --   1. btrim trims leading/trailing whitespace from the whole string
    --   2. regexp_split_to_array splits on "optional ws , optional ws"
    --      (so "A, B , C" → {'A','B','C'} already trimmed)
    --   3. array_remove strips any empty slots that slipped through
    --      (e.g. trailing comma in "A,B," → {'A','B',''} → {'A','B'})
    ALTER TABLE public.projects
      ALTER COLUMN project_type TYPE TEXT[]
      USING CASE
        WHEN project_type IS NULL OR btrim(project_type) = '' THEN '{}'::TEXT[]
        ELSE array_remove(
          regexp_split_to_array(btrim(project_type), '\s*,\s*'),
          ''
        )
      END;

    -- Re-set the default as an empty text array now that the type is text[].
    ALTER TABLE public.projects
      ALTER COLUMN project_type SET DEFAULT '{}'::TEXT[];
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
