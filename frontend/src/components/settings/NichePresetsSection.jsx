import { useMemo, useState } from 'react';
import { useDialog } from '../../context/DialogContext';

const normalizeKeyword = (value) => String(value || '').trim().toLowerCase();

const cleanKeywords = (keywords) => [
  ...new Set((keywords || []).map((keyword) => String(keyword).trim()).filter(Boolean)),
];

function hasAllKeywords(keywordSet, keywords) {
  return keywords.length > 0 && keywords.every((keyword) => keywordSet.has(normalizeKeyword(keyword)));
}

function createItemId() {
  return globalThis.crypto?.randomUUID?.() || `niche-${Date.now()}-${Math.random()}`;
}

export default function NichePresetsSection({ niches, presets, onChange }) {
  const { confirm } = useDialog();
  const [editor, setEditor] = useState(null);
  const currentKeywords = useMemo(() => cleanKeywords(niches), [niches]);
  const currentKeywordSet = useMemo(
    () => new Set(currentKeywords.map(normalizeKeyword)),
    [currentKeywords]
  );
  const presetKeywords = useMemo(
    () =>
      new Set(
        presets
          .flatMap((preset) => preset.items || [])
          .flatMap((item) => item.keywords || [])
          .map(normalizeKeyword)
      ),
    [presets]
  );

  const toggleKeywords = (keywords, selected) => {
    const normalized = new Set(keywords.map(normalizeKeyword));
    const nextNiches = selected
      ? currentKeywords.filter((keyword) => !normalized.has(normalizeKeyword(keyword)))
      : cleanKeywords([...currentKeywords, ...keywords]);
    onChange({ niches: nextNiches });
  };

  const handlePresetToggle = (preset) => {
    const keywords = (preset.items || []).flatMap((item) => item.keywords || []);
    if (keywords.length === 0) return;
    toggleKeywords(keywords, hasAllKeywords(currentKeywordSet, keywords));
  };

  const openEditor = (presetId, item = null) => {
    setEditor({
      presetId,
      itemId: item?.id || null,
      name: item?.name || '',
      keywords: (item?.keywords || []).join('\n'),
    });
  };

  const handleEditorSubmit = (event) => {
    event.preventDefault();
    const name = editor.name.trim();
    const keywords = cleanKeywords(editor.keywords.split('\n'));
    if (!name || keywords.length === 0) return;

    let nextNiches = currentKeywords;
    const nextPresets = presets.map((preset) => {
      if (preset.id !== editor.presetId) return preset;

      if (!editor.itemId) {
        return {
          ...preset,
          items: [...(preset.items || []), { id: createItemId(), name, keywords }],
        };
      }

      const previousItem = (preset.items || []).find((item) => item.id === editor.itemId);
      if (previousItem && hasAllKeywords(currentKeywordSet, previousItem.keywords || [])) {
        const previousKeywords = new Set((previousItem.keywords || []).map(normalizeKeyword));
        nextNiches = cleanKeywords([
          ...currentKeywords.filter(
            (keyword) => !previousKeywords.has(normalizeKeyword(keyword))
          ),
          ...keywords,
        ]);
      }

      return {
        ...preset,
        items: (preset.items || []).map((item) =>
          item.id === editor.itemId ? { ...item, name, keywords } : item
        ),
      };
    });

    onChange({ nichePresets: nextPresets, niches: nextNiches });
    setEditor(null);
  };

  const handleDelete = async (presetId, item) => {
    const accepted = await confirm({
      title: `Удалить «${item.name}»?`,
      message: 'Категория исчезнет из пресета. Её выбранные поисковые запросы тоже удалятся.',
      confirmText: 'Удалить',
      variant: 'danger',
    });
    if (!accepted) return;

    const removedKeywords = new Set((item.keywords || []).map(normalizeKeyword));
    const nextPresets = presets.map((preset) =>
      preset.id === presetId
        ? {
            ...preset,
            items: (preset.items || []).filter((candidate) => candidate.id !== item.id),
          }
        : preset
    );
    const nextNiches = hasAllKeywords(currentKeywordSet, item.keywords || [])
      ? currentKeywords.filter(
          (keyword) => !removedKeywords.has(normalizeKeyword(keyword))
        )
      : currentKeywords;

    onChange({ nichePresets: nextPresets, niches: nextNiches });
    if (editor?.itemId === item.id) setEditor(null);
  };

  const selectedItemsCount = presets.reduce(
    (total, preset) =>
      total +
      (preset.items || []).filter((item) =>
        hasAllKeywords(currentKeywordSet, item.keywords || [])
      ).length,
    0
  );

  return (
    <div className="niche-settings-layout">
      <section className="niche-presets-section">
        <div className="niche-section-header">
          <div>
            <h3>Пресеты ниш доноров</h3>
            <p>Выбирайте, редактируйте и добавляйте категории внутри блоков.</p>
          </div>
          <div className="niche-section-actions">
            <span>{selectedItemsCount} выбрано</span>
            <button
              type="button"
              className="btn-primary btn-sm btn-outline"
              onClick={() =>
                onChange({
                  niches: currentKeywords.filter(
                    (keyword) => !presetKeywords.has(normalizeKeyword(keyword))
                  ),
                })
              }
            >
              Сбросить пресеты
            </button>
          </div>
        </div>

        <div className="niche-presets-grid">
          {presets.map((preset) => {
            const items = preset.items || [];
            const keywords = items.flatMap((item) => item.keywords || []);
            const presetSelected = hasAllKeywords(currentKeywordSet, keywords);
            const selectedCount = items.filter((item) =>
              hasAllKeywords(currentKeywordSet, item.keywords || [])
            ).length;

            return (
              <article
                key={preset.id}
                className={`niche-preset-card${presetSelected ? ' selected' : ''}`}
              >
                <div className="niche-preset-header">
                  <button type="button" onClick={() => handlePresetToggle(preset)}>
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </span>
                    <b>
                      {selectedCount}/{items.length}
                    </b>
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-xs btn-outline niche-add-item"
                    onClick={() => openEditor(preset.id)}
                  >
                    + Категория
                  </button>
                </div>

                <div className="niche-preset-items">
                  {items.map((item) => {
                    const selected = hasAllKeywords(currentKeywordSet, item.keywords || []);
                    return (
                      <div key={item.id}>
                        <div
                          className={`niche-preset-item${selected ? ' selected' : ''}`}
                        >
                          <label className="niche-preset-toggle">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleKeywords(item.keywords || [], selected)}
                            />
                            <span>
                              <strong>{item.name}</strong>
                              <small>{(item.keywords || []).join(' · ')}</small>
                            </span>
                          </label>
                          <div className="niche-item-actions">
                            <button
                              type="button"
                              className="btn-primary btn-ghost btn-xs"
                              onClick={() => openEditor(preset.id, item)}
                            >
                              Изменить
                            </button>
                            <button
                              type="button"
                              className="btn-primary btn-ghost btn-xs niche-delete-item"
                              onClick={() => handleDelete(preset.id, item)}
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                        {editor?.presetId === preset.id && editor.itemId === item.id && (
                          <NicheItemEditor
                            editor={editor}
                            setEditor={setEditor}
                            onSubmit={handleEditorSubmit}
                          />
                        )}
                      </div>
                    );
                  })}

                  {editor?.presetId === preset.id && !editor.itemId && (
                    <NicheItemEditor
                      editor={editor}
                      setEditor={setEditor}
                      onSubmit={handleEditorSubmit}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="niche-keywords-editor">
        <div>
          <h3>Поисковые запросы</h3>
          <p>Можно добавить или удалить запросы вручную.</p>
        </div>
        <textarea
          className="msg-textarea"
          value={currentKeywords.join('\n')}
          onChange={(event) => onChange({ niches: event.target.value.split('\n') })}
          placeholder={'маникюр\nтату студия\nстудия йоги'}
        />
        <span>{currentKeywords.length} запросов</span>
      </aside>
    </div>
  );
}

function NicheItemEditor({ editor, setEditor, onSubmit }) {
  const keywordCount = cleanKeywords(editor.keywords.split('\n')).length;

  return (
    <form className="niche-item-editor" onSubmit={onSubmit}>
      <label>
        <span>Название категории</span>
        <input
          type="text"
          className="text-input"
          value={editor.name}
          autoFocus
          onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
          placeholder="Например, Хай хилс"
        />
      </label>
      <label>
        <span>Ниши, по одной на строку</span>
        <textarea
          className="msg-textarea"
          value={editor.keywords}
          onChange={(event) =>
            setEditor((current) => ({ ...current, keywords: event.target.value }))
          }
          placeholder={'high heels\nхай хилс студия\nтанцы на каблуках'}
        />
      </label>
      <div className="niche-item-editor-footer">
        <span>{keywordCount} запросов</span>
        <div>
          <button
            type="button"
            className="btn-primary btn-sm btn-outline"
            onClick={() => setEditor(null)}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="btn-primary btn-sm"
            disabled={!editor.name.trim() || keywordCount === 0}
          >
            Сохранить
          </button>
        </div>
      </div>
    </form>
  );
}
