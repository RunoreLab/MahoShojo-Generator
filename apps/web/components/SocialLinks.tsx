import React from 'react';

import { QqGroupJoinSection } from '@/components/QqGroupJoinSection';

export const SocialLinks: React.FC = () => {
  return (
    <>
      <QqGroupJoinSection />
      <div className="text-center mt-3">
        <a
          href="https://pd.qq.com/s/brisxifbl"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline font-semibold"
        >
          点击加入腾讯频道
        </a>
      </div>
    </>
  );
};
