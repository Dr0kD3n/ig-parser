import React, { memo } from 'react';

const DiscoveredKeywords = memo(function DiscoveredKeywords({
  keywords,
  bundledKeys,
  checkedKeys,
  onToggleCheck,
  onSelect,
}) {
  const visible = (keywords || []).filter((item) => !bundledKeys?.has(item.key));
  if (!visible.length) return null;

  return (
    <div className="discovered-keywords">
      <p className="fs-12 color-muted m-0 mb-8">
        Быстрый выбор — отметь 2+ запроса и нажми «Объединить»:
      </p>
      <div className="keyword-chips">
        {visible.map((item) => {
          const isChecked = checkedKeys?.has(item.key);
          return (
            <label
              key={item.key}
              className={`keyword-chip keyword-chip-selectable${isChecked ? ' checked' : ''}`}
            >
              <input
                type="checkbox"
                className="donor-row-check"
                checked={isChecked}
                onChange={() => onToggleCheck?.(item.key, item.keyword)}
              />
              <button
                type="button"
                className="keyword-chip-label"
                onClick={() => onSelect(item.keyword)}
              >
                {item.keyword}
                <span className="keyword-chip-count">{item.donors_count}</span>
              </button>
            </label>
          );
        })}
      </div>
    </div>
  );
});

export default DiscoveredKeywords;
