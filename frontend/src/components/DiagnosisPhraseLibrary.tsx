import React, { useCallback, useState, memo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList,
  StyleSheet, Alert, Switch, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, ITEM_ICONS } from '../constants';
import { DiagnosisPhrase, DIAGNOSIS_ITEM_TYPES, MAX_DIAGNOSIS_FAVOURITES } from '../types';
import {
  getDiagnosisPhrases,
  addDiagnosisPhrase,
  updateDiagnosisPhrase,
  deleteDiagnosisPhrase,
  duplicateDiagnosisPhrase,
  reorderDiagnosisPhrases,
} from '../database';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const ITEM_TABS = DIAGNOSIS_ITEM_TYPES.map(t => ({
  type: t,
  label: `${ITEM_ICONS[t] || ''} ${t}`.trim(),
}));

const PhraseRow = memo(function PhraseRow({
  item,
  index,
  total,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleEnabled,
  onToggleFavourite,
  onMoveUp,
  onMoveDown,
}: {
  item: DiagnosisPhrase;
  index: number;
  total: number;
  onEdit: (p: DiagnosisPhrase) => void;
  onDelete: (p: DiagnosisPhrase) => void;
  onDuplicate: (p: DiagnosisPhrase) => void;
  onToggleEnabled: (p: DiagnosisPhrase) => void;
  onToggleFavourite: (p: DiagnosisPhrase) => void;
  onMoveUp: (p: DiagnosisPhrase, index: number) => void;
  onMoveDown: (p: DiagnosisPhrase, index: number) => void;
}) {
  return (
    <View style={[styles.row, !item.isEnabled && styles.rowDisabled]} testID={`diag-lib-row-${item.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.phraseText}>{item.phrase}</Text>
        <Text style={styles.meta}>
          {ITEM_ICONS[item.itemType] || ''} {item.itemType}
          {item.useCount > 0 ? ` · used ${item.useCount}×` : ''}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity onPress={() => onToggleFavourite(item)} hitSlop={8} testID={`diag-fav-toggle-${item.id}`}>
          <Ionicons name={item.isFavourite ? 'star' : 'star-outline'} size={20} color={item.isFavourite ? '#D97706' : C.textMuted} />
        </TouchableOpacity>
        <Switch
          value={item.isEnabled}
          onValueChange={() => onToggleEnabled(item)}
          trackColor={{ false: C.border, true: C.green100 }}
          thumbColor={item.isEnabled ? C.green800 : C.textMuted}
        />
        <TouchableOpacity onPress={() => onMoveUp(item, index)} disabled={index === 0} hitSlop={6}>
          <Ionicons name="chevron-up" size={20} color={index === 0 ? C.border : C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onMoveDown(item, index)} disabled={index >= total - 1} hitSlop={6}>
          <Ionicons name="chevron-down" size={20} color={index >= total - 1 ? C.border : C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onEdit(item)} hitSlop={8}>
          <Ionicons name="create-outline" size={18} color={C.blue} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDuplicate(item)} hitSlop={8}>
          <Ionicons name="copy-outline" size={18} color={C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(item)} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={C.red} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function DiagnosisPhraseLibrary({ visible, onClose }: Props) {
  const [phrases, setPhrases] = useState<DiagnosisPhrase[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<string>(DIAGNOSIS_ITEM_TYPES[0]);
  const [newPhrase, setNewPhrase] = useState('');
  const [editing, setEditing] = useState<DiagnosisPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState<string>(DIAGNOSIS_ITEM_TYPES[0]);
  const [toast, setToast] = useState<string | null>(null);

  const showMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async (itemType = activeType, q = search) => {
    setLoading(true);
    try {
      const ph = await getDiagnosisPhrases({
        itemType,
        search: q || undefined,
      });
      setPhrases(ph);
    } catch (e: any) {
      showMsg(e?.message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [activeType, search]);

  React.useEffect(() => {
    if (visible) {
      setSearch('');
      setActiveType(DIAGNOSIS_ITEM_TYPES[0]);
      setNewPhrase('');
      load(DIAGNOSIS_ITEM_TYPES[0], '');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newPhrase.trim()) return;
    try {
      await addDiagnosisPhrase(newPhrase.trim(), activeType);
      setNewPhrase('');
      await load();
      showMsg('Phrase added');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add phrase');
    }
  };

  const onEdit = (p: DiagnosisPhrase) => {
    setEditing(p);
    setEditText(p.phrase);
    setEditType(p.itemType);
  };

  const saveEdit = async () => {
    if (!editing || !editText.trim()) return;
    try {
      await updateDiagnosisPhrase(editing.id, { phrase: editText.trim(), itemType: editType });
      setEditing(null);
      await load(activeType, search);
      showMsg('Phrase updated');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Update failed');
    }
  };

  const onDelete = (p: DiagnosisPhrase) => {
    Alert.alert('Delete Phrase', `Remove "${p.phrase}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteDiagnosisPhrase(p.id);
          await load();
          showMsg('Phrase deleted');
        },
      },
    ]);
  };

  const onDuplicate = async (p: DiagnosisPhrase) => {
    await duplicateDiagnosisPhrase(p.id);
    await load();
    showMsg('Phrase duplicated');
  };

  const onToggleEnabled = async (p: DiagnosisPhrase) => {
    await updateDiagnosisPhrase(p.id, { isEnabled: !p.isEnabled });
    await load();
  };

  const onToggleFavourite = async (p: DiagnosisPhrase) => {
    try {
      await updateDiagnosisPhrase(p.id, { isFavourite: !p.isFavourite });
      await load();
      showMsg(p.isFavourite ? 'Removed from favourites' : 'Pinned to favourites');
    } catch (e: any) {
      Alert.alert('Favourites', e?.message || `Maximum ${MAX_DIAGNOSIS_FAVOURITES} favourites`);
    }
  };

  const onMoveUp = async (_p: DiagnosisPhrase, index: number) => {
    if (index <= 0) return;
    const ids = phrases.map(x => x.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await reorderDiagnosisPhrases(ids);
    await load();
  };

  const onMoveDown = async (_p: DiagnosisPhrase, index: number) => {
    if (index >= phrases.length - 1) return;
    const ids = phrases.map(x => x.id);
    [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
    await reorderDiagnosisPhrases(ids);
    await load();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.header}>
            <Text style={styles.title}>Diagnosis Phrases</Text>
            <TouchableOpacity testID="close-diag-library" onPress={onClose}>
              <Ionicons name="close" size={24} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              testID="diag-lib-search"
              style={styles.searchInput}
              value={search}
              onChangeText={t => {
                setSearch(t);
                load(activeType, t);
              }}
              placeholder="Search phrases..."
              placeholderTextColor={C.textMuted}
            />
          </View>

          <FlatList
            horizontal
            data={ITEM_TABS}
            keyExtractor={c => c.type}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catBar}
            renderItem={({ item: tab }) => (
              <TouchableOpacity
                style={[styles.catChip, activeType === tab.type && styles.catChipActive]}
                onPress={() => {
                  setActiveType(tab.type);
                  load(tab.type, search);
                }}
                testID={`diag-tab-${tab.type}`}
              >
                <Text style={[styles.catChipText, activeType === tab.type && styles.catChipTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            )}
          />

          <View style={styles.addRow}>
            <TextInput
              testID="diag-lib-new-phrase"
              style={[styles.input, { flex: 1 }]}
              value={newPhrase}
              onChangeText={setNewPhrase}
              placeholder={`New ${activeType} diagnosis phrase...`}
              placeholderTextColor={C.textMuted}
            />
            <TouchableOpacity testID="diag-lib-add" style={styles.addBtn} onPress={handleAdd}>
              <Ionicons name="add" size={22} color={C.primaryFg} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Phrases are stored under {ITEM_ICONS[activeType]} {activeType}. ⭐ Favourites (max {MAX_DIAGNOSIS_FAVOURITES}) · Reorder with ↑↓
          </Text>

          {loading ? (
            <ActivityIndicator style={{ margin: 24 }} color={C.primary} />
          ) : (
            <FlatList
              data={phrases}
              keyExtractor={item => item.id}
              style={styles.list}
              initialNumToRender={14}
              maxToRenderPerBatch={16}
              windowSize={7}
              ListEmptyComponent={<Text style={styles.empty}>No phrases for this item yet</Text>}
              renderItem={({ item, index }) => (
                <PhraseRow
                  item={item}
                  index={index}
                  total={phrases.length}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onToggleEnabled={onToggleEnabled}
                  onToggleFavourite={onToggleFavourite}
                  onMoveUp={onMoveUp}
                  onMoveDown={onMoveDown}
                />
              )}
            />
          )}

          {toast ? (
            <View style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View>
          ) : null}
        </View>
      </View>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.editOverlay}>
          <View style={styles.editBox}>
            <Text style={styles.editTitle}>Edit Phrase</Text>
            <TextInput
              style={styles.input}
              value={editText}
              onChangeText={setEditText}
              placeholder="Phrase text"
              placeholderTextColor={C.textMuted}
            />
            <Text style={[styles.hint, { marginTop: 10 }]}>Item type</Text>
            <FlatList
              horizontal
              data={ITEM_TABS}
              keyExtractor={c => c.type}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
              renderItem={({ item: tab }) => (
                <TouchableOpacity
                  style={[styles.miniCat, editType === tab.type && styles.miniCatActive]}
                  onPress={() => setEditType(tab.type)}
                >
                  <Text style={[styles.miniCatText, editType === tab.type && styles.miniCatTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  box: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '92%', paddingBottom: 16,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: C.text },
  catBar: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border,
  },
  catChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  catChipText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  catChipTextActive: { color: C.primaryFg },
  addRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: C.text,
  },
  addBtn: {
    backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  miniCat: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border,
  },
  miniCatActive: { backgroundColor: C.blue, borderColor: C.blue },
  miniCatText: { fontSize: 11, fontWeight: '600', color: C.textMuted },
  miniCatTextActive: { color: '#FFF' },
  hint: { fontSize: 11, color: C.textMuted, paddingHorizontal: 16, marginBottom: 6, lineHeight: 16 },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  rowDisabled: { opacity: 0.45 },
  phraseText: { fontSize: 14, fontWeight: '600', color: C.text },
  meta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { textAlign: 'center', color: C.textMuted, padding: 28 },
  toast: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: '#166534', borderRadius: 10, padding: 12, alignItems: 'center',
  },
  toastText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  editOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 24,
  },
  editBox: { backgroundColor: C.surface, borderRadius: 14, padding: 18 },
  editTitle: { fontSize: 17, fontWeight: '700', color: C.primary, marginBottom: 12 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { color: C.textMuted, fontWeight: '600' },
  saveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  saveBtnText: { color: C.primaryFg, fontWeight: '700' },
});
