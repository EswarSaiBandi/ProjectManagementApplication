-- 1. Add missing columns to transactions table to match the Frontend
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS created_by_name TEXT,
ADD COLUMN IF NOT EXISTS vendor_name TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS user_name TEXT,
ADD COLUMN IF NOT EXISTS order_reference TEXT;

-- 2. Insert a dummy Project with ID=1 (if not exists) so the foreign key works
INSERT INTO public.projects (project_id, project_name, status)
VALUES (1, 'Hiranandani B1705', 'Planning')
ON CONFLICT (project_id) DO NOTHING;
