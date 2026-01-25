# Database Schema Documentation

## Complete Database Schema

### 1. **profiles** (User Profiles)
Stores user profile information linked to Supabase Auth.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY, REFERENCES auth.users(id) | User ID from Supabase Auth |
| `full_name` | TEXT | | User's full name |
| `role` | TEXT | CHECK: 'Admin', 'ProjectManager', 'SiteSupervisor', 'Client', 'Vendor' | User role |
| `phone` | TEXT | | Phone number |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |

---

### 2. **projects** (Projects)
Main project information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `project_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique project identifier |
| `project_name` | TEXT | NOT NULL | Project name |
| `client_id` | UUID | REFERENCES profiles(user_id) | Client user ID |
| `start_date` | DATE | | Project start date |
| `status` | TEXT | CHECK: 'Planning', 'Execution', 'Handover', 'Completed' | Project status |
| `location` | TEXT | | Project location (added in migration 20250103) |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |

---

### 3. **activities** (Planning Activities)
Project planning activities.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `activity_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique activity identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) | Associated project |
| `name` | TEXT | NOT NULL | Activity name |
| `start_date` | DATE | | Activity start date |
| `internal_duration_days` | INT | | Internal duration in days |
| `client_buffer_days` | INT | | Client buffer days |
| `completion_percentage` | INT | DEFAULT 0 | Completion percentage (0-100) |
| `status` | TEXT | DEFAULT 'Not Started' | Activity status |

---

### 4. **site_updates** (Site Progress Updates)
Site progress updates with evidence.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `update_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique update identifier |
| `activity_id` | BIGINT | REFERENCES activities(activity_id) | Associated activity |
| `reported_by` | UUID | REFERENCES profiles(user_id) | User who reported |
| `audio_url` | TEXT | | Link to Supabase Storage 'audio-logs' bucket |
| `transcript_text` | TEXT | | Audio transcript |
| `remarks` | TEXT | | Additional remarks |
| `progress_claimed_pct` | INT | | Claimed progress percentage |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |

---

### 5. **material_master** (Inventory Materials)
Master list of materials/items.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `material_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique material identifier |
| `item_name` | TEXT | NOT NULL | Material/item name |
| `unit` | TEXT | | Unit of measurement (e.g., kg, units, bags) |
| `quantity` | NUMERIC | DEFAULT 0, NOT NULL | Current stock quantity (manually maintained) |

**Note:** Category is currently derived from `unit` field in frontend, not stored separately.

---

### 5b. **project_manpower** (Project Manpower)
Tracks manpower allocation per project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Row identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `role` | TEXT | NOT NULL | Role (e.g., Mason, Carpenter) |
| `headcount` | INT | DEFAULT 1, NOT NULL | Number of people |
| `start_date` | DATE | | Start date |
| `end_date` | DATE | | End date |
| `rate_per_day` | NUMERIC(12,2) | | Cost per day |
| `notes` | TEXT | | Notes |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW(), NOT NULL | Created timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW(), NOT NULL | Updated timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator |

**RLS Policies:** Enabled with authenticated read/write.

---

### 5c. **project_checklist_items** (Project Checklists)
Checklist items scoped to a project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Row identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `title` | TEXT | NOT NULL | Checklist item title |
| `description` | TEXT | | Optional description |
| `status` | TEXT | DEFAULT 'Pending', CHECK: 'Pending','In Progress','Done' | State |
| `due_date` | DATE | | Optional due date |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW(), NOT NULL | Created timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW(), NOT NULL | Updated timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator |

**RLS Policies:** Enabled with authenticated read/write.

---

### 6. **purchase_requests** (Purchase Requests)
Purchase request headers.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `pr_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique PR identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) | Associated project |
| `requester_id` | UUID | REFERENCES profiles(user_id) | User who requested |
| `status` | TEXT | CHECK: 'Pending', 'Approved', 'Rejected' | PR status |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |

---

### 7. **pr_items** (Purchase Request Items)
Individual items in purchase requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `item_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique item identifier |
| `pr_id` | BIGINT | REFERENCES purchase_requests(pr_id) | Parent PR |
| `material_id` | BIGINT | REFERENCES material_master(material_id) | Material reference |
| `requested_qty` | DECIMAL | | Requested quantity |
| `approved_qty` | DECIMAL | | Approved quantity (edited by PM) |

---

