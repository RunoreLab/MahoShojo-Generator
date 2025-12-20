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
