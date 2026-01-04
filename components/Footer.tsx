import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

import { qqGroups } from '@/lib/communityGroups';

interface FooterProps {
  className?: string;
  textWhite?: boolean;
  showSponsor?: boolean;
}

export default function Footer({ className = "footer", textWhite = false }: FooterProps) {
  return (
    <footer className={className} style={{ color: textWhite ? 'white' : '' }}>
      <p>
        本项目绝赞靠爱发电中，
      </p>
      <p>欢迎在爱发电上赞助我们！</p>
      <p style={{ textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
        <Link href="https://afdian.com/a/colanns" target="_blank" rel="noopener noreferrer">
          {textWhite ? <Image src="/afdian-white.svg" alt="afdian" width={120} height={20} /> : <Image src="/afdian.svg" alt="afdian" width={120} height={20} />}
        </Link>
      </p>
      <p>
        交流群{' '}
        {qqGroups.map((group, index) => (
          <React.Fragment key={group.groupCode}>
            {index > 0 ? ' / ' : null}
            <a
              href={group.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              title={group.name}
            >
              {group.groupCode}
            </a>
          </React.Fragment>
        ))}
      </p>
      <p>
        腾讯频道 <a href="https://pd.qq.com/s/brisxifbl" target="_blank" rel="noopener noreferrer" className="footer-link">pd73230758</a>
      </p>
      <p>
        设计与制作 <a href="https://github.com/notuhao" target="_blank" rel="noopener noreferrer" className="footer-link">@末伏之夜</a>
      </p>
      <p>
        程序与美工 <a href="https://github.com/colasama" target="_blank" rel="noopener noreferrer" className="footer-link">@Colanns</a>
      </p>
      <p>
        本项目 AI 能力由&nbsp;
        <a href="https://github.com/KouriChat/KouriChat" target="_blank" rel="noopener noreferrer" className="footer-link">KouriChat</a> &&nbsp;
        <a href="https://api.kourichat.com/" target="_blank" rel="noopener noreferrer" className="footer-link">Kouri API</a>
        &nbsp;强力支持
      </p>
      <p>
        <a href="https://docs.qq.com/form/page/DYmdrdWFQdmZCSGdZ" target="_blank" rel="noopener noreferrer" className="footer-link">反馈问题</a>
      </p>
      <p>
        <Link href="/encyclopedia" className="footer-link">百科</Link>
      </p>
      <p>
        <a href="https://github.com/colasama/MahoShojo-Generator" target="_blank" rel="noopener noreferrer" className="footer-link">colasama/MahoShojo-Generator</a>
      </p>
    </footer>
  );
}