### 8. **goods_received** (Goods Received Notes)
Records of goods received against purchase requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `grn_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique GRN identifier |
| `pr_id` | BIGINT | REFERENCES purchase_requests(pr_id) | Associated PR |
| `received_by` | UUID | REFERENCES profiles(user_id) | User who received |
| `received_date` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Receipt timestamp |

---

### 9. **transactions** (Financial Transactions)
Financial transactions (credits and debits).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `transaction_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique transaction identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) | Associated project |
| `type` | TEXT | CHECK: 'Credit', 'Debit' | Transaction type |
| `category` | TEXT | CHECK: 'ClientPayment', 'VendorPayment', 'LabourPayout' | Transaction category |
| `amount` | DECIMAL(15,2) | | Transaction amount |
| `payment_channel` | TEXT | | Payment method (UPI, NEFT, Cash) |
| `receipt_url` | TEXT | | Link to Supabase Storage 'documents' bucket |
| `transaction_date` | DATE | | Transaction date |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp (added in migration 20250102) |
| `created_by_name` | TEXT | | Creator name (added in migration 20250102) |
| `vendor_name` | TEXT | | Vendor name (added in migration 20250102) |
| `description` | TEXT | | Transaction description (added in migration 20250102) |
| `user_name` | TEXT | | User name (added in migration 20250102) |
| `order_reference` | TEXT | | Order reference (added in migration 20250102) |
| `comments` | TEXT | | Additional comments (added in migration 20250104) |

---

### 10. **site_activities** (Site Activities/Schedule)
Site activities and schedule events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `activity_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique activity identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE | Associated project |
| `activity_name` | TEXT | NOT NULL | Activity name |
| `start_date` | DATE | NOT NULL | Start date |
| `end_date` | DATE | NOT NULL | End date |
| `tag` | TEXT | | Category tag ('Site Work', 'Civil', 'Electrical', etc.) |
| `owner` | TEXT | | Activity owner/assignee |
| `progress` | INT | DEFAULT 0 | Progress percentage (0-100) |
| `status` | TEXT | DEFAULT 'Pending' | Activity status |
| `description` | TEXT | | Activity description (added in migration 20260120) |
| `dependencies` | TEXT | | Activity dependencies (added in migration 20260120) |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |

---

### 10b. **activity_logs** (Activity History)
Audit/history records for site activity updates.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `log_id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Log identifier |
| `activity_id` | BIGINT | REFERENCES site_activities(activity_id) ON DELETE CASCADE, NOT NULL | Activity |
| `previous_progress` | INT | | Previous progress |
| `new_progress` | INT | | New progress |
| `comment` | TEXT | | Remarks |
| `user_name` | TEXT | | User display name |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Created timestamp |

**RLS Policies:** Enabled with authenticated read/write.

---

### 11. **client_updates** (Client Progress Updates)
Client-facing progress updates with images.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique update identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `image_url` | TEXT | | Image URL |
| `description` | TEXT | | Update description |
| `date` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW(), NOT NULL | Update date |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW(), NOT NULL | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Row Level Security enabled with policies for authenticated users (read, insert, update, delete).

---

### 12. **project_notes** (Project Notes)
Free-form notes scoped to a project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Note identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `title` | TEXT | NOT NULL | Note title |
| `body` | TEXT | | Note content |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 13. **project_tasks** (Project Tasks)
Lightweight task tracking scoped to a project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Task identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `title` | TEXT | NOT NULL | Task title |
| `description` | TEXT | | Task description |
| `status` | TEXT | DEFAULT 'Todo', CHECK: 'Todo','In Progress','Done' | Task status |
| `priority` | TEXT | DEFAULT 'Medium' | Low / Medium / High |
| `due_date` | DATE | | Due date |
| `assignee_name` | TEXT | | Assignee (name/text for now) |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Last update timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 14. **project_files** (Project Files - Metadata)
Metadata for project-related documents stored in Supabase Storage.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | File identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `bucket` | TEXT | DEFAULT 'documents', NOT NULL | Storage bucket |
| `object_path` | TEXT | NOT NULL | Storage object path |
| `file_name` | TEXT | NOT NULL | Original file name |
| `mime_type` | TEXT | | MIME type |
| `size_bytes` | BIGINT | | Size in bytes |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Uploader user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 15. **project_moodboard_items** (Moodboard)
Moodboard images stored in Supabase Storage and referenced per project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Item identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `title` | TEXT | | Optional label/title |
| `bucket` | TEXT | DEFAULT 'documents', NOT NULL | Storage bucket |
| `image_path` | TEXT | NOT NULL | Storage object path |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 16. **project_quotes** (Quotes)
Header-level quotes per project (line items can be added later).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Quote identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `quote_number` | TEXT | | Quote reference number |
| `vendor_name` | TEXT | | Vendor |
| `title` | TEXT | | Quote title |
| `total_amount` | NUMERIC(15,2) | DEFAULT 0 | Total amount |
| `status` | TEXT | DEFAULT 'Draft' | Draft / Sent / Approved / Rejected |
| `issued_date` | DATE | | Issued date |
| `notes` | TEXT | | Notes |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 17. **project_orders** (Orders)
Header-level orders per project (line items can be added later).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Order identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `order_number` | TEXT | | Order reference number |
| `vendor_name` | TEXT | | Vendor |
| `title` | TEXT | | Order title |
| `total_amount` | NUMERIC(15,2) | DEFAULT 0 | Total amount |
| `status` | TEXT | DEFAULT 'Draft' | Draft / Placed / Delivered / Cancelled |
| `order_date` | DATE | | Order date |
| `notes` | TEXT | | Notes |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

