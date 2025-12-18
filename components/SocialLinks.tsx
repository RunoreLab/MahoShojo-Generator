import React from 'react';

export const SocialLinks: React.FC = () => {
  return (
    <>
      <div className="text-center mt-3">
        <a
          href="https://qun.qq.com/universal-share/share?ac=1&busi_data=eyJncm91cENvZGUiOiIxMDU5ODMwOTUyIiwidG9rZW4iOiJNUFN6UVpBRVZNNU9COWpBa21DU1lxczRObXhiKy9kSzEvbHhOcnNpT1RBZUVVU3dtZ2hUQjJVNGtuYk5ISDhrIiwidWluIjoiMTAxOTcyNzcxMCJ9&data=DxfxSXDeGY3mgLKqoTGEoHkfqpums19TEW8Alu5Ikc3uCmV0O8YkLVLyRTMOp61VjFN387-7QL8-j2AFHUX2QXq525oXb8rl0lNhm0K453Q&svctype=5&tempid=h5_group_info"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline font-semibold"
        >
          点击加入QQ交流群
        </a>
      </div>
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
