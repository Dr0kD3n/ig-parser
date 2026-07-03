import React, { memo } from 'react';
import { TrashIcon } from '../Icons';
import CategoryRowExpand from './CategoryRowExpand';
import { ALL_DONORS_KEY, ALL_DONORS_LABEL, normalizeKeyword } from '../../utils/donorCategories';

const KeywordCategoriesTable = memo(function KeywordCategoriesTable({
  rows,
  allStats,
  allGroup,
  sortKey,
  sortDir,
  onSort,
  selectedKey,
  checkedKeys,
  onToggleCheck,
  onSelect,
  onSelectBundle,
  onSelectAll,
  onAdd,
  onAddBundle,
  onCreateBundle,
  checkedCount,
  onDelete,
  onDeleteBundle,
  onAllMessagesCommit,
  onCategoryMessagesCommit,
  onBundleMessagesCommit,
}) {
  const renderSortArrow = (key) => (
    <span className={`sort-arrow${sortKey === key ? '' : ' sort-arrow-inactive'}`}>
      {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  return (
    <div className="donors-categories-card">
      <div className="donors-categories-head">
        <div>
          <h4 className="donors-section-title">Категории рассылки</h4>
          <p className="fs-12 color-muted m-0 mt-4">Клик по строке — шаблоны · галочки — объединить в блок</p>
        </div>
        <div className="donors-categories-actions">
          <button type="button" className="btn-primary btn-sm" onClick={onAdd}>
            + Категория
          </button>
          <button type="button" className="btn-primary btn-sm btn-outline" onClick={onAddBundle}>
            + Блок
          </button>
          {checkedCount >= 2 && (
            <button type="button" className="btn-primary btn-sm btn-outline" onClick={onCreateBundle}>
              Объединить ({checkedCount})
            </button>
          )}
        </div>
      </div>
      <div className="donors-table-scroll">
        <table className="stats-table donors-stats-table">
          <thead>
            <tr>
              <th className="col-check head-center" aria-label="Выбор" />
              <th onClick={() => onSort('category')} className="sortable col-query">
                Запрос {renderSortArrow('category')}
              </th>
              <th onClick={() => onSort('donors_count')} className="sortable head-center col-num">
                Дон. {renderSortArrow('donors_count')}
              </th>
              <th onClick={() => onSort('profiles_total')} className="sortable head-center col-num">
                Проф. {renderSortArrow('profiles_total')}
              </th>
              <th onClick={() => onSort('likes_count')} className="sortable head-center col-num">
                Like {renderSortArrow('likes_count')}
              </th>
              <th onClick={() => onSort('dm_sent_count')} className="sortable head-center col-num">
                DM {renderSortArrow('dm_sent_count')}
              </th>
              <th className="head-center col-action" aria-label="Удалить" />
            </tr>
          </thead>
          <tbody>
            <React.Fragment key={ALL_DONORS_KEY}>
              <tr
                className={`category-row-all${selectedKey === ALL_DONORS_KEY ? ' category-row-selected' : ''}`}
                onClick={() => onSelectAll?.()}
              >
                <td className="col-check" />
                <td className="msg-cell col-query">
                  <strong>{ALL_DONORS_LABEL}</strong>
                </td>
                <td className="count-cell col-num">{allStats?.donors_count ?? 0}</td>
                <td className="count-cell col-num">{allStats?.profiles_total ?? 0}</td>
                <td className="count-cell col-num likes-cell">{allStats?.likes_count ?? 0}</td>
                <td className="count-cell col-num">{allStats?.dm_sent_count ?? 0}</td>
                <td className="col-action" />
              </tr>
              {selectedKey === ALL_DONORS_KEY && (
                <tr className="category-row-expand">
                  <td colSpan={7}>
                    <CategoryRowExpand
                      rowType="all"
                      messages={allGroup?.messages || []}
                      onMessagesCommit={onAllMessagesCommit}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
            {rows.map((r) => {
              const isBundle = r.rowType === 'bundle';
              const keyword = r.keyword || r.stats?.keyword;
              const key = r.key || (isBundle ? r.id : normalizeKeyword(keyword));
              const isSelected = selectedKey === key;
              const stats = r.stats || r;
              const isChecked = !isBundle && checkedKeys?.has(key);

              if (isBundle) {
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`category-row-bundle${isSelected ? ' category-row-selected' : ''}`}
                      onClick={() => onSelectBundle?.(r.id)}
                    >
                      <td className="col-check" />
                      <td className="msg-cell col-query">
                        <strong>📦 {r.label || r.name}</strong>
                        <div className="bundle-keywords-inline">{(r.keywords || []).join(' · ')}</div>
                      </td>
                      <td className="count-cell col-num">{stats.donors_count ?? 0}</td>
                      <td className="count-cell col-num">{stats.profiles_total ?? 0}</td>
                      <td className="count-cell col-num likes-cell">{stats.likes_count ?? 0}</td>
                      <td className="count-cell col-num">{stats.dm_sent_count ?? 0}</td>
                      <td className="col-action">
                        <button
                          type="button"
                          className="socialBtn mini-btn mini-btn-danger"
                          title="Удалить блок"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteBundle?.(r.id);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                    {isSelected && (
                      <tr className="category-row-expand">
                        <td colSpan={7}>
                          <CategoryRowExpand
                            rowType="bundle"
                            keywordItems={r.keywordItems}
                            messages={r.messages || []}
                            onMessagesCommit={(msgs) => onBundleMessagesCommit?.(r.id, msgs)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }

              return (
                <React.Fragment key={key}>
                  <tr
                    className={isSelected ? 'category-row-selected' : ''}
                    onClick={() => onSelect?.(keyword)}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="donor-row-check"
                        checked={isChecked}
                        onChange={() => onToggleCheck?.(key, keyword)}
                      />
                    </td>
                    <td className="msg-cell col-query">{keyword}</td>
                    <td className="count-cell col-num">{stats.donors_count ?? 0}</td>
                    <td className="count-cell col-num">{stats.profiles_total ?? 0}</td>
                    <td className="count-cell col-num likes-cell">{stats.likes_count ?? 0}</td>
                    <td className="count-cell col-num">{stats.dm_sent_count ?? 0}</td>
                    <td className="col-action">
                      <button
                        type="button"
                        className="socialBtn mini-btn mini-btn-danger"
                        title="Удалить категорию"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete?.(keyword);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                  {isSelected && (
                    <tr className="category-row-expand">
                      <td colSpan={7}>
                        <CategoryRowExpand
                          rowType="keyword"
                          keyword={keyword}
                          messages={r.messages || []}
                          onMessagesCommit={(msgs) => onCategoryMessagesCommit?.(keyword, msgs)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="donors-table-empty">
                  Нет категорий — «+ Категория» или запрос ниже
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default KeywordCategoriesTable;
