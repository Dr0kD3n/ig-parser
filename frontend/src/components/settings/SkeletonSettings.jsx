import React, { memo } from 'react';

const SkeletonSettings = memo(function SkeletonSettings() {
  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="skeleton" style={{ width: 400, height: 40, borderRadius: 12 }} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: '32px',
          padding: '0 32px',
        }}
      >
        <div>
          <div className="skeleton-item skeleton h-200" />
          <div className="skeleton-item skeleton h-200" />
        </div>
        <div>
          <div className="skeleton-item skeleton h-400" />
        </div>
      </div>
    </div>
  );
});

export default SkeletonSettings;