### 18. **project_invoices** (Invoices)
Header-level invoices per project (line items can be added later).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PRIMARY KEY, AUTO INCREMENT | Invoice identifier |
| `project_id` | BIGINT | REFERENCES projects(project_id) ON DELETE CASCADE, NOT NULL | Associated project |
| `invoice_number` | TEXT | | Invoice number |
| `counterparty_name` | TEXT | | Client or vendor |
| `title` | TEXT | | Invoice title |
| `total_amount` | NUMERIC(15,2) | DEFAULT 0 | Total amount |
| `status` | TEXT | DEFAULT 'Draft' | Draft / Sent / Paid / Overdue / Cancelled |
| `issued_date` | DATE | | Issued date |
| `due_date` | DATE | | Due date |
| `notes` | TEXT | | Notes |
| `created_at` | TIMESTAMP WITH TIME ZONE | DEFAULT NOW() | Creation timestamp |
| `created_by` | UUID | REFERENCES auth.users(id) | Creator user ID |

**RLS Policies:** Enabled with authenticated read/write.

---

## Relationships Summary

```
profiles (user_id)
  ├── projects (client_id)
  ├── purchase_requests (requester_id)
  ├── goods_received (received_by)
  └── site_updates (reported_by)

projects (project_id)
  ├── activities (project_id)
  ├── purchase_requests (project_id)
  ├── transactions (project_id)
  ├── site_activities (project_id)
  ├── client_updates (project_id)
  ├── project_notes (project_id)
  ├── project_tasks (project_id)
  ├── project_files (project_id)
  ├── project_moodboard_items (project_id)
  ├── project_quotes (project_id)
  ├── project_orders (project_id)
  └── project_invoices (project_id)

material_master (material_id)
  └── pr_items (material_id)

purchase_requests (pr_id)
  ├── pr_items (pr_id)
  └── goods_received (pr_id)

activities (activity_id)
  └── site_updates (activity_id)
```

---

## Storage Buckets (Supabase Storage)

- **audio-logs**: Audio recordings for site updates
- **documents**: Receipts and transaction documents
- **receipts**: Receipt storage (configured in setup_receipts_storage.sql)
  - Used by project modules like **Files** and **Moodboard** in the web app (paths stored in `project_files` / `project_moodboard_items`)

---

## Migration History

1. **20250101_initial_schema.sql**: Initial schema creation
2. **20250102_fix_schema.sql**: Added columns to transactions table
3. **20250103_add_location_to_projects.sql**: Added location to projects
4. **20250104_add_comments_to_transactions.sql**: Added comments to transactions
5. **20250105_create_site_activities.sql**: Created site_activities table
6. **20260120_add_activity_details.sql**: Added description and dependencies to site_activities
7. **20260121_create_client_updates.sql**: Created client_updates table with RLS

---

## Notes

- All timestamps use `TIMESTAMP WITH TIME ZONE` for timezone-aware storage
- Foreign keys use `ON DELETE CASCADE` where appropriate to maintain referential integrity
- Row Level Security (RLS) is enabled on `client_updates` table
- Inventory quantities are calculated dynamically from approved PRs minus goods received
- Category field for materials is currently derived from `unit` field, not stored separately

