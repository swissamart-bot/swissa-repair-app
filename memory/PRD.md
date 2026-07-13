# Swissa Watch & Opticals - Repair Shop Management App v2.0

## Overview
Multi-item repair job management app for **SWISSA — Watch & Opticals**, Vadodara.

## Architecture
- **Frontend**: Expo React Native (SDK 54) with expo-router tabs
- **Database**: SQLite on mobile (2 tables: repair_jobs + repair_items + custom_phrases + app_config)
- **Backup**: Auto nightly (9 PM) + manual export/import
- **Offline-first**: No internet required

## v2.0 — Multi-Item Repair Jobs

### Data Structure
- **repair_jobs**: Customer info, advance, notes, job number
- **repair_items**: Item type, brand, model, description, phrases, photos, charges, status, delivery
- **custom_phrases**: User-managed phrases per item type
- **app_config**: Settings (Google review link, backup time, etc.)

### Migration
- Old single-item records auto-migrate to new format on first launch
- Each old record becomes a job with 1 item
- All data preserved (name, phone, photos, status, dates)
- Migration is idempotent and safe

### Features
1. **Multi-item repair jobs** — One customer can have multiple items (watches, spectacles, etc.)
2. **Expandable item cards** — Each item opens/closes independently
3. **Independent status per item** — 11 statuses: Received → Checking → ... → Ready → Delivered
4. **Partial delivery** — Deliver selected items while others remain active
5. **Charges per item** — Estimated, final, paid, balance per item + job totals
6. **Phrase checklist** — Default + custom phrases per item type, selectable per item
7. **Custom phrase management** — Add/delete phrases in Settings
8. **Google Review link** — Configurable in Settings, on/off toggle during delivery
9. **Item-wise WhatsApp messages** — Ready, delivery, receipt messages list items separately
10. **Search** — Name, phone, job#, brand, model, description, status
11. **Wall Clock** — New item type added
12. **CSV Export** — Export all customer data as Excel-compatible file

### Item Types
Watch, Spectacle, Goggle, Wall Clock

### Item Statuses
Received, Checking, Estimate Pending, Customer Approval Pending, Approved, Under Repair, Sent Outside, Parts Pending, Ready, Delivered, Cancelled

### Overall Job Status (auto-calculated)
- Completed: All items delivered
- Ready: All pending items are ready
- Partially Delivered: Some delivered, some pending
- In Progress: Otherwise
