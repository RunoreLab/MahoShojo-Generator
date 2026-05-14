export interface QQGroupInfo {
  groupCode: string;
  name: string;
  joinUrl: string;
}

export const qqGroupJoinButtonImageUrl = 'https://pub.idqqimg.com/wpa/images/group.png';

export const qqGroups: QQGroupInfo[] = [
  {
    groupCode: '1059830952',
    name: '魔法少女生成器&竞技场①',
    joinUrl:
      'https://qm.qq.com/cgi-bin/qm/qr?k=57nCfNSXWgmHh-xOVGdDf0LsN5AF7UlR&jump_from=webapi&authKey=67Tik8FycKZzBAZaU2eGAVYAJe2Uoe+TCOMopa4ZtNWC3JzWXknj+eZWiMqLenh4',
  },
  {
    groupCode: '1076725478',
    name: '魔法少女生成器&竞技场②',
    joinUrl:
      'https://qm.qq.com/cgi-bin/qm/qr?k=szfg7A7-AIy_UA1HUbrop4GAr5mrhzxC&jump_from=webapi&authKey=3R4sPTM0hzUHEYDaEcOLrvCtMy1U49OAW2vjT+7cvFqYtbUqwrhvQ8cp06dI0CBR',
  },
  {
    groupCode: '1078309485',
    name: '万途驿站①',
    joinUrl:
      'https://qun.qq.com/universal-share/share?ac=1&authKey=8yaiSlkPmEa82b07ebbgc%2F76mgpkw3GwWBISvMQczeUlh%2BUIA%2FOio%2Fb0lUHoJI4P&busi_data=eyJncm91cENvZGUiOiIxMDc4MzA5NDg1IiwidG9rZW4iOiJzWDZNcVk5aytVemtwTXJFSUhzbFptKzRwWkxWT0xjUlowbEM4d0tnNDlzWUJRTjI4TktrcTQyK1Y3MzQ2UDI3IiwidWluIjoiMTAxOTcyNzcxMCJ9&data=XkTI5DpklN0YPUgYeYNU6BVJOpROzvzh4p1LYh-U90SgQj-kQRcvrarI-jlPectNJBNIW8feC7rh00yoKz2TVQ&svctype=4&tempid=h5_group_info',
  },
];

export const getQQGroupsMarkdownList = (): string => {
  return qqGroups
    .map((group, index) => {
      const indexText = index + 1;
      return `- **群${indexText}**：\`${group.groupCode}\`（${group.name}）→ [点击加群](${group.joinUrl})`;
    })
    .join('\n');
};

export const interpolateWithQQGroups = (content: string): string => {
  return content.split('{{QQ_GROUPS}}').join(getQQGroupsMarkdownList());
};
