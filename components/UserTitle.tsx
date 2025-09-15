import React from 'react';

interface UserTitleProps {
  prefix?: string | null;
  className?: string;
}

interface ParsedPrefix {
  title: string;
  textColor: string;
  backgroundColor: string;
}

/**
 * 解析用户头衔前缀字符串
 * 格式: "头衔名称,#000000,#FFFFFF"
 * @param prefix 前缀字符串
 * @returns 解析后的头衔对象，如果解析失败返回 null
 */
function parsePrefix(prefix?: string | null): ParsedPrefix | null {
  if (!prefix || typeof prefix !== 'string') {
    return null;
  }

  const parts = prefix.split(',');
  if (parts.length !== 3) {
    return null;
  }

  const [title, textColor, backgroundColor] = parts.map(part => part.trim());

  // 验证颜色格式（简单的十六进制颜色检查）
  const colorRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!colorRegex.test(textColor) || !colorRegex.test(backgroundColor)) {
    return null;
  }

  return {
    title,
    textColor,
    backgroundColor
  };
}

/**
 * 用户头衔组件
 * 显示用户的头衔标签，包含自定义的文字颜色和背景颜色
 */
export default function UserTitle({ prefix, className = '' }: UserTitleProps) {
  const parsedPrefix = parsePrefix(prefix);

  if (!parsedPrefix) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-md border ${className}`}
      style={{
        color: parsedPrefix.textColor,
        backgroundColor: parsedPrefix.backgroundColor,
        borderColor: parsedPrefix.textColor + '40' // 添加透明度作为边框颜色
      }}
      title={`头衔: ${parsedPrefix.title}`}
    >
      {parsedPrefix.title}
    </span>
  );
}

/**
 * 用户名和头衔组合组件
 * 显示用户名和头衔（如果存在）
 */
export function UserWithTitle({ 
  username, 
  prefix, 
  className = '',
  usernameClassName = '',
  titleClassName = ''
}: {
  username: string;
  prefix?: string | null;
  className?: string;
  usernameClassName?: string;
  titleClassName?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className={usernameClassName}>{username}</span>
      <UserTitle prefix={prefix} className={titleClassName} />
    </div>
  );
}