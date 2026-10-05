import { describe, expect, it } from 'vitest';

import {
  buildArenaRoomInviteText,
  parseArenaRoomJoinCode,
} from '@/lib/arena-room/join-code';

const UUID = '5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f';

describe('parseArenaRoomJoinCode', () => {
  it('纯房间码（UUID 或简单 ID）直接使用', () => {
    expect(parseArenaRoomJoinCode(UUID)).toEqual({ ok: true, roomId: UUID });
    expect(parseArenaRoomJoinCode('room-1')).toEqual({ ok: true, roomId: 'room-1' });
    expect(parseArenaRoomJoinCode(`  ${UUID}  `)).toEqual({ ok: true, roomId: UUID });
  });

  it('整段邀请文案自动抽取唯一 UUID', () => {
    const invite = buildArenaRoomInviteText('https://mahoshojo.colanns.me', UUID);
    expect(parseArenaRoomJoinCode(invite)).toEqual({ ok: true, roomId: UUID });
  });

  it('带标签的房间码优先于自由文本', () => {
    expect(parseArenaRoomJoinCode(`房间码：${UUID} 欢迎来玩`)).toEqual({ ok: true, roomId: UUID });
    expect(parseArenaRoomJoinCode(`房间ID=${UUID}`)).toEqual({ ok: true, roomId: UUID });
    expect(parseArenaRoomJoinCode(`Room Id: ${UUID}`)).toEqual({ ok: true, roomId: UUID });
    expect(parseArenaRoomJoinCode('房间码：room-9（快来）')).toEqual({ ok: true, roomId: 'room-9' });
  });

  it('多个 UUID 拒绝猜测', () => {
    const other = '0f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e20';
    const result = parseArenaRoomJoinCode(`${UUID} ${other}`);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('多个');
  });

  it('没有可识别 ID 时给出明确提示', () => {
    const result = parseArenaRoomJoinCode('这只是随便一段话');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('未识别到有效房间码');
    expect(parseArenaRoomJoinCode('   ')).toMatchObject({ ok: false });
  });

  it('分享链接中的 UUID 也能识别', () => {
    expect(parseArenaRoomJoinCode(`https://example.com/x?dataCardId=${UUID}&tab=1`))
      .toEqual({ ok: true, roomId: UUID });
  });
});

describe('buildArenaRoomInviteText', () => {
  it('邀请文案包含房间上下文、房间码、入口与用法，可被解析器还原', () => {
    const text = buildArenaRoomInviteText('https://mahoshojo.colanns.me/', UUID, {
      roomTitle: '废都茶会',
      hostDisplayName: '小银',
      memberCount: 2,
      memberLimit: 8,
    });
    expect(text).toContain('房间：废都茶会');
    expect(text).toContain('房主：小银');
    expect(text).toContain('当前在线：2/8 人');
    expect(text).toContain(UUID);
    expect(text).toContain('https://mahoshojo.colanns.me/arena');
    expect(text).toContain('凭房间码加入');
    expect(text).toContain('直接粘贴整段邀请即可加入');
    expect(parseArenaRoomJoinCode(text)).toEqual({ ok: true, roomId: UUID });
  });

  it('用户可控的标题与昵称会折叠为空白分隔的单行文本', () => {
    const text = buildArenaRoomInviteText('https://example.com', UUID, {
      roomTitle: '  夜战\n测试房  ',
      hostDisplayName: '房主\tAlice',
      memberCount: 1.5,
      memberLimit: -1,
    });
    expect(text).toContain('房间：夜战 测试房');
    expect(text).toContain('房主：房主 Alice');
    expect(text).not.toContain('当前在线：');
    expect(parseArenaRoomJoinCode(text)).toEqual({ ok: true, roomId: UUID });
  });

  it('未提供房间详情时仍保持兼容并生成可粘贴邀请', () => {
    const text = buildArenaRoomInviteText('https://example.com/', UUID);
    expect(text).toContain(`房间码：${UUID}`);
    expect(text).toContain('https://example.com/arena');
    expect(parseArenaRoomJoinCode(text)).toEqual({ ok: true, roomId: UUID });
  });
});
