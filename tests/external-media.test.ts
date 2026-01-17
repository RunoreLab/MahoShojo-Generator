import { describe, expect, it } from 'bun:test';

import { isAllowedExternalMediaUrl, isLikelyVideoUrl } from '@/lib/markdown/externalMedia';

describe('external media whitelist', () => {
  it('允许白名单内的图片域名', () => {
    expect(
      isAllowedExternalMediaUrl('https://pic3.zhimg.com/80/v2-83fa1f698669f7b1dbfab8cbcae152fc_qhd.webp', 'image'),
    ).toBe(true);
  });

  it('阻止非白名单的图片域名', () => {
    expect(
      isAllowedExternalMediaUrl('https://i.ytimg.com/vi/abc123/hqdefault.jpg', 'image'),
    ).toBe(false);
  });

  it('允许白名单内的音频域名', () => {
    expect(
      isAllowedExternalMediaUrl(
        'https://m10.music.126.net/20260117193723/21da7fba63a7ed59ca01ad2fd95faa3b/ymusic/obj/w5zDlMODwrDDiGjCn8Ky/77789048916/d0df/bb75/5d14/93457a6614d6c40e08aff56adcd8c696.mp3',
        'audio',
      ),
    ).toBe(true);

    expect(isAllowedExternalMediaUrl('https://www.ximalaya.com/track/123456789', 'audio')).toBe(true);
  });

  it('阻止非白名单的音频域名', () => {
    expect(isAllowedExternalMediaUrl('https://www.youtube.com/watch?v=abc', 'audio')).toBe(false);
  });

  it('阻止非 http/https 协议', () => {
    expect(isAllowedExternalMediaUrl('data:audio/mp3;base64,Zm9v', 'audio')).toBe(false);
  });

  it('允许白名单内的视频域名', () => {
    expect(isAllowedExternalMediaUrl('https://v.youku.com/v_show/id_abc123.html', 'video')).toBe(true);
    expect(isAllowedExternalMediaUrl('https://www.iqiyi.com/v_abc123.html', 'video')).toBe(true);
    expect(isAllowedExternalMediaUrl('https://www.bilibili.com/video/BV1xK4y1Z7yH', 'video')).toBe(true);
  });

  it('阻止非白名单的视频域名', () => {
    expect(isAllowedExternalMediaUrl('https://video.example.com/clip.mp4', 'video')).toBe(false);
  });

  it('识别常见视频文件扩展名', () => {
    expect(isLikelyVideoUrl('https://media.example.com/clip.mp4')).toBe(true);
    expect(isLikelyVideoUrl('https://media.example.com/stream.m3u8?token=abc')).toBe(true);
    expect(isLikelyVideoUrl('https://media.example.com/clip.webm#t=5')).toBe(true);
    expect(isLikelyVideoUrl('https://www.example.com/watch?v=123')).toBe(false);
  });
});
