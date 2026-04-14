import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Image, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { getAllRecords } from '../src/database';
import { C, SHOP } from '../src/constants';
import { RepairRecord } from '../src/types';

const DEFAULT_PROMO = `🏪 *SWISSA — Watch & Opticals*\n\n🎉 Special Offer! 🎉\n\nVisit us for the best deals on watch repairs, spectacle fitting, and goggle services!\n\n📍 ${SHOP.address}\n\nCall us today! 🙏`;

export default function Promo() {
  const [message, setMessage] = useState(DEFAULT_PROMO);
  const [promoPhoto, setPromoPhoto] = useState<string | null>(null);
  const [customers, setCustomers] = useState<RepairRecord[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  const [uniqueNumbers, setUniqueNumbers] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);

  useFocusEffect(useCallback(() => { loadCustomers(); }, []));

  async function loadCustomers() {
    const data = await getAllRecords();
    setCustomers(data);
  }

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  async function handlePromoPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Gallery access is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
      if (!result.canceled && result.assets[0]?.base64) {
        setPromoPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch {
      showToastMsg('Gallery not available', true);
    }
  }

  async function startBroadcast() {
    if (!message.trim()) {
      showToastMsg('Please enter a promo message', true);
      return;
    }
    if (customers.length === 0) {
      showToastMsg('No customers in records', true);
      return;
    }

    // Get unique phone numbers
    const seen = new Set<string>();
    const numbers: string[] = [];
    for (const c of customers) {
      const clean = (c.countryCode + c.phone).replace(/\D/g, '');
      if (!seen.has(clean)) {
        seen.add(clean);
        numbers.push(clean);
      }
    }
    setUniqueNumbers(numbers);

    // Copy message to clipboard
    try {
      await Clipboard.setStringAsync(message);
      showToastMsg('Message copied to clipboard!');
    } catch {
      showToastMsg('Could not copy message', true);
    }

    setShowProgress(true);

    // Open WhatsApp
    try {
      await Linking.openURL('https://wa.me/');
    } catch {
      // WhatsApp might not be installed on web preview
    }
  }

  async function copyNumbers() {
    try {
      const text = uniqueNumbers.join('\n');
      await Clipboard.setStringAsync(text);
      showToastMsg('Numbers copied to clipboard!');
    } catch {
      showToastMsg('Could not copy numbers', true);
    }
  }

  async function copyMessage() {
    try {
      await Clipboard.setStringAsync(message);
      showToastMsg('Message copied to clipboard!');
    } catch {
      showToastMsg('Could not copy message', true);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Broadcast Promotion</Text>
          <Text style={s.headerSub}>Send a promotional message to ALL customers via WhatsApp</Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.label}>PROMO MESSAGE</Text>
            <TextInput testID="promo-message" style={s.textarea} value={message} onChangeText={setMessage}
              placeholder="Enter your promotional message..." placeholderTextColor={C.textMuted}
              multiline numberOfLines={6} textAlignVertical="top" />

            <Text style={[s.label, { marginTop: 20 }]}>PROMO PHOTO / VIDEO (OPTIONAL)</Text>
            {promoPhoto ? (
              <View style={s.photoWrap}>
                <Image source={{ uri: promoPhoto }} style={s.promoImg} />
                <TouchableOpacity testID="remove-promo-photo" style={s.removePhoto} onPress={() => setPromoPhoto(null)}>
                  <Ionicons name="close-circle" size={28} color={C.red} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity testID="add-promo-photo" style={s.photoPlaceholder} onPress={handlePromoPhoto}>
                <Ionicons name="images-outline" size={32} color={C.textMuted} />
                <Text style={s.photoPlaceholderText}>Tap to add promo image</Text>
              </TouchableOpacity>
            )}

            <View style={s.countRow}>
              <Ionicons name="people-outline" size={18} color={C.textMuted} />
              <Text testID="promo-count" style={s.countText}>{customers.length} customers in records</Text>
            </View>

            <TouchableOpacity testID="btn-broadcast" style={s.broadcastBtn} onPress={startBroadcast}>
              <Ionicons name="copy-outline" size={20} color={C.primaryFg} />
              <Text style={s.broadcastBtnText}>Copy Message & Open WhatsApp</Text>
            </TouchableOpacity>
          </View>

          {showProgress && (
            <View style={s.card}>
              <Text style={s.progressTitle}>Ready to send!</Text>
              <Text style={s.progressSub}>{uniqueNumbers.length} unique numbers</Text>

              <View style={s.numbersList}>
                {uniqueNumbers.map((num, i) => (
                  <Text key={i} style={s.numberItem}>{num}</Text>
                ))}
              </View>

              <TouchableOpacity testID="btn-copy-numbers" style={s.copyBtn} onPress={copyNumbers}>
                <Ionicons name="copy-outline" size={16} color={C.primary} />
                <Text style={s.copyBtnText}>Copy All Numbers</Text>
              </TouchableOpacity>

              <TouchableOpacity testID="btn-copy-message" style={s.copyBtn} onPress={copyMessage}>
                <Ionicons name="clipboard-outline" size={16} color={C.primary} />
                <Text style={s.copyBtnText}>Copy Message Again</Text>
              </TouchableOpacity>

              <View style={s.infoBox}>
                <Text style={s.infoTitle}>How it works (1-click broadcast)</Text>
                <Text style={s.infoStep}>1. Tap the button — your message is copied to clipboard automatically.</Text>
                <Text style={s.infoStep}>2. WhatsApp opens. Use <Text style={{ fontWeight: '700' }}>New Broadcast</Text> to add all your customers at once.</Text>
                <Text style={s.infoStep}>3. Paste the message and send.</Text>
                <Text style={[s.infoStep, { marginTop: 8 }]}>📸 WhatsApp Broadcast supports images natively. Attach the promo image inside the broadcast chat before sending.</Text>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {toast && (
        <View style={[s.toast, toast.err && s.toastErr]}>
          <Text style={s.toastText}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 24, fontWeight: '800', color: C.primary },
  headerSub: { fontSize: 13, color: C.textMuted, marginTop: 4, lineHeight: 18 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.5, marginBottom: 8 },
  textarea: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: C.text, minHeight: 140, textAlignVertical: 'top' },
  photoWrap: { position: 'relative', marginTop: 4 },
  promoImg: { width: '100%', height: 180, borderRadius: 10 },
  removePhoto: { position: 'absolute', top: 8, right: 8 },
  photoPlaceholder: { borderWidth: 1, borderColor: C.border, borderRadius: 10, borderStyle: 'dashed', paddingVertical: 28, alignItems: 'center', gap: 8, backgroundColor: C.bg },
  photoPlaceholderText: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 16 },
  countText: { fontSize: 14, color: C.textMuted, fontWeight: '600' },
  broadcastBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16 },
  broadcastBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  progressTitle: { fontSize: 18, fontWeight: '700', color: C.green800, marginBottom: 4 },
  progressSub: { fontSize: 13, color: C.textMuted, marginBottom: 12 },
  numbersList: { backgroundColor: C.bg, borderRadius: 8, padding: 12, marginBottom: 12 },
  numberItem: { fontSize: 14, color: C.text, fontWeight: '500', paddingVertical: 4, fontVariant: ['tabular-nums'] },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, marginBottom: 8 },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: C.primary },
  infoBox: { backgroundColor: '#F0F9FF', borderRadius: 10, padding: 16, marginTop: 8 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: C.blue, marginBottom: 8 },
  infoStep: { fontSize: 13, color: C.text, lineHeight: 20, marginBottom: 4 },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
