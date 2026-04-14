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
- Full name, mobile number with 24+ country codes
- Item type: Watch / Spectacle / Goggle
- Issue/Fault description
- Photo capture (Camera/Gallery)
- Saves to local SQLite database
- Shows receipt after saving with WhatsApp sharing

### 2. Records Management (records.tsx)
- View all repair records
- Filter by status: All / Pending / Repaired / Delivered
- Search by name, phone, or item type
- Mark as Repaired (sends WhatsApp notification)
- Mark as Delivered (sends WhatsApp notification)
- **Multiple "Repaired" reminders** - can send WhatsApp reminders multiple times (not limited to once)
- Delete individual records or clear all
- View receipt for any record
- View full-size item photos

### 3. WhatsApp Promo Broadcast (promo.tsx)
- Compose promotional message
- Optional promo image
- Copy message to clipboard + open WhatsApp
- Shows unique customer numbers for broadcast list
- Copy numbers feature
- Instructions for WhatsApp Broadcast usage
- Works even if customer numbers aren't saved on phone (uses wa.me links)

### 4. Settings & Backup (settings.tsx)
- Record count display
- Last backup time
- Auto backup toggle (every 24 hours)
- Manual backup (export to JSON file)
- Import/Restore from backup file
- About section with shop info

## Key Design Decisions
- **Offline-first**: No internet required. All data stored locally on device.
- **No subscription dependency**: Works without Emergent subscription or any server.
- **Platform files**: `database.ts` (native SQLite) and `database.web.ts` (in-memory) for web/mobile compatibility.
- **Light professional theme**: Swiss & High-Contrast design with clean borders, #FAFAFA background.

## WhatsApp Integration
- Uses `Linking.openURL('https://wa.me/PHONE?text=MESSAGE')` 
- Works with unsaved numbers
- Pre-filled messages for: Receipt, Repaired notification, Delivery notification, Reminders, Promo broadcast

## Backup Strategy
- Auto backup: Checks on app launch, backs up if >24 hours since last backup
- Saves to app's document directory (SwissaBackups/)
- Manual export: Uses expo-sharing to let user save wherever they want
- Import: expo-document-picker to select JSON backup file
