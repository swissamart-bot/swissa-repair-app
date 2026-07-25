import React, { useCallback, useState, memo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList,
  StyleSheet, Alert, Switch, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../constants';
import { CustomPhrase, SERVICE_PHRASE_ITEM_TYPES } from '../types';
import {
  getAllCustomPhrases,
  addServicePhrase,
  updateServicePhrase,
  deleteCustomPhrase,
  reorderServicePhrases,
} from '../database';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type FormState = {
  phrase: string;
  itemType: string;
  isEnabled: boolean;
};

const emptyForm = (): FormState => ({
  phrase: '',
  itemType: 'Watch',
  isEnabled: true,
});

const PhraseRow = memo(function PhraseRow({
  item,
  index,
  total,
  onEdit,
  onDelete,
  onToggleEnabled,
  onMoveUp,
  onMoveDown,
}: {
  item: CustomPhrase;
  index: number;
  total: number;
  onEdit: (p: CustomPhrase) => void;
  onDelete: (p: CustomPhrase) => void;
  onToggleEnabled: (p: CustomPhrase) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <View style={[styles.row, !item.isEnabled && styles.rowDisabled]} testID={`service-lib-row-${item.id}`}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={styles.phraseText}>{item.phrase}</Text>
        <Text style={styles.meta}>
          {item.itemType} · {item.isEnabled ? 'Enabled' : 'Disabled'}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Switch
          value={item.isEnabled}
          onValueChange={() => onToggleEnabled(item)}
          trackColor={{ false: C.border, true: C.green100 }}
          thumbColor={item.isEnabled ? C.green800 : C.textMuted}
        />
        <TouchableOpacity onPress={() => onMoveUp(index)} disabled={index === 0} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-up" size={22} color={index === 0 ? C.border : C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onMoveDown(index)} disabled={index >= total - 1} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-down" size={22} color={index >= total - 1 ? C.border : C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity testID={`service-edit-${item.id}`} onPress={() => onEdit(item)} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="create-outline" size={22} color={C.blue} />
        </TouchableOpacity>
        <TouchableOpacity testID={`service-delete-${item.id}`} onPress={() => onDelete(item)} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={22} color={C.red} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function ServicePhraseLibrary({ visible, onClose }: Props) {
  const [phrases, setPhrases] = useState<CustomPhrase[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomPhrase | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [toast, setToast] = useState<string | null>(null);

  const showMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async (type = filterType, q = search) => {
    setLoading(true);
    try {
      let list = await getAllCustomPhrases();
      if (type !== 'All') list = list.filter(p => p.itemType === type);
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        list = list.filter(p => p.phrase.toLowerCase().includes(needle));
      }
      setPhrases(list);
    } catch (e: any) {
      showMsg(e?.message || 'Failed to load phrases');
    } finally {
      setLoading(false);
    }
  }, [filterType, search]);

  React.useEffect(() => {
    if (visible) {
      setSearch('');
      setFilterType('All');
      load('All', '');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (p: CustomPhrase) => {
    setEditing(p);
    setForm({ phrase: p.phrase, itemType: p.itemType, isEnabled: p.isEnabled });
    setFormOpen(true);
  };

  const saveForm = async () => {
    try {
      if (editing) {
        await updateServicePhrase(editing.id, {
          phrase: form.phrase,
          itemType: form.itemType,
          isEnabled: form.isEnabled,
        });
        showMsg('Phrase updated');
      } else {
        await addServicePhrase(form.phrase, form.itemType, form.isEnabled);
        showMsg('Phrase added');
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save phrase');
    }
  };

  const onDelete = (p: CustomPhrase) => {
    Alert.alert(
      'Delete this service phrase?',
      `"${p.phrase}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCustomPhrase(p.id);
            await load();
            showMsg('Phrase deleted');
          },
        },
      ]
    );
  };

  const onToggleEnabled = async (p: CustomPhrase) => {
    try {
      await updateServicePhrase(p.id, { isEnabled: !p.isEnabled });
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Update failed');
    }
  };

  const onMoveUp = async (index: number) => {
    if (index <= 0) return;
    const ids = phrases.map(x => x.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await reorderServicePhrases(ids);
    await load();
  };

  const onMoveDown = async (index: number) => {
    if (index >= phrases.length - 1) return;
    const ids = phrases.map(x => x.id);
    [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
    await reorderServicePhrases(ids);
    await load();
  };

  const filterTabs = ['All', ...SERVICE_PHRASE_ITEM_TYPES];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.header}>
            <Text style={styles.title}>Service Phrase Manager</Text>
            <TouchableOpacity testID="close-service-library" onPress={onClose}>
              <Ionicons name="close" size={24} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              testID="service-lib-search"
              style={styles.searchInput}
              value={search}
              onChangeText={t => {
                setSearch(t);
                load(filterType, t);
              }}
              placeholder="Search service phrases..."
              placeholderTextColor={C.textMuted}
            />
          </View>

          <FlatList
            horizontal
            data={filterTabs}
            keyExtractor={t => t}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catBar}
            renderItem={({ item: t }) => (
              <TouchableOpacity
                style={[styles.catChip, filterType === t && styles.catChipActive]}
                onPress={() => {
                  setFilterType(t);
                  load(t, search);
                }}
              >
                <Text style={[styles.catChipText, filterType === t && styles.catChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            )}
          />

          <TouchableOpacity testID="btn-add-service-phrase" style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add-circle-outline" size={20} color={C.primaryFg} />
            <Text style={styles.addBtnText}>+ Add Service Phrase</Text>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator style={{ margin: 24 }} color={C.primary} />
          ) : (
            <FlatList
              data={phrases}
              keyExtractor={item => item.id}
              style={styles.list}
              initialNumToRender={14}
              ListEmptyComponent={<Text style={styles.empty}>No service phrases yet</Text>}
              renderItem={({ item, index }) => (
                <PhraseRow
                  item={item}
                  index={index}
                  total={phrases.length}
                  onEdit={openEdit}
                  onDelete={onDelete}
                  onToggleEnabled={onToggleEnabled}
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

      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.formOverlay}>
          <View style={styles.formBox}>
            <Text style={styles.formTitle}>{editing ? 'Edit Service Phrase' : 'Add Service Phrase'}</Text>

            <Text style={styles.formLabel}>Phrase text</Text>
            <TextInput
              testID="service-form-phrase"
              style={styles.input}
              value={form.phrase}
              onChangeText={t => setForm(f => ({ ...f, phrase: t }))}
              placeholder="e.g. Battery replaced"
              placeholderTextColor={C.textMuted}
              multiline
            />

            <Text style={[styles.formLabel, { marginTop: 12 }]}>Item type</Text>
            <View style={styles.typeGrid}>
              {SERVICE_PHRASE_ITEM_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, form.itemType === t && styles.typeChipActive]}
                  onPress={() => setForm(f => ({ ...f, itemType: t }))}
                >
                  <Text style={[styles.typeChipText, form.itemType === t && styles.typeChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.formLabel}>Enabled</Text>
              <Switch
                value={form.isEnabled}
                onValueChange={v => setForm(f => ({ ...f, isEnabled: v }))}
                trackColor={{ false: C.border, true: C.green100 }}
                thumbColor={form.isEnabled ? C.green800 : C.textMuted}
              />
            </View>

            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setFormOpen(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="service-form-save" style={styles.saveBtn} onPress={saveForm}>
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
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: C.text },
  catBar: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border,
  },
  catChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  catChipText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  catChipTextActive: { color: C.primaryFg },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14,
  },
  addBtnText: { fontSize: 15, fontWeight: '800', color: C.primaryFg },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 64,
  },
  rowDisabled: { opacity: 0.5 },
  phraseText: { fontSize: 15, fontWeight: '600', color: C.text },
  meta: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6 },
  empty: { textAlign: 'center', color: C.textMuted, padding: 28 },
  toast: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: '#166534', borderRadius: 10, padding: 12, alignItems: 'center',
  },
  toastText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  formOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 20,
  },
  formBox: { backgroundColor: C.surface, borderRadius: 14, padding: 18 },
  formTitle: { fontSize: 17, fontWeight: '800', color: C.primary, marginBottom: 14 },
  formLabel: { fontSize: 12, fontWeight: '700', color: C.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: C.text, minHeight: 48,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border,
  },
  typeChipActive: { backgroundColor: C.blue, borderColor: C.blue },
  typeChipText: { fontSize: 13, fontWeight: '600', color: C.textMuted },
  typeChipTextActive: { color: '#FFF' },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, marginBottom: 8,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  cancelBtnText: { color: C.textMuted, fontWeight: '600' },
  saveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  saveBtnText: { color: C.primaryFg, fontWeight: '700' },
});
