# Material Movement & Inventory Flow Analysis

## Executive Summary

The system implements a **dual-source inventory model** with real-time tracking across projects and stores. Materials can flow from two sources (In-Store vs Market Purchase) to multiple projects, with comprehensive audit trails and automatic stock reconciliation.

---

## 1. Core Architecture

### Two Inventory Sources
```
┌─────────────────────────────────────────┐
│      MATERIAL MASTER (Global)           │
│  ├─ in_store_quantity                   │
│  ├─ market_purchase_quantity            │
│  └─ total_quantity_computed (sum)       │
└────────────┬────────────────────────────┘
             │
        ┌────┴────┐
        │          │
   [In-Store]  [Market Purchase]
   Source       Source
```

---

## 2. Main Data Entities & Flow

### A. **Material Master** (Global Registry)
**Table:** `materials_master`
- Central registry of all material types
- Each material has metric (Litres, Kgs, Tonnes, Sqft, Metres, Units, Pieces, Boxes, Bags)
- Status: Active/Inactive

**Table:** `material_variants`
- Size/packaging variants of a material
- Example: Same "Cement" material → "50kg Bag", "25kg Bag" variants
- Each variant has quantity_per_unit (e.g., 50 for 50kg bag)

---

### B. **Store Inventory** (Warehouse/Central Store)
**Table:** `store_inventory`
```
inventory_id | material_id | variant_id | number_of_units | total_quantity
─────────────┼─────────────┼────────────┼─────────────────┼────────────────
      1      |      10     |      1     |        5        |      100       (5 units × 20L = 100L)
      2      |      10     |      2     |       10        |      100       (10 units × 10L = 100L)
```
- Tracks **physical units** (how many cans/bags/boxes)
- Tracks **total quantity** (computed: units × quantity_per_unit)
- Location-aware storage
- Updates: Automatic on issues/returns or manual entry

---

### C. **Material Allocation** (Project-Level Stock)
**Table:** `material_allocations`
```
allocation_id | project_id | material_id | allocated_qty | issued_qty | returned_qty | source_type
──────────────┼────────────┼─────────────┼───────────────┼────────────┼──────────────┼─────────────
      1       |     5      |      10     |       50      |     30     |       5      | In-Store
      2       |     5      |      10     |       50      |     40     |       0      | Market Purchase
```
- **Allocated:** Total approved for project
- **Issued:** Actually consumed/used
- **Returned:** Unused material sent back to store
- **Source Type:** Tracks origin (In-Store vs Market Purchase)

---

### D. **Material Movements** (Complete Audit Trail)
**Table:** `material_movements`
```
movement_id | type    | sub_type    | material_id | project_id | quantity | unit_cost | total_cost | source_type
────────────┼─────────┼─────────────┼─────────────┼────────────┼──────────┼───────────┼────────────┼─────────────
      1     | Inward  | Purchase    |      10     |    NULL    |    100   |   1.50    |   150.00   | In-Store
      2     | Outward | Issue       |      10     |      5     |     30   |   1.50    |    45.00   | In-Store
      3     | Inward  | Excess Return|     10     |      5     |      5   |   1.50    |     7.50   | In-Store
```
- **Types:** Inward (into store) / Outward (from store)
- **Sub-Types:**
  - `Purchase` — stock received from supplier
  - `Purchase Return` — unused stock returned to supplier
  - `Issue` — allocated to project
  - `Utilization` — consumed on site
  - `Excess Return` — unused allocation returned to store
  - `Adjustment` — manual correction
- **Cost Tracking:** unit_cost × quantity = total_cost (for project costing)

---

### E. **Material Requests** (Approval Workflow)
**Table:** `material_requests`
```
request_id | project_id | material_id | requested_qty | status    | request_source | approved_by
────────────┼────────────┼─────────────┼───────────────┼───────────┼────────────────┼─────────────
      1     |      5     |      10     |       50      | Approved  | Store          | user_123
      2     |      5     |      15     |       25      | Pending   | Local Procurement| NULL
```
- **Status Workflow:** Pending → Approved/Rejected → Fulfilled
- **Request Source:** Store vs Local Procurement
- **Approval:** Admin/PM must approve before fulfillment
- **Fulfillment Tracking:** How much was actually issued

