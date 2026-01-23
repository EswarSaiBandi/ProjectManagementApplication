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

**Note:** Category is currently derived from `unit` field in frontend, not stored separately.

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
  └── client_updates (project_id)

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

---

## Migration History

1. **20250101_initial_schema.sql**: Initial schema creation
2. **20250102_fix_schema.sql**: Added columns to transactions table
3. **20250103_add_location_to_projects.sql**: Added location to projects
4. **20250104_add_comments_to_transactions.sql**: Added comments to transactions
5. **20250105_create_site_activities.sql**: Created site_activities table
6. **20260120_add_activity_details.sql**: Added description and dependencies to site_activities
7. **20260120_create_client_updates.sql**: Created client_updates table with RLS

---

## Notes

- All timestamps use `TIMESTAMP WITH TIME ZONE` for timezone-aware storage
- Foreign keys use `ON DELETE CASCADE` where appropriate to maintain referential integrity
- Row Level Security (RLS) is enabled on `client_updates` table
- Inventory quantities are calculated dynamically from approved PRs minus goods received
- Category field for materials is currently derived from `unit` field, not stored separately

