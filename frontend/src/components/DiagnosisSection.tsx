import React, { useCallback, useMemo, useState, memo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList,
  StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, ITEM_ICONS } from '../constants';
import {
  DiagnosisPhrase,
  appendDiagnosisPhrases,
} from '../types';
import {
  getFavouriteDiagnosisPhrases,
  getDiagnosisPhrases,
  markDiagnosisPhrasesUsed,
} from '../database';

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Watch | Spectacle | Goggle | Wall Clock — filters phrase library when inserting */
  itemType: string;
  /**
   * When true (default): favourites + Insert Diagnosis popup (New Entry).
   * When false: editable text only — no insert button (Edit Job corrections).
   */
  allowInsert?: boolean;
  /** Compact layout for records item rows */
  compact?: boolean;
  testID?: string;
}

const FavChip = memo(function FavChip({
  phrase,
  onPress,
}: {
  phrase: DiagnosisPhrase;
  onPress: (p: DiagnosisPhrase) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.favChip}
      onPress={() => onPress(phrase)}
      testID={`diag-fav-${phrase.id}`}
    >
      <Text style={styles.favStar}>⭐</Text>
      <Text style={styles.favText} numberOfLines={1}>{phrase.phrase}</Text>
    </TouchableOpacity>
  );
});

const PhraseCheckRow = memo(function PhraseCheckRow({
  phrase,
  selected,
  onToggle,
}: {
  phrase: DiagnosisPhrase;
  selected: boolean;
  onToggle: (p: DiagnosisPhrase) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkRow}
      onPress={() => onToggle(phrase)}
      activeOpacity={0.7}
      testID={`diag-phrase-${phrase.id}`}
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

export default function DiagnosisSection({ value, onChange, itemType, allowInsert = true, compact, testID }: Props) {
  const [favourites, setFavourites] = useState<DiagnosisPhrase[]>([]);
  const [favLoaded, setFavLoaded] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listPhrases, setListPhrases] = useState<DiagnosisPhrase[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMap, setSelectedMap] = useState<Record<string, DiagnosisPhrase>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFavourites = useCallback(async () => {
    if (!allowInsert) return;
    try {
      const favs = await getFavouriteDiagnosisPhrases(itemType);
      setFavourites(favs);
    } catch {
      setFavourites([]);
    } finally {
      setFavLoaded(true);
    }
  }, [itemType, allowInsert]);

  const ensureFavourites = useCallback(() => {
    if (!allowInsert || favLoaded) return;
    loadFavourites();
  }, [allowInsert, favLoaded, loadFavourites]);

  React.useEffect(() => {
    if (!allowInsert) {
      setFavourites([]);
      setFavLoaded(true);
      return;
    }
    setFavLoaded(false);
    loadFavourites();
  }, [itemType, allowInsert]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPhrases = useCallback(async (q: string) => {
    if (!allowInsert) return;
    setLoadingList(true);
    try {
      const rows = await getDiagnosisPhrases({
        enabledOnly: true,
        itemType,
        search: q.trim() || undefined,
      });
      setListPhrases(rows);
    } catch {
      setListPhrases([]);
    } finally {
      setLoadingList(false);
    }
  }, [itemType, allowInsert]);

  const insertPhraseTexts = useCallback(async (phrases: DiagnosisPhrase[]) => {
    if (!phrases.length) return;
    // Copy phrase text into the job field (not a library reference)
    onChange(appendDiagnosisPhrases(value, phrases.map(p => p.phrase)));
    try {
      await markDiagnosisPhrasesUsed(phrases.map(p => p.id));
    } catch { /* non-fatal */ }
    loadFavourites();
  }, [onChange, value, loadFavourites]);

  const onFavTap = useCallback((p: DiagnosisPhrase) => {
    insertPhraseTexts([p]);
  }, [insertPhraseTexts]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedMap({});
  }, []);

  const closePopup = useCallback(() => {
    setShowInsert(false);
    clearSelection();
    setSearch('');
  }, [clearSelection]);

  const openInsert = useCallback(async () => {
    clearSelection();
    setSearch('');
    setShowInsert(true);
    await loadPhrases('');
  }, [clearSelection, loadPhrases]);

  const onSearchChange = useCallback((t: string) => {
    setSearch(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadPhrases(t), 200);
  }, [loadPhrases]);

  const toggleSelect = useCallback((p: DiagnosisPhrase) => {
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
      .filter(Boolean) as DiagnosisPhrase[];
  }, [selectedIds, selectedMap]);

  const handleAddToDiagnosis = useCallback(async () => {
    if (!selectedList.length) return;
    await insertPhraseTexts(selectedList);
    closePopup();
  }, [selectedList, insertPhraseTexts, closePopup]);

  const selectedCount = selectedList.length;

  const typeLabel = `${ITEM_ICONS[itemType] || ''} ${itemType}`.trim();

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID={testID || 'diagnosis-section'}>
      <Text style={styles.sectionLabel}>
        {allowInsert ? `TECHNICIAN DIAGNOSIS — ${typeLabel}` : 'TECHNICIAN DIAGNOSIS'}
      </Text>

      {allowInsert && favourites.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.favBar}
          style={styles.favBarScroll}
        >
          {favourites.map(p => (
            <FavChip key={p.id} phrase={p} onPress={onFavTap} />
          ))}
        </ScrollView>
      )}

      <TextInput
        testID="input-diagnosis"
        style={[styles.input, styles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder={allowInsert ? 'Record technician diagnosis...' : 'Edit diagnosis if needed...'}
        placeholderTextColor={C.textMuted}
        multiline
        numberOfLines={compact ? 2 : 4}
        textAlignVertical="top"
        onFocus={allowInsert ? ensureFavourites : undefined}
      />

      {allowInsert ? (
        <TouchableOpacity
          testID="btn-insert-diagnosis"
          style={styles.insertBtn}
          onPress={openInsert}
        >
          <Ionicons name="add-circle-outline" size={18} color={C.primaryFg} />
          <Text style={styles.insertBtnText}>Insert Diagnosis</Text>
        </TouchableOpacity>
      ) : null}

      {allowInsert ? (
      <Modal visible={showInsert} transparent animationType="slide" onRequestClose={closePopup}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Insert Diagnosis — {typeLabel}</Text>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={C.textMuted} />
              <TextInput
                testID="diag-search-input"
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
                    {search.trim() ? 'No matching phrases' : 'No diagnosis phrases available'}
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

            <View style={styles.previewBox} testID="diag-selected-preview">
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
                testID="btn-clear-diag-selection"
                style={styles.secondaryBtn}
                onPress={clearSelection}
                disabled={selectedCount === 0}
              >
                <Text style={[styles.secondaryBtnText, selectedCount === 0 && styles.btnDisabledText]}>
                  Clear Selection
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-cancel-insert-diagnosis"
                style={styles.secondaryBtn}
                onPress={closePopup}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-confirm-insert-diagnosis"
                style={[styles.confirmBtn, selectedCount === 0 && styles.confirmBtnDisabled]}
                disabled={selectedCount === 0}
                onPress={handleAddToDiagnosis}
              >
                <Text style={styles.confirmBtnText}>Add to Diagnosis</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      ) : null}
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
  favBarScroll: { marginBottom: 8, maxHeight: 40 },
  favBar: { gap: 8, paddingRight: 8 },
  favChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.amber100, borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#FDE68A',
    maxWidth: 180,
  },
  favStar: { fontSize: 12 },
  favText: { fontSize: 12, fontWeight: '600', color: C.amber800, flexShrink: 1 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: C.text,
  },
  textarea: { minHeight: 88, paddingTop: 12 },
  insertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12, marginTop: 10,
  },
  insertBtnText: { fontSize: 14, fontWeight: '700', color: C.primaryFg },
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
  searchInput: {
    flex: 1, paddingVertical: 12, fontSize: 15, color: C.text,
  },
  list: { maxHeight: 280, marginTop: 4 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 16,
    minHeight: 56,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  checkPhrase: { flex: 1, fontSize: 16, color: C.text, fontWeight: '600' },
  empty: { textAlign: 'center', color: C.textMuted, padding: 28, fontSize: 14 },
  previewBox: {
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: C.amber100, borderRadius: 12,
    borderWidth: 1, borderColor: '#FDE68A',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  previewTitle: { fontSize: 14, fontWeight: '800', color: C.amber800, marginBottom: 6 },
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
    backgroundColor: C.primary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: C.primaryFg, fontWeight: '800', fontSize: 13 },
});