---

### F. **Material Returns** (Project → Store)
**Table:** `material_returns`
```
return_id | project_id | material_id | returned_qty | condition | status   | reviewed_by
───────────┼────────────┼─────────────┼──────────────┼───────────┼──────────┼─────────────
     1    |      5     |      10     |       10     | Good      | Accepted | user_456
     2    |      5     |      15     |        5     | Damaged   | Rejected | user_456
```
- **Condition Assessment:** Excellent/Good/Fair/Damaged/Unusable
- **Status:** Pending → Accepted/Rejected (store approval)
- **Impact:** Accepted returns increase store stock automatically

---

### G. **Material Movement Logs** (Complete History)
**Table:** `material_movement_logs`
```
log_id | material_id | project_id | movement_type    | quantity | reference_type     | movement_date
────────┼─────────────┼────────────┼──────────────────┼──────────┼────────────────────┼───────────────
    1  |      10     |    NULL    | Store In         |    100   | Initial Stock      | 2026-04-01
    2  |      10     |      5     | Project Out      |     30   | Material Request   | 2026-04-05
    3  |      10     |      5     | Return to Store  |      5   | Material Return    | 2026-04-10
```
- Immutable audit trail
- Reference to source (Request/Return/Manual)
- Complete visibility for compliance

---

## 3. Stock Flow Scenarios

### Scenario 1: Allocate In-Store Material to Project
```
User (Project Manager)
    ↓
Requests material from store (material_requests table)
    ↓
Admin/PM approves request
    ↓
[TRIGGER] request_fulfillment_items created
    ↓
[TRIGGER] material_movements created (Outward/Issue)
    ↓
[TRIGGER] material_allocations updated (issued_quantity +)
    ↓
[TRIGGER] update_stock_on_movement() fired
    ↓
store_inventory.total_quantity -= issued_amount
inventory_realtime_status view updates
    ↓
Frontend Dashboard shows:
- In-Store Available ↓
- Project Allocated ↑
- Total Available ↓
```

**SQL Functions Involved:**
- `update_stock_by_source()` — subtracts from in_store_quantity
- `check_available_stock_by_source()` — real-time available computation
- `create_movement_on_issue()` — auto-logs the movement
- RLS: authenticated users can see their project allocations

---

### Scenario 2: Project Returns Unused Material
```
Project Supervisor
    ↓
Creates material_return record (condition: Good/Fair/Damaged)
    ↓
Store Manager reviews
    ↓
If "Accepted":
    [TRIGGER] auto_reclassify_market_purchase_excess()
    ↓
    If source was "Market Purchase":
      - Add to in_store_quantity
      - Subtract from market_purchase_quantity
      - Notes: "[Auto-reclassified from Market Purchase to In-Store]"
    ↓
    [TRIGGER] material_movements created (Inward/Excess Return)
    ↓
    [TRIGGER] update_stock_on_movement() fired
    ↓
    store_inventory.total_quantity += returned_amount
    
If "Rejected":
    - No stock update
    - material_returns.status = 'Rejected'
    - Reason logged in review_notes
```

**Impact:**
- In-Store Available ↑
- Market Purchase Available ↓ (if reclassified)
- Total Available ↑
- Allocation remains but usage tracking updates

---

### Scenario 3: Market Purchase Excess Becomes In-Store Stock
```
Allocation marked as complete but qty remains
    ↓
excess_materials table row created
    ↓
[TRIGGER] create_movement_on_excess_return() fired
    ↓
Material becomes "Available" in excess table
    ↓
[TRIGGER] auto_reclassify_market_purchase_excess() fired
    ↓
If market_purchase source:
    - Add quantity to in_store_quantity
    - Subtract from market_purchase_quantity
    - Creates INWARD movement with "Excess Return" sub_type
    ↓
Stock automatically shifts from "Market Purchase" bucket to "In-Store" bucket
    ↓
Real-time inventory view updates:
  - market_purchase_available ↓
  - in_store_available ↑
```

