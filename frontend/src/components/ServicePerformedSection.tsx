import React, { useCallback, useMemo, useState, memo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList,
  StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../constants';
import { appendDiagnosisPhrases } from '../types';
import { getServicePhrasesForItem } from '../database';

interface ServicePhrase {
  id: string;
  phrase: string;
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  itemType: string;
  compact?: boolean;
  testID?: string;
}

const PhraseCheckRow = memo(function PhraseCheckRow({
  phrase,
  selected,
  onToggle,
}: {
  phrase: ServicePhrase;
  selected: boolean;
  onToggle: (p: ServicePhrase) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkRow}
      onPress={() => onToggle(phrase)}
      activeOpacity={0.7}
      testID={`service-phrase-${phrase.id}`}
    >
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={28}
        color={selected ? C.primary : C.textMuted}
      />
      <Text style={styles.checkPhrase}>{phrase.phrase}</Text>
    </TouchableOpacity>
  );
});

export default function ServicePerformedSection({
  value, onChange, itemType, compact, testID,
}: Props) {
  const [showInsert, setShowInsert] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listPhrases, setListPhrases] = useState<ServicePhrase[]>([]);
  const [allPhrases, setAllPhrases] = useState<ServicePhrase[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMap, setSelectedMap] = useState<Record<string, ServicePhrase>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedMap({});
  }, []);

  const closePopup = useCallback(() => {
    setShowInsert(false);
    clearSelection();
    setSearch('');
  }, [clearSelection]);

  const loadPhrases = useCallback(async () => {
    setLoadingList(true);
    try {
      const rows = await getServicePhrasesForItem(itemType);
      // Unique wording (case-insensitive)
      const seen = new Set<string>();
      const merged: ServicePhrase[] = [];
      for (const p of rows) {
        const key = p.phrase.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push({ id: p.id, phrase: p.phrase });
      }
      setAllPhrases(merged);
      setListPhrases(merged);
    } catch {
      setAllPhrases([]);
      setListPhrases([]);
    } finally {
      setLoadingList(false);
    }
  }, [itemType]);

  const openInsert = useCallback(async () => {
    clearSelection();
    setSearch('');
    setShowInsert(true);
    await loadPhrases();
  }, [clearSelection, loadPhrases]);

  const filterList = useCallback((q: string, source: ServicePhrase[]) => {
    const t = q.trim().toLowerCase();
    if (!t) return source;
    return source.filter(p => p.phrase.toLowerCase().includes(t));
  }, []);

  const onSearchChange = useCallback((t: string) => {
    setSearch(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setListPhrases(filterList(t, allPhrases));
    }, 150);
  }, [allPhrases, filterList]);

  const toggleSelect = useCallback((p: ServicePhrase) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
    setSelectedMap(prev => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  }, []);

  const selectedList = useMemo(() => {
    return Array.from(selectedIds)
      .map(id => selectedMap[id])
      .filter(Boolean) as ServicePhrase[];
  }, [selectedIds, selectedMap]);

  const handleAdd = useCallback(() => {
    if (!selectedList.length) return;
    // Copy phrase text into the record (not a library reference)
    onChange(appendDiagnosisPhrases(value, selectedList.map(p => p.phrase)));
    closePopup();
  }, [selectedList, onChange, value, closePopup]);

  const selectedCount = selectedList.length;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID={testID || 'service-performed-section'}>
      <Text style={styles.sectionLabel}>SERVICE PERFORMED</Text>

      <TextInput
        testID="input-service-performed"
        style={[styles.input, styles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder="Record service performed..."
        placeholderTextColor={C.textMuted}
        multiline
        numberOfLines={compact ? 2 : 4}
        textAlignVertical="top"
      />

      <TouchableOpacity
        testID="btn-insert-service-phrase"
        style={styles.insertBtn}
        onPress={openInsert}
      >
        <Ionicons name="add-circle-outline" size={18} color={C.primaryFg} />
        <Text style={styles.insertBtnText}>Insert Service Phrase</Text>
      </TouchableOpacity>

      <Modal visible={showInsert} transparent animationType="slide" onRequestClose={closePopup}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Insert Service Phrase</Text>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={C.textMuted} />
              <TextInput
                testID="service-search-input"
                style={styles.searchInput}
                value={search}
                onChangeText={onSearchChange}
                placeholder="Search phrases..."
                placeholderTextColor={C.textMuted}
                autoFocus
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => onSearchChange('')}>
                  <Ionicons name="close-circle" size={18} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {loadingList ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color={C.primary} />
            ) : (
              <FlatList
                data={listPhrases}
                keyExtractor={item => item.id}
                style={styles.list}
                initialNumToRender={14}
                maxToRenderPerBatch={16}
                windowSize={7}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {search.trim() ? 'No matching phrases' : 'No service phrases available'}
                  </Text>
                }
                renderItem={({ item }) => (
                  <PhraseCheckRow
                    phrase={item}
                    selected={selectedIds.has(item.id)}
                    onToggle={toggleSelect}
                  />
                )}
              />
            )}

            <View style={styles.previewBox} testID="service-selected-preview">
              <Text style={styles.previewTitle}>
                Selected Phrases ({selectedCount})
              </Text>
              {selectedCount === 0 ? (
                <Text style={styles.previewEmpty}>No phrases selected</Text>
              ) : (
                <ScrollView style={styles.previewScroll} nestedScrollEnabled>
                  {selectedList.map(p => (
                    <Text key={p.id} style={styles.previewItem}>• {p.phrase}</Text>
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={clearSelection}
                disabled={selectedCount === 0}
              >
                <Text style={[styles.secondaryBtnText, selectedCount === 0 && styles.btnDisabledText]}>
                  Clear Selection
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={closePopup}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-confirm-insert-service"
                style={[styles.confirmBtn, selectedCount === 0 && styles.confirmBtnDisabled]}
                disabled={selectedCount === 0}
                onPress={handleAdd}
              >
                <Text style={styles.confirmBtnText}>Add to Service</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  wrapCompact: { marginTop: 8, marginBottom: 4 },
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: C.textMuted,
    letterSpacing: 0.6, marginBottom: 8,
  },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.text,
  },
  textarea: { minHeight: 72, paddingTop: 12 },
  insertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.blue, borderRadius: 10, paddingVertical: 12, marginTop: 10,
  },
  insertBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '92%', paddingBottom: 12,
  },
  modalHeader: {
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: C.text },
  list: { maxHeight: 280, marginTop: 4 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 16, minHeight: 56,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  checkPhrase: { flex: 1, fontSize: 16, color: C.text, fontWeight: '600' },
  empty: { textAlign: 'center', color: C.textMuted, padding: 28, fontSize: 14 },
  previewBox: {
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: '#EFF6FF', borderRadius: 12,
    borderWidth: 1, borderColor: '#BFDBFE',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  previewTitle: { fontSize: 14, fontWeight: '800', color: C.blue, marginBottom: 6 },
  previewEmpty: { fontSize: 13, color: C.textMuted },
  previewScroll: { maxHeight: 110 },
  previewItem: { fontSize: 14, color: C.text, fontWeight: '600', marginTop: 3, lineHeight: 20 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: C.border, marginTop: 8,
  },
  secondaryBtn: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.surface,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  btnDisabledText: { color: C.textMuted },
  confirmBtn: {
    backgroundColor: C.blue, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
});
