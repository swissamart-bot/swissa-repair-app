# Swissa Watch & Opticals - Repair Shop Management App

## Overview
A fully offline repair shop management mobile app for **SWISSA — Watch & Opticals**, located at 29, Bombay Shopping Centre, Nr. Ambedkar Circle, Racecourse, Alkapuri, Vadodara.

## Architecture
- **Frontend**: Expo React Native (SDK 54) with expo-router tabs navigation
- **Database**: SQLite (expo-sqlite) on mobile, in-memory on web
- **Backend**: Minimal FastAPI health check (app is offline-first, no server dependency)
- **Backup**: Auto nightly + manual export/import

## Features

### 1. New Customer Entry (index.tsx)
- **Pick from Contacts** - Select customer directly from phone contacts
- Full name, mobile number with 24+ country codes
- Item type: Watch / Spectacle / Goggle
- Issue/Fault description
- Photo capture (Camera/Gallery)
- **5-digit Job ID** (max 5 numbers)
- Saves to local SQLite database
- Shows receipt after saving with WhatsApp sharing

### 2. Records Management (records.tsx)
- View all repair records with Job ID displayed
- Filter by status: All / Pending / Repaired / Delivered
- **Search by name, phone, item, AND job ID**
- **Edit records** - Edit name, phone, item type, issue via modal
- Mark as Repaired (sends WhatsApp notification with multilingual delivery message)
- Mark as Delivered (sends WhatsApp notification)
- **Multiple "Repaired" reminders** - can send WhatsApp reminders unlimited times
- Delete individual records
- View receipt for any record
- View full-size item photos
- No "Clear All" button (moved to Settings for safety)

### 3. Settings & Backup (settings.tsx)
- Record count display
- Last backup time
- Auto backup toggle (every 24 hours)
- Manual backup (export to JSON file, share to Google Drive/WhatsApp/Downloads)
- Import/Restore from backup file
- **Clear All Records** in Danger Zone with double confirmation
- About section with shop info

### 4. WhatsApp Messages
- **Repaired message includes:**
  - Multilingual text (English, Gujarati, Hindi) about collecting belongings within 7 days
  - "SHOW THIS MESSAGE WHILE TAKING DELIVERY"
  - "SHARE THIS MESSAGE ONLY TO TRUSTED PEOPLE FOR TAKING DELIVERY"
- Reminder messages (can be sent multiple times)
- Receipt sharing
- All messages work with unsaved numbers via wa.me links

### Removed Features
- Promo tab removed (as per user request)

## Navigation
- **3 tabs only**: New, Records, Settings
- Tab bar positioned with extra padding to avoid overlapping Android navigation buttons

## Key Design Decisions
- **Offline-first**: No internet required
- **No subscription dependency**: Works without any server
- **Light professional theme**: Swiss & High-Contrast design
- **edgeToEdgeEnabled disabled** on Android to prevent tab bar overlap
