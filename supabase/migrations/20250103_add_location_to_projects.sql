ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS location TEXT;

-- Optional: Update existing rows to have a default location so the UI looks good immediately
UPDATE public.projects SET location = 'Mumbai, India' WHERE location IS NULL;