**Use Case:** Material ordered from market that wasn't needed becomes store inventory for future projects

---

## 4. Real-Time Inventory View

**View:** `inventory_realtime_status`
```sql
SELECT 
  material_id,
  material_name,
  in_store_quantity,
  market_purchase_quantity,
  total_quantity = in_store + market,
  
  -- Allocated across ALL projects (by source)
  in_store_allocated = SUM(allocated_qty) WHERE source='In-Store',
  market_allocated = SUM(allocated_qty) WHERE source='Market Purchase',
  
  -- Available (inventory - allocated)
  in_store_available = in_store_quantity - in_store_allocated,
  market_available = market_purchase_quantity - market_allocated,
  total_available = total_quantity - (in_store_allocated + market_allocated),
  
  -- Project breakdown (JSON array)
  project_allocations = [
    {project_id, project_name, allocated, source},
    ...
  ]
FROM materials_master;
```

**Frontend Usage (InventoryTab.tsx):**
```javascript
const [inventory, setInventory] = useState<InventoryItem[]>([]);

const fetchInventory = async () => {
  const { data, error } = await supabase
    .from('inventory_realtime_status')
    .select('*')
    .order('material_name');
  
  setInventory(data); // Auto-updates every 10 seconds
};
```

---

## 5. Cost Tracking & Project Costing

**Integration with Project Costing:**

Each movement stores `unit_cost` and `total_cost`:
```sql
INSERT INTO material_movements (
  material_id, project_id, quantity, unit_cost,
  total_cost  -- Generated as: quantity * unit_cost STORED
)
```

**Project Cost Ledger Integration:**
- Movements with movement_type='Outward' represent project material costs
- Rolled up into `project_cost_ledger` for P&L
- Expense type determined by allocation source:
  - In-Store → "Material from Inventory"
  - Market Purchase → "Material Procurement"

---

## 6. Concurrent Access & Safety

### Triggers Ensure Consistency
1. **`trg_create_movement_on_issue`**
   - When allocation.issued_quantity increases → auto-create OUTWARD movement
   - Prevents manual double-entry

2. **`trg_update_stock_on_allocation`**
   - When allocation.issued_quantity increases → subtract from store_inventory
   - When allocation.returned_quantity increases → add back to store_inventory

3. **`trg_update_stock_on_movement`**
   - When material_movements row inserted → update store_inventory quantities
   - Auto-handles INWARD/OUTWARD logic

### RLS Policies
```sql
-- All authenticated users can read movements
CREATE POLICY "material_movements_select_auth"
ON material_movements FOR SELECT
TO authenticated USING (true);

-- All can insert (but trigger validates)
CREATE POLICY "material_movements_insert_auth"
ON material_movements FOR INSERT
TO authenticated WITH CHECK (true);
```

---

## 7. Key Business Rules

| Rule | Implementation |
|------|---|
| **Prevent over-allocation** | `check_available_stock_by_source()` computed real-time |
| **Prevent negative inventory** | `GREATEST(0, quantity - used)` in stock updates |
| **Track actual vs allocated** | Separate `allocated_quantity` vs `issued_quantity` columns |
| **Auto-classify excess** | `auto_reclassify_market_purchase_excess()` trigger |
| **Audit trail** | All movements logged to `material_movement_logs` |
| **Cost attribution** | `unit_cost` captured per movement for project costing |
| **Return condition tracking** | `condition` field documents return quality |
| **Approval workflow** | Status gates (`Pending → Approved → Fulfilled`) |

---

## 8. Current Data Volumes

Based on migrations (Feb 2026 → now):
- **Materials Master:** ~50-100 material types
- **Allocations per project:** 5-20 per project
- **Movements per project:** 20-50 (allocation + returns + adjustments)
- **Total movements:** 1000+ for platform (across all projects)

---

## 9. Potential Improvements / Issues

### ✅ Strong Points
- Dual-source tracking (In-Store vs Market Purchase)
- Real-time availability computation
- Automatic cost attribution for project P&L
- Complete audit trail
- RLS for data isolation

