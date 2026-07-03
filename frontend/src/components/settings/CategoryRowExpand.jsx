import React, { memo } from 'react';
import DebouncedLinesTextarea from './DebouncedLinesTextarea';

const CategoryRowExpand = memo(function CategoryRowExpand({
  rowType,
  keyword,
  keywordItems,
  messages,
  onMessagesCommit,
}) {
  if (rowType === 'all') {
    return (
      <div className="category-expand-inner">
        <p className="fs-11 color-muted m-0 mb-8">
          Если у донора нет категории или для неё пустые шаблоны
        </p>
        <DebouncedLinesTextarea
          className="msg-textarea category-msg-textarea fs-13"
          lines={messages}
          onCommit={onMessagesCommit}
          placeholder="Одно сообщение на строку..."
        />
      </div>
    );
  }

  if (rowType === 'bundle') {
    return (
      <div className="category-expand-inner">
        <div className="donors-table-scroll bundle-expand-scroll">
          <table className="stats-table donors-stats-table bundle-expand-table">
            <thead>
              <tr>
                <th className="col-query">Запрос</th>
                <th className="head-center col-num">Дон.</th>
                <th className="head-center col-num">Проф.</th>
                <th className="head-center col-num">Like</th>
                <th className="head-center col-num">DM</th>
              </tr>
            </thead>
            <tbody>
              {(keywordItems || []).map((item) => {
                const stats = item.stats || {};
                return (
                  <tr key={item.key || item.keyword}>
                    <td className="msg-cell col-query">{item.keyword}</td>
                    <td className="count-cell col-num">{stats.donors_count ?? 0}</td>
                    <td className="count-cell col-num">{stats.profiles_total ?? 0}</td>
                    <td className="count-cell col-num likes-cell">{stats.likes_count ?? 0}</td>
                    <td className="count-cell col-num">{stats.dm_sent_count ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DebouncedLinesTextarea
          className="msg-textarea category-msg-textarea fs-13"
          lines={messages}
          onCommit={onMessagesCommit}
          placeholder="Одно сообщение на строку..."
        />
      </div>
    );
  }

  return (
    <div className="category-expand-inner">
      <label className="fs-12 mb-4 block color-muted">Шаблоны рассылки:</label>
      <DebouncedLinesTextarea
        className="msg-textarea category-msg-textarea fs-13"
        lines={messages}
        onCommit={onMessagesCommit}
        placeholder="Одно сообщение на строку..."
      />
    </div>
  );
});

export default CategoryRowExpand;