### ⚠️ Areas to Review
1. **No physical stock count validation** — system is ledger-based; no integration with actual warehouse counts
2. **Excess material classification** — relies on `auto_reclassify_*` trigger; if a project manager forgets to mark excess, it stays in Market Purchase bucket
3. **No low-stock alerts** — threshold-based notifications not visible in schema
4. **Supplier return tracking** — `Purchase Return` sub_type exists but no dedicated supplier returns workflow
5. **Material damage/wastage** — only tracked in `material_returns.condition`, not separately costed

---

## 10. Example Flow: End-to-End

**Day 1:** Store receives 100L of Cement (in 5x20L bags)
```sql
INSERT INTO store_inventory (material_id, variant_id, number_of_units, total_quantity, location)
VALUES (10, 1, 5, 100, 'Warehouse A');

INSERT INTO material_movements (movement_type, sub_type, material_id, quantity, unit_cost, source_type)
VALUES ('Inward', 'Purchase', 10, 100, 1.50, 'In-Store');
-- ↓ Trigger fires
-- UPDATE material_master SET in_store_quantity = 100 WHERE material_id = 10;
```

**Day 2:** Project 5 requests 30L
```sql
INSERT INTO material_requests (project_id, material_id, requested_qty, request_source, status)
VALUES (5, 10, 30, 'Store', 'Pending');
-- ↓ Admin approves
UPDATE material_requests SET status = 'Approved' WHERE request_id = 1;
-- ↓ Frontend triggers fulfillment
INSERT INTO request_fulfillment_items (request_id, variant_id, units_issued, quantity_issued, issued_by)
VALUES (1, 1, 2, 40, user_uuid); -- 2 bags × 20L = 40L (overfulfilled slightly)
-- ↓ Triggers fire:
INSERT INTO material_allocations (project_id, material_id, allocated_qty, issued_qty, source_type)
VALUES (5, 10, 30, 40, 'In-Store');
INSERT INTO material_movements (movement_type, sub_type, quantity, unit_cost, reference_id)
VALUES ('Outward', 'Issue', 40, 1.50, allocation_id);
-- UPDATE material_master SET in_store_quantity = 60 WHERE material_id = 10;
```

**Day 5:** Project returns 5L (excess)
```sql
INSERT INTO material_returns (project_id, material_id, returned_qty, condition, status)
VALUES (5, 10, 5, 'Good', 'Pending');
-- ↓ Store approves
UPDATE material_returns SET status = 'Accepted', reviewed_by = admin_uuid;
-- ↓ Triggers fire:
INSERT INTO material_movements (movement_type, sub_type, quantity, reference_id)
VALUES ('Inward', 'Excess Return', 5, return_id);
-- UPDATE material_master SET in_store_quantity = 65 WHERE material_id = 10;
```

**Real-Time Dashboard Shows:**
```
Material: Cement (10L)
├─ In-Store Stock: 65L
├─ In-Store Allocated: 25L (only allocation remains after return)
├─ In-Store Available: 40L
├─ Market Purchase: 0L
└─ Total Available: 40L

Project Allocations:
├─ Project 5: 25L (In-Store, from 30L allocated, 40L issued, 5L returned)
```

---

## Summary Table

| Entity | Purpose | Key Tracking |
|--------|---------|---|
| `materials_master` | Global material registry | Name, metric, status |
| `material_variants` | Packaging sizes | Size/unit mapping |
| `store_inventory` | Physical warehouse stock | Units, total quantity, location |
| `material_allocations` | Project-level stock booking | Allocated/Issued/Returned split by source |
| `material_movements` | Ledger of all stock changes | Inward/Outward with cost, audit trail |
| `material_requests` | Approval workflow for allocation | Status, approval chain |
| `material_returns` | Project returns to store | Condition, acceptance, reclassification |
| `material_movement_logs` | Immutable history | Complete audit trail |
| `inventory_realtime_status` | Real-time materialized view | Available quantity, allocations, project breakdown |
